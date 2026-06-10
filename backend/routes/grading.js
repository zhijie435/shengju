const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');
const GradingAccountModel = require('../models/gradingAccountModel');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const { isObjectiveQuestionType, getAnswerTypeForGrading } = require('../services/gradingService');
const ExamSummaryService = require('../services/examSummaryService');
const EvaluationReportService = require('../services/evaluationReportService');

// 检查表是否存在
async function checkTablesExist() {
  try {
    const [tables] = await pool.execute("SHOW TABLES LIKE 'grading_%'");
    const tableNames = tables.map(t => Object.values(t)[0]);
    return {
      accounts: tableNames.includes('grading_accounts'),
      tasks: tableNames.includes('grading_tasks'),
      records: tableNames.includes('grading_records')
    };
  } catch (e) {
    return { accounts: false, tasks: false, records: false };
  }
}

async function listSubmittedSessionsWithCandidates(examId) {
  const userTbl = await ExamEnrollmentModel.getCandidateUserTableName();
  const uSafe = String(userTbl).replace(/`/g, '');
  const [colRows] = await pool.execute(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [uSafe]
  );
  const uCols = new Set((colRows || []).map((r) => String(r.c || '').toLowerCase()));
  const usernameExpr = uCols.has('username')
    ? 'u.username'
    : uCols.has('phone')
      ? 'u.phone AS username'
      : 'CAST(u.id AS CHAR) AS username';
  const realNameExpr = uCols.has('real_name')
    ? 'u.real_name'
    : uCols.has('name')
      ? 'u.name AS real_name'
      : usernameExpr.replace(/\s+AS\s+username$/i, '') + ' AS real_name';

  const [rows] = await pool.execute(
    `SELECT s.*, ${usernameExpr}, ${realNameExpr}
     FROM exam_sessions s
     JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
     JOIN \`${uSafe}\` u ON s.user_id = u.id
     WHERE s.exam_id = ? AND s.status IN ('submitted', 'force_submitted')
     ORDER BY s.submitted_at DESC`,
    [examId]
  );
  return rows || [];
}

// 所有路由都需要认证
router.use(authenticate);

// 初始化表（如果不存在）- 在第一次请求时执行
let initializationPromise = null;
router.use(async (req, res, next) => {
  // 确保只初始化一次
  if (!initializationPromise) {
    initializationPromise = require('../models/gradingAccountModel').initializeTables().catch(err => {
      console.error('初始化表失败:', err);
      initializationPromise = null; // 重置，允许重试
    });
  }
  // 等待初始化完成（但不阻塞太久）
  try {
    await Promise.race([
      initializationPromise,
      new Promise(resolve => setTimeout(resolve, 1000)) // 最多等待1秒
    ]);
  } catch (err) {
    // 忽略超时错误
  }
  next();
});

// 获取任务下的待阅卷答案列表
router.get('/grading-tasks/:taskId/answers', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    // 检查表是否存在
    const tables = await checkTablesExist();
    if (!tables.tasks || !tables.accounts || !tables.records) {
      return res.status(500).json({
        success: false,
        message: '数据库表不存在，请先运行迁移脚本：node backend/scripts/run_grading_system_migration.js'
      });
    }

    const taskId = parseInt(req.params.taskId);

    // 获取任务信息
    const [tasks] = await pool.execute(
      `SELECT t.*, e.enterprise_id, e.paper_id, ga.enterprise_id as grader_enterprise_id
       FROM grading_tasks t
       JOIN exams e ON t.exam_id = e.id
       LEFT JOIN grading_accounts ga ON t.grading_account_id = ga.id
       WHERE t.id = ?`,
      [taskId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const task = tasks[0];

    // 读取考试配置（含主观/客观答题方式覆盖，用于与“主观题阅卷”配置保持一致）
    let exam = null;
    let answerTypeOverrides = {};
    try {
      exam = await ExamModel.findById(task.exam_id);
      if (exam && exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) {
        answerTypeOverrides = exam.answer_system_config.answerTypeOverrides || {};
      }
    } catch (e) {
      // 若读取失败，不中断流程，仅回退到按题型粗略判断
      exam = null;
      answerTypeOverrides = {};
    }

    // 权限检查
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (task.enterprise_id !== entId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    } else if (req.user.role === 'grader') {
      // 子阅卷账号只能查看分配给自己的任务
      const graderId = req.user.graderId || req.user.id;
      const enterpriseId = req.user.enterpriseId;
      
      if (task.grading_account_id !== graderId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      
      // 企业端子账号：额外检查考试是否属于该企业
      if (enterpriseId && task.enterprise_id !== enterpriseId) {
        return res.status(403).json({ success: false, message: '无权限访问该考试' });
      }
    }

    // 获取已交卷的会话
    const sessions = await listSubmittedSessionsWithCandidates(task.exam_id);

    if (sessions.length === 0) {
      return res.json({ success: true, data: { answers: [], task } });
    }

    const sessionIds = sessions.map(s => s.id);

    // 获取所有答案，同时获取题号信息（与主观题列表一致：含 standard_answer、answer_analysis、answer、answer_html、explanation、explanation_html、子小题答案和解析）
    const [allAnswers] = await pool.execute(
      `SELECT a.*, sq.content_html, sq.full_content, sq.score as max_score, 
              sq.standard_answer, sq.answer_analysis, sq.grading_points,
              sq.answer, sq.answer_html, sq.explanation, sq.explanation_html,
              sq.number, sq.sub_number,
              sq.sub_answers, sq.sub_explanations,
              mq.question_type, mq.id as major_question_id, sq.id as sub_question_id,
              CONCAT(IFNULL(sq.number, ''), IF(sq.sub_number IS NOT NULL AND sq.sub_number != '', CONCAT('.', sq.sub_number), '')) as question_number
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id IN (${sessionIds.map(() => '?').join(',')})`,
      sessionIds
    );

    // 根据任务配置过滤答案
    const taskConfig = typeof task.task_config === 'string' 
      ? JSON.parse(task.task_config) 
      : task.task_config;

    let filteredAnswers = allAnswers;

    if (task.task_type === 'content') {
      // 按内容分配：过滤指定的小题或大题
      if (taskConfig.sub_question_ids && Array.isArray(taskConfig.sub_question_ids)) {
        filteredAnswers = allAnswers.filter(a => 
          taskConfig.sub_question_ids.includes(a.sub_question_id)
        );
      } else if (taskConfig.major_question_ids && Array.isArray(taskConfig.major_question_ids)) {
        filteredAnswers = allAnswers.filter(a => 
          taskConfig.major_question_ids.includes(a.major_question_id)
        );
      }
    } else if (task.task_type === 'question_type') {
      // 按题型分配：过滤指定的题型
      if (taskConfig.question_types && Array.isArray(taskConfig.question_types)) {
        filteredAnswers = allAnswers.filter(a => {
          const qType = a.question_type || '';
          return taskConfig.question_types.some(type => 
            qType.includes(type) || type.includes(qType)
          );
        });
      }
    }

    // 只保留“主观题阅卷”里配置为主观题的小题：
    // 使用 gradingService.getAnswerTypeForGrading + isObjectiveQuestionType，
    // 与管理端「主观题任务分配与阅卷」中的主观题定义保持一致
    filteredAnswers = filteredAnswers.filter(a => {
      // a.question_type 来自 mq.question_type，a.sub_question_id 来自 sq.id
      const answerType = getAnswerTypeForGrading(a.question_type, answerTypeOverrides, a.sub_question_id);
      // answerType 为 choice/multichoice/judge/blank 等认为是客观题，其它（如 text）为主观题
      return !isObjectiveQuestionType(answerType);
    });

    // 获取已有的阅卷记录
    const [records] = await pool.execute(
      `SELECT * FROM grading_records WHERE task_id = ?`,
      [taskId]
    );

    const recordMap = new Map(records.map(r => [r.answer_id, r]));

    // review=1 时返回全部（含已阅卷），否则只返回未阅卷
    const includeGraded = req.query.review === '1' || req.query.include_graded === '1';
    const answersToReturn = includeGraded
      ? filteredAnswers
      : filteredAnswers.filter(a => !recordMap.has(a.id));

    // 为答案添加题号显示，并附带阅卷记录（回评时前端可展示并 PUT 更新）
    const answersWithQuestionNumber = answersToReturn.map(a => {
      let questionNumber = a.question_number;
      if (!questionNumber || questionNumber === '') {
        if (a.sub_number) {
          questionNumber = `${a.number || ''}.${a.sub_number}`;
        } else {
          questionNumber = a.number || '';
        }
      }
      const rec = recordMap.get(a.id);
      
      // 解析子小题答案和解析
      let subAnswers = null;
      let subExplanations = null;
      
      if (a.sub_answers) {
        try {
          subAnswers = typeof a.sub_answers === 'string' ? JSON.parse(a.sub_answers) : a.sub_answers;
          if (!Array.isArray(subAnswers)) subAnswers = null;
        } catch (e) {
          console.warn('解析 sub_answers 失败:', e);
          subAnswers = null;
        }
      }
      
      if (a.sub_explanations) {
        try {
          subExplanations = typeof a.sub_explanations === 'string' ? JSON.parse(a.sub_explanations) : a.sub_explanations;
          if (!Array.isArray(subExplanations)) subExplanations = null;
        } catch (e) {
          console.warn('解析 sub_explanations 失败:', e);
          subExplanations = null;
        }
      }
      
      // 显式带上参考答案字段（与主观题列表一致），确保前端子阅卷能显示
      return {
        ...a,
        question_number: questionNumber,
        sub_answers: subAnswers,
        sub_explanations: subExplanations,
        grading_record: rec ? { id: rec.id, score: rec.score, grading_comment: rec.grading_comment, graded_at: rec.graded_at } : null,
        standard_answer: a.standard_answer ?? null,
        answer_analysis: a.answer_analysis ?? null,
        answer: a.answer ?? null,
        answer_html: a.answer_html ?? null,
        explanation: a.explanation ?? null,
        explanation_html: a.explanation_html ?? null
      };
    });

    res.json({ success: true, data: { answers: answersWithQuestionNumber, task, sessions } });
  } catch (error) {
    console.error('Get task answers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 提交阅卷结果
router.post('/grading-records', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    const { task_id, answer_id, score, grading_comment } = req.body;

    if (!task_id || !answer_id || score === undefined) {
      return res.status(400).json({
        success: false,
        message: '参数不完整'
      });
    }

    // 获取任务信息
    const [tasks] = await pool.execute(
      `SELECT t.*, e.enterprise_id, ga.enterprise_id as grader_enterprise_id
       FROM grading_tasks t
       JOIN exams e ON t.exam_id = e.id
       LEFT JOIN grading_accounts ga ON t.grading_account_id = ga.id
       WHERE t.id = ?`,
      [task_id]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const task = tasks[0];

    // 权限检查
    let graderId;
    if (req.user.role === 'grader') {
      graderId = req.user.graderId || req.user.id;
      const enterpriseId = req.user.enterpriseId;
      
      if (task.grading_account_id !== graderId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      
      // 企业端子账号：额外检查考试是否属于该企业
      if (enterpriseId && task.enterprise_id !== enterpriseId) {
        return res.status(403).json({ success: false, message: '无权限访问该考试' });
      }
    } else {
      // admin或enterprise可以指定grader_id，否则使用任务分配的grader
      graderId = req.body.grading_account_id || task.grading_account_id;
    }

    // 验证答案是否存在
    const [answers] = await pool.execute(
      `SELECT a.*, sq.score as max_score FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       WHERE a.id = ?`,
      [answer_id]
    );

    if (answers.length === 0) {
      return res.status(404).json({ success: false, message: '答案不存在' });
    }

    const answer = answers[0];
    const maxScore = answer.max_score || 100;

    // 验证分数范围
    const scoreNum = parseFloat(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > maxScore) {
      return res.status(400).json({
        success: false,
        message: `分数必须在0-${maxScore}之间`
      });
    }

    // 检查是否已存在记录
    const [existing] = await pool.execute(
      `SELECT * FROM grading_records WHERE task_id = ? AND answer_id = ?`,
      [task_id, answer_id]
    );

    if (existing.length > 0) {
      // 更新现有记录
      await pool.execute(
        `UPDATE grading_records 
         SET score = ?, grading_comment = ?, graded_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [scoreNum, grading_comment || null, existing[0].id]
      );

      // 同步更新exam_answers表的score
      await pool.execute(
        `UPDATE exam_answers SET score = ? WHERE id = ?`,
        [scoreNum, answer_id]
      );
      // 重算该会话总分并回写 exam_sessions，使阅卷统计与总成绩正确
      const [sumRows] = await pool.execute(
        `SELECT COALESCE(SUM(x.score), 0) AS total
         FROM (
           SELECT
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END AS logical_key,
             MAX(score) AS score
           FROM exam_answers
           WHERE session_id = ? AND score IS NOT NULL
           GROUP BY
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END
         ) x`,
        [answer.session_id]
      );
      await pool.execute(
        'UPDATE exam_sessions SET total_score = ? WHERE id = ?',
        [sumRows[0].total, answer.session_id]
      );
      await generateSummaryAndReport(answer.session_id);

      res.json({ success: true, message: '阅卷结果更新成功', data: { id: existing[0].id } });
    } else {
      // 创建新记录
      const [result] = await pool.execute(
        `INSERT INTO grading_records (task_id, answer_id, grading_account_id, score, grading_comment, graded_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [task_id, answer_id, graderId, scoreNum, grading_comment || null]
      );

      // 同步更新exam_answers表的score
      await pool.execute(
        `UPDATE exam_answers SET score = ? WHERE id = ?`,
        [scoreNum, answer_id]
      );
      // 重算该会话总分并回写 exam_sessions，使阅卷统计与总成绩正确
      const [sumRows] = await pool.execute(
        `SELECT COALESCE(SUM(x.score), 0) AS total
         FROM (
           SELECT
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END AS logical_key,
             MAX(score) AS score
           FROM exam_answers
           WHERE session_id = ? AND score IS NOT NULL
           GROUP BY
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END
         ) x`,
        [answer.session_id]
      );
      await pool.execute(
        'UPDATE exam_sessions SET total_score = ? WHERE id = ?',
        [sumRows[0].total, answer.session_id]
      );
      await generateSummaryAndReport(answer.session_id);

      // 更新任务状态为进行中
      await pool.execute(
        `UPDATE grading_tasks SET status = 'in_progress', updated_at = NOW() WHERE id = ?`,
        [task_id]
      );

      await checkAndGenerateSummaryAndReport(answer_id, task_id);

      res.json({ success: true, message: '阅卷结果提交成功', data: { id: result.insertId } });
    }
  } catch (error) {
    console.error('Submit grading record error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 更新阅卷结果
router.put('/grading-records/:id', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    const recordId = parseInt(req.params.id);
    const { score, grading_comment } = req.body;

    // 获取记录信息
    const [records] = await pool.execute(
      `SELECT gr.*, t.grading_account_id, t.exam_id, a.id as answer_id, a.session_id, sq.score as max_score
       FROM grading_records gr
       JOIN grading_tasks t ON gr.task_id = t.id
       JOIN exam_answers a ON gr.answer_id = a.id
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       WHERE gr.id = ?`,
      [recordId]
    );

    if (records.length === 0) {
      return res.status(404).json({ success: false, message: '阅卷记录不存在' });
    }

    const record = records[0];

    // 权限检查
    if (req.user.role === 'grader') {
      const graderId = req.user.graderId || req.user.id;
      const enterpriseId = req.user.enterpriseId;
      
      if (record.grading_account_id !== graderId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      
      // 企业端子账号：额外检查考试是否属于该企业
      if (enterpriseId) {
        const [exam] = await pool.execute(
          `SELECT enterprise_id FROM exams WHERE id = ?`,
          [record.exam_id]
        );
        if (exam.length > 0 && exam[0].enterprise_id !== enterpriseId) {
          return res.status(403).json({ success: false, message: '无权限访问该考试' });
        }
      }
    }

    const updates = [];
    const params = [];

    if (score !== undefined) {
      const scoreNum = parseFloat(score);
      const maxScore = record.max_score || 100;
      if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > maxScore) {
        return res.status(400).json({
          success: false,
          message: `分数必须在0-${maxScore}之间`
        });
      }
      updates.push('score = ?');
      params.push(scoreNum);

      // 同步更新exam_answers表的score
      await pool.execute(
        `UPDATE exam_answers SET score = ? WHERE id = ?`,
        [scoreNum, record.answer_id]
      );
      // 重算该会话总分并回写 exam_sessions
      const [sumRows] = await pool.execute(
        `SELECT COALESCE(SUM(x.score), 0) AS total
         FROM (
           SELECT
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END AS logical_key,
             MAX(score) AS score
           FROM exam_answers
           WHERE session_id = ? AND score IS NOT NULL
           GROUP BY
             CASE
               WHEN sub_question_id IS NOT NULL THEN CONCAT('sq#', sub_question_id)
               WHEN question_number IS NOT NULL AND question_number != '' THEN CONCAT('qn#', question_number)
               ELSE CONCAT('id#', id)
             END
         ) x`,
        [record.session_id]
      );
      await pool.execute(
        'UPDATE exam_sessions SET total_score = ? WHERE id = ?',
        [sumRows[0].total, record.session_id]
      );
      await generateSummaryAndReport(record.session_id);
    }

    if (grading_comment !== undefined) {
      updates.push('grading_comment = ?');
      params.push(grading_comment);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }

    params.push(recordId);
    await pool.execute(
      `UPDATE grading_records SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    res.json({ success: true, message: '阅卷结果更新成功' });
  } catch (error) {
    console.error('Update grading record error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取每道题的阅卷进度
router.get('/grading-tasks/:taskId/question-progress', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);

    // 获取任务信息
    const [tasks] = await pool.execute(
      `SELECT t.*, e.enterprise_id FROM grading_tasks t
       JOIN exams e ON t.exam_id = e.id
       WHERE t.id = ?`,
      [taskId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const task = tasks[0];

    // 权限检查
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (task.enterprise_id !== entId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    } else if (req.user.role === 'grader') {
      const graderId = req.user.graderId || req.user.id;
      const enterpriseId = req.user.enterpriseId;
      
      if (task.grading_account_id !== graderId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      
      // 企业端子账号：额外检查考试是否属于该企业
      if (enterpriseId && task.enterprise_id !== enterpriseId) {
        return res.status(403).json({ success: false, message: '无权限访问该考试' });
      }
    }

    // 获取任务配置
    const taskConfig = typeof task.task_config === 'string' 
      ? JSON.parse(task.task_config) 
      : task.task_config;

    // 获取已交卷的会话
    const [sessions] = await pool.execute(
      `SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'submitted'`,
      [task.exam_id]
    );

    const sessionIds = sessions.map(s => s.id);
    if (sessionIds.length === 0) {
      return res.json({ success: true, data: {} });
    }

    // 获取所有答案
    const [allAnswers] = await pool.execute(
      `SELECT a.*, a.sub_question_id, mq.question_type, mq.id as major_question_id
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id IN (${sessionIds.map(() => '?').join(',')})`,
      sessionIds
    );

    // 根据任务配置过滤
    let filteredAnswers = allAnswers;
    if (task.task_type === 'content') {
      if (taskConfig.sub_question_ids && Array.isArray(taskConfig.sub_question_ids)) {
        filteredAnswers = allAnswers.filter(a => 
          taskConfig.sub_question_ids.includes(a.sub_question_id)
        );
      } else if (taskConfig.major_question_ids && Array.isArray(taskConfig.major_question_ids)) {
        filteredAnswers = allAnswers.filter(a => 
          taskConfig.major_question_ids.includes(a.major_question_id)
        );
      }
    } else if (task.task_type === 'question_type') {
      if (taskConfig.question_types && Array.isArray(taskConfig.question_types)) {
        filteredAnswers = allAnswers.filter(a => {
          const qType = a.question_type || '';
          return taskConfig.question_types.some(type => 
            qType.includes(type) || type.includes(qType)
          );
        });
      }
    }

    // 排除客观题
    filteredAnswers = filteredAnswers.filter(a => {
      return !isObjectiveQuestionType(a.question_type);
    });

    // 按 sub_question_id 分组统计
    const questionStats = {};
    filteredAnswers.forEach(a => {
      const qId = a.sub_question_id;
      if (!qId) return;
      
      if (!questionStats[qId]) {
        questionStats[qId] = {
          question_id: qId,
          total: 0,
          graded: 0
        };
      }
      questionStats[qId].total++;
    });

    // 获取已阅卷记录
    const [records] = await pool.execute(
      `SELECT gr.answer_id, a.sub_question_id 
       FROM grading_records gr
       JOIN exam_answers a ON gr.answer_id = a.id
       WHERE gr.task_id = ?`,
      [taskId]
    );

    // 统计每道题的已阅卷数量
    records.forEach(r => {
      if (r.sub_question_id && questionStats[r.sub_question_id]) {
        questionStats[r.sub_question_id].graded++;
      }
    });

    // 计算进度百分比
    const result = {};
    Object.values(questionStats).forEach(stat => {
      result[stat.question_id] = {
        graded: stat.graded,
        total: stat.total,
        progress: stat.total > 0 ? Math.round((stat.graded / stat.total) * 100) : 0
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get question progress error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取任务进度统计
router.get('/grading-tasks/:taskId/progress', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);

    // 获取任务信息
    const [tasks] = await pool.execute(
      `SELECT t.*, e.enterprise_id FROM grading_tasks t
       JOIN exams e ON t.exam_id = e.id
       WHERE t.id = ?`,
      [taskId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const task = tasks[0];

    // 权限检查
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (task.enterprise_id !== entId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    } else if (req.user.role === 'grader') {
      const graderId = req.user.graderId || req.user.id;
      const enterpriseId = req.user.enterpriseId;
      
      if (task.grading_account_id !== graderId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      
      // 企业端子账号：额外检查考试是否属于该企业
      if (enterpriseId && task.enterprise_id !== enterpriseId) {
        return res.status(403).json({ success: false, message: '无权限访问该考试' });
      }
    }

    // 获取总答案数（需要先获取任务下的答案列表）
    const taskConfig = typeof task.task_config === 'string' 
      ? JSON.parse(task.task_config) 
      : task.task_config;

    const [sessions] = await pool.execute(
      `SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'submitted'`,
      [task.exam_id]
    );

    const sessionIds = sessions.map(s => s.id);
    if (sessionIds.length === 0) {
      return res.json({
        success: true,
        data: {
          total: 0,
          graded: 0,
          pending: 0,
          progress: 0
        }
      });
    }

    const [allAnswers] = await pool.execute(
      `SELECT a.*, mq.question_type, mq.id as major_question_id
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id IN (${sessionIds.map(() => '?').join(',')})`,
      sessionIds
    );

    // 根据任务配置过滤
    let filteredAnswers = allAnswers;
    if (task.task_type === 'content') {
      if (taskConfig.sub_question_ids) {
        filteredAnswers = allAnswers.filter(a => 
          taskConfig.sub_question_ids.includes(a.sub_question_id)
        );
      } else if (taskConfig.major_question_ids) {
        filteredAnswers = allAnswers.filter(a => 
          taskConfig.major_question_ids.includes(a.major_question_id)
        );
      }
    } else if (task.task_type === 'question_type') {
      if (taskConfig.question_types) {
        filteredAnswers = allAnswers.filter(a => {
          const qType = a.question_type || '';
          return taskConfig.question_types.some(type => 
            qType.includes(type) || type.includes(qType)
          );
        });
      }
    }

    // 排除客观题
    filteredAnswers = filteredAnswers.filter(a => {
      return !isObjectiveQuestionType(a.question_type);
    });

    const total = filteredAnswers.length;

    // 获取已阅卷数量
    const [records] = await pool.execute(
      `SELECT COUNT(DISTINCT answer_id) as graded_count
       FROM grading_records WHERE task_id = ?`,
      [taskId]
    );

    const graded = parseInt(records[0]?.graded_count || 0);
    const pending = total - graded;
    const progress = total > 0 ? Math.round((graded / total) * 100) : 0;

    // 获取该考试的所有子账号及其剩余数量
    const [allTasks] = await pool.execute(
      `SELECT t.id, t.grading_account_id, t.task_type, t.task_config,
              CASE WHEN ga.id IS NULL THEN CONCAT('missing#', t.grading_account_id) ELSE ga.username END AS username,
              CASE WHEN ga.id IS NULL THEN '账号已删除/无效' ELSE COALESCE(ga.real_name, ga.username) END AS real_name
       FROM grading_tasks t
       LEFT JOIN grading_accounts ga ON t.grading_account_id = ga.id
       WHERE t.exam_id = ?`,
      [task.exam_id]
    );

    const remainingByAccount = {};
    
    // 为每个子账号计算剩余数量
    for (const taskItem of allTasks) {
      const accountId = taskItem.grading_account_id;
      const accountKey = `${accountId}`;
      
      if (!remainingByAccount[accountKey]) {
        remainingByAccount[accountKey] = {
          account_id: accountId,
          username: taskItem.username,
          real_name: taskItem.real_name,
          remaining: 0
        };
      }

      // 获取该任务的总数和已阅卷数
      const taskConfigItem = typeof taskItem.task_config === 'string' 
        ? JSON.parse(taskItem.task_config) 
        : taskItem.task_config;

      let taskFilteredAnswers = allAnswers;
      if (taskItem.task_type === 'content') {
        if (taskConfigItem.sub_question_ids && Array.isArray(taskConfigItem.sub_question_ids)) {
          taskFilteredAnswers = allAnswers.filter(a => 
            taskConfigItem.sub_question_ids.includes(a.sub_question_id)
          );
        } else if (taskConfigItem.major_question_ids && Array.isArray(taskConfigItem.major_question_ids)) {
          taskFilteredAnswers = allAnswers.filter(a => 
            taskConfigItem.major_question_ids.includes(a.major_question_id)
          );
        }
      } else if (taskItem.task_type === 'question_type') {
        if (taskConfigItem.question_types && Array.isArray(taskConfigItem.question_types)) {
          taskFilteredAnswers = allAnswers.filter(a => {
            const qType = a.question_type || '';
            return taskConfigItem.question_types.some(type => 
              qType.includes(type) || type.includes(qType)
            );
          });
        }
      }

      // 排除客观题
      taskFilteredAnswers = taskFilteredAnswers.filter(a => {
        return !isObjectiveQuestionType(a.question_type);
      });

      const taskTotal = taskFilteredAnswers.length;

      // 获取该任务的已阅卷数量
      const [taskRecords] = await pool.execute(
        `SELECT COUNT(DISTINCT answer_id) as graded_count
         FROM grading_records WHERE task_id = ?`,
        [taskItem.id]
      );

      const taskGraded = parseInt(taskRecords[0]?.graded_count || 0);
      const taskRemaining = taskTotal - taskGraded;

      remainingByAccount[accountKey].remaining += taskRemaining;
    }

    res.json({
      success: true,
      data: {
        total,
        graded,
        pending,
        progress,
        remainingByAccount: Object.values(remainingByAccount)
      }
    });
  } catch (error) {
    console.error('Get task progress error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 检查是否所有题目都已阅卷完成，如果是则自动生成汇总数据和评估报告
 */
async function checkAndGenerateSummaryAndReport(answerId, taskId) {
  try {
    // 获取答案信息
    const [answers] = await pool.execute(
      `SELECT a.session_id, a.sub_question_id, t.exam_id
       FROM exam_answers a
       JOIN grading_records gr ON a.id = gr.answer_id
       JOIN grading_tasks t ON gr.task_id = t.id
       WHERE a.id = ? AND gr.task_id = ?`,
      [answerId, taskId]
    );

    if (answers.length === 0) return;

    const { session_id, exam_id } = answers[0];

    // 获取该会话的所有答案
    const [allAnswers] = await pool.execute(
      `SELECT a.*, sq.score as max_score, sq.exam_purpose, sq.difficulty, mq.question_type
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id = ?`,
      [session_id]
    );

    // 检查是否所有主观题都已阅卷（客观题自动阅卷）
    const subjectiveAnswers = allAnswers.filter(a => {
      return !isObjectiveQuestionType(a.question_type) && a.sub_question_id;
    });

    if (subjectiveAnswers.length === 0) {
      // 没有主观题，直接生成汇总数据和报告
      await generateSummaryAndReport(session_id);
      return;
    }

    // 获取该考试的所有任务
    const [tasks] = await pool.execute(
      `SELECT id FROM grading_tasks WHERE exam_id = ?`,
      [exam_id]
    );

    // 检查每个主观题是否都有阅卷记录
    let allGraded = true;
    for (const answer of subjectiveAnswers) {
      const [records] = await pool.execute(
        `SELECT COUNT(*) as count FROM grading_records gr
         JOIN grading_tasks t ON gr.task_id = t.id
         WHERE gr.answer_id = ? AND t.exam_id = ?`,
        [answer.id, exam_id]
      );

      if (records[0].count === 0) {
        allGraded = false;
        break;
      }
    }

    // 如果所有题目都已阅卷，生成汇总数据和报告
    if (allGraded) {
      await generateSummaryAndReport(session_id);
    }
  } catch (error) {
    console.error('检查阅卷完成状态失败:', error);
    // 不抛出错误，避免影响阅卷流程
  }
}

/**
 * 生成汇总数据和评估报告
 */
async function generateSummaryAndReport(sessionId) {
  try {
    // 生成汇总数据
    await ExamSummaryService.generateSummary(sessionId);
    console.log(`✓ 汇总数据生成成功: sessionId=${sessionId}`);

    // 异步生成评估报告（避免阻塞）
    EvaluationReportService.generateReport(sessionId)
      .then(() => {
        console.log(`✓ 评估报告生成成功: sessionId=${sessionId}`);
      })
      .catch(error => {
        console.error(`✗ 评估报告生成失败: sessionId=${sessionId}`, error);
      });
  } catch (error) {
    console.error(`生成汇总数据失败: sessionId=${sessionId}`, error);
    // 不抛出错误，避免影响阅卷流程
  }
}

module.exports = router;
