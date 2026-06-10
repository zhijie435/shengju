/**
 * 阅卷服务：客观题自动阅卷
 */
const { pool } = require('../config/database');
const { cleanAnswerText } = require('../utils/textCleaner');

const OBJECTIVE_TYPES = ['choice', 'judge', 'multichoice', 'blank', '选择题', '判断题', '多选题', '单选题', '填空题'];

function normalizeAnswer(val) {
  if (val == null) return '';
  if (Array.isArray(val)) return val.map(v => String(v).trim().toUpperCase()).sort().join(',');
  const str = String(val).trim();
  // 处理判断题的多种表示方式
  if (/^(正确|对|是|true|yes|t|1)$/i.test(str)) return '正确';
  if (/^(错误|错|否|false|no|f|0)$/i.test(str)) return '错误';
  // 处理选择题答案（去除空格、统一大写）
  return str.toUpperCase().replace(/\s+/g, '').replace(/[,，、]/g, ',');
}

function parseStandardAnswer(std) {
  if (!std) return [];
  const s = String(std).trim();
  // 处理判断题
  if (/^(正确|对|是|true|yes|t|1)$/i.test(s)) return ['正确'];
  if (/^(错误|错|否|false|no|f|0)$/i.test(s)) return ['错误'];
  // 处理多选题/选择题（支持多种分隔符）
  if (s.includes(',') || s.includes('，') || s.includes('、')) {
    return s.split(/[,，、\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean).sort();
  }
  return [s.toUpperCase()];
}

function isObjectiveQuestionType(type) {
  if (!type) return false;
  const t = String(type);
  return OBJECTIVE_TYPES.some(ot => t.includes(ot));
}

/**
 * 评分客观题：答案一致给满分（ratio=1），不一致给0分（ratio=0）
 * @param {string|Array|Object} userAnswer - 考生答案
 * @param {string} standardAnswer - 标准答案
 * @param {string} questionType - 题型（用于判断是否多选题）
 * @returns {number|null} 1=正确（给满分），0=错误（给0分），null=无法判断
 */
function scoreObjective(userAnswer, standardAnswer, questionType) {
  const std = parseStandardAnswer(standardAnswer);
  if (std.length === 0) return null;

  let userVal = null;
  if (Array.isArray(userAnswer)) {
    // 数组格式（如 blanks）
    userVal = userAnswer.map(v => String(v).trim().toUpperCase()).sort().join(',');
  } else if (userAnswer && typeof userAnswer === 'object' && userAnswer.selected) {
    // 对象格式，含 selected 字段（多选题）
    userVal = (userAnswer.selected || []).map(v => String(v).trim().toUpperCase()).sort().join(',');
  } else {
    // 字符串格式
    userVal = normalizeAnswer(userAnswer);
  }

  const stdStr = std.join(',');
  const isMulti = questionType && (String(questionType).includes('多') || String(questionType).includes('multichoice'));
  
  // 多选题和单选题/判断题/填空题统一规则：完全一致给满分（1），不一致给0分（0）
  // 多选题必须完全匹配（顺序、数量、内容都一致）
  if (isMulti) {
    // 多选题：答案必须完全一致（包括顺序，已排序）
    return userVal === stdStr ? 1 : 0;
  }
  
  // 单选题/判断题/填空题：答案一致给满分，不一致给0分
  return userVal === stdStr ? 1 : 0;
}

const TYPE_MAP_GRADE = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
const OBJECTIVE_GRADE = ['choice', 'multichoice', 'judge', 'blank'];

/**
 * 与 gradeSession 自动阅卷、汇总客观/主观拆分一致：仅 choice/multichoice/judge/blank 为客观；
 * 同时识别 answerTypeOverrides 里直接写的中文题型（与 TYPE_MAP_GRADE 一致），避免误判为主观导致「客观分少算、主观分多算」。
 */
function isObjectiveAnswerTypeStrict(type) {
  if (type == null || type === '') return false;
  const t = String(type).trim();
  if (OBJECTIVE_GRADE.includes(t)) return true;
  for (const [k, v] of Object.entries(TYPE_MAP_GRADE)) {
    if (t.includes(k)) return OBJECTIVE_GRADE.includes(v);
  }
  return false;
}

function getAnswerTypeForGrading(qt, overrides, subId) {
  const override = overrides && (overrides[subId] || overrides[String(subId)]);
  if (override) return override;
  if (!qt) return 'text';
  const t = String(qt).trim();
  for (const [k, v] of Object.entries(TYPE_MAP_GRADE)) { if (t.includes(k)) return v; }
  return 'text';
}

async function gradeSession(sessionId, answerTypeOverrides = {}, examConfig = null) {
  const [sessions] = await pool.execute(
    'SELECT * FROM exam_sessions WHERE id = ?',
    [sessionId]
  );
  const session = sessions[0];
  if (!session) throw new Error('会话不存在');
  if (session.status !== 'submitted' && session.status !== 'ongoing') {
    throw new Error('只能对已交卷的会话阅卷');
  }

  const [answers] = await pool.execute(
    'SELECT * FROM exam_answers WHERE session_id = ?',
    [sessionId]
  );

  const examId = session.exam_id;
  const [examRows] = await pool.execute('SELECT paper_id, answer_system_config FROM exams WHERE id = ?', [examId]);
  const exam = examRows[0];
  const paperId = exam?.paper_id;
  if (!paperId) return { graded: 0, totalScore: 0 };

  const [subQuestions] = await pool.execute(
    `SELECT sq.*, mq.question_type 
     FROM exam_paper_sub_questions sq 
     JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id 
     WHERE sq.paper_id = ? ORDER BY mq.major_number, sq.number, sq.sub_number`,
    [paperId]
  );
  const sqMap = new Map(subQuestions.map(s => [s.id, s]));
  
  // 构建按 question_number 匹配的映射（用于统一提交的客观题答案）
  const displayNumberOverrides = (exam?.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
  const sqByQuestionNumber = new Map();
  subQuestions.forEach((sq, idx) => {
    const displayNum = (displayNumberOverrides[sq.id] && String(displayNumberOverrides[sq.id]).trim()) || String(idx + 1);
    sqByQuestionNumber.set(displayNum, sq);
    if (sq.number) sqByQuestionNumber.set(String(sq.number).trim(), sq);
    if (sq.sub_number) sqByQuestionNumber.set(String(sq.sub_number).trim(), sq);
  });

  let totalScore = 0;
  let gradedCount = 0;
  const gradedSubQuestionIds = new Set();

  for (const ans of answers) {
    let sq = null;
    if (ans.sub_question_id) {
      sq = sqMap.get(ans.sub_question_id);
    } else if (ans.question_number) {
      const qn = String(ans.question_number).trim();
      sq = sqByQuestionNumber.get(qn);
      // 尝试匹配 displayNum--subIdx 格式
      if (!sq && qn.includes('--')) {
        const parts = qn.split('--');
        if (parts.length >= 2) {
          sq = sqByQuestionNumber.get(parts[0]);
        }
      }
      if (!sq && qn.includes('-')) {
        const parts = qn.split('-');
        if (parts.length >= 2) {
          sq = sqByQuestionNumber.get(parts[0]);
        }
      }
    }
    if (!sq) continue;
    
    const answerType = getAnswerTypeForGrading(sq.question_type, answerTypeOverrides, sq.id);
    if (!isObjectiveAnswerTypeStrict(answerType)) continue;
    // 兜底去重：同一小题可能同时存在 sub_question_id 版本与 question_number 版本答案，只保留首次命中的一条
    if (sq.id != null && gradedSubQuestionIds.has(sq.id)) {
      // 同一小题的重复答案行不参与计分，避免总分重复累加
      await pool.execute(
        'UPDATE exam_answers SET score = NULL WHERE id = ?',
        [ans.id]
      );
      continue;
    }
    // 标准答案优先用 standard_answer（与客观题设置同步），为空时用 answer/answer_html
    const rawStandard = (sq.standard_answer && String(sq.standard_answer).trim()) || (sq.answer && String(sq.answer).trim()) || (sq.answer_html ? String(sq.answer_html).replace(/<[^>]+>/g, '').trim() : '') || '';
    const standardAnswer = cleanAnswerText(rawStandard);
    if (!standardAnswer) continue;

    let userAnswer = ans.answer_text;
    if (ans.answer_data) {
      try {
        const d = typeof ans.answer_data === 'string' ? JSON.parse(ans.answer_data) : ans.answer_data;
        if (d.selected) userAnswer = d.selected;
        else if (d.blanks) userAnswer = d.blanks;
      } catch (_) {}
    }

    const ratio = scoreObjective(userAnswer, standardAnswer, answerType);
    // ratio = 1 表示答案正确，给满分；ratio = 0 表示答案错误，给0分
    const score = ratio !== null ? (ratio * (sq.score || 0)) : null;
    if (score !== null) {
      await pool.execute(
        'UPDATE exam_answers SET score = ? WHERE id = ?',
        [score, ans.id]
      );
      if (sq.id != null) gradedSubQuestionIds.add(sq.id);
      totalScore += score;
      gradedCount++;
    }
  }

  await pool.execute(
    'UPDATE exam_sessions SET total_score = ? WHERE id = ?',
    [totalScore, sessionId]
  );

  return { graded: gradedCount, totalScore };
}

async function gradeExamSubmissions(examId, exam = null) {
  const ExamSummaryService = require('./examSummaryService');
  let overrides = {};
  if (exam && exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) {
    overrides = exam.answer_system_config.answerTypeOverrides;
  }
  // 获取完整的 exam 对象（含 answer_system_config）
  if (!exam) {
    const [examRows] = await pool.execute('SELECT * FROM exams WHERE id = ?', [examId]);
    exam = examRows[0] || null;
  }
  const [sessions] = await pool.execute(
    'SELECT id FROM exam_sessions WHERE exam_id = ? AND status IN (\'submitted\', \'force_submitted\')',
    [examId]
  );
  const results = [];
  for (const row of sessions) {
    try {
      const r = await gradeSession(row.id, overrides, exam);
      await ExamSummaryService.generateSummary(row.id).catch(err => {
        console.error('generateSummary after objective grading:', err);
      });
      results.push({ sessionId: row.id, ...r });
    } catch (e) {
      results.push({ sessionId: row.id, error: e.message });
    }
  }
  // 兜底回填：保证已交卷会话的 total_score 不为空，避免前端显示 '-'
  try {
    await pool.execute(
      `UPDATE exam_sessions s
       LEFT JOIN (
         SELECT a1.session_id, COALESCE(SUM(a1.score), 0) AS total_score
         FROM (
           SELECT
             session_id,
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END AS logical_key,
             MAX(score) AS score
           FROM exam_answers
           WHERE score IS NOT NULL
           GROUP BY
             session_id,
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END
         ) a1
         GROUP BY a1.session_id
       ) t ON t.session_id = s.id
       SET s.total_score = COALESCE(t.total_score, 0)
       WHERE s.exam_id = ? AND s.status IN ('submitted', 'force_submitted')`,
      [examId]
    );
  } catch (e) {
    console.warn('[gradeExamSubmissions] total_score fallback update failed:', e.message || e);
  }
  return results;
}

/**
 * 检查该考试下所有客观题是否均已设置标准答案（阅卷前置条件）
 * @param {number} examId
 * @param {object} exam - 考试对象，需含 paper_id、answer_system_config
 * @returns {{ ok: boolean, missingCount: number }}
 */
async function checkObjectiveSettingsComplete(examId, exam) {
  const paperId = exam?.paper_id;
  if (!paperId) return { ok: true, missingCount: 0 };
  const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT sq.id, sq.standard_answer, sq.answer, sq.answer_html, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?`,
      [paperId]
    );
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' && (e.message || '').includes('standard_answer')) {
      return { ok: false, missingCount: 1 };
    }
    if (e.code === 'ER_NO_SUCH_TABLE' || (e.message || '').includes("doesn't exist")) {
      return { ok: true, missingCount: 0 };
    }
    throw e;
  }
  const TYPE_MAP = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
  const OBJECTIVE = ['choice', 'multichoice', 'judge', 'blank'];
  const getType = (qt) => {
    if (!qt) return 'text';
    const t = String(qt).trim();
    for (const [k, v] of Object.entries(TYPE_MAP)) { if (t.includes(k)) return v; }
    return 'text';
  };
  let missingCount = 0;
  for (const r of rows) {
    const answerType = overrides[r.id] || getType(r.question_type);
    if (!OBJECTIVE.includes(answerType)) continue;
    const sa = (r.standard_answer || '').toString().trim();
    const rawFromAnswer = (r.answer || '').toString().trim() || (r.answer_html ? String(r.answer_html).replace(/<[^>]+>/g, '').trim() : '');
    const fromAnswer = cleanAnswerText(rawFromAnswer);
    if (!sa && !fromAnswer) missingCount++;
  }
  return { ok: missingCount === 0, missingCount };
}

/**
 * 检查该考试客观题是否已全部阅卷完成（每份已交卷答卷的客观题均有得分）
 * @param {number} examId
 * @param {object} exam - 考试对象，需含 paper_id、answer_system_config
 * @returns {Promise<{ ok: boolean }>}
 */
async function checkObjectiveGradedStatus(examId, exam) {
  const paperId = exam?.paper_id;
  if (!paperId) return { ok: true };
  const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT sq.id, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?`,
      [paperId]
    );
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || (e.message || '').includes("doesn't exist")) {
      return { ok: true };
    }
    throw e;
  }
  const TYPE_MAP = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
  const OBJECTIVE = ['choice', 'multichoice', 'judge', 'blank'];
  const getType = (qt) => {
    if (!qt) return 'text';
    const t = String(qt).trim();
    for (const [k, v] of Object.entries(TYPE_MAP)) { if (t.includes(k)) return v; }
    return 'text';
  };
  const objectiveSubIds = rows
    .filter(r => OBJECTIVE.includes(overrides[r.id] || getType(r.question_type)))
    .map(r => r.id);
  if (objectiveSubIds.length === 0) return { ok: true };

  const [sessions] = await pool.execute(
    `SELECT id FROM exam_sessions WHERE exam_id = ? AND status IN ('submitted', 'force_submitted')`,
    [examId]
  );
  if (sessions.length === 0) return { ok: true };

  const placeholders = objectiveSubIds.map(() => '?').join(',');
  for (const s of sessions) {
    const [countRows] = await pool.execute(
      `SELECT COUNT(DISTINCT a.id) AS cnt FROM exam_answers a
       WHERE a.session_id = ? AND a.sub_question_id IN (${placeholders}) AND a.score IS NOT NULL`,
      [s.id, ...objectiveSubIds]
    );
    const cnt = countRows[0]?.cnt || 0;
    if (cnt < objectiveSubIds.length) return { ok: false };
  }
  return { ok: true };
}

module.exports = {
  gradeSession,
  gradeExamSubmissions,
  isObjectiveQuestionType,
  isObjectiveAnswerTypeStrict,
  checkObjectiveSettingsComplete,
  checkObjectiveGradedStatus,
  scoreObjective,
  getAnswerTypeForGrading
};
