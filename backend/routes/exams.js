const express = require('express');
const router = express.Router();
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');
const ExamPaperModel = require('../models/examPaperModel');
const QuestionBankModel = require('../models/questionBankModel');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const ExamSessionModel = require('../models/examSessionModel');
const ExamAnswerModel = require('../models/examAnswerModel');
const gradingService = require('../services/gradingService');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { collectEnterpriseScopeIds } = require('../utils/enterpriseScopeIds');
const { cleanAnswerText } = require('../utils/textCleaner');
const { listGradingTasksForExam } = require('../services/gradingTaskListHelper');

function getEnterpriseId(req) {
  if (req.user.role === 'admin') return req.query.enterpriseId || req.body.enterpriseId;
  return req.enterpriseId;
}

/**
 * 客观题阅卷列表：已交卷会话 + 考生信息。与 ExamEnrollmentModel.listByExam 一致，主库为 qms_users 时不得写死 JOIN users。
 */
async function listSubmittedSessionsWithCandidates(examId) {
  const userTbl = await ExamEnrollmentModel.getCandidateUserTableName();
  const uSafe = String(userTbl).replace(/`/g, '');
  const [colRows] = await pool.execute(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [uSafe]
  );
  const uCols = new Set((colRows || []).map((r) => String(r.c).toLowerCase()));
  const nameExpr = uCols.has('real_name')
    ? 'u.real_name'
    : uCols.has('name')
      ? 'u.name AS real_name'
      : 'u.username AS real_name';
  const examNumSel = uCols.has('exam_number') ? 'u.exam_number' : 'NULL AS exam_number';
  const posSel = uCols.has('position') ? 'u.position' : 'NULL AS position';
  const orderPos = uCols.has('position') ? 'u.position, ' : '';
  const sql = `SELECT s.id, s.user_id, s.total_score, ${nameExpr}, u.username, ${examNumSel}, ${posSel}
     FROM exam_sessions s
     JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
     JOIN \`${uSafe}\` u ON u.id = s.user_id
     WHERE s.exam_id = ? AND s.status IN ('submitted', 'force_submitted')
     ORDER BY ${orderPos}s.total_score DESC`;
  const [rows] = await pool.execute(sql, [examId]);
  return rows || [];
}

/**
 * 与 GET objective-results 明细一致：客观小题列表（含 globalDisplayNumber、subIndexInMajor）
 */
async function buildObjectiveSqListForExam(exam) {
  const paperId = exam.paper_id;
  if (!paperId) return [];
  const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
  const displayNumberOverrides = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
  const [sqRows] = await pool.execute(
    `SELECT sq.id, sq.major_question_id, sq.number, sq.sub_number, sq.standard_answer, sq.score as max_score, mq.question_type
     FROM exam_paper_sub_questions sq
     JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
     WHERE sq.paper_id = ? ORDER BY mq.major_number, sq.number, sq.sub_number`,
    [paperId]
  );
  const sqRowsWithGlobal = (sqRows || []).map((r, idx) => {
    const displayNum =
      (displayNumberOverrides[r.id] && String(displayNumberOverrides[r.id]).trim()) || String(idx + 1);
    return { ...r, globalDisplayNumber: displayNum };
  });
  const ov = (id) => overrides[id] ?? overrides[String(id)];
  const list = sqRowsWithGlobal.filter((r) =>
    OBJECTIVE_ANSWER_TYPES.includes(ov(r.id) ?? getAnswerTypeFromQuestionType(r.question_type))
  );
  let subIndexInMajor = 0;
  let lastMajorId = null;
  list.forEach((sq) => {
    if (sq.major_question_id !== lastMajorId) {
      lastMajorId = sq.major_question_id;
      subIndexInMajor = 0;
    }
    sq.subIndexInMajor = subIndexInMajor;
    subIndexInMajor++;
  });
  return list;
}

/**
 * 单会话客观题得分合计：与 objective-results 展开明细同一套匹配与判分（题号匹配、score 为空时按标准答案即时算）
 */
function sumObjectiveScoreFromAnswerRows(overrides, objectiveSqList, examAnswers, objAnswers) {
  const ansBySq = new Map();
  const ansByQuestionNumber = new Map();
  for (const a of objAnswers || []) {
    if (a.question_number && String(a.question_number).trim()) {
      const key = String(a.question_number).trim();
      if (!ansByQuestionNumber.has(key)) ansByQuestionNumber.set(key, { ...a, score: null });
    }
  }
  for (const a of examAnswers || []) {
    if (a.sub_question_id != null) {
      const sid = a.sub_question_id;
      ansBySq.set(sid, a);
      if (typeof sid === 'string') ansBySq.set(Number(sid), a);
      else if (typeof sid === 'number') ansBySq.set(String(sid), a);
    }
    if (a.question_number && String(a.question_number).trim()) {
      const key = String(a.question_number).trim();
      if (!ansByQuestionNumber.has(key)) ansByQuestionNumber.set(key, a);
    }
  }
  let sum = 0;
  for (const sq of objectiveSqList) {
    const displayNum = (sq.globalDisplayNumber && String(sq.globalDisplayNumber).trim()) || '';
    const qNum = String(sq.number || '').trim();
    const qSub = String(sq.sub_number || '').trim();
    const subIdx = sq.subIndexInMajor != null ? sq.subIndexInMajor : 0;
    let ans = ansBySq.get(sq.id);
    if (!ans) {
      ans = ansByQuestionNumber.get(displayNum)
        || ansByQuestionNumber.get(`${displayNum}--${subIdx}`)
        || ansByQuestionNumber.get(`${displayNum}-${subIdx}`)
        || ansByQuestionNumber.get(qNum) || ansByQuestionNumber.get(qSub) || ansByQuestionNumber.get(qNum + (qSub ? `(${qSub})` : ''));
      if (!ans && displayNum) {
        for (let i = 0; i <= 9; i++) {
          ans = ansByQuestionNumber.get(`${displayNum}--${i}`)
            || ansByQuestionNumber.get(`${displayNum}-${i}`)
            || ansByQuestionNumber.get(`${displayNum}-${qSub || ''}-${i}`);
          if (ans) break;
        }
      }
    }
    if (!ans) continue;
    const standardAnswer = (sq.standard_answer || '').toString().trim();
    let scoreVal = ans.score != null ? Number(ans.score) : null;
    if (scoreVal === null && standardAnswer) {
      const answerType = overrides[sq.id] ?? overrides[String(sq.id)] ?? getAnswerTypeFromQuestionType(sq.question_type);
      if (OBJECTIVE_ANSWER_TYPES.includes(answerType)) {
        let userAns = ans.answer_text;
        if (ans.answer_data) {
          try {
            const d = typeof ans.answer_data === 'string' ? JSON.parse(ans.answer_data) : ans.answer_data;
            if (d.selected) userAns = d.selected;
            else if (d.blanks) userAns = d.blanks;
          } catch (_) {}
        }
        if (userAns != null && String(userAns).trim() !== '') {
          const ratio = gradingService.scoreObjective(userAns, standardAnswer, answerType);
          if (ratio !== null) {
            scoreVal = ratio * (sq.max_score || 0);
          }
        }
      }
    }
    if (scoreVal != null && !Number.isNaN(scoreVal)) sum += scoreVal;
  }
  return sum;
}

/**
 * 已交卷会话的客观题总分（与 objective-results 明细逻辑一致，避免「明细有分、列表客观题得分为 0」）
 * @param {object} exam
 * @param {number[]} sessionIds
 * @returns {Promise<Record<number, number>>}
 */
async function buildObjectiveScoreMap(exam, sessionIds) {
  const scoreMap = {};
  (sessionIds || []).forEach((id) => { scoreMap[id] = 0; });
  if (!exam?.paper_id || !sessionIds || sessionIds.length === 0) return scoreMap;

  const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
  const objectiveSqList = await buildObjectiveSqListForExam(exam);
  if (objectiveSqList.length === 0) return scoreMap;

  const sessionPh = sessionIds.map(() => '?').join(',');
  const ansBySession = new Map();
  sessionIds.forEach((id) => ansBySession.set(id, { examAnswers: [], objAnswers: [] }));

  try {
    const [allAns] = await pool.execute(
      `SELECT id, session_id, sub_question_id, question_number, answer_text, answer_data, score
       FROM exam_answers WHERE session_id IN (${sessionPh})`,
      sessionIds
    );
    for (const a of allAns || []) {
      const b = ansBySession.get(a.session_id);
      if (b) b.examAnswers.push(a);
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }

  try {
    const [allObj] = await pool.execute(
      `SELECT session_id, question_number, answer_text, answer_data FROM exam_objective_answers WHERE session_id IN (${sessionPh})`,
      sessionIds
    );
    for (const a of allObj || []) {
      const b = ansBySession.get(a.session_id);
      if (b) b.objAnswers.push(a);
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }

  for (const sid of sessionIds) {
    const { examAnswers, objAnswers } = ansBySession.get(sid) || { examAnswers: [], objAnswers: [] };
    scoreMap[sid] = sumObjectiveScoreFromAnswerRows(overrides, objectiveSqList, examAnswers, objAnswers);
  }
  return scoreMap;
}

router.use(authenticate);
router.use(async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (req.user.role === 'enterprise') {
      if (req.user.enterpriseId != null) {
        const n = parseInt(req.user.enterpriseId, 10);
        req.enterpriseId = Number.isFinite(n) && n > 0 ? n : req.user.enterpriseId;
      } else {
        let ent = null;
        try {
          ent = await EnterpriseModel.findByUserId(req.user.id);
        } catch (e) {
          console.error('Exams middleware findByUserId error:', e.message);
        }
        if (!ent || ent.status !== 'approved') {
          return res.status(403).json({ success: false, message: '企业未审核通过' });
        }
        req.enterpriseId = ent.id;
      }
    }
    next();
  } catch (e) {
    console.error('Exams middleware error:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// 考试列表：企业端只显示本企业考试（强制按 req.enterpriseId 过滤），总管理端可筛选 enterpriseId 或看全部
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let filters = {
      enterpriseId: undefined,
      status: req.query.status,
      name: req.query.name,
      page: req.query.page,
      pageSize: req.query.pageSize
    };
    if (isAdmin) {
      const q = req.query.enterpriseId;
      if (q != null && String(q).trim() !== '') {
        const n = parseInt(q, 10);
        if (Number.isFinite(n) && n > 0) filters.enterpriseId = n;
      }
    } else {
      // 企业端：与 exam-papers 一致，合并 JWT + 主账号企业行 + 地址栏 enterpriseId（已校验），避免人才换票 JWT 仍为旧 enterprises.id 时列表为空
      let scopeIds = [];
      try {
        scopeIds = await collectEnterpriseScopeIds(req);
      } catch (_) {
        scopeIds = [];
      }
      const ids = [...new Set(scopeIds.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0))];
      if (!ids.length) {
        const entId = req.enterpriseId != null ? parseInt(String(req.enterpriseId), 10) : NaN;
        if (Number.isFinite(entId) && entId > 0) ids.push(entId);
      }
      if (!ids.length) {
        return res.json({ success: true, data: { list: [], total: 0 } });
      }
      if (ids.length > 1) {
        filters.enterpriseIds = ids;
      } else {
        filters.enterpriseId = ids[0];
      }
    }
    let list;
    let total;
    try {
      list = await ExamModel.list(filters);
      total = await ExamModel.count(filters);
    } catch (e) {
      console.error('Exams list DB error:', e.message || e);
      return res.json({ success: true, data: { list: [], total: 0 } });
    }
    res.json({ success: true, data: { list: list || [], total: total ?? 0 } });
  } catch (e) {
    console.error('Exams list error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 从试卷直接导入创建考试（须在 /:id 之前定义）
router.post('/import-from-paper', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const { paperId } = req.body;
    if (!paperId) return res.status(400).json({ success: false, message: '缺少试卷ID' });
    const paper = await ExamPaperModel.getExamPaperById(paperId);
    if (!paper) return res.status(404).json({ success: false, message: '试卷不存在' });
    let enterpriseId = req.user.role === 'admin' ? req.body.enterpriseId : req.enterpriseId;
    if (!enterpriseId && req.user.role === 'admin') {
      enterpriseId = await EnterpriseModel.getFirstOrCreateDefault();
    }
    const now = new Date();
    const startTime = new Date(now.getTime() + 60 * 60 * 1000);
    const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const name = req.body.name || (paper.paper_name || '未命名试卷') + ' - ' + now.toLocaleDateString('zh-CN');
    const id = await ExamModel.create({
      enterpriseId,
      paperId,
      name,
      description: null,
      startTime: startTime.toISOString().slice(0, 19).replace('T', ' '),
      endTime: endTime.toISOString().slice(0, 19).replace('T', ' '),
      durationMinutes: paper.exam_time || 90,
      monitorConfig: { dualCamera: true, screenShare: true, lockScreen: true, maxViolations: 5 },
      answerSystemConfig: { essayWordCount: 800, drawingEnabled: true, drawingWidth: 500, drawingHeight: 300 },
      createdBy: req.user.id
    });
    res.json({ success: true, data: { id, name } });
  } catch (e) {
    console.error('Import exam from paper error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取测评报告（须在 /:id 之前）
router.get('/:examId/sessions/:sessionId/report', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    const [sessions] = await pool.execute(
      `SELECT s.*, ${userSelectSql} FROM exam_sessions s JOIN ${joinTableSql} u ON s.user_id = u.id WHERE s.id = ? AND s.exam_id = ?`,
      [req.params.sessionId, req.params.examId]
    );
    const session = sessions[0];
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    const [answers] = await pool.execute(
      `SELECT a.*, sq.content_html, sq.full_content, sq.score as max_score, sq.standard_answer, sq.answer_analysis, mq.question_type
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id = ? ORDER BY a.id`,
      [req.params.sessionId]
    );
    const formatAnswer = (a) => {
      if (a.answer_data) {
        try {
          const d = typeof a.answer_data === 'string' ? JSON.parse(a.answer_data) : a.answer_data;
          if (d.selected) return Array.isArray(d.selected) ? d.selected.join(',') : d.selected;
          if (d.blanks) return Array.isArray(d.blanks) ? d.blanks.join(',') : d.blanks;
          if (d.imageBase64) return '[图片]';
        } catch (_) {}
      }
      return a.answer_text || '';
    };
    const items = answers.map(a => ({
      content: a.content_html || a.full_content,
      questionType: a.question_type,
      studentAnswer: formatAnswer(a),
      standardAnswer: a.standard_answer || '',
      analysis: a.answer_analysis || '',
      score: a.score,
      maxScore: a.max_score
    }));
    res.json({
      success: true,
      data: {
        exam: { name: exam.name },
        student: { name: session.real_name || session.username },
        totalScore: session.total_score,
        items
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 题型映射到 answerType（与答题预览一致）
const TYPE_MAP = {
  选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice',
  填空题: 'blank', 简答题: 'text', 论述题: 'text', 解答题: 'text', 综合题: 'text',
  写作题: 'essay', 作文题: 'essay', 作图题: 'drawing', 画图题: 'drawing'
};
const ANSWER_TYPE_LABELS = { 
  choice: '选择题', 
  multichoice: '多选题', 
  judge: '判断题', 
  blank: '填空题',
  text: '简答题',
  essay: '作文题',
  drawing: '作图题'
};
const OBJECTIVE_ANSWER_TYPES = ['choice', 'multichoice', 'judge', 'blank'];

function getAnswerTypeFromQuestionType(questionType) {
  if (!questionType) return 'text';
  const t = String(questionType).trim();
  for (const [key, val] of Object.entries(TYPE_MAP)) {
    if (t.includes(key)) return val;
  }
  return 'text';
}

// 获取某考试客观题列表（按答题预览的答题方式识别，含题库答案与标准答案）
router.get('/:examId/objective-questions', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.json({ success: true, data: [] });

    const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
    const [rows] = await pool.execute(
      `SELECT sq.*, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );

    const displayNumberOverrides = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
    const list = [];
    let globalIndex = 0;
    for (const r of rows) {
      globalIndex++;
      const answerType = overrides[r.id] || getAnswerTypeFromQuestionType(r.question_type);
      if (!OBJECTIVE_ANSWER_TYPES.includes(answerType)) continue;
      const rawBankAnswer = r.answer || (r.answer_html ? String(r.answer_html).replace(/<[^>]+>/g, '').trim() : '') || null;
      const bankAnswer = rawBankAnswer ? cleanAnswerText(rawBankAnswer) : '';
      const bankExplanation = cleanAnswerText(r.explanation || r.answer_analysis || '') || '';
      const displayNum = (displayNumberOverrides[r.id] && String(displayNumberOverrides[r.id]).trim()) || String(globalIndex);
      list.push({
        ...r,
        displayNumber: displayNum,
        answerType,
        answerTypeLabel: ANSWER_TYPE_LABELS[answerType] || answerType,
        bankAnswer,
        bankExplanation,
        standard_answer: r.standard_answer || ''
      });
    }
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取某考试非客观题列表（按答题预览的答题方式识别，含题库答案与标准答案，用于主观题任务分配）
router.get('/:examId/subjective-questions', requireRole('enterprise', 'admin', 'grader'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.json({ success: true, data: [] });

    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();

    const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
    const [rows] = await pool.execute(
      `SELECT sq.*, mq.question_type, mq.major_number
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );

    const displayNumberOverrides = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
    const list = [];
    let globalIndex = 0;
    for (const r of rows) {
      globalIndex++;
      const answerType = overrides[r.id] || getAnswerTypeFromQuestionType(r.question_type);
      // 排除客观题类型
      if (OBJECTIVE_ANSWER_TYPES.includes(answerType)) continue;
      
      const rawBankAnswer = r.answer || (r.answer_html ? String(r.answer_html).replace(/<[^>]+>/g, '').trim() : '') || null;
      const bankAnswer = rawBankAnswer ? cleanAnswerText(rawBankAnswer) : '';
      const bankExplanation = cleanAnswerText(r.explanation || r.answer_analysis || '') || '';
      const displayNum = (displayNumberOverrides[r.id] && String(displayNumberOverrides[r.id]).trim()) || String(globalIndex);
      const displayNumLike = displayNum + '-%';

      // 获取该小题的考生答案（仅已交卷会话）：含 sub_question_id 精确匹配 + 多子小题时 question_number 匹配（如 "2--0","2--1"），提交后同步到阅卷系统主观题列表
      // 考生账号表与 listSubmittedSessionsWithCandidates 一致：qms_users / users，禁止写死 JOIN users（否则 qms 库下易 500 或无人匹配）
      const [studentAnswers] = await pool.execute(
        `SELECT ea.id, ea.session_id, ea.answer_text, ea.answer_data, 
                es.user_id, ${userSelectSql}
         FROM exam_answers ea
         JOIN exam_sessions es ON ea.session_id = es.id
         JOIN ${joinTableSql} u ON es.user_id = u.id
         WHERE es.exam_id = ? AND es.status IN ('submitted', 'force_submitted')
         AND (
           ea.sub_question_id = ?
           OR (ea.sub_question_id IS NULL AND (ea.question_number = ? OR ea.question_number LIKE ?))
         )
         ORDER BY exam_number, real_name`,
        [req.params.examId, r.id, displayNum, displayNumLike]
      );
      
      list.push({
        ...r,
        displayNumber: displayNum,
        answerType,
        answerTypeLabel: ANSWER_TYPE_LABELS[answerType] || answerType || '简答题',
        bankAnswer,
        bankExplanation,
        standard_answer: r.standard_answer || '',
        studentAnswers: studentAnswers.map(sa => {
          let answerData = null;
          if (sa.answer_data) {
            try {
              answerData = typeof sa.answer_data === 'string' ? JSON.parse(sa.answer_data) : sa.answer_data;
            } catch (e) {
              console.error('Parse answer_data error:', e);
              answerData = null;
            }
          }
          return {
            id: sa.id,
            sessionId: sa.session_id,
            userId: sa.user_id,
            realName: sa.real_name,
            username: sa.username,
            examNumber: sa.exam_number,
            answerText: sa.answer_text,
            answerData: answerData
          };
        })
      });
    }
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 同步主观题答案：从 exam_subjective_answers 表提取并写入 exam_answers（与客观题阅卷方式一致，按题号匹配后主观题列表可展示考生答案）
router.post('/:examId/sync-subjective-answers', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.status(400).json({ success: false, message: '该考试未关联试卷' });

    const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
    const displayNumberOverrides = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
    const [rows] = await pool.execute(
      `SELECT sq.id, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );
    const displayNumToSubId = new Map();
    let globalIndex = 0;
    for (const r of rows) {
      globalIndex++;
      const answerType = overrides[r.id] || getAnswerTypeFromQuestionType(r.question_type);
      if (OBJECTIVE_ANSWER_TYPES.includes(answerType)) continue;
      const displayNum = (displayNumberOverrides[r.id] && String(displayNumberOverrides[r.id]).trim()) || String(globalIndex);
      displayNumToSubId.set(displayNum, r.id);
    }

    const [sessions] = await pool.execute(
      'SELECT id FROM exam_sessions WHERE exam_id = ? AND status IN (\'submitted\', \'force_submitted\')',
      [req.params.examId]
    );
    const sessionIds = sessions.map(s => s.id);
    let totalAnswers = 0;
    const matchLog = { matched: [], unmatched: [] };
    try {
      for (const s of sessions) {
        const [subRows] = await pool.execute(
          'SELECT question_number, answer_text, answer_data FROM exam_subjective_answers WHERE session_id = ?',
          [s.id]
        );
        for (const row of subRows) {
          const qn = row.question_number && String(row.question_number).trim();
          if (!qn) continue;
          let subQuestionId = displayNumToSubId.get(qn);
          let displayNumMatched = qn;
          if (subQuestionId == null) {
            for (const [displayNum, sid] of displayNumToSubId) {
              if (qn === displayNum || qn.startsWith(displayNum + '-') || qn.startsWith(displayNum + '--')) {
                subQuestionId = sid;
                displayNumMatched = displayNum;
                break;
              }
            }
          }
          const answerData = row.answer_data != null && typeof row.answer_data === 'string'
            ? (() => { try { return JSON.parse(row.answer_data); } catch (_) { return null; } })()
            : row.answer_data;
          // 多空题（题号带 "-" 如 5--0）用 question_number 唯一匹配，传 sub_question_id=null 避免多条互相覆盖；单题可带 sub_question_id 便于展示
          const isMultiSlot = qn !== displayNumMatched && qn.indexOf('-') !== -1;
          const finalSubId = isMultiSlot ? null : (subQuestionId || null);
          if (subQuestionId != null || !isMultiSlot) {
            matchLog.matched.push({ question_number: qn, sub_question_id: finalSubId });
          } else {
            matchLog.unmatched.push(qn);
          }
          await ExamAnswerModel.upsert(s.id, finalSubId, qn, row.answer_text || null, answerData);
          totalAnswers++;
        }
      }
      if (matchLog.unmatched.length > 0) {
        console.log('[sync-subjective-answers] 未匹配到 sub_question_id 的题号:', matchLog.unmatched.slice(0, 20));
      }
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        return res.status(400).json({ success: false, message: '主观题答案表不存在，请先执行 migrate_exam_subjective_answers.sql' });
      }
      throw err;
    }

    // 修复：阅卷统计只统计 sub_question_id 有值的记录，若同步时题号未匹配会写成 null，此处按 question_number 回填
    let repaired = 0;
    if (sessionIds.length > 0) {
      const [nullRows] = await pool.execute(
        `SELECT id, question_number FROM exam_answers
         WHERE session_id IN (${sessionIds.map(() => '?').join(',')}) AND sub_question_id IS NULL AND question_number IS NOT NULL AND TRIM(question_number) != ''`,
        sessionIds
      );
      for (const row of nullRows) {
        const qn = String(row.question_number).trim();
        let subQuestionId = displayNumToSubId.get(qn);
        if (subQuestionId == null) {
          for (const [displayNum, sid] of displayNumToSubId) {
            if (qn === displayNum || qn.startsWith(displayNum + '-')) {
              subQuestionId = sid;
              break;
            }
          }
        }
        if (subQuestionId != null) {
          await pool.execute('UPDATE exam_answers SET sub_question_id = ? WHERE id = ?', [subQuestionId, row.id]);
          repaired++;
        } else {
          console.log('[sync-subjective-answers] 修复阶段未匹配题号:', qn);
        }
      }
    }

    res.json({
      success: true,
      message: `已从主观题答案表同步 ${totalAnswers} 条答案至阅卷表（共 ${sessions.length} 名考生）${repaired > 0 ? `，并修复 ${repaired} 条 sub_question_id` : ''}`,
      data: { sessionCount: sessions.length, totalAnswers, repaired }
    });
  } catch (e) {
    console.error('[sync-subjective-answers]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

// 同步考生答案到主观题任务分配系统（仅统计；实际展示请使用「同步主观题答案」将 exam_subjective_answers 同步到 exam_answers）
router.post('/:examId/sync-student-answers', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }

    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    // 获取所有已交卷的考生答案
    const [answers] = await pool.execute(
      `SELECT ea.id, ea.session_id, ea.sub_question_id, ea.question_number, 
              ea.answer_text, ea.answer_data, es.user_id, es.status,
              ${userSelectSql}
       FROM exam_answers ea
       JOIN exam_sessions es ON ea.session_id = es.id
       JOIN ${joinTableSql} u ON es.user_id = u.id
       WHERE es.exam_id = ? AND es.status IN ('submitted', 'force_submitted') AND ea.sub_question_id IS NOT NULL
       ORDER BY ea.sub_question_id, exam_number`,
      [req.params.examId]
    );
    
    res.json({ 
      success: true, 
      message: `已同步 ${answers.length} 条考生答案`,
      data: { count: answers.length }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 从题库同步答案和解析到试卷小题（当 exam_paper_sub_questions 中无答案/解析时，按 content 匹配题库）
router.post('/:examId/sync-answers-from-bank', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.status(400).json({ success: false, message: '该考试未关联试卷' });
    const { category = '未分类', subject = '未分类' } = req.body;

    const [rows] = await pool.execute(
      `SELECT sq.id, sq.content_text, sq.content_html, sq.answer, sq.explanation, sq.sub_answers, sq.sub_explanations
       FROM exam_paper_sub_questions sq
       WHERE sq.paper_id = ?
       ORDER BY sq.id`,
      [paperId]
    );

    let synced = 0;
    for (const r of rows) {
      const needAnswer = !(r.answer && r.answer.trim());
      const needExplanation = !(r.explanation && r.explanation.trim());
      const hasSubAnswers = r.sub_answers && (typeof r.sub_answers !== 'string' || r.sub_answers.trim());
      const hasSubExplanations = r.sub_explanations && (typeof r.sub_explanations !== 'string' || r.sub_explanations.trim());
      const needSubAnswers = !hasSubAnswers;
      const needSubExplanations = !hasSubExplanations;
      if (!needAnswer && !needExplanation && !needSubAnswers && !needSubExplanations) continue;
      const contentText = (r.content_text || '').trim() || String(r.content_html || '').replace(/<[^>]+>/g, '').trim();
      if (!contentText || contentText.length < 5) continue;
      try {
        const match = await QuestionBankModel.findBestMatchWithAnswer(contentText, category, subject, 0.7);
        if (!match) continue;
        const updates = [];
        const params = [];
        if (needAnswer && match.answer && match.answer.trim()) {
          updates.push('answer = ?');
          params.push(match.answer.trim());
        }
        if (needExplanation && match.explanation && match.explanation.trim()) {
          updates.push('explanation = ?');
          params.push(match.explanation.trim());
        }
        if (needAnswer && match.answerHtml && match.answerHtml.trim()) {
          updates.push('answer_html = ?');
          params.push(match.answerHtml.trim());
        }
        if (needExplanation && match.explanationHtml && match.explanationHtml.trim()) {
          updates.push('explanation_html = ?');
          params.push(match.explanationHtml.trim());
        }
        // 同步到阅卷用标准答案：答案一并写入 standard_answer，便于客观题设置与执行阅卷使用
        if (needAnswer && match.answer && match.answer.trim()) {
          updates.push('standard_answer = ?');
          params.push(match.answer.trim());
        }
        // 同步子小题答案和解析（题库更新后子阅卷可显示）
        if (match.sub_answers && Array.isArray(match.sub_answers) && match.sub_answers.length > 0) {
          updates.push('sub_answers = ?');
          params.push(JSON.stringify(match.sub_answers));
        }
        if (match.sub_explanations && Array.isArray(match.sub_explanations) && match.sub_explanations.length > 0) {
          updates.push('sub_explanations = ?');
          params.push(JSON.stringify(match.sub_explanations));
        }
        if (updates.length === 0) continue;
        params.push(r.id);
        await pool.execute(
          `UPDATE exam_paper_sub_questions SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
        synced++;
      } catch (err) {
        console.warn('同步小题失败:', r.id, err.message);
      }
    }
    res.json({ success: true, message: `已从题库同步 ${synced} 道小题的答案/解析`, data: { synced } });
  } catch (e) {
    console.error('[sync-answers-from-bank]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

// 统一自动识别答案选项：从题干 content_html/content_text 中提取答案字母，写入 standard_answer
router.post('/:examId/auto-recognize-answers', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.status(400).json({ success: false, message: '该考试未关联试卷' });

    const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
    const [rows] = await pool.execute(
      `SELECT sq.id, sq.content_html, sq.content_text, sq.standard_answer, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );

    let recognized = 0;
    const answerPatterns = [
      /[【\[]?答案[：:]\s*([A-F]+(?:[,.、\s]+[A-F]+)*)[】\]]?/i,
      /[【\[]?正确答案[：:]\s*([A-F]+(?:[,.、\s]+[A-F]+)*)[】\]]?/i,
      /[【\[]?标准答案[：:]\s*([A-F]+(?:[,.、\s]+[A-F]+)*)[】\]]?/i,
      /答案[：:]?\s*([A-F])\b/i,
      /正确答案[：:]?\s*([A-F])\b/i,
      /[（(]\s*([A-F])\s*[）)]\s*[为是]?正确/i,
      /选\s*([A-F])\b/i,
      /[。.]\s*([A-F])\s*[。.]/,
      /\b([对错正确错误])\b/
    ];

    for (const r of rows) {
      const answerType = overrides[r.id] || getAnswerTypeFromQuestionType(r.question_type);
      if (!OBJECTIVE_ANSWER_TYPES.includes(answerType)) continue;

      const raw = ((r.content_text || '').trim() || String(r.content_html || '').replace(/<[^>]+>/g, ' ')).trim();
      if (!raw || raw.length < 3) continue;

      let extracted = null;
      if (answerType === 'judge') {
        const m = raw.match(/(答案|正确答案)[：:]\s*([对错正确错误])/);
        if (m) extracted = /对|正确/.test(m[2]) ? '正确' : '错误';
      } else {
        for (const pat of answerPatterns) {
          const m = raw.match(pat);
          if (m && m[1]) {
            let s = String(m[1]).trim();
            if (/^[对错正确错误]$/.test(s)) {
              extracted = /对|正确/.test(s) ? '正确' : '错误';
            } else {
              s = s.replace(/[,.、\s]+/g, ',').replace(/,+/g, ',').toUpperCase();
              const letters = s.split(',').filter(c => /^[A-F]$/.test(c));
              if (letters.length > 0) extracted = letters.join(',');
            }
            break;
          }
        }
      }

      if (!extracted) continue;
      await pool.execute('UPDATE exam_paper_sub_questions SET standard_answer = ? WHERE id = ?', [extracted, r.id]);
      recognized++;
    }

    res.json({ success: true, message: `已自动识别 ${recognized} 道客观题答案`, data: { recognized } });
  } catch (e) {
    console.error('[auto-recognize-answers]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '识别失败' });
  }
});

// 检查客观题设置是否已完成（用于前端禁用「执行阅卷」）
router.get('/:examId/objective-settings-check', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const check = await gradingService.checkObjectiveSettingsComplete(req.params.examId, exam);
    res.json({ success: true, data: { ok: check.ok, missingCount: check.missingCount || 0 } });
  } catch (e) {
    console.error('[objective-settings-check]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

// 检查客观题阅卷是否已完成（用于阅卷系统列表显示「已完成/未完成」）
router.get('/:examId/objective-graded-status', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const result = await gradingService.checkObjectiveGradedStatus(req.params.examId, exam);
    res.json({ success: true, data: { ok: result.ok } });
  } catch (e) {
    console.error('[objective-graded-status]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

// 同步所有考生客观题答案：从 exam_objective_answers 表提取并写入 exam_answers，便于阅卷按显示题号匹配
router.post('/:examId/sync-objective-answers', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const [sessions] = await pool.execute(
      'SELECT id FROM exam_sessions WHERE exam_id = ? AND status IN (\'submitted\', \'force_submitted\')',
      [req.params.examId]
    );
    let totalAnswers = 0;
    if (!sessions.length) {
      return res.json({
        success: true,
        message:
          '本场暂无已交卷会话（exam_sessions.status 需为 submitted 或 force_submitted），未同步任何客观题答案。若考生已答题但未交卷，请先完成交卷。',
        data: { sessionCount: 0, totalAnswers: 0 }
      });
    }
    try {
      for (const s of sessions) {
        const [rows] = await pool.execute(
          'SELECT question_number, answer_text, answer_data FROM exam_objective_answers WHERE session_id = ?',
          [s.id]
        );
        for (const row of rows) {
          const qn = row.question_number && String(row.question_number).trim();
          if (!qn) continue;
          const answerData = row.answer_data != null && typeof row.answer_data === 'string'
            ? (() => { try { return JSON.parse(row.answer_data); } catch (_) { return null; } })()
            : row.answer_data;
          await ExamAnswerModel.upsert(s.id, null, qn, row.answer_text || null, answerData);
          totalAnswers++;
        }
      }
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        return res.status(400).json({ success: false, message: '客观题答案表不存在，请先执行 migrate_exam_objective_answers.sql 或 run_exam_objective_answers_migration.js' });
      }
      throw err;
    }
    res.json({
      success: true,
      message: `已从客观题答案表同步 ${totalAnswers} 条答案至阅卷表（共 ${sessions.length} 名考生）`,
      data: { sessionCount: sessions.length, totalAnswers }
    });
  } catch (e) {
    console.error('[sync-objective-answers]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

// 获取某考试考生考试情况列表（须在 /:id 之前，避免被单段路由匹配）
router.get('/:examId/examinee-status', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const maxViolations = (exam.monitor_config && exam.monitor_config.maxViolations != null)
      ? parseInt(exam.monitor_config.maxViolations, 10) : 5;

    const userTbl = await ExamEnrollmentModel.getCandidateUserTableName();
    const joinEnUser = `FROM exam_enrollments en JOIN \`${userTbl}\` u ON en.user_id = u.id`;
    let enrollments;
    const sqlFull = `SELECT en.id, en.user_id, en.invite_code, en.status as enrollment_status,
                u.username, u.real_name, u.exam_number, u.phone, u.email, u.position, u.id_card_image_path
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlNameAsReal = `SELECT en.id, en.user_id, en.invite_code, en.status as enrollment_status,
                u.username, u.name AS real_name, u.exam_number, u.phone, u.email, u.position, u.id_card_image_path
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlUserAsReal = `SELECT en.id, en.user_id, en.invite_code, en.status as enrollment_status,
                u.username, u.username AS real_name, u.exam_number, u.phone, u.email, u.position, u.id_card_image_path
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlMinimal = `SELECT en.id, en.user_id, en.invite_code, en.status as enrollment_status, u.username, u.real_name, u.email
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlMinimalUser = `SELECT en.id, en.user_id, en.invite_code, en.status as enrollment_status, u.username, u.username AS real_name, u.email
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    try {
      [enrollments] = await pool.execute(sqlFull, [req.params.examId]);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' && err.message && err.message.includes('real_name')) {
        try {
          [enrollments] = await pool.execute(sqlNameAsReal, [req.params.examId]);
        } catch (err2) {
          if (err2.code === 'ER_BAD_FIELD_ERROR') {
            [enrollments] = await pool.execute(sqlUserAsReal, [req.params.examId]);
          } else {
            throw err2;
          }
        }
      } else if (err.code === 'ER_BAD_FIELD_ERROR' && err.message && (err.message.includes('phone') || err.message.includes('exam_number') || err.message.includes('position') || err.message.includes('id_card_image_path'))) {
        try {
          [enrollments] = await pool.execute(sqlMinimal, [req.params.examId]);
        } catch (errM) {
          if (errM.code === 'ER_BAD_FIELD_ERROR' && (errM.message || '').includes('real_name')) {
            [enrollments] = await pool.execute(sqlMinimalUser, [req.params.examId]);
          } else {
            throw errM;
          }
        }
        enrollments = enrollments.map(r => ({ ...r, exam_number: r.exam_number ?? null, phone: r.phone ?? null, position: r.position ?? null, id_card_image_path: r.id_card_image_path ?? null }));
      } else {
        throw err;
      }
    }
    const [sessions] = await pool.execute(
      `SELECT user_id, status, violation_count, submitted_at
       FROM exam_sessions WHERE exam_id = ?`,
      [req.params.examId]
    );
    const sessionByUser = {};
    sessions.forEach(s => { sessionByUser[s.user_id] = s; });

    const list = enrollments.map(en => {
      const session = sessionByUser[en.user_id];
      let status = '缺考';
      if (session) {
        if (session.violation_count >= maxViolations) {
          status = '违规';
        } else if (session.status === 'submitted' || session.status === 'force_submitted' || session.status === 'ongoing') {
          status = (session.status === 'submitted' || session.status === 'force_submitted') ? '已交卷' : '考试中';
        } else if (session.status === 'pending') {
          status = '缺考';
        } else {
          status = session.status === 'abnormal' ? '异常' : (session.status || '缺考');
        }
      }
      return {
        id: en.id,
        user_id: en.user_id,
        real_name: en.real_name || en.username,
        username: en.username,
        exam_number: en.exam_number,
        phone: en.phone,
        email: en.email || '',
        position: en.position || '',
        id_card_image_path: en.id_card_image_path || '',
        invite_code: en.invite_code || '',
        status,
        violation_count: session ? session.violation_count : 0,
        max_violations: maxViolations,
        submitted_at: session ? session.submitted_at : null
      };
    });

    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 阅卷任务列表：与 /api/exams 同栈注册，避免代理或嵌套路由未 fallback 到 app.use('/api', gradingTasks) 时 404
router.get('/:examId/grading-tasks', requireRole('enterprise', 'admin', 'grader'), (req, res, next) => {
  Promise.resolve(listGradingTasksForExam(req, res)).catch(next);
});

// 获取单个考试
router.get('/:id', async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise' && exam.enterprise_id !== req.enterpriseId) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    res.json({ success: true, data: exam });
  } catch (e) {
    console.error('GET /exams/:id error:', e.message, e.stack);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

// 创建考试（企业端）：答题时长由开始/结束时间自动计算，与考生端一致
router.post('/', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    let enterpriseId = req.user.role === 'admin' ? req.body.enterpriseId : req.enterpriseId;
    if (!enterpriseId && req.user.role === 'admin') {
      enterpriseId = await EnterpriseModel.getFirstOrCreateDefault();
    }
    const {
      paperId,
      name,
      description,
      startTime,
      endTime,
      durationMinutes: bodyDuration,
      monitorConfig,
      answerSystemConfig,
      interviewConfig
    } = req.body;
    if (!enterpriseId || !paperId || !name || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: '缺少必填字段' });
    }
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    if (endMs <= startMs || isNaN(startMs) || isNaN(endMs)) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' });
    }
    const durationMinutes = Math.max(10, Math.min(300, Math.round((endMs - startMs) / 60000)));
    // 企业端（含人才网登录）可能无笔试系统本地用户，created_by 传 null 避免外键约束报错
    const createdBy = req.user.role === 'admin' ? (req.user.id || null) : null;
    let finalAnswerSystemConfig =
      answerSystemConfig && typeof answerSystemConfig === 'object'
        ? { ...answerSystemConfig }
        : answerSystemConfig || {
            essayWordCount: 800,
            drawingEnabled: true,
            drawingWidth: 500,
            drawingHeight: 300
          };
    if (interviewConfig && typeof finalAnswerSystemConfig === 'object') {
      finalAnswerSystemConfig.interviewConfig = interviewConfig;
    }
    const id = await ExamModel.create({
      enterpriseId,
      paperId,
      name,
      description,
      startTime,
      endTime,
      durationMinutes,
      monitorConfig:
        monitorConfig || {
          dualCamera: true,
          screenShare: true,
          lockScreen: true,
          maxViolations: 5
        },
      answerSystemConfig: finalAnswerSystemConfig,
      interviewConfig,
      createdBy
    });
    try {
      await ExamModel.ensurePublicRoomCode(id);
    } catch (err) {
      console.warn('[exams] ensurePublicRoomCode after create:', err.message);
    }
    res.json({ success: true, data: { id } });
  } catch (e) {
    console.error('Create exam error:', e.message, e.stack);
    res.status(500).json({ success: false, message: e.message || '创建失败' });
  }
});

// 更新考试
router.put('/:id', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise' && exam.enterprise_id !== req.enterpriseId) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const body = req.body;
    if (body.status === 'published') {
      if (!exam.paper_id) return res.status(400).json({ success: false, message: '请先选择试卷' });
      if (!exam.start_time || !exam.end_time) return res.status(400).json({ success: false, message: '请设置考试开始和结束时间' });
      const [enrollRows] = await pool.execute('SELECT COUNT(*) as cnt FROM exam_enrollments WHERE exam_id = ?', [req.params.id]);
      if (!enrollRows[0]?.cnt || enrollRows[0].cnt < 1) {
        return res.status(400).json({ success: false, message: '请先在考生管理中添加至少一名考生' });
      }
      const asc = exam.answer_system_config;
      if (!asc || typeof asc !== 'object') {
        return res.status(400).json({ success: false, message: '请先在答题预览中完成答题方式等设置并保存' });
      }
    }
    const effectiveStart = body.startTime !== undefined ? body.startTime : exam.start_time;
    const effectiveEnd = body.endTime !== undefined ? body.endTime : exam.end_time;
    if (effectiveStart && effectiveEnd) {
      const startMs = new Date(effectiveStart).getTime();
      const endMs = new Date(effectiveEnd).getTime();
      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' });
      }
    }
    const update = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.startTime !== undefined) update.start_time = body.startTime;
    if (body.endTime !== undefined) update.end_time = body.endTime;
    if (effectiveStart && effectiveEnd) {
      const startMs = new Date(effectiveStart).getTime();
      const endMs = new Date(effectiveEnd).getTime();
      if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
        update.duration_minutes = Math.max(10, Math.min(300, Math.round((endMs - startMs) / 60000)));
      }
    }
    if (body.durationMinutes !== undefined && update.duration_minutes === undefined) update.duration_minutes = body.durationMinutes;
    if (body.monitorConfig !== undefined) update.monitor_config = body.monitorConfig;
    if (body.answerSystemConfig !== undefined || body.interviewConfig !== undefined) {
      const baseAsc =
        body.answerSystemConfig && typeof body.answerSystemConfig === 'object'
          ? { ...body.answerSystemConfig }
          : (exam.answer_system_config && typeof exam.answer_system_config === 'object'
              ? { ...exam.answer_system_config }
              : {});
      if (body.interviewConfig !== undefined) {
        baseAsc.interviewConfig = body.interviewConfig;
      }
      update.answer_system_config = baseAsc;
    }
    if (body.status !== undefined) update.status = body.status;
    if (body.paperId !== undefined) update.paper_id = body.paperId == null || body.paperId === '' ? null : parseInt(body.paperId, 10);
    await ExamModel.update(req.params.id, update);
    try {
      await ExamModel.ensurePublicRoomCode(req.params.id);
    } catch (err) {
      console.warn('[exams] ensurePublicRoomCode:', err.message);
    }

    // 发布时：为考生管理中的每位用户写入专业测评邀请通知（仅从草稿首次发布时写入）
    if (body.status === 'published' && exam.status !== 'published') {
      try {
        const examId = parseInt(req.params.id, 10);
        const examName = (exam.name || '专业测评').toString().substring(0, 255);
        const [enrolls] = await pool.execute(
          'SELECT user_id FROM exam_enrollments WHERE exam_id = ?',
          [examId]
        );
        const userIds = (enrolls || []).map((r) => r.user_id);
        for (const userId of userIds) {
          await pool.execute(
            `INSERT INTO exam_invitation_notifications (user_id, exam_id, exam_name)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
            [userId, examId, examName]
          );
        }
        if (userIds.length > 0) {
          console.log(`[发布考试] 已为考试 ${examId} 的 ${userIds.length} 名考生写入专业测评邀请通知`);
        }
      } catch (err) {
        console.error('Create exam invitation notifications error:', err.message, err.code || '');
        if (err.code === 'ER_NO_SUCH_TABLE') {
          console.error('请确保已执行 database/migrate_exam_invitation_notifications.sql 或重启后端以自动创建表');
        }
      }
    }

    res.json({ success: true, message: '更新成功' });
  } catch (e) {
    console.error('Exam update error:', e.message, e.stack);
    const msg = e.message || '服务器错误';
    res.status(500).json({ success: false, message: msg });
  }
});

// 删除考试
router.delete('/:id', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise' && exam.enterprise_id !== req.enterpriseId) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    await ExamModel.delete(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取阅卷数据（会话+答案+小题信息）（须在 /:id 之前，但 /:examId/sessions/:sessionId 已处理 sessions）
router.get('/:id/grading-data', requireRole('enterprise', 'admin', 'grader'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    } else if (req.user.role === 'grader') {
      // 子账号只能查看分配给自己的任务
      const graderId = req.user.graderId || req.user.id;
      // 检查是否有分配给该子账号的任务
      const [tasks] = await pool.execute(
        `SELECT id FROM grading_tasks WHERE exam_id = ? AND grading_account_id = ?`,
        [req.params.id, graderId]
      );
      if (tasks.length === 0) {
        return res.status(403).json({ success: false, message: '无权限：没有分配给您的任务' });
      }
    }
    
    // 支持按任务ID或账号ID过滤
    const { task_id, grading_account_id } = req.query;
    let taskFilter = '';
    const params = [req.params.id];
    
    // 如果是子账号，自动过滤到分配给自己的任务
    if (req.user.role === 'grader') {
      const graderId = req.user.graderId || req.user.id;
      const [graderTasks] = await pool.execute(
        `SELECT id FROM grading_tasks WHERE exam_id = ? AND grading_account_id = ?`,
        [req.params.id, graderId]
      );
      if (graderTasks.length > 0) {
        const taskIds = graderTasks.map(t => t.id);
        // 如果没有指定task_id，使用第一个任务
        if (!task_id && taskIds.length > 0) {
          const firstTaskId = taskIds[0];
          const [tasks] = await pool.execute(
            `SELECT task_config, task_type FROM grading_tasks WHERE id = ? AND exam_id = ?`,
            [firstTaskId, req.params.id]
          );
          if (tasks.length > 0) {
            const task = tasks[0];
            const taskConfig = typeof task.task_config === 'string' 
              ? JSON.parse(task.task_config) 
              : task.task_config;
            
            if (task.task_type === 'content') {
              if (taskConfig.sub_question_ids) {
                taskFilter = ` AND a.sub_question_id IN (${taskConfig.sub_question_ids.map(() => '?').join(',')})`;
                params.push(...taskConfig.sub_question_ids);
              } else if (taskConfig.major_question_ids) {
                taskFilter = ` AND sq.major_question_id IN (${taskConfig.major_question_ids.map(() => '?').join(',')})`;
                params.push(...taskConfig.major_question_ids);
              }
            } else if (task.task_type === 'question_type') {
              if (taskConfig.question_types) {
                const typeConditions = taskConfig.question_types.map(() => 'mq.question_type LIKE ?').join(' OR ');
                taskFilter = ` AND (${typeConditions})`;
                taskConfig.question_types.forEach(type => {
                  params.push(`%${type}%`);
                });
              }
            }
          }
        }
      }
    }
    
    if (task_id) {
      // 按任务过滤
      // 如果是子账号，验证任务是否属于自己
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [taskCheck] = await pool.execute(
          `SELECT id FROM grading_tasks WHERE id = ? AND exam_id = ? AND grading_account_id = ?`,
          [task_id, req.params.id, graderId]
        );
        if (taskCheck.length === 0) {
          return res.status(403).json({ success: false, message: '无权限：该任务不属于您' });
        }
      }
      
      const [tasks] = await pool.execute(
        `SELECT task_config, task_type FROM grading_tasks WHERE id = ? AND exam_id = ?`,
        [task_id, req.params.id]
      );
      if (tasks.length > 0) {
        const task = tasks[0];
        const taskConfig = typeof task.task_config === 'string' 
          ? JSON.parse(task.task_config) 
          : task.task_config;
        
        if (task.task_type === 'content') {
          if (taskConfig.sub_question_ids) {
            taskFilter = ` AND a.sub_question_id IN (${taskConfig.sub_question_ids.map(() => '?').join(',')})`;
            params.push(...taskConfig.sub_question_ids);
          } else if (taskConfig.major_question_ids) {
            taskFilter = ` AND sq.major_question_id IN (${taskConfig.major_question_ids.map(() => '?').join(',')})`;
            params.push(...taskConfig.major_question_ids);
          }
        } else if (task.task_type === 'question_type') {
          if (taskConfig.question_types) {
            const typeConditions = taskConfig.question_types.map(() => 'mq.question_type LIKE ?').join(' OR ');
            taskFilter = ` AND (${typeConditions})`;
            taskConfig.question_types.forEach(type => {
              params.push(`%${type}%`);
            });
          }
        }
      }
    } else if (grading_account_id) {
      // 按账号过滤：获取该账号的所有任务
      const [accountTasks] = await pool.execute(
        `SELECT task_config, task_type FROM grading_tasks WHERE exam_id = ? AND grading_account_id = ?`,
        [req.params.id, grading_account_id]
      );
      // 这里可以进一步过滤，但为了简化，暂时不限制
    }

    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    const [sessions] = await pool.execute(
      `SELECT s.*, ${userSelectSql} FROM exam_sessions s JOIN ${joinTableSql} u ON s.user_id = u.id WHERE s.exam_id = ? AND s.status IN ('submitted', 'force_submitted') ORDER BY s.submitted_at DESC`,
      [req.params.id]
    );
    const [answers] = await pool.execute(
      `SELECT a.*, sq.content_html, sq.full_content, sq.score as max_score, sq.standard_answer, sq.answer_analysis, sq.grading_points, mq.question_type
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id IN (SELECT id FROM exam_sessions WHERE exam_id = ?)${taskFilter}`,
      params
    );
    const bySession = {};
    sessions.forEach(s => { bySession[s.id] = { ...s, answers: [] }; });
    answers.forEach(a => {
      if (bySession[a.session_id]) bySession[a.session_id].answers.push(a);
    });
    res.json({ success: true, data: { sessions: Object.values(bySession), exam } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取客观题阅卷结果导出（支持 ?detail=1 含每题明细）
router.get('/:examId/objective-results/export', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const withDetail = req.query.detail === '1' || req.query.detail === 'true';
    const rows = await listSubmittedSessionsWithCandidates(req.params.examId);
    const objectiveScoreMap = await buildObjectiveScoreMap(exam, rows.map((r) => r.id));
    const rankedRows = [...rows].sort((a, b) => (objectiveScoreMap[b.id] || 0) - (objectiveScoreMap[a.id] || 0));
    const byPosition = {};
    rankedRows.forEach(r => {
      const pos = r.position || '未填写';
      if (!byPosition[pos]) byPosition[pos] = [];
      byPosition[pos].push(r);
    });
    const summaryData = rankedRows.map((r, idx) => {
      const pos = r.position || '未填写';
      const posIdx = (byPosition[pos]?.findIndex(x => x.id === r.id) ?? -1) + 1;
      return {
        排名: idx + 1,
        岗位: pos,
        岗位内排名: posIdx || '-',
        姓名: r.real_name || '',
        用户名: r.username || '',
        准考证号: r.exam_number || '',
        客观题得分: objectiveScoreMap[r.id] ?? 0
      };
    });
    const wb = XLSX.utils.book_new();
    if (summaryData.length > 0) {
      const ws = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws, '客观题阅卷结果');
    } else {
      // 如果没有数据，创建一个空表
      const ws = XLSX.utils.json_to_sheet([{ 排名: '', 岗位: '', 岗位内排名: '', 姓名: '', 用户名: '', 准考证号: '', 客观题得分: '暂无已交卷考生' }]);
      XLSX.utils.book_append_sheet(wb, ws, '客观题阅卷结果');
    }

    if (withDetail && exam.paper_id) {
      const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
      const displayNumberOverridesExport = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
      const [sqRows] = await pool.execute(
        `SELECT sq.id, sq.major_question_id, sq.number, sq.sub_number, sq.standard_answer, sq.score as max_score, mq.question_type
         FROM exam_paper_sub_questions sq
         JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
         WHERE sq.paper_id = ? ORDER BY mq.major_number, sq.number, sq.sub_number`,
        [exam.paper_id]
      );
      const typeMap = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
      const OBJECTIVE = ['choice', 'multichoice', 'judge', 'blank'];
      const getType = (qt) => {
        if (!qt) return 'text';
        const t = String(qt).trim();
        for (const [k, v] of Object.entries(typeMap)) { if (t.includes(k)) return v; }
        return 'text';
      };
      const sqRowsWithGlobal = sqRows.map((r, idx) => {
        const displayNum = (displayNumberOverridesExport[r.id] && String(displayNumberOverridesExport[r.id]).trim()) || String(idx + 1);
        return { ...r, globalDisplayNumber: displayNum };
      });
      let exportObjectiveSqList = sqRowsWithGlobal.filter(r => OBJECTIVE.includes(overrides[r.id] || getType(r.question_type)));
      let expSubIdx = 0;
      let expLastMajor = null;
      exportObjectiveSqList.forEach(sq => {
        if (sq.major_question_id !== expLastMajor) { expLastMajor = sq.major_question_id; expSubIdx = 0; }
        sq.subIndexInMajor = expSubIdx;
        expSubIdx++;
      });
      const objectiveSqList = exportObjectiveSqList;
      // 每个考生一列导出：先收集所有考生的答案数据
      const candidateAnswers = [];
      for (const r of rows) {
        const ansBySq = new Map();
        const ansByQuestionNumber = new Map();
        try {
          const [objRows] = await pool.execute(
            'SELECT question_number, answer_text, answer_data FROM exam_objective_answers WHERE session_id = ?',
            [r.id]
          );
          for (const a of objRows || []) {
            if (a.question_number && String(a.question_number).trim()) {
              const key = String(a.question_number).trim();
              ansByQuestionNumber.set(key, { ...a, score: null });
            }
          }
        } catch (err) {
          if (err.code !== 'ER_NO_SUCH_TABLE') console.warn('[objective-results/export] exam_objective_answers 查询失败:', err.message);
        }
        const [ansRows] = await pool.execute(
          'SELECT a.sub_question_id, a.question_number, a.answer_text, a.answer_data, a.score FROM exam_answers a WHERE a.session_id = ?',
          [r.id]
        );
        for (const a of ansRows) {
          if (a.sub_question_id) ansBySq.set(a.sub_question_id, a);
          if (a.question_number && String(a.question_number).trim()) {
            const key = String(a.question_number).trim();
            if (!ansByQuestionNumber.has(key)) ansByQuestionNumber.set(key, a);
          }
        }
        const candidateData = {
          name: r.real_name || '',
          examNumber: r.exam_number || '',
          position: r.position || '未填写',
          totalScore: r.total_score ?? null,
          answers: []
        };
        for (const sq of objectiveSqList) {
          const displayNum = (sq.globalDisplayNumber && String(sq.globalDisplayNumber).trim()) || '';
          const qNum = String(sq.number || '').trim();
          const qSub = String(sq.sub_number || '').trim();
          const subIdx = sq.subIndexInMajor != null ? sq.subIndexInMajor : 0;
          let ans = ansBySq.get(sq.id);
          if (!ans) {
            ans = ansByQuestionNumber.get(displayNum)
              || ansByQuestionNumber.get(`${displayNum}--${subIdx}`)
              || ansByQuestionNumber.get(`${displayNum}-${subIdx}`)
              || ansByQuestionNumber.get(qNum) || ansByQuestionNumber.get(qSub) || ansByQuestionNumber.get(qNum + (qSub ? `(${qSub})` : ''));
            if (!ans && displayNum) {
              for (let i = 0; i <= 9; i++) {
                ans = ansByQuestionNumber.get(`${displayNum}--${i}`) || ansByQuestionNumber.get(`${displayNum}-${i}`);
                if (ans) break;
              }
            }
          }
          let studentAnswer = '';
          if (ans) {
            if (ans.answer_data) {
              try {
                const d = typeof ans.answer_data === 'string' ? JSON.parse(ans.answer_data) : ans.answer_data;
                if (d.selected) studentAnswer = Array.isArray(d.selected) ? d.selected.join(',') : String(d.selected);
                else if (d.blanks) studentAnswer = Array.isArray(d.blanks) ? d.blanks.join(',') : String(d.blanks);
              } catch (_) {}
            }
            if (!studentAnswer && ans.answer_text) studentAnswer = ans.answer_text;
          }
          candidateData.answers.push({
            answer: studentAnswer,
            score: ans && ans.score != null ? ans.score : null,
            correct: ans && ans.score != null ? (Number(ans.score) > 0 ? '是' : '否') : ''
          });
        }
        candidateAnswers.push(candidateData);
      }
      // 构建横向布局：第一列题号、标准答案、满分，后续每列一个考生（答案、得分、是否正确）
      if (objectiveSqList.length > 0 && candidateAnswers.length > 0) {
        const detailRows = [];
        for (let i = 0; i < objectiveSqList.length; i++) {
          const sq = objectiveSqList[i];
          const displayNumber = sq.globalDisplayNumber || String(sq.number || '') + (sq.sub_number ? `(${sq.sub_number})` : '');
          const row = {
            题号: displayNumber,
            标准答案: (sq.standard_answer || '').toString().trim(),
            满分: sq.max_score != null ? sq.max_score : ''
          };
          candidateAnswers.forEach((cand, idx) => {
            const ans = cand.answers[i] || {};
            const candidateLabel = (cand.name || cand.examNumber || `考生${idx + 1}`).replace(/[\/\\?*|:<>"]/g, '_');
            row[`${candidateLabel}_答案`] = ans.answer || '';
            row[`${candidateLabel}_得分`] = ans.score != null ? ans.score : '';
            row[`${candidateLabel}_正确`] = ans.correct || '';
          });
          detailRows.push(row);
        }
        // 添加总分行
        const totalRow = { 题号: '总分', 标准答案: '', 满分: '' };
        candidateAnswers.forEach((cand, idx) => {
          const candidateLabel = (cand.name || cand.examNumber || `考生${idx + 1}`).replace(/[\/\\?*|:<>"]/g, '_');
          totalRow[`${candidateLabel}_答案`] = '';
          totalRow[`${candidateLabel}_得分`] = cand.totalScore != null ? cand.totalScore : '';
          totalRow[`${candidateLabel}_正确`] = '';
        });
        detailRows.push(totalRow);
        if (detailRows.length > 0) {
          const wsDetail = XLSX.utils.json_to_sheet(detailRows);
          XLSX.utils.book_append_sheet(wb, wsDetail, '每题明细');
        }
      }
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `客观题阅卷结果_${(exam.name || '考试').replace(/[/\\?*|:<>"]/g, '_')}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (e) {
    console.error('[objective-results/export]', e.message || e, e.stack);
    res.status(500).json({ success: false, message: e.message || '导出失败' });
  }
});

router.get('/:examId/objective-results', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const withDetail = req.query.detail === '1' || req.query.detail === 'true';

    // 诊断：统计本场考试会话状态，便于排查“不显示”问题
    let sessionStats = { total: 0, submitted: 0, ongoing: 0, pending: 0 };
    try {
      const [statRows] = await pool.execute(
        `SELECT status, COUNT(*) as cnt FROM exam_sessions WHERE exam_id = ? GROUP BY status`,
        [req.params.examId]
      );
      statRows.forEach(r => {
        sessionStats.total += r.cnt || 0;
        if (r.status === 'submitted' || r.status === 'force_submitted') sessionStats.submitted += r.cnt || 0;
        else if (r.status === 'ongoing') sessionStats.ongoing = r.cnt || 0;
        else if (r.status === 'pending') sessionStats.pending = r.cnt || 0;
      });
    } catch (_) {}

    // 与考生情况一致：exam_enrollments + exam_sessions + qms_users（或 users）
    const rows = await listSubmittedSessionsWithCandidates(req.params.examId);
    const objectiveScoreMap = await buildObjectiveScoreMap(exam, rows.map((r) => r.id));
    const rankedRows = [...rows].sort((a, b) => (objectiveScoreMap[b.id] || 0) - (objectiveScoreMap[a.id] || 0));
    const byPosition = {};
    rankedRows.forEach(r => {
      const pos = r.position || '未填写';
      if (!byPosition[pos]) byPosition[pos] = [];
      byPosition[pos].push(r);
    });
    const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
    const paperId = exam.paper_id;
    let objectiveSqList = [];
    if (withDetail && paperId) {
      try {
        objectiveSqList = await buildObjectiveSqListForExam(exam);
      } catch (sqErr) {
        if (sqErr.code === 'ER_BAD_FIELD_ERROR' || sqErr.code === 'ER_NO_SUCH_TABLE') {
          objectiveSqList = [];
        } else {
          throw sqErr;
        }
      }
    }
    const list = [];
    for (let idx = 0; idx < rankedRows.length; idx++) {
      const r = rankedRows[idx];
      const pos = r.position || '未填写';
      const posRank = (byPosition[pos]?.findIndex(x => x.id === r.id) || 0) + 1;
      const item = {
        rank: idx + 1,
        session_id: r.id,
        position: pos,
        positionRank: posRank,
        real_name: r.real_name || '',
        username: r.username || '',
        exam_number: r.exam_number || '',
        total_score: objectiveScoreMap[r.id] ?? 0
      };
      if (withDetail && objectiveSqList.length > 0) {
        const ansBySq = new Map();
        const ansByQuestionNumber = new Map();
        try {
          const [objRows] = await pool.execute(
            `SELECT question_number, answer_text, answer_data FROM exam_objective_answers WHERE session_id = ?`,
            [r.id]
          );
          for (const a of objRows || []) {
            if (a.question_number && String(a.question_number).trim()) {
              const key = String(a.question_number).trim();
              ansByQuestionNumber.set(key, { ...a, score: null });
            }
          }
        } catch (err) {
          if (err.code !== 'ER_NO_SUCH_TABLE') console.warn('[objective-results] exam_objective_answers 查询失败:', err.message);
        }
        let ansRows = [];
        try {
          const [ar] = await pool.execute(
            `SELECT a.id, a.sub_question_id, a.question_number, a.answer_text, a.answer_data, a.score
             FROM exam_answers a WHERE a.session_id = ?`,
            [r.id]
          );
          ansRows = ar || [];
        } catch (errA) {
          if (errA.code !== 'ER_NO_SUCH_TABLE') throw errA;
        }
        if (ansRows.length === 0 && sessionStats.submitted > 0 && ansByQuestionNumber.size === 0) {
          console.warn(`[objective-results] session ${r.id} (${r.real_name}) 已交卷但无 exam_answers/exam_objective_answers 记录`);
        }
        for (const a of ansRows) {
          if (a.sub_question_id != null) {
            const sid = a.sub_question_id;
            ansBySq.set(sid, a);
            if (typeof sid === 'string') ansBySq.set(Number(sid), a);
            else if (typeof sid === 'number') ansBySq.set(String(sid), a);
          }
          if (a.question_number && String(a.question_number).trim()) {
            const key = String(a.question_number).trim();
            if (!ansByQuestionNumber.has(key)) ansByQuestionNumber.set(key, a);
          }
        }
        const details = objectiveSqList.map(sq => {
          const displayNum = (sq.globalDisplayNumber && String(sq.globalDisplayNumber).trim()) || '';
          const qNum = String(sq.number || '').trim();
          const qSub = String(sq.sub_number || '').trim();
          const subIdx = sq.subIndexInMajor != null ? sq.subIndexInMajor : 0;
          let ans = ansBySq.get(sq.id);
          if (!ans) {
            ans = ansByQuestionNumber.get(displayNum)
              || ansByQuestionNumber.get(`${displayNum}--${subIdx}`)
              || ansByQuestionNumber.get(`${displayNum}-${subIdx}`)
              || ansByQuestionNumber.get(qNum) || ansByQuestionNumber.get(qSub) || ansByQuestionNumber.get(qNum + (qSub ? `(${qSub})` : ''));
            if (!ans && displayNum) {
              for (let i = 0; i <= 9; i++) {
                ans = ansByQuestionNumber.get(`${displayNum}--${i}`) || ansByQuestionNumber.get(`${displayNum}-${i}`) || ansByQuestionNumber.get(`${displayNum}-${qSub || ''}-${i}`);
                if (ans) break;
              }
            }
          }
          let studentAnswer = '';
          if (ans) {
            if (ans.answer_data) {
              try {
                const d = typeof ans.answer_data === 'string' ? JSON.parse(ans.answer_data) : ans.answer_data;
                if (d.selected) studentAnswer = Array.isArray(d.selected) ? d.selected.join(',') : String(d.selected);
                else if (d.blanks) studentAnswer = Array.isArray(d.blanks) ? d.blanks.join(',') : String(d.blanks);
              } catch (_) {}
            }
            if (!studentAnswer && ans.answer_text) studentAnswer = ans.answer_text;
          }
          const displayNumber = sq.globalDisplayNumber || String(sq.number || '') + (sq.sub_number ? `(${sq.sub_number})` : '');
          const standardAnswer = (sq.standard_answer || '').toString().trim();
          let scoreVal = ans && ans.score != null ? Number(ans.score) : null;
          // 如果 score 为 null 但有考生答案和标准答案，实时计算一次
          if (scoreVal === null && ans && standardAnswer) {
            const answerType = overrides[sq.id] || getAnswerTypeFromQuestionType(sq.question_type);
            if (OBJECTIVE_ANSWER_TYPES.includes(answerType)) {
              let userAns = ans.answer_text;
              if (ans.answer_data) {
                try {
                  const d = typeof ans.answer_data === 'string' ? JSON.parse(ans.answer_data) : ans.answer_data;
                  if (d.selected) userAns = d.selected;
                  else if (d.blanks) userAns = d.blanks;
                } catch (_) {}
              }
              if (userAns != null && String(userAns).trim() !== '') {
                const ratio = gradingService.scoreObjective(userAns, standardAnswer, answerType);
                if (ratio !== null) {
                  scoreVal = ratio * (sq.max_score || 0);
                }
              }
            }
          }
          const maxScore = sq.max_score != null ? Number(sq.max_score) : 0;
          const correct = scoreVal != null ? (scoreVal > 0 ? true : false) : null;
          return {
            displayNumber,
            standard_answer: standardAnswer,
            student_answer: studentAnswer,
            correct,
            score: scoreVal,
            max_score: maxScore
          };
        });
        item.details = details;
      }
      list.push(item);
    }
    res.json({ success: true, data: { total: rows.length, list, sessionStats } });
  } catch (e) {
    console.error('[objective-results]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

// 开始阅卷（客观题自动阅卷）- 须先完成客观题设置
router.post('/:id/grade', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise' && exam.enterprise_id !== req.enterpriseId) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const check = await gradingService.checkObjectiveSettingsComplete(req.params.id, exam);
    if (!check.ok) {
      return res.status(400).json({
        success: false,
        message: '请先在客观题设置中完成所有客观题标准答案后再执行阅卷',
        missingCount: check.missingCount
      });
    }
    const results = await gradingService.gradeExamSubmissions(req.params.id, exam);
    res.json({ success: true, data: { results } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
