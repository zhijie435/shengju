const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { cleanAnswerText } = require('../utils/textCleaner');
const ExamModel = require('../models/examModel');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const EnterpriseModel = require('../models/enterpriseModel');
const GradingAccountModel = require('../models/gradingAccountModel');
const { isObjectiveQuestionType } = require('../services/gradingService');
const { checkTablesExist, attachTaskProgressStats, listGradingTasksForExam } = require('../services/gradingTaskListHelper');

async function resolveEnterpriseId(req) {
  if (req.user.role !== 'enterprise') return null;
  const eid = req.enterpriseId ?? req.user?.enterpriseId;
  if (eid != null && eid !== '' && Number.isFinite(Number(eid)) && Number(eid) > 0) return Number(eid);
  const ent = await EnterpriseModel.findByUserId(req.user.id);
  return ent?.id ?? null;
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

// 获取某考试考生考试情况列表（缺考/违规/正常）- 备用路由（与 exams 路由重复，确保 /api/exams/:id/examinee-status 可访问）
router.get('/exams/:examId/examinee-status', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (exam.enterprise_id !== ent?.id) return res.status(403).json({ success: false, message: '无权限' });
    }
    const mc = exam.monitor_config && typeof exam.monitor_config === 'object' ? exam.monitor_config : {};
    const maxViolations = mc.maxViolations != null ? parseInt(mc.maxViolations, 10) : 5;

    const userTbl = await ExamEnrollmentModel.getCandidateUserTableName();
    const joinEnUser = `FROM exam_enrollments en JOIN \`${userTbl}\` u ON en.user_id = u.id`;
    let enrollments;
    const sqlFull = `SELECT en.id, en.user_id, en.status as enrollment_status, u.username, u.real_name, u.exam_number, u.phone
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlNameAsReal = `SELECT en.id, en.user_id, en.status as enrollment_status, u.username, u.name AS real_name, u.exam_number, u.phone
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlUserAsReal = `SELECT en.id, en.user_id, en.status as enrollment_status, u.username, u.username AS real_name, u.exam_number, u.phone
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlMinimal = `SELECT en.id, en.user_id, en.status as enrollment_status, u.username, u.real_name
         ${joinEnUser}
         WHERE en.exam_id = ? ORDER BY en.enrolled_at DESC`;
    const sqlMinimalUser = `SELECT en.id, en.user_id, en.status as enrollment_status, u.username, u.username AS real_name
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
      } else if (err.code === 'ER_BAD_FIELD_ERROR' && err.message && (err.message.includes('phone') || err.message.includes('exam_number'))) {
        try {
          [enrollments] = await pool.execute(sqlMinimal, [req.params.examId]);
        } catch (errM) {
          if (errM.code === 'ER_BAD_FIELD_ERROR' && (errM.message || '').includes('real_name')) {
            [enrollments] = await pool.execute(sqlMinimalUser, [req.params.examId]);
          } else {
            throw errM;
          }
        }
        enrollments = enrollments.map(r => ({ ...r, exam_number: r.exam_number ?? null, phone: r.phone ?? null }));
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
        if (session.violation_count >= maxViolations) status = '违规';
        else if (session.status === 'submitted' || session.status === 'ongoing') status = session.status === 'submitted' ? '已交卷' : '考试中';
        else if (session.status !== 'pending') status = session.status === 'abnormal' ? '异常' : (session.status || '缺考');
      }
      return {
        id: en.id, user_id: en.user_id, real_name: en.real_name || en.username, username: en.username,
        exam_number: en.exam_number, phone: en.phone, status,
        violation_count: session ? session.violation_count : 0, max_violations: maxViolations,
        submitted_at: session ? session.submitted_at : null
      };
    });
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

const TYPE_MAP_GT = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
const ANSWER_TYPE_LABELS_GT = { choice: '选择题', multichoice: '多选题', judge: '判断题', blank: '填空题' };
const OBJECTIVE_ANSWER_TYPES_GT = ['choice', 'multichoice', 'judge', 'blank'];

function getAnswerTypeFromQuestionType(questionType) {
  if (!questionType) return 'text';
  const t = String(questionType).trim();
  for (const [key, val] of Object.entries(TYPE_MAP_GT)) {
    if (t.includes(key)) return val;
  }
  return 'text';
}

// 获取某考试客观题列表（备用路由）
router.get('/exams/:examId/objective-questions', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (exam.enterprise_id !== ent?.id) return res.status(403).json({ success: false, message: '无权限' });
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

    const list = [];
    let globalIndex = 0;
    for (const r of rows) {
      globalIndex++;
      const answerType = overrides[r.id] || getAnswerTypeFromQuestionType(r.question_type);
      if (!OBJECTIVE_ANSWER_TYPES_GT.includes(answerType)) continue;
      const rawAnswer = (r.answer != null && r.answer !== '') ? String(r.answer).trim()
        : (r.Answer != null && r.Answer !== '') ? String(r.Answer).trim()
        : (r.answer_html ? String(r.answer_html).replace(/<[^>]+>/g, '').trim() : '') || '';
      const bankAnswer = cleanAnswerText(rawAnswer || (r.standard_answer || '').trim()) || '';
      const rawExplanation = (r.explanation != null && r.explanation !== '') ? String(r.explanation).trim()
        : (r.Explanation != null && r.Explanation !== '') ? String(r.Explanation).trim()
        : (r.explanation_html ? String(r.explanation_html).replace(/<[^>]+>/g, '').trim() : '')
        || (r.answer_analysis ? String(r.answer_analysis).trim() : '') || '';
      const bankExplanation = cleanAnswerText(rawExplanation) || '';
      list.push({
        ...r,
        displayNumber: String(globalIndex),
        answerType,
        answerTypeLabel: ANSWER_TYPE_LABELS_GT[answerType] || answerType,
        bankAnswer: bankAnswer || '',
        bankExplanation: bankExplanation || '',
        standard_answer: r.standard_answer || ''
      });
    }
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/exams/:examId/grading-tasks', requireRole('admin', 'enterprise', 'grader'), listGradingTasksForExam);

// 创建任务分配
router.post('/exams/:examId/grading-tasks', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    // 检查表是否存在
    const tables = await checkTablesExist();
    if (!tables.tasks || !tables.accounts) {
      return res.status(500).json({
        success: false,
        message: '数据库表不存在，请先运行迁移脚本：node backend/scripts/run_grading_system_migration.js'
      });
    }

    const examId = parseInt(req.params.examId);
    const { grading_account_id, task_type, task_config } = req.body;

    if (!grading_account_id || !task_type || !task_config) {
      return res.status(400).json({
        success: false,
        message: '参数不完整'
      });
    }

    if (!['content', 'question_type'].includes(task_type)) {
      return res.status(400).json({
        success: false,
        message: '无效的任务类型'
      });
    }

    const exam = await ExamModel.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: '考试不存在' });
    }

    // 企业管理员只能为本企业的考试分配任务
    if (req.user.role === 'enterprise') {
      const entId = await resolveEnterpriseId(req);
      if (!entId || exam.enterprise_id !== entId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    // 验证账号是否存在且属于同一企业
    const account = await GradingAccountModel.findById(grading_account_id);
    if (!account) {
      return res.status(404).json({ success: false, message: '阅卷账号不存在' });
    }

    if (req.user.role === 'enterprise') {
      const entId = await resolveEnterpriseId(req);
      if (!entId || account.enterprise_id !== entId) {
        return res.status(403).json({ success: false, message: '账号不属于本企业' });
      }
    }

    // 验证任务配置
    let taskConfigObj;
    try {
      taskConfigObj = typeof task_config === 'string' ? JSON.parse(task_config) : task_config;
    } catch (e) {
      return res.status(400).json({ success: false, message: '任务配置格式错误' });
    }

    // 根据任务类型验证配置
    if (task_type === 'content') {
      // 按内容分配：需要 sub_question_ids 或 major_question_ids
      if (!taskConfigObj.sub_question_ids && !taskConfigObj.major_question_ids) {
        return res.status(400).json({
          success: false,
          message: '按内容分配需要指定小题ID或大题ID'
        });
      }
    } else if (task_type === 'question_type') {
      // 按题型分配：需要 question_types 数组
      if (!Array.isArray(taskConfigObj.question_types) || taskConfigObj.question_types.length === 0) {
        return res.status(400).json({
          success: false,
          message: '按题型分配需要指定题型数组'
        });
      }
    }

    // 创建任务
    const [result] = await pool.execute(
      `INSERT INTO grading_tasks (exam_id, grading_account_id, task_type, task_config, status, created_by, assigned_at)
       VALUES (?, ?, ?, ?, 'assigned', ?, NOW())`,
      [examId, grading_account_id, task_type, JSON.stringify(taskConfigObj), req.user.id]
    );

    res.json({
      success: true,
      message: '任务分配成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Create grading task error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 更新任务分配
router.put('/grading-tasks/:id', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    // 检查表是否存在
    const tables = await checkTablesExist();
    if (!tables.tasks) {
      return res.status(500).json({
        success: false,
        message: '数据库表不存在，请先运行迁移脚本'
      });
    }

    const taskId = parseInt(req.params.id);
    const { status } = req.body;

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

    // 企业管理员只能更新本企业的任务
    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      if (!enterprise || task.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    // 更新状态
    if (status) {
      if (!['pending', 'assigned', 'in_progress', 'completed'].includes(status)) {
        return res.status(400).json({ success: false, message: '无效的状态' });
      }

      const updateFields = ['status = ?'];
      const params = [status];

      if (status === 'completed') {
        updateFields.push('completed_at = NOW()');
      } else if (status === 'in_progress') {
        updateFields.push('assigned_at = COALESCE(assigned_at, NOW())');
      }

      params.push(taskId);

      await pool.execute(
        `UPDATE grading_tasks SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
        params
      );
    }

    res.json({ success: true, message: '任务更新成功' });
  } catch (error) {
    console.error('Update grading task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 删除任务分配
router.delete('/grading-tasks/:id', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    // 检查表是否存在
    const tables = await checkTablesExist();
    if (!tables.tasks) {
      return res.status(500).json({
        success: false,
        message: '数据库表不存在，请先运行迁移脚本'
      });
    }

    const taskId = parseInt(req.params.id);

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

    // 企业管理员只能删除本企业的任务
    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      if (!enterprise || task.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    await pool.execute('DELETE FROM grading_tasks WHERE id = ?', [taskId]);

    res.json({ success: true, message: '任务删除成功' });
  } catch (error) {
    console.error('Delete grading task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取子账号可访问的项目列表
router.get('/grading/projects', requireRole('grader'), async (req, res) => {
  try {
    const graderId = req.user.graderId || req.user.id;
    const enterpriseId = req.user.enterpriseId; // 企业端子账号有值，管理端为null

    let projects = [];

    if (enterpriseId) {
      // 企业端子账号：查询自己企业的所有考试
      const [exams] = await pool.execute(
        `SELECT e.id, e.name, e.status, e.start_time, e.end_time, e.enterprise_id,
                COUNT(DISTINCT gt.id) as task_count
         FROM exams e
         LEFT JOIN grading_tasks gt ON e.id = gt.exam_id AND gt.grading_account_id = ?
         WHERE e.enterprise_id = ?
         GROUP BY e.id
         ORDER BY e.created_at DESC`,
        [graderId, enterpriseId]
      );
      projects = exams;
    } else {
      // 管理端子账号：查询通过grading_tasks分配的项目
      const [exams] = await pool.execute(
        `SELECT DISTINCT e.id, e.name, e.status, e.start_time, e.end_time, e.enterprise_id,
                COUNT(DISTINCT gt.id) as task_count
         FROM exams e
         JOIN grading_tasks gt ON e.id = gt.exam_id
         WHERE gt.grading_account_id = ?
         GROUP BY e.id
         ORDER BY e.created_at DESC`,
        [graderId]
      );
      projects = exams;
    }

    res.json({ success: true, data: projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取当前子阅卷账号的任务列表
router.get('/grading-tasks/my-tasks', requireRole('grader'), async (req, res) => {
  try {
    // 检查表是否存在
    const tables = await checkTablesExist();
    if (!tables.tasks) {
      return res.status(500).json({
        success: false,
        message: '数据库表不存在，请先运行迁移脚本'
      });
    }

    // 从token中获取grader账号信息
    const graderId = req.user.graderId || req.user.id;
    const enterpriseId = req.user.enterpriseId; // 企业端子账号有值，管理端为null

    let query = `SELECT t.*, e.name as exam_name, e.start_time, e.end_time, e.status as exam_status, e.enterprise_id
       FROM grading_tasks t
       JOIN exams e ON t.exam_id = e.id
       WHERE t.grading_account_id = ?`;
    const params = [graderId];

    // 企业端子账号：只能看到自己企业的考试任务
    if (enterpriseId) {
      query += ` AND e.enterprise_id = ?`;
      params.push(enterpriseId);
    }
    // 管理端子账号：只能看到通过grading_tasks分配的任务（无需额外过滤）

    query += ` ORDER BY t.created_at DESC`;

    const [tasks] = await pool.execute(query, params);

    // 为每个任务附加分配题数、已阅卷、待阅卷、进度，便于子账号阅卷系统展示
    await attachTaskProgressStats(tasks);

    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Get my tasks error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取任务详情（包含进度统计、子账号信息、小题进度等）
router.get('/grading-tasks/:id/details', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    // 检查表是否存在
    const tables = await checkTablesExist();
    if (!tables.tasks || !tables.accounts || !tables.records) {
      return res.status(500).json({
        success: false,
        message: '数据库表不存在，请先运行迁移脚本'
      });
    }

    const taskId = parseInt(req.params.id);

    // 获取任务基本信息
    const [tasks] = await pool.execute(
      `SELECT t.*, e.enterprise_id, e.name as exam_name, e.paper_id,
              CASE WHEN ga.id IS NULL THEN CONCAT('missing#', t.grading_account_id) ELSE ga.username END AS username,
              CASE WHEN ga.id IS NULL THEN '账号已删除/无效' ELSE COALESCE(ga.real_name, ga.username) END AS real_name,
              ga.email
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

    // 权限检查
    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      if (!enterprise || task.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    } else if (req.user.role === 'grader') {
      const graderId = req.user.graderId || req.user.id;
      const enterpriseId = req.user.enterpriseId;
      
      // 检查任务是否分配给该账号
      if (task.grading_account_id !== graderId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      
      // 企业端子账号：额外检查考试是否属于该企业
      if (enterpriseId && task.enterprise_id !== enterpriseId) {
        return res.status(403).json({ success: false, message: '无权限访问该考试' });
      }
    }

    // 解析任务配置
    const taskConfig = typeof task.task_config === 'string' 
      ? JSON.parse(task.task_config) 
      : task.task_config;

    // 获取已交卷的会话
    const [sessions] = await pool.execute(
      `SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'submitted'`,
      [task.exam_id]
    );

    const sessionIds = sessions.map(s => s.id);
    
    // 获取所有答案
    let allAnswers = [];
    if (sessionIds.length > 0) {
      const [answers] = await pool.execute(
        `SELECT a.*, sq.number, sq.sub_number, sq.score as max_score,
                mq.question_type, mq.id as major_question_id, sq.id as sub_question_id,
                CONCAT(IFNULL(sq.number, ''), IF(sq.sub_number IS NOT NULL AND sq.sub_number != '', CONCAT('.', sq.sub_number), '')) as question_number
         FROM exam_answers a
         LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
         LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
         WHERE a.session_id IN (${sessionIds.map(() => '?').join(',')})`,
        sessionIds
      );
      allAnswers = answers;
    }

    // 根据任务配置过滤答案
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

    const total = filteredAnswers.length;

    // 获取已阅卷记录
    const [records] = await pool.execute(
      `SELECT gr.*, a.sub_question_id, a.session_id,
              sq.number, sq.sub_number,
              CONCAT(IFNULL(sq.number, ''), IF(sq.sub_number IS NOT NULL AND sq.sub_number != '', CONCAT('.', sq.sub_number), '')) as question_number
       FROM grading_records gr
       JOIN exam_answers a ON gr.answer_id = a.id
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       WHERE gr.task_id = ?`,
      [taskId]
    );

    const graded = records.length;
    const pending = total - graded;
    const progress = total > 0 ? Math.round((graded / total) * 100) : 0;

    // 按小题统计进度
    const questionProgress = {};
    filteredAnswers.forEach(a => {
      const qId = a.sub_question_id;
      if (!qId) return;
      
      if (!questionProgress[qId]) {
        questionProgress[qId] = {
          question_id: qId,
          question_number: a.question_number || `${a.number || ''}${a.sub_number ? '.' + a.sub_number : ''}`,
          total: 0,
          graded: 0
        };
      }
      questionProgress[qId].total++;
    });

    records.forEach(r => {
      if (r.sub_question_id && questionProgress[r.sub_question_id]) {
        questionProgress[r.sub_question_id].graded++;
      }
    });

    // 计算每个小题的进度百分比
    Object.values(questionProgress).forEach(qp => {
      qp.progress = qp.total > 0 ? Math.round((qp.graded / qp.total) * 100) : 0;
    });

    // 获取该考试的所有子账号及其任务统计
    const [allTasks] = await pool.execute(
      `SELECT t.id, t.grading_account_id, t.task_type, t.task_config, t.status,
              CASE WHEN ga.id IS NULL THEN CONCAT('missing#', t.grading_account_id) ELSE ga.username END AS username,
              CASE WHEN ga.id IS NULL THEN '账号已删除/无效' ELSE COALESCE(ga.real_name, ga.username) END AS real_name,
              ga.email
       FROM grading_tasks t
       LEFT JOIN grading_accounts ga ON t.grading_account_id = ga.id
       WHERE t.exam_id = ?`,
      [task.exam_id]
    );

    const accounts = [];
    for (const taskItem of allTasks) {
      const accountId = taskItem.grading_account_id;
      
      // 计算该账号的任务统计
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

      const accountTotal = taskFilteredAnswers.length;

      // 获取该任务的已阅卷数量
      const [taskRecords] = await pool.execute(
        `SELECT COUNT(DISTINCT answer_id) as graded_count
         FROM grading_records WHERE task_id = ?`,
        [taskItem.id]
      );

      const accountGraded = parseInt(taskRecords[0]?.graded_count || 0);
      const accountPending = accountTotal - accountGraded;
      const accountProgress = accountTotal > 0 ? Math.round((accountGraded / accountTotal) * 100) : 0;

      accounts.push({
        account_id: accountId,
        username: taskItem.username,
        real_name: taskItem.real_name,
        email: taskItem.email,
        task_id: taskItem.id,
        task_status: taskItem.status,
        total: accountTotal,
        graded: accountGraded,
        pending: accountPending,
        progress: accountProgress
      });
    }

    // 获取阅卷时间分布（按小时统计）
    const [timeDistribution] = await pool.execute(
      `SELECT DATE_FORMAT(graded_at, '%Y-%m-%d %H:00:00') as hour,
              COUNT(*) as count
       FROM grading_records
       WHERE task_id = ? AND graded_at IS NOT NULL
       GROUP BY hour
       ORDER BY hour`,
      [taskId]
    );

    res.json({
      success: true,
      data: {
        task: {
          id: task.id,
          exam_id: task.exam_id,
          exam_name: task.exam_name,
          grading_account_id: task.grading_account_id,
          username: task.username,
          real_name: task.real_name,
          email: task.email,
          task_type: task.task_type,
          task_config: taskConfig,
          status: task.status,
          created_at: task.created_at,
          assigned_at: task.assigned_at,
          completed_at: task.completed_at,
          updated_at: task.updated_at
        },
        progress: {
          total,
          graded,
          pending,
          progress
        },
        accounts,
        questionProgress: Object.values(questionProgress),
        timeDistribution
      }
    });
  } catch (error) {
    console.error('Get task details error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;
