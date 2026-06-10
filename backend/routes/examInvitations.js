const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const UserModel = require('../models/userModel');
const { formatDateTimeLocal } = require('../utils/dateTimeHelper');

/**
 * 同场考试、同手机号多用户时只保留一条：优先当前登录 userId 上的报名，否则任一条
 */
function dedupeEnrollmentsByExam(rows, preferredUserId) {
  const sorted = [...(rows || [])].sort((a, b) => {
    if (a.exam_id !== b.exam_id) return a.exam_id - b.exam_id;
    const ap = a.en_user_id === preferredUserId;
    const bp = b.en_user_id === preferredUserId;
    if (ap && !bp) return -1;
    if (bp && !ap) return 1;
    return (b.enrollment_id || 0) - (a.enrollment_id || 0);
  });
  const seen = new Set();
  const out = [];
  for (const r of sorted) {
    if (seen.has(r.exam_id)) continue;
    seen.add(r.exam_id);
    out.push(r);
  }
  return out;
}

// 获取当前用户的专业测评邀请列表（求职者/考生端个人中心「专业测评」使用）
// 数据来源：考生报名表 + 考试表。按「当前账号 + 同手机号下其它 qms_users 行」合并报名，避免主号登录、报名在 cand_ 子号上时 data 恒为空
router.get('/mine', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const idList = await UserModel.getAllIdsWithSamePhoneAsUser(userId);
    const placeholders = idList.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT en.id AS enrollment_id, en.exam_id, en.user_id AS en_user_id, e.name AS exam_name, e.start_time, e.end_time, e.status AS exam_status,
              s.status AS session_status
       FROM exam_enrollments en
       JOIN exams e ON e.id = en.exam_id
       LEFT JOIN exam_sessions s ON s.exam_id = en.exam_id AND s.user_id = en.user_id
       WHERE en.user_id IN (${placeholders}) AND e.status IN ('draft', 'published', 'ongoing', 'ended')
       ORDER BY e.start_time DESC, en.id DESC`,
      idList
    );
    const merged = dedupeEnrollmentsByExam(rows, userId);
    const list = merged.map((r) => {
      const st = r.session_status != null ? String(r.session_status) : '';
      const sessionSubmitted = st === 'submitted' || st === 'force_submitted';
      return {
        id: r.enrollment_id,
        examId: r.exam_id,
        examName: r.exam_name,
        startTime: formatDateTimeLocal(r.start_time),
        endTime: formatDateTimeLocal(r.end_time),
        examStatus: r.exam_status,
        sessionStatus: st || null,
        sessionSubmitted
      };
    });
    res.json({ success: true, data: list });
  } catch (e) {
    console.error('examInvitations mine error:', e.message);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

// 按手机号查询专业测评邀请（供求职者端 3001 后端代理调用，需 API Key）
const EXAM_INVITATIONS_API_KEY = process.env.EXAM_INVITATIONS_API_KEY || 'shengju-exam-invitations-key';
router.get('/by-identity', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (apiKey !== EXAM_INVITATIONS_API_KEY) {
      return res.status(401).json({ success: false, message: '未授权' });
    }
    const phone = (req.query.phone || '').toString().replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      return res.json({ success: true, data: [] });
    }
    const user = await UserModel.findByPhone(phone);
    if (!user) {
      return res.json({ success: true, data: [] });
    }
    const idList = await UserModel.getAllIdsWithSamePhoneAsUser(user.id);
    const placeholders = idList.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT en.id AS enrollment_id, en.exam_id, en.user_id AS en_user_id, e.name AS exam_name, e.start_time, e.end_time, e.status AS exam_status,
              s.status AS session_status
       FROM exam_enrollments en
       JOIN exams e ON e.id = en.exam_id
       LEFT JOIN exam_sessions s ON s.exam_id = en.exam_id AND s.user_id = en.user_id
       WHERE en.user_id IN (${placeholders}) AND e.status IN ('draft', 'published', 'ongoing', 'ended')
       ORDER BY e.start_time DESC, en.id DESC`,
      idList
    );
    const merged = dedupeEnrollmentsByExam(rows, user.id);
    const list = merged.map((r) => {
      const st = r.session_status != null ? String(r.session_status) : '';
      const sessionSubmitted = st === 'submitted' || st === 'force_submitted';
      return {
        id: r.enrollment_id,
        examId: r.exam_id,
        examName: r.exam_name,
        startTime: formatDateTimeLocal(r.start_time),
        endTime: formatDateTimeLocal(r.end_time),
        examStatus: r.exam_status,
        sessionStatus: st || null,
        sessionSubmitted
      };
    });
    res.json({ success: true, data: list });
  } catch (e) {
    console.error('examInvitations by-identity error:', e.message);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

module.exports = router;
