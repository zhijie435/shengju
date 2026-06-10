const { pool } = require('../config/database');
const ExamSummaryModel = require('../models/examSummaryModel');
const { isObjectiveAnswerTypeStrict, getAnswerTypeForGrading } = require('./gradingService');

/**
 * 与 gradeExamSubmissions 中会话 total_score 兜底一致：同一逻辑小题只计一次分，取各答案行中 MAX(score)。
 * 将 question_number 解析到试卷小题 id，避免「sq# 一条 + qn# 一条」对同一题重复累加（常见表现为主观分多 5 分等）。
 */
function buildSqByQuestionNumberMap(subQuestions, displayNumberOverrides) {
  const map = new Map();
  const ov = displayNumberOverrides || {};
  subQuestions.forEach((sq, idx) => {
    const displayNum =
      ov[sq.id] != null && String(ov[sq.id]).trim() !== ''
        ? String(ov[sq.id]).trim()
        : String(idx + 1);
    map.set(displayNum, sq);
    if (sq.number != null && String(sq.number).trim() !== '') map.set(String(sq.number).trim(), sq);
    if (sq.sub_number != null && String(sq.sub_number).trim() !== '') map.set(String(sq.sub_number).trim(), sq);
  });
  return map;
}

/**
 * 将答案行解析到试卷小题（与 gradingService.gradeSession 题号规则一致，并增加纯数字题号 → 全卷第 N 小题兜底，避免 sq# 与 qn# 分裂导致客观分算两次）
 * @param {object[]} orderedSubQuestions 已按 major_number, number, sub_number 排序的小题列表
 */
function resolveSqForAnswer(answer, sqMap, sqByQN, orderedSubQuestions = []) {
  const sid = answer.sub_question_id;
  if (sid != null && sid !== '') {
    const sq = sqMap.get(sid) ?? sqMap.get(Number(sid));
    if (sq) return sq;
  }
  const qn = answer.question_number != null ? String(answer.question_number).trim() : '';
  if (!qn) return null;
  let sq = sqByQN.get(qn);
  if (!sq && qn.includes('--')) {
    const parts = qn.split('--');
    if (parts.length >= 2) sq = sqByQN.get(String(parts[0]).trim());
  }
  if (!sq && qn.includes('-')) {
    const parts = qn.split('-');
    if (parts.length >= 2) sq = sqByQN.get(String(parts[0]).trim());
  }
  // 与 buildSqByQuestionNumberMap 中默认展示序号一致：题号为纯数字 "N" 时对应全卷第 N 小题（仅当未携带无效 sub_question_id，避免脏数据误挂）
  if (!sq && orderedSubQuestions.length && (sid == null || sid === '')) {
    if (/^\d+$/.test(qn)) {
      const idx = parseInt(qn, 10);
      if (idx >= 1 && idx <= orderedSubQuestions.length) {
        sq = orderedSubQuestions[idx - 1];
      }
    }
  }
  return sq || null;
}

/** 稳定分组键：尽量归一到真实小题 id，避免同一客观题出现 sq#id 与 qn#xxx 两条分组 */
function canonicalAnswerGroupKey(answer, sqMap, sqByQN, orderedSubQuestions) {
  const sq = resolveSqForAnswer(answer, sqMap, sqByQN, orderedSubQuestions);
  if (sq && sq.id != null) return `sq#${sq.id}`;
  if (answer.sub_question_id != null && answer.sub_question_id !== '') return `sq#${answer.sub_question_id}`;
  if (answer.question_number != null && String(answer.question_number).trim() !== '') {
    return `qn#${String(answer.question_number).trim()}`;
  }
  return `id#${answer.id}`;
}

function pickRepresentativeAnswerRow(rows) {
  const withSid = rows.find((r) => r.sub_question_id != null && r.sub_question_id !== '');
  if (withSid) return withSid;
  const withType = rows.find((r) => r.question_type);
  if (withType) return withType;
  return rows[0];
}

/** 以试卷小题定义为准拆分主/客观（避免答案行 JOIN 缺失时 question_type 为空被当成主观） */
function isObjectiveByPaperDefinition(answer, sqMap, answerTypeOverrides) {
  const sid = answer.sub_question_id;
  let qt = answer.question_type || '';
  if (sid != null && sid !== '') {
    const sqRow = sqMap.get(sid) ?? sqMap.get(Number(sid));
    if (sqRow && sqRow.question_type) qt = sqRow.question_type;
  }
  const answerType = getAnswerTypeForGrading(qt, answerTypeOverrides, sid);
  return isObjectiveAnswerTypeStrict(answerType);
}

function dedupeAnswersForSummary(answers, sqMap, sqByQN, orderedSubQuestions) {
  const groups = new Map();
  for (const a of answers) {
    const key = canonicalAnswerGroupKey(a, sqMap, sqByQN, orderedSubQuestions);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const out = [];
  for (const rows of groups.values()) {
    const rep = pickRepresentativeAnswerRow(rows);
    let best = null;
    for (const r of rows) {
      if (r.score == null || r.score === '') continue;
      const v = parseFloat(r.score);
      if (Number.isNaN(v)) continue;
      best = best == null ? v : Math.max(best, v);
    }
    const sq = resolveSqForAnswer(rep, sqMap, sqByQN, orderedSubQuestions);
    const merged = {
      ...rep,
      sub_question_id: sq && sq.id != null ? sq.id : rep.sub_question_id,
      question_type: (sq && sq.question_type) || rep.question_type,
      max_score:
        rep.max_score != null && rep.max_score !== ''
          ? rep.max_score
          : (sq && sq.score != null ? sq.score : rep.max_score),
      score: best != null ? best : null
    };
    out.push(merged);
  }
  return out;
}

/**
 * 考试汇总数据服务
 */
class ExamSummaryService {
  /**
   * 确保指定考试的已交卷会话都存在汇总记录（阶段三优化：异步化+互斥锁，不阻塞列表请求）
   */
  static async ensureExamSummariesForExam(examId) {
    const lockKey = `summary_lock:${examId}`;
    if (this._summaryLocks && this._summaryLocks.has(lockKey)) return; // 已有生成任务在跑，跳过

    const run = async () => {
      try {
        const [sessions] = await pool.execute(
          `SELECT id FROM exam_sessions WHERE exam_id = ? AND status IN ('submitted', 'force_submitted')`,
          [examId]
        );
        if (!sessions || sessions.length === 0) return;

        const [summaryRows] = await pool.execute(
          `SELECT session_id FROM exam_summaries WHERE exam_id = ?`, [examId]
        );
        const existing = new Set((summaryRows || []).map((r) => Number(r.session_id)));
        for (const s of sessions) {
          const sid = Number(s.id);
          if (!existing.has(sid)) {
            try {
              await this.generateSummary(sid);
            } catch (e) {
              console.warn('[ensureExamSummariesForExam] generate failed:', sid, e.message || e);
            }
          }
        }
      } finally {
        if (this._summaryLocks) this._summaryLocks.delete(lockKey);
      }
    };

    if (!this._summaryLocks) this._summaryLocks = new Map();
    this._summaryLocks.set(lockKey, run());
  }

  // 异步批量生成（供接口后台调用，不阻塞响应）
  static async batchGenerateAsync(examId) {
    setImmediate(() => this.ensureExamSummariesForExam(examId));
  }

  /**
   * 生成考试汇总数据
   */
  static async generateSummary(sessionId) {
    // 获取会话信息
    const [sessions] = await pool.execute(
      `SELECT s.*, e.paper_id, e.id as exam_id
       FROM exam_sessions s
       JOIN exams e ON s.exam_id = e.id
       WHERE s.id = ?`,
      [sessionId]
    );

    if (!sessions[0]) {
      throw new Error('考试会话不存在');
    }

    const session = sessions[0];
    const examId = session.exam_id;
    const userId = session.user_id;
    const paperId = session.paper_id;

    // 获取考试配置（与主观题阅卷、客观题判定一致，用于正确拆分客观/主观得分 + 题号映射去重）
    let answerTypeOverrides = {};
    let displayNumberOverrides = {};
    try {
      const [examRows] = await pool.execute('SELECT answer_system_config FROM exams WHERE id = ?', [examId]);
      if (examRows[0] && examRows[0].answer_system_config) {
        const config = typeof examRows[0].answer_system_config === 'string'
          ? JSON.parse(examRows[0].answer_system_config) : examRows[0].answer_system_config;
        answerTypeOverrides = config.answerTypeOverrides || {};
        displayNumberOverrides = config.displayNumberOverrides || {};
      }
    } catch (e) {
      // 忽略，使用默认按题型判断
    }

    // 获取所有答案
    const [answers] = await pool.execute(
      `SELECT a.*, sq.score as max_score, sq.exam_purpose, sq.difficulty,
              mq.question_type
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id = ?`,
      [sessionId]
    );

    // 获取试卷所有小题（用于计算满分；顺序与客观阅卷题号映射一致）
    const [subQuestions] = await pool.execute(
      `SELECT sq.*, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );

    const sqMap = new Map();
    for (const sq of subQuestions) {
      if (sq.id == null) continue;
      sqMap.set(sq.id, sq);
      sqMap.set(Number(sq.id), sq);
    }
    const sqByQuestionNumber = buildSqByQuestionNumberMap(subQuestions, displayNumberOverrides);
    const answersDeduped = dedupeAnswersForSummary(answers, sqMap, sqByQuestionNumber, subQuestions);

    // 满分：优先用试卷表 total_score（与「试卷设置 100 分」一致）；未维护或为 0 时回退为小题分值之和
    let paperConfiguredTotal = 0;
    try {
      const [paperRows] = await pool.execute(
        'SELECT COALESCE(total_score, 0) AS total_score FROM exam_papers WHERE id = ?',
        [paperId]
      );
      paperConfiguredTotal = parseFloat(paperRows[0]?.total_score || 0) || 0;
    } catch (_) {
      paperConfiguredTotal = 0;
    }
    const sumSubQuestionScores = subQuestions.reduce((sum, sq) => sum + (parseFloat(sq.score) || 0), 0);
    const maxScore = paperConfiguredTotal > 0 ? paperConfiguredTotal : sumSubQuestionScores;

    // 计算答题时长
    let answerTimeSeconds = 0;
    if (session.started_at && session.submitted_at) {
      const started = new Date(session.started_at);
      const submitted = new Date(session.submitted_at);
      answerTimeSeconds = Math.floor((submitted - started) / 1000);
    }

    // 计算客观题和主观题得分（与阅卷系统一致：使用考试答题方式覆盖配置区分客观/主观）
    let objectiveScore = 0;
    let subjectiveScore = 0;

    answersDeduped.forEach((answer) => {
      const score = parseFloat(answer.score || 0);
      if (isObjectiveByPaperDefinition(answer, sqMap, answerTypeOverrides)) {
        objectiveScore += score;
      } else {
        subjectiveScore += score;
      }
    });

    // 汇总总分必须与「客观+主观」同源，避免 session.total_score 与按题拆分不一致（重复答案行、只更新部分分数、会话总分未重算等）
    const totalScore = objectiveScore + subjectiveScore;
    const scoreRate = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    // 计算各题型统计（按去重后的一小题一行，避免重复行抬高得分）
    const questionTypeStats = this.calculateQuestionTypeStats(answersDeduped, subQuestions);

    // 计算各难度统计
    const difficultyStats = this.calculateDifficultyStats(answersDeduped, subQuestions);

    // 计算各考察目的统计
    const examPurposeStats = this.calculateExamPurposeStats(answersDeduped, subQuestions);

    // 计算正确/错误/未答题数
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    answersDeduped.forEach((answer) => {
      const score = parseFloat(answer.score || 0);
      const rowMax = parseFloat(answer.max_score || 0);
      if (rowMax === 0) {
        unansweredCount++;
      } else if (score >= rowMax * 0.6) { // 60%以上算正确
        correctCount++;
      } else if (score > 0) {
        wrongCount++;
      } else {
        unansweredCount++;
      }
    });

    // 分析知识点掌握情况
    const knowledgePoints = this.analyzeKnowledgePoints(answersDeduped, subQuestions);

    // 创建或更新汇总数据
    const existing = await ExamSummaryModel.findBySessionId(sessionId);
    const summaryData = {
      sessionId,
      examId,
      userId,
      totalScore,
      maxScore,
      scoreRate: parseFloat(scoreRate.toFixed(2)),
      answerTimeSeconds,
      submittedAt: session.submitted_at,
      objectiveScore,
      subjectiveScore,
      questionTypeStats,
      difficultyStats,
      examPurposeStats,
      correctCount,
      wrongCount,
      unansweredCount,
      knowledgePoints
    };

    if (existing) {
      await ExamSummaryModel.update(existing.id, summaryData);
      return await ExamSummaryModel.findById(existing.id);
    } else {
      const id = await ExamSummaryModel.create(summaryData);
      return await ExamSummaryModel.findById(id);
    }
  }

  /**
   * 计算各题型统计
   */
  static calculateQuestionTypeStats(answers, subQuestions) {
    const stats = {};
    const sqMap = new Map(subQuestions.map(sq => [sq.id, sq]));

    answers.forEach(answer => {
      const questionType = answer.question_type || '未知题型';
      const score = parseFloat(answer.score || 0);
      const maxScore = parseFloat(answer.max_score || 0);

      if (!stats[questionType]) {
        stats[questionType] = {
          totalScore: 0,
          maxScore: 0,
          count: 0,
          correctCount: 0
        };
      }

      stats[questionType].totalScore += score;
      stats[questionType].maxScore += maxScore;
      stats[questionType].count++;
      if (score >= maxScore * 0.6) {
        stats[questionType].correctCount++;
      }
    });

    // 计算得分率
    Object.keys(stats).forEach(type => {
      const stat = stats[type];
      stat.scoreRate = stat.maxScore > 0 ? (stat.totalScore / stat.maxScore) * 100 : 0;
      stat.correctRate = stat.count > 0 ? (stat.correctCount / stat.count) * 100 : 0;
    });

    return stats;
  }

  /**
   * 计算各难度统计
   */
  static calculateDifficultyStats(answers, subQuestions) {
    const stats = {};
    const sqMap = new Map(subQuestions.map(sq => [sq.id, sq]));

    answers.forEach(answer => {
      const difficulty = answer.difficulty || '未知难度';
      const score = parseFloat(answer.score || 0);
      const maxScore = parseFloat(answer.max_score || 0);

      if (!stats[difficulty]) {
        stats[difficulty] = {
          totalScore: 0,
          maxScore: 0,
          count: 0,
          correctCount: 0
        };
      }

      stats[difficulty].totalScore += score;
      stats[difficulty].maxScore += maxScore;
      stats[difficulty].count++;
      if (score >= maxScore * 0.6) {
        stats[difficulty].correctCount++;
      }
    });

    // 计算得分率
    Object.keys(stats).forEach(difficulty => {
      const stat = stats[difficulty];
      stat.scoreRate = stat.maxScore > 0 ? (stat.totalScore / stat.maxScore) * 100 : 0;
      stat.correctRate = stat.count > 0 ? (stat.correctCount / stat.count) * 100 : 0;
    });

    return stats;
  }

  /**
   * 计算各考察目的统计
   */
  static calculateExamPurposeStats(answers, subQuestions) {
    const stats = {};
    const sqMap = new Map(subQuestions.map(sq => [sq.id, sq]));

    answers.forEach(answer => {
      const examPurpose = answer.exam_purpose || '未设置考察目的';
      const score = parseFloat(answer.score || 0);
      const maxScore = parseFloat(answer.max_score || 0);

      if (!stats[examPurpose]) {
        stats[examPurpose] = {
          totalScore: 0,
          maxScore: 0,
          count: 0,
          correctCount: 0
        };
      }

      stats[examPurpose].totalScore += score;
      stats[examPurpose].maxScore += maxScore;
      stats[examPurpose].count++;
      if (score >= maxScore * 0.6) {
        stats[examPurpose].correctCount++;
      }
    });

    // 计算得分率
    Object.keys(stats).forEach(purpose => {
      const stat = stats[purpose];
      stat.scoreRate = stat.maxScore > 0 ? (stat.totalScore / stat.maxScore) * 100 : 0;
      stat.correctRate = stat.count > 0 ? (stat.correctCount / stat.count) * 100 : 0;
    });

    return stats;
  }

  /**
   * 分析知识点掌握情况
   */
  static analyzeKnowledgePoints(answers, subQuestions) {
    const knowledgePoints = {};
    const sqMap = new Map(subQuestions.map(sq => [sq.id, sq]));

    answers.forEach(answer => {
      const examPurpose = answer.exam_purpose || '未设置考察目的';
      const score = parseFloat(answer.score || 0);
      const maxScore = parseFloat(answer.max_score || 0);

      if (!knowledgePoints[examPurpose]) {
        knowledgePoints[examPurpose] = {
          totalScore: 0,
          maxScore: 0,
          count: 0,
          masteryLevel: '未掌握' // 未掌握、部分掌握、掌握、熟练掌握
        };
      }

      knowledgePoints[examPurpose].totalScore += score;
      knowledgePoints[examPurpose].maxScore += maxScore;
      knowledgePoints[examPurpose].count++;
    });

    // 计算掌握程度
    Object.keys(knowledgePoints).forEach(purpose => {
      const kp = knowledgePoints[purpose];
      const rate = kp.maxScore > 0 ? (kp.totalScore / kp.maxScore) * 100 : 0;
      if (rate >= 90) {
        kp.masteryLevel = '熟练掌握';
      } else if (rate >= 70) {
        kp.masteryLevel = '掌握';
      } else if (rate >= 50) {
        kp.masteryLevel = '部分掌握';
      } else {
        kp.masteryLevel = '未掌握';
      }
      kp.masteryRate = parseFloat(rate.toFixed(2));
    });

    return knowledgePoints;
  }

  /**
   * 获取考试整体统计信息
   */
  static async getExamStatistics(examId) {
    const summaries = await ExamSummaryModel.findByExamId(examId);

    if (summaries.length === 0) {
      return {
        totalCandidates: 0,
        averageScore: 0,
        averageScoreRate: 0,
        highestScore: 0,
        lowestScore: 0,
        passRate: 0
      };
    }

    const totalCandidates = summaries.length;
    const totalScore = summaries.reduce((sum, s) => sum + parseFloat(s.total_score || 0), 0);
    const averageScore = totalScore / totalCandidates;
    const averageScoreRate = summaries.reduce((sum, s) => sum + parseFloat(s.score_rate || 0), 0) / totalCandidates;
    const scores = summaries.map(s => parseFloat(s.total_score || 0)).sort((a, b) => b - a);
    const highestScore = scores[0] || 0;
    const lowestScore = scores[scores.length - 1] || 0;
    const passCount = summaries.filter(s => parseFloat(s.score_rate || 0) >= 60).length;
    const passRate = (passCount / totalCandidates) * 100;

    return {
      totalCandidates,
      averageScore: parseFloat(averageScore.toFixed(2)),
      averageScoreRate: parseFloat(averageScoreRate.toFixed(2)),
      highestScore,
      lowestScore,
      passRate: parseFloat(passRate.toFixed(2))
    };
  }
}

module.exports = ExamSummaryService;
