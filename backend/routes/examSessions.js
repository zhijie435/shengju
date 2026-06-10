const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const ExamSessionModel = require('../models/examSessionModel');
const ExamModel = require('../models/examModel');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const ExamPaperModel = require('../models/examPaperModel');
const EnterpriseModel = require('../models/enterpriseModel');
const ExamSummaryService = require('../services/examSummaryService');
const UserModel = require('../models/userModel');
const faceIdCompare = require('../services/faceIdCompare');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { formatDateTimeLocal } = require('../utils/dateTimeHelper');
const { sessionOwnedByUser } = require('../utils/sessionUserMatch');
const interviewRoute = require('./interview');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

async function interviewExamUsesDrawNumbers(examId) {
  try {
    const [cnt] = await pool.execute(
      'SELECT COUNT(*) AS n FROM exam_enrollments WHERE exam_id = ? AND draw_number IS NOT NULL',
      [examId]
    );
    return Number(cnt[0]?.n || 0) > 0;
  } catch (_) {
    return false;
  }
}

/** 面试入场：未抽签不可进；顺序入场时还需轮到本人签号；提前录制候考/闸门 */
async function buildInterviewCanEnterData(session) {
  const exam = await ExamModel.findById(session.exam_id);
  if (!exam) return { error: '考试不存在' };
  const interviewConfig = (exam.answer_system_config || {}).interviewConfig || {};
  const flowMode =
    interviewConfig.interviewFlowMode === 'prerecord' || interviewConfig.interviewFlowMode === 'online'
      ? interviewConfig.interviewFlowMode
      : 'legacy';
  const sequentialEntry =
    flowMode === 'online' ? true : !!interviewConfig.sequentialEntry;
  const isInterview = (exam.exam_type || 'written') === 'interview';

  const enrollment = await ExamEnrollmentModel.findByExamForLoginUser(session.exam_id, session.user_id);
  const yourDrawNumber =
    enrollment && enrollment.draw_number != null && enrollment.draw_number !== ''
      ? Number(enrollment.draw_number)
      : null;

  if (typeof interviewRoute.tryPrerecordScheduleAutoOpen === 'function') {
    try {
      await interviewRoute.tryPrerecordScheduleAutoOpen(exam);
    } catch (_) {}
  }

  if (isInterview && yourDrawNumber == null) {
    const examUsesDraw = await interviewExamUsesDrawNumbers(session.exam_id);
    const reason = examUsesDraw
      ? '您尚未分配抽签号，请联系考务人员完成抽签后再进入考场'
      : '本场面试尚未完成抽签，请等候考务通知后再进入考场';
    return {
      canEnter: false,
      reason,
      currentDrawNumber: null,
      yourDrawNumber: null,
      missingDrawNumber: true,
      sequentialEntry,
      interviewFlowMode: flowMode,
      interviewPhase: 'no_draw'
    };
  }

  if (!isInterview) {
    return {
      canEnter: true,
      reason: null,
      currentDrawNumber: null,
      yourDrawNumber,
      missingDrawNumber: false,
      sequentialEntry: false,
      interviewFlowMode: flowMode,
      interviewPhase: 'exam_ready'
    };
  }

  /** @type {{ gateOpenAt: any, confirmPending: number }} */
  let prerecordGate = { gateOpenAt: null, confirmPending: 0 };
  if (flowMode === 'prerecord') {
    try {
      const [gr] = await pool.execute(
        `SELECT interview_prerecord_gate_open_at AS g, interview_prerecord_confirm_pending AS p FROM exams WHERE id = ?`,
        [session.exam_id]
      );
      prerecordGate = {
        gateOpenAt: gr[0] && gr[0].g ? gr[0].g : null,
        confirmPending: gr[0] && gr[0].p != null ? Number(gr[0].p) : 0
      };
    } catch (_) {
      prerecordGate = { gateOpenAt: null, confirmPending: 0 };
    }
  }

  if (flowMode === 'prerecord') {
    const checkedIn = session.check_in_at != null && String(session.check_in_at).trim() !== '';
    if (!checkedIn) {
      return {
        canEnter: false,
        reason: '请先完成签到后再进入候考室',
        currentDrawNumber: null,
        yourDrawNumber,
        missingDrawNumber: false,
        sequentialEntry: false,
        interviewFlowMode: flowMode,
        interviewPhase: 'need_check_in',
        prerecordGateOpen: false,
        prerecordConfirmPending: !!prerecordGate.confirmPending
      };
    }
    if (!prerecordGate.gateOpenAt) {
      return {
        canEnter: false,
        reason: prerecordGate.confirmPending
          ? '已到计划开考时间，请等待计时计分人员点击「开始答题」'
          : '请先在统一候考室等候，计时计分人员宣布开始答题后方可查看试题',
        currentDrawNumber: null,
        yourDrawNumber,
        missingDrawNumber: false,
        sequentialEntry: false,
        interviewFlowMode: flowMode,
        interviewPhase: 'waiting_room',
        prerecordGateOpen: false,
        prerecordConfirmPending: !!prerecordGate.confirmPending
      };
    }
    return {
      canEnter: true,
      reason: null,
      currentDrawNumber: null,
      yourDrawNumber,
      missingDrawNumber: false,
      sequentialEntry: false,
      interviewFlowMode: flowMode,
      interviewPhase: 'exam_ready',
      prerecordGateOpen: true
    };
  }

  if (!sequentialEntry) {
    return {
      canEnter: true,
      reason: null,
      currentDrawNumber: null,
      yourDrawNumber,
      missingDrawNumber: false,
      sequentialEntry,
      interviewFlowMode: flowMode,
      interviewPhase: 'exam_ready'
    };
  }

  let currentDrawNumber = null;
  try {
    const [r] = await pool.execute('SELECT interview_current_draw_number FROM exams WHERE id = ?', [session.exam_id]);
    currentDrawNumber =
      r[0] && r[0].interview_current_draw_number != null ? Number(r[0].interview_current_draw_number) : null;
    if (currentDrawNumber == null) {
      const [minRow] = await pool.execute(
        'SELECT MIN(en.draw_number) AS mn FROM exam_enrollments en WHERE en.exam_id = ? AND en.draw_number IS NOT NULL',
        [session.exam_id]
      );
      const firstDraw = minRow[0] && minRow[0].mn != null ? Number(minRow[0].mn) : null;
      if (firstDraw != null) {
        await pool.execute('UPDATE exams SET interview_current_draw_number = ? WHERE id = ?', [
          firstDraw,
          session.exam_id
        ]);
        currentDrawNumber = firstDraw;
      }
    }
  } catch (_) {}

  const canEnter =
    currentDrawNumber != null && yourDrawNumber != null && currentDrawNumber === yourDrawNumber;
  const reason = canEnter
    ? null
    : yourDrawNumber == null
      ? '请先完成签到与抽签'
      : `当前请${currentDrawNumber != null ? currentDrawNumber + '号' : ''}考生进入考场，您是${yourDrawNumber}号，请候考`;
  return {
    canEnter,
    reason,
    currentDrawNumber,
    yourDrawNumber,
    missingDrawNumber: false,
    sequentialEntry,
    interviewFlowMode: flowMode,
    interviewPhase: canEnter ? 'exam_ready' : 'queued'
  };
}

function allowGuestOrRole(...roles) {
  return (req, res, next) => {
    if (req.isGuest && req.guestSessionId === parseInt(req.params.id, 10)) return next();
    return requireRole(...roles)(req, res, next);
  };
}

// 管理员/企业代签（须在 /:id 等动态路径之前注册，避免被误匹配）
router.post('/admin-check-in', authenticate, requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const { examId, userId } = req.body;
    if (!examId || !userId) return res.status(400).json({ success: false, message: '缺少 examId 或 userId' });
    const exam = await ExamModel.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      /** 人才网 token 已在 authenticate 中写入 req.enterpriseId，勿仅依赖 enterprises.user_id=users.id（常对不上） */
      let allowedEntId = null;
      if (req.enterpriseId != null && String(req.enterpriseId).trim() !== '') {
        const n = Number(req.enterpriseId);
        if (Number.isFinite(n) && n > 0) allowedEntId = n;
      }
      if (allowedEntId == null) {
        const ent = await EnterpriseModel.findByUserId(req.user.id);
        if (ent) allowedEntId = ent.id;
      }
      if (!allowedEntId || Number(exam.enterprise_id) !== Number(allowedEntId)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }
    const enrollment = await ExamEnrollmentModel.findByExamAndUser(examId, userId);
    if (!enrollment) return res.status(404).json({ success: false, message: '该用户未报名本场考试' });
    const session = await ExamSessionModel.findOrCreate(examId, userId, enrollment.id);
    await ExamSessionModel.checkIn(session.id, { faceVerified: false });
    res.json({ success: true, message: '已标记签到' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 通过邀请码或单场「公共考场码」获取考试信息（免登录，供考生使用；公共考场码不含试卷，需登录后入场）
router.get('/invite/:inviteCode', async (req, res) => {
  try {
    const raw = String(req.params.inviteCode || '').trim();
    const enrollment = await ExamEnrollmentModel.findByInviteCode(raw);
    if (enrollment) {
      const exam = await ExamModel.findById(enrollment.exam_id);
      const paper = await ExamPaperModel.getExamPaperComplete(enrollment.paper_id);
      return res.json({
        success: true,
        data: {
          entryMode: 'personal_invite',
          enrollmentId: enrollment.id,
          examId: enrollment.exam_id,
          examName: enrollment.exam_name,
          exam_name: enrollment.exam_name,
          startTime: formatDateTimeLocal(enrollment.start_time),
          start_time: formatDateTimeLocal(enrollment.start_time),
          endTime: formatDateTimeLocal(enrollment.end_time),
          end_time: formatDateTimeLocal(enrollment.end_time),
          durationMinutes: enrollment.duration_minutes,
          duration_minutes: enrollment.duration_minutes,
          paperId: enrollment.paper_id,
          inviteCode: enrollment.invite_code,
          paper
        }
      });
    }
    const exam = await ExamModel.findByPublicRoomCode(raw);
    if (!exam) {
      return res.status(404).json({ success: false, message: '邀请码或考场码无效，或考试未发布' });
    }
    const st = formatDateTimeLocal(exam.start_time);
    const et = formatDateTimeLocal(exam.end_time);
    return res.json({
      success: true,
      data: {
        entryMode: 'public_room',
        examId: exam.id,
        examName: exam.name,
        exam_name: exam.name,
        startTime: st,
        start_time: st,
        endTime: et,
        end_time: et,
        durationMinutes: exam.duration_minutes,
        duration_minutes: exam.duration_minutes,
        publicRoomCode: raw
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 免登录进入考试：凭邀请码创建/获取会话，返回 session + exam + paper + guestToken，考生端用 guestToken 调用 start/submit
router.get('/enter-by-invite/:inviteCode', async (req, res) => {
  try {
    const enrollment = await ExamEnrollmentModel.findByInviteCode(req.params.inviteCode);
    if (!enrollment) return res.status(404).json({ success: false, message: '邀请码无效或已过期' });
    const session = await ExamSessionModel.findOrCreate(enrollment.exam_id, enrollment.user_id, enrollment.id);
    const exam = await ExamModel.findById(enrollment.exam_id);
    const paper = await ExamPaperModel.getExamPaperComplete(enrollment.paper_id);
    const guestToken = jwt.sign(
      { type: 'guest', sessionId: session.id, inviteCode: req.params.inviteCode },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      success: true,
      data: {
        session,
        exam: {
          id: exam.id,
          name: exam.name,
          paper_id: exam.paper_id,
          duration_minutes: exam.duration_minutes,
          start_time: exam.start_time,
          end_time: exam.end_time,
          answer_system_config: exam.answer_system_config || {},
          monitor_config: exam.monitor_config || {}
        },
        paper,
        guestToken
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.use(authenticate);

// 考生：凭单场公共考场码获取/创建会话（需登录且在名单内；同企业多场考试各场独立码）
router.get('/by-public-room/:code', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const exam = await ExamModel.findByPublicRoomCode(code);
    if (!exam) {
      return res.status(404).json({ success: false, message: '考场码无效或考试未开放' });
    }
    const enrollment = await ExamEnrollmentModel.findByExamForLoginUser(exam.id, req.user.id);
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: '未找到您在本场考试的报名记录，请使用与考生名单中一致的手机号登录；多场考试请分别确认已加入对应场次名单'
      });
    }
    const session = await ExamSessionModel.findOrCreate(exam.id, req.user.id, enrollment.id);
    const paper = await ExamPaperModel.getExamPaperComplete(exam.paper_id);
    res.json({
      success: true,
      data: {
        session,
        exam: {
          id: exam.id,
          name: exam.name,
          paper_id: exam.paper_id,
          durationMinutes: exam.duration_minutes,
          startTime: exam.start_time,
          endTime: exam.end_time,
          answer_system_config: exam.answer_system_config || {},
          monitor_config: exam.monitor_config || {}
        },
        paper
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：通过邀请码获取/创建会话（需登录且为被邀请用户）
router.get('/by-invite/:inviteCode', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const enrollment = await ExamEnrollmentModel.findByInviteCode(req.params.inviteCode);
    if (!enrollment) return res.status(404).json({ success: false, message: '邀请码无效或已过期' });
    const samePhoneIds = await UserModel.getAllIdsWithSamePhoneAsUser(req.user.id);
    const eUid = Number(enrollment.user_id);
    if (!samePhoneIds.some((x) => Number(x) === eUid)) {
      return res.status(403).json({ success: false, message: '该邀请码不属于当前登录用户' });
    }
    const session = await ExamSessionModel.findOrCreate(enrollment.exam_id, req.user.id, enrollment.id);
    const exam = await ExamModel.findById(enrollment.exam_id);
    const ExamPaperModel = require('../models/examPaperModel');
    const paper = await ExamPaperModel.getExamPaperComplete(enrollment.paper_id);
    res.json({
      success: true,
      data: {
        session,
        exam: {
          id: exam.id,
          name: exam.name,
          paper_id: exam.paper_id,
          durationMinutes: exam.duration_minutes,
          startTime: exam.start_time,
          endTime: exam.end_time,
          answer_system_config: exam.answer_system_config || {},
          monitor_config: exam.monitor_config || {}
        },
        paper
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：获取我的考试会话（面试时附带抽签号 draw_number 供前端显示「你好，X 号考生」）
router.get('/my/:examId', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const enrollment = await ExamEnrollmentModel.findByExamForLoginUser(req.params.examId, req.user.id);
    if (!enrollment) return res.status(403).json({ success: false, message: '您未被邀请参加该考试' });
    const session = await ExamSessionModel.findOrCreate(req.params.examId, req.user.id, enrollment.id);
    const data = session && typeof session === 'object' ? { ...session } : session;
    if (data && enrollment.draw_number != null) data.draw_number = enrollment.draw_number;
    res.json({ success: true, data: data || session });
  } catch (e) {
    console.error('[exam-sessions/my]', req.params.examId, 'user', req.user?.id, e.code || '', e.message || e);
    res.status(500).json({ success: false, message: e.message || '获取会话失败' });
  }
});

// 企业/总管理/企业审核子账号：获取某考试的所有会话
router.get('/exam/:examId', requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role !== 'admin') {
      let entId = req.enterpriseId != null && String(req.enterpriseId).trim() !== '' ? Number(req.enterpriseId) : null;
      if (!Number.isFinite(entId) || entId <= 0) {
        const ent = await EnterpriseModel.findByUserId(req.user.id);
        entId = ent?.id != null ? Number(ent.id) : null;
      }
      if (!Number.isFinite(entId) || entId <= 0 || Number(exam.enterprise_id) !== entId) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }
    const list = await ExamSessionModel.listByExam(req.params.examId);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：检查是否可进入考场（面试未抽签不可进；顺序入场需轮到本人签号）
router.get('/:id/can-enter-room', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const data = await buildInterviewCanEnterData(session);
    if (data.error) return res.status(404).json({ success: false, message: data.error });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '获取失败' });
  }
});

// 考生：开始考试（支持免登录 guestToken）
router.post('/:id/start', allowGuestOrRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!req.isGuest && !sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    if (session.status !== 'pending') {
      return res.json({ success: true, data: session, message: '已在考试中或已交卷' });
    }
    const enterData = await buildInterviewCanEnterData(session);
    if (enterData.error) return res.status(404).json({ success: false, message: enterData.error });
    if (!enterData.canEnter) {
      return res.status(403).json({ success: false, message: enterData.reason || '暂不可开始考试' });
    }
    await ExamSessionModel.start(req.params.id);
    const [rows] = await pool.execute('SELECT * FROM exam_sessions WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：进入考场（顺序入场时调用，用于考官端「开始答题」仅在有考生进入后可用）
router.post('/:id/enter-room', allowGuestOrRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!req.isGuest && !sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const enterData = await buildInterviewCanEnterData(session);
    if (enterData.error) return res.status(404).json({ success: false, message: enterData.error });
    if (!enterData.canEnter) {
      return res.status(403).json({ success: false, message: enterData.reason || '暂不可进入考场' });
    }
    await ExamSessionModel.enterRoom(req.params.id);
    res.json({ success: true, message: '已记录进入考场' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：提前录制模式 — 进入统一候考室（监考端可见）
router.post('/:id/interview-waiting-room', allowGuestOrRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!req.isGuest && !sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const exam = await ExamModel.findById(session.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    const ic = (exam.answer_system_config || {}).interviewConfig || {};
    if (ic.interviewFlowMode !== 'prerecord') {
      return res.status(400).json({ success: false, message: '本场未启用提前录制模式' });
    }
    const enrollment = await ExamEnrollmentModel.findByExamForLoginUser(session.exam_id, session.user_id);
    const dn = enrollment && enrollment.draw_number != null ? Number(enrollment.draw_number) : null;
    if (dn == null || Number.isNaN(dn)) {
      return res.status(400).json({ success: false, message: '请先完成抽签后再进入候考室' });
    }
    const ok = await ExamSessionModel.enterInterviewWaitingRoom(req.params.id);
    if (!ok) return res.status(503).json({ success: false, message: '数据库未迁移 interview_waiting_room_at 列' });
    res.json({ success: true, message: '已进入候考室' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：提前录制 — 上报正面录像上传失败等（侧摄失败用手机 Token 走 exam-monitor 路由）
router.post('/:id/prerecord-video-status', allowGuestOrRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim().slice(0, 32);
    if (!status) return res.status(400).json({ success: false, message: 'status 必填' });
    const allowed = new Set(['front_fail']);
    if (!allowed.has(status)) {
      return res.status(400).json({ success: false, message: 'status 仅支持 front_fail' });
    }
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!req.isGuest && !sessionOwnedByUser(session, req.user.id)) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const exam = await ExamModel.findById(session.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    const ic = (exam.answer_system_config || {}).interviewConfig || {};
    if (ic.interviewFlowMode !== 'prerecord') {
      return res.status(400).json({ success: false, message: '仅提前录制模式可上报录像状态' });
    }
    const ok = await ExamSessionModel.setPrerecordVideoStatus(req.params.id, status);
    if (!ok) {
      return res.status(503).json({ success: false, message: '数据库未迁移 interview_prerecord_video_status' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：交卷（支持免登录 guestToken；可携带统一提交时的客观题答案，写入 exam_objective_answers 表）
router.post('/:id/submit', allowGuestOrRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!req.isGuest && !sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });

    const st = String(session.status || '');
    if (st === 'submitted' || st === 'force_submitted') {
      return res.json({ success: true, message: '已交卷', data: { alreadySubmitted: true } });
    }

    const objectiveAnswers = req.body.objectiveAnswers;
    if (Array.isArray(objectiveAnswers) && objectiveAnswers.length > 0) {
      try {
        await pool.execute('DELETE FROM exam_objective_answers WHERE session_id = ?', [req.params.id]);
        // P0 优化：逐条 INSERT → 批量 INSERT（N 次 DB 往返 → 1 次）
        const validAnswers = objectiveAnswers.filter(a => {
          const qn = a.questionNumber != null ? String(a.questionNumber).trim() : '';
          return qn !== '';
        });
        if (validAnswers.length > 0) {
          const rows = validAnswers.map(a => [
            req.params.id,
            String(a.questionNumber).trim(),
            a.answerText != null ? String(a.answerText) : null,
            a.answerData ? JSON.stringify(a.answerData) : null
          ]);
          const placeholders = rows.map(() => '(?, ?, ?, ?)').join(', ');
          await pool.execute(
            `INSERT INTO exam_objective_answers (session_id, question_number, answer_text, answer_data)
             VALUES ${placeholders}`,
            rows.flat()
          );
        }
      } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
          return res.status(503).json({
            success: false,
            message:
              '数据库缺少表 exam_objective_answers，客观题答案无法落库。请管理员在库中执行 backend/database/migrate_exam_objective_answers.sql（或 node scripts/run_exam_objective_answers_migration.js）后再交卷。'
          });
        }
        throw err;
      }
    }

    const subjectiveAnswers = req.body.subjectiveAnswers;
    if (Array.isArray(subjectiveAnswers) && subjectiveAnswers.length > 0) {
      try {
        await pool.execute('DELETE FROM exam_subjective_answers WHERE session_id = ?', [req.params.id]);
        // P0 优化：逐条 INSERT → 批量 INSERT
        const validAnswers = subjectiveAnswers.filter(a => {
          const qn = a.questionNumber != null ? String(a.questionNumber).trim() : '';
          return qn !== '';
        });
        if (validAnswers.length > 0) {
          const rows = validAnswers.map(a => [
            req.params.id,
            String(a.questionNumber).trim(),
            a.answerText != null ? String(a.answerText) : null,
            a.answerData ? JSON.stringify(a.answerData) : null
          ]);
          const placeholders = rows.map(() => '(?, ?, ?, ?)').join(', ');
          await pool.execute(
            `INSERT INTO exam_subjective_answers (session_id, question_number, answer_text, answer_data)
             VALUES ${placeholders}`,
            rows.flat()
          );
        }
      } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
          return res.status(503).json({
            success: false,
            message:
              '数据库缺少表 exam_subjective_answers，主观题答案无法落库。请管理员执行 migrate_exam_subjective_answers.sql 后再交卷。'
          });
        }
        throw err;
      }
    }

    await ExamSessionModel.submit(req.params.id, req.body.force ? 'force_submitted' : 'submitted');
    try {
      if (typeof interviewRoute.maybeAutoAdvanceInterviewAfterSubmit === 'function') {
        await interviewRoute.maybeAutoAdvanceInterviewAfterSubmit(session.exam_id, session.user_id);
      }
    } catch (advErr) {
      console.warn('[exam-sessions/submit] maybeAutoAdvanceInterviewAfterSubmit:', advErr && advErr.message);
    }
    const sessionId = req.params.id;
    setImmediate(() => {
      ExamSummaryService.generateSummary(sessionId).catch(err => {
        console.error('generateSummary on submit:', err);
      });
    });
    res.json({ success: true, message: '交卷成功' });
  } catch (e) {
    console.error('[exam-sessions/submit]', req.params.id, e);
    res.status(500).json({ success: false, message: e.message || '交卷失败' });
  }
});

// 签到（考生本人或 guest 会话；若考试开启身份核验且传入 faceImage 则先刷脸再记为签到）
router.post('/:id/check-in', allowGuestOrRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!req.isGuest && !sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const exam = await ExamModel.findById(session.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    const ic = (exam.answer_system_config || {}).interviewConfig || {};
    const monitorConfig = exam.monitor_config || {};
    const requireFace = !!(ic.requireIdentityVerify || monitorConfig.faceVerifyEnabled);
    const faceImage = req.body.faceImage;
    let faceVerified = false;
    if (requireFace && faceImage) {
      const user = await UserModel.findByIdWithIdCardImage(session.user_id);
      if (!user || user.status !== 'active') {
        return res.status(401).json({ success: false, message: '用户不存在或已被禁用' });
      }
      if (!user.id_card_image_path || !user.id_card_image_path.trim()) {
        return res.status(400).json({ success: false, message: '该账号未配置身份证照片，无法刷脸签到' });
      }
      const cmp = await faceIdCompare.compareLiveFaceWithIdCard({
        idCardImageRef: user.id_card_image_path,
        liveFaceImageBase64: faceImage
      });
      if (!cmp.ok) {
        return res.status(400).json({ success: false, message: cmp.message || '人脸与身份证核验未通过' });
      }
      faceVerified = true;
    } else if (requireFace && !faceImage) {
      return res.status(400).json({ success: false, message: '本考试需刷脸签到，请上传人脸照片' });
    }
    await ExamSessionModel.checkIn(req.params.id, { faceVerified });
    res.json({ success: true, message: faceVerified ? '刷脸签到成功' : '签到成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
