const express = require('express');
const router = express.Router();
const ExamAnswerModel = require('../models/examAnswerModel');
const ExamSessionModel = require('../models/examSessionModel');
const { authenticate, requireRole } = require('../middleware/auth');
const { sessionOwnedByUser } = require('../utils/sessionUserMatch');

router.use(authenticate);

// 保存答案（考生）；slotSubmitted 为 true 时表示考生点击了「提交」该小题，用于掉线重进后恢复已提交状态
router.post('/', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const { sessionId, subQuestionId, questionNumber, answerText, answerData, slotSubmitted } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, message: '缺少 sessionId' });
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '考试会话不存在' });
    if (req.isGuest) { if (req.guestSessionId !== parseInt(sessionId, 10)) return res.status(403).json({ success: false, message: '无权限' }); }
    else if (!sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限操作他人答卷' });
    if (session.status !== 'ongoing') return res.status(400).json({ success: false, message: '考试已结束或未开始，无法保存答案' });
    const id = await ExamAnswerModel.upsert(sessionId, subQuestionId, questionNumber, answerText, answerData, slotSubmitted === true);
    res.json({ success: true, data: { id } });
  } catch (e) {
    console.error('[exam-answers] 保存失败:', e.message);
    res.status(500).json({ success: false, message: e.message || '保存失败，请稍后重试' });
  }
});

// 批量保存答案（阶段一优化：轻量 session 校验，去三表 JOIN）
router.post('/batch', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, message: '缺少 sessionId' });
    if (!Array.isArray(answers)) return res.status(400).json({ success: false, message: 'answers 必须为数组' });

    // 轻量校验：只查 session 身份+状态，不 JOIN 用户表和考试表
    const { pool } = require('../config/database');
    const [[sess]] = await pool.execute(
      `SELECT id, user_id, status FROM exam_sessions WHERE id = ?`,
      [sessionId]
    );
    if (!sess) return res.status(404).json({ success: false, message: '考试会话不存在' });
    if (req.isGuest) {
      if (req.guestSessionId !== parseInt(sessionId, 10)) return res.status(403).json({ success: false, message: '无权限' });
    } else if (Number(sess.user_id) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权限操作他人答卷' });
    }
    if (sess.status !== 'ongoing' && sess.status !== 'pending') {
      return res.status(400).json({ success: false, message: '考试已结束或未开始，无法保存答案' });
    }

    // 批量 UPSERT：单条 multi-row SQL（阶段二优化）
    const subIdRaw = (a) => (a.subQuestionId !== undefined && a.subQuestionId !== null && a.subQuestionId !== '') ? a.subQuestionId : null;
    const validAnswers = answers.filter(a => {
      const qn = a.questionNumber != null ? String(a.questionNumber).trim() : '';
      return qn !== '' || subIdRaw(a) !== null;
    });
    if (validAnswers.length > 0) {
      const rows = validAnswers.map(a => [
        sessionId,
        subIdRaw(a),
        a.questionNumber || null,
        a.answerText != null ? String(a.answerText) : null,
        a.answerData ? JSON.stringify(a.answerData) : null
      ]);
      const placeholders = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
      await pool.execute(
        `INSERT INTO exam_answers (session_id, sub_question_id, question_number, answer_text, answer_data)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           answer_text = VALUES(answer_text),
           answer_data = VALUES(answer_data),
           updated_at = CURRENT_TIMESTAMP`,
        rows.flat()
      );
    }

    res.json({ success: true, message: '保存成功', count: validAnswers.length });
  } catch (e) {
    console.error('[exam-answers batch] 保存失败:', e.message);
    res.status(500).json({ success: false, message: e.message || '保存失败，请稍后重试' });
  }
});

// 获取我的答案（支持免登录 guest）
router.get('/session/:sessionId', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (req.isGuest) { if (req.guestSessionId !== parseInt(req.params.sessionId, 10)) return res.status(403).json({ success: false, message: '无权限' }); }
    else if (!sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const list = await ExamAnswerModel.getBySession(req.params.sessionId);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 阅卷员：更新答案得分
router.put('/:id/score', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const { pool } = require('../config/database');
    const ExamModel = require('../models/examModel');
    const EnterpriseModel = require('../models/enterpriseModel');
    const [rows] = await pool.execute(
      `SELECT a.*, s.exam_id FROM exam_answers a JOIN exam_sessions s ON a.session_id = s.id WHERE a.id = ?`,
      [req.params.id]
    );
    const ans = rows[0];
    if (!ans) return res.status(404).json({ success: false, message: '答案不存在' });
    const exam = await ExamModel.findById(ans.exam_id);
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const { score } = req.body;
    const s = parseFloat(score);
    if (isNaN(s) || s < 0) return res.status(400).json({ success: false, message: '无效的分数' });
    await pool.execute('UPDATE exam_answers SET score = ? WHERE id = ?', [s, req.params.id]);
    const [sumRows] = await pool.execute(
      'SELECT COALESCE(SUM(score), 0) as total FROM exam_answers WHERE session_id = ?',
      [ans.session_id]
    );
    await pool.execute('UPDATE exam_sessions SET total_score = ? WHERE id = ?', [sumRows[0].total, ans.session_id]);
    res.json({ success: true, message: '保存成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
