/**
 * 阅卷任务列表（按考试）——供 routes/exams.js 与 routes/gradingTasks.js 共用，
 * 避免 exams 顶层 require gradingTasks 时出现循环依赖或未完全初始化导致 listGradingTasksForExam 缺失。
 */
const { pool } = require('../config/database');
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');
const { isObjectiveQuestionType } = require('./gradingService');

async function checkTablesExist() {
  try {
    const [tables] = await pool.execute("SHOW TABLES LIKE 'grading_%'");
    const tableNames = tables.map((t) => Object.values(t)[0]);
    return {
      accounts: tableNames.includes('grading_accounts'),
      tasks: tableNames.includes('grading_tasks'),
      records: tableNames.includes('grading_records')
    };
  } catch (e) {
    return { accounts: false, tasks: false, records: false };
  }
}

/**
 * @param {Array} tasks
 */
async function attachTaskProgressStats(tasks) {
  if (!tasks || tasks.length === 0) return;
  const byExam = {};
  for (const t of tasks) {
    const eid = t.exam_id;
    if (!byExam[eid]) byExam[eid] = [];
    byExam[eid].push(t);
  }
  for (const examId of Object.keys(byExam)) {
    const examTasks = byExam[examId];
    const taskIds = examTasks.map((t) => t.id);

    const [sessions] = await pool.execute(
      `SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'submitted'`,
      [examId]
    );
    const sessionIds = sessions.map((s) => s.id);

    let allAnswers = [];
    if (sessionIds.length > 0) {
      const [answers] = await pool.execute(
        `SELECT a.id, a.sub_question_id, mq.question_type, mq.id as major_question_id
         FROM exam_answers a
         LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
         LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
         WHERE a.session_id IN (${sessionIds.map(() => '?').join(',')})`,
        sessionIds
      );
      allAnswers = answers;
    }

    const [recordCounts] = await pool.execute(
      `SELECT task_id, COUNT(DISTINCT answer_id) as graded_count
       FROM grading_records
       WHERE task_id IN (${taskIds.map(() => '?').join(',')})
       GROUP BY task_id`,
      taskIds
    );
    const gradedByTaskId = {};
    recordCounts.forEach((r) => {
      gradedByTaskId[r.task_id] = parseInt(r.graded_count || 0, 10);
    });

    for (const task of examTasks) {
      const taskConfig =
        typeof task.task_config === 'string' ? JSON.parse(task.task_config) : task.task_config;

      let filtered = allAnswers;
      if (task.task_type === 'content') {
        if (taskConfig.sub_question_ids && Array.isArray(taskConfig.sub_question_ids)) {
          filtered = allAnswers.filter((a) => taskConfig.sub_question_ids.includes(a.sub_question_id));
        } else if (taskConfig.major_question_ids && Array.isArray(taskConfig.major_question_ids)) {
          filtered = allAnswers.filter((a) => taskConfig.major_question_ids.includes(a.major_question_id));
        }
      } else if (
        task.task_type === 'question_type' &&
        taskConfig.question_types &&
        Array.isArray(taskConfig.question_types)
      ) {
        filtered = allAnswers.filter((a) => {
          const qType = a.question_type || '';
          return taskConfig.question_types.some(
            (type) => qType.includes(type) || type.includes(qType)
          );
        });
      }
      filtered = filtered.filter((a) => !isObjectiveQuestionType(a.question_type));
      const total = filtered.length;
      const graded = gradedByTaskId[task.id] || 0;
      const pending = total - graded;
      const progress = total > 0 ? Math.round((graded / total) * 100) : 0;
      task.total = total;
      task.graded = graded;
      task.pending = pending;
      task.progress = progress;
    }
  }
}

async function listGradingTasksForExam(req, res) {
  try {
    const tables = await checkTablesExist();
    if (!tables.tasks || !tables.accounts) {
      return res.json({ success: true, data: [] });
    }

    const examId = parseInt(req.params.examId, 10);
    const exam = await ExamModel.findById(examId);

    if (!exam) {
      return res.status(404).json({ success: false, message: '考试不存在' });
    }

    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    if (req.user.role === 'grader') {
      const enterpriseId = req.user.enterpriseId;
      if (enterpriseId && exam.enterprise_id !== enterpriseId) {
        return res.status(403).json({ success: false, message: '无权限访问该考试' });
      }
    }

    let query = `SELECT t.*,
              CASE WHEN ga.id IS NULL THEN CONCAT('missing#', t.grading_account_id) ELSE ga.username END AS username,
              CASE WHEN ga.id IS NULL THEN '账号已删除/无效' ELSE COALESCE(ga.real_name, ga.username) END AS real_name,
              ga.email
       FROM grading_tasks t
       LEFT JOIN grading_accounts ga ON t.grading_account_id = ga.id
       WHERE t.exam_id = ?`;
    const params = [examId];

    if (req.user.role === 'grader') {
      const graderId = req.user.graderId || req.user.id;
      query += ` AND t.grading_account_id = ?`;
      params.push(graderId);
    }

    query += ` ORDER BY t.created_at DESC`;

    const [tasks] = await pool.execute(query, params);

    await attachTaskProgressStats(tasks);

    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Get grading tasks error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

module.exports = {
  checkTablesExist,
  attachTaskProgressStats,
  listGradingTasksForExam
};
