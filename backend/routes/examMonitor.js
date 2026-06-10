const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const JSZip = require('jszip');
const jwt = require('jsonwebtoken');
const ExamMonitorEventModel = require('../models/examMonitorEventModel');
const ExamVideoChunkModel = require('../models/examVideoChunkModel');

// P2 优化：从 WebSocket 截图缓存读取（替代 WS 广播 base64）
const { getScreenshot } = require('../services/examWebSocket');
const ExamSessionModel = require('../models/examSessionModel');
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');
const { pool } = require('../config/database');
const { authenticate, requireRole, verifyToken, JWT_SECRET } = require('../middleware/auth');
const { sessionOwnedByUser } = require('../utils/sessionUserMatch');

const SIDE_CAMERA_TOKEN_EXPIRY = '2h';

/** 企业主账号、企业审核子账号、人才网带 enterpriseId 的 token：校验考试归属（须优先用 req.enterpriseId，避免子账号 findByUserId 对不上 enterprises） */
async function assertEnterpriseExamAccess(req, exam) {
  if (!exam) return { ok: false, status: 404, message: '考试不存在' };
  if (req.user.role === 'admin') return { ok: true };
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer') {
    return { ok: false, status: 403, message: '权限不足' };
  }
  let entId = req.enterpriseId != null && String(req.enterpriseId).trim() !== '' ? Number(req.enterpriseId) : null;
  if (!Number.isFinite(entId) || entId <= 0) {
    try {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      entId = ent?.id != null ? Number(ent.id) : null;
    } catch (_) {
      entId = null;
    }
  }
  const examEnt = exam.enterprise_id != null ? Number(exam.enterprise_id) : null;
  if (!Number.isFinite(entId) || entId <= 0 || !Number.isFinite(examEnt) || examEnt !== entId) {
    return { ok: false, status: 403, message: '无权限' };
  }
  return { ok: true };
}

// 存储目录
const UPLOAD_DIR = path.join(__dirname, '../uploads/exam-videos');
const INTERVIEW_VIDEO_DIR = path.join(__dirname, '../uploads/interview-video');

// P1 优化：已创建目录缓存，避免每次上传都 sync stat + mkdir
const createdDirs = new Set();

function ensureDir(dir) {
  if (createdDirs.has(dir)) return;
  try {
    require('fs').mkdirSync(dir, { recursive: true });
  } catch (_) { /* 目录已存在 */ }
  createdDirs.add(dir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const examId = req.body.examId || req.body.exam_id || '0';
    const sessionId = req.body.sessionId || req.body.session_id || '0';
    const dir = path.join(UPLOAD_DIR, String(examId), String(sessionId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    let type = (req.body.chunkType || req.body.chunk_type || 'camera').replace(/[^a-z_]/gi, '') || 'camera';
    if (type !== 'screen' && type !== 'side_camera') type = 'camera';
    const mime = (file.mimetype || '').toLowerCase();
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : (mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' : (mime.includes('png') ? 'png' : 'blob');
    cb(null, `${type}_${Date.now()}.${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// 校验侧面摄像头 Token（手机端上传用，无登录态）
function verifySideCameraToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '请提供侧摄 Token' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== 'side_camera' || !decoded.sessionId) {
      return res.status(403).json({ success: false, message: '无效的侧摄 Token' });
    }
    req.sideCameraSession = { sessionId: decoded.sessionId, examId: decoded.examId };
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Token 无效或已过期' });
  }
}
const storageMobile = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.sideCameraSession?.sessionId || '0';
    const examId = req.sideCameraSession?.examId || '0';
    const dir = path.join(UPLOAD_DIR, String(examId), String(sessionId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : (mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' : (mime.includes('png') ? 'png' : 'blob');
    cb(null, `side_camera_${Date.now()}.${ext}`);
  }
});
const uploadMobile = multer({ storage: storageMobile, limits: { fileSize: 50 * 1024 * 1024 } });

const storagePrerecordSide = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.sideCameraSession?.sessionId || '0';
    const examId = req.sideCameraSession?.examId || '0';
    const dir = path.join(INTERVIEW_VIDEO_DIR, String(examId), String(sessionId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `side_prerecord_${Date.now()}.webm`);
  }
});
const uploadPrerecordSideMobile = multer({ storage: storagePrerecordSide, limits: { fileSize: 512 * 1024 * 1024 } });

router.post('/upload-chunk-mobile', verifySideCameraToken, uploadMobile.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'file 必填' });
    const sessionId = req.sideCameraSession.sessionId;
    const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
    const duration = parseFloat(req.body.durationSeconds || req.body.duration_seconds) || 0;
    const id = await ExamVideoChunkModel.create({
      sessionId,
      chunkType: 'side_camera',
      filePath: relativePath,
      fileSize: req.file.size,
      durationSeconds: duration
    });
    res.json({ success: true, data: { id } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 提前录制：侧摄手机上传整段侧面录像（无登录态，Bearer 为侧摄 Token）
router.post('/upload-prerecord-side-mobile', verifySideCameraToken, uploadPrerecordSideMobile.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'file 必填' });
    const sessionId = req.sideCameraSession.sessionId;
    const examIdFromToken = req.sideCameraSession.examId;
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    const exam = await ExamModel.findById(examIdFromToken || session.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    const ic = (exam.answer_system_config || {}).interviewConfig || {};
    if (ic.interviewFlowMode !== 'prerecord') {
      return res.status(400).json({ success: false, message: '当前考试未启用提前录制模式' });
    }
    const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
    const dur = parseInt(String(req.body.durationSeconds || req.body.duration_seconds || '0'), 10) || null;
    const eid = Number(session.exam_id);
    await pool.execute(
      `INSERT INTO interview_session_videos (exam_id, session_id, kind, file_path, duration_seconds)
       VALUES (?, ?, 'side', ?, ?)
       ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), duration_seconds = VALUES(duration_seconds), created_at = CURRENT_TIMESTAMP`,
      [eid, sessionId, relativePath, dur]
    );
    await ExamSessionModel.setPrerecordVideoStatus(sessionId, 'side_ok');
    res.json({ success: true, data: { filePath: relativePath } });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ success: false, message: '请先执行数据库迁移 interview_session_videos' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
});

// 提前录制：侧摄页上报上传失败（Bearer 为侧摄 Token）
router.post('/prerecord-side-upload-status', verifySideCameraToken, async (req, res) => {
  try {
    const status = String(req.body?.status || 'side_fail').trim().slice(0, 32);
    if (status !== 'side_fail') {
      return res.status(400).json({ success: false, message: '仅支持 status=side_fail' });
    }
    const sessionId = req.sideCameraSession.sessionId;
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    const exam = await ExamModel.findById(session.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    const ic = (exam.answer_system_config || {}).interviewConfig || {};
    if (ic.interviewFlowMode !== 'prerecord') {
      return res.status(400).json({ success: false, message: '当前考试未启用提前录制模式' });
    }
    const ok = await ExamSessionModel.setPrerecordVideoStatus(sessionId, 'side_fail');
    if (!ok) {
      return res.status(503).json({ success: false, message: '数据库未迁移 interview_prerecord_video_status' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.use(authenticate);

// 上报监控事件（考生）
router.post('/events', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const { sessionId, eventType, metadata } = req.body;
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const id = await ExamMonitorEventModel.create(sessionId, eventType, metadata || {});
    const count = await ExamSessionModel.incrementViolation(sessionId);
    res.json({ success: true, data: { id, violationCount: count } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 上传视频/截图分片（考生）
router.post('/upload-chunk', requireRole('candidate', 'user', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId || req.body.session_id;
    const chunkType = req.body.chunkType || req.body.chunk_type || 'camera';
    if (!sessionId || !req.file) {
      return res.status(400).json({ success: false, message: 'sessionId 和 file 必填' });
    }
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (!sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '无权限' });
    const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
    const duration = parseFloat(req.body.durationSeconds || req.body.duration_seconds) || 0;
    const normalizedType = chunkType === 'screen' ? 'screen' : chunkType === 'side_camera' ? 'side_camera' : 'camera';
    const id = await ExamVideoChunkModel.create({
      sessionId,
      chunkType: normalizedType,
      filePath: relativePath,
      fileSize: req.file.size,
      durationSeconds: duration
    });
    res.json({ success: true, data: { id } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 企业/总管理/企业审核子账号：获取某考试的监控事件
router.get('/events/exam/:examId', requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    const gate = await assertEnterpriseExamAccess(req, exam);
    if (!gate.ok) return res.status(gate.status).json({ success: false, message: gate.message });
    const list = await ExamMonitorEventModel.listByExam(req.params.examId);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取某考试下各会话最新分片（监控画面，按会话分组）— 必须放在 /chunks/session/:id 之前
router.get('/chunks/exam/:examId/latest', requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    const gate = await assertEnterpriseExamAccess(req, exam);
    if (!gate.ok) return res.status(gate.status).json({ success: false, message: gate.message });
    const list = await ExamVideoChunkModel.listLatestByExam(req.params.examId);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生：获取自己会话各路监控最新分片（侧摄连接后 PC 端轮询预览）
router.get('/chunks/session/:sessionId/latest', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (req.isGuest) {
      if (Number(sessionId) !== Number(req.guestSessionId)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    } else if (!sessionOwnedByUser(session, req.user?.id)) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const latest = await ExamVideoChunkModel.listLatestBySession(sessionId);
    res.json({ success: true, data: latest });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取某会话的视频分片列表（用于回放）
router.get('/chunks/session/:sessionId', requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  try {
    const session = await ExamSessionModel.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    const exam = await ExamModel.findById(session.exam_id);
    const gate = await assertEnterpriseExamAccess(req, exam);
    if (!gate.ok) return res.status(gate.status).json({ success: false, message: gate.message });
    const list = await ExamVideoChunkModel.listBySession(req.params.sessionId);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 企业/总管理：导出某考试的监控存档（压缩为 zip，便于后续调取）
router.get('/archive/exam/:examId', requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    const gate = await assertEnterpriseExamAccess(req, exam);
    if (!gate.ok) return res.status(gate.status).json({ success: false, message: gate.message });
    const chunks = await ExamVideoChunkModel.listAllByExam(req.params.examId);
    if (!chunks.length) {
      return res.status(404).json({ success: false, message: '该考试暂无监控数据' });
    }
    const zip = new JSZip();
    const sanitize = (s) => String(s || '').replace(/[/\\:*?"<>|]/g, '_').slice(0, 50) || 'unknown';
    const examName = sanitize(exam.name);
    const rootDir = `exam_${exam.id}_${examName}`;
    for (const c of chunks) {
      const fullPath = path.join(__dirname, '..', c.file_path);
      if (!fs.existsSync(fullPath)) continue;
      const sessionDir = `${rootDir}/session_${c.session_id}_${sanitize(c.real_name || c.username)}`;
      const baseName = path.basename(c.file_path);
      const zipPath = `${sessionDir}/${baseName}`;
      const buf = await fsPromises.readFile(fullPath);
      zip.file(zipPath, buf);
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const filename = `monitor_archive_exam${exam.id}_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(zipBuf);
  } catch (e) {
    console.error('Monitor archive error:', e);
    res.status(500).json({ success: false, message: e.message || '导出失败' });
  }
});

// 考生端：获取侧面摄像头上传用短期 Token（放入二维码）
router.get('/side-camera-token', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const sessionId = req.query.sessionId || req.body?.sessionId;
    if (!sessionId) return res.status(400).json({ success: false, message: 'sessionId 必填' });
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (req.isGuest) {
      if (Number(sessionId) !== Number(req.guestSessionId)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    } else if (!sessionOwnedByUser(session, req.user?.id)) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    // 仅用 exam_sessions 单列读状态，避免 JOIN 结果里字段被覆盖等非预期情况
    let sessionStatus = '';
    try {
      const [[stRow]] = await pool.execute('SELECT status FROM exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
      const v = stRow && stRow.status;
      if (Buffer.isBuffer(v)) sessionStatus = v.toString('utf8').replace(/\0/g, '').trim().toLowerCase();
      else sessionStatus = String(v == null ? '' : v).trim().toLowerCase();
    } catch (_) {
      sessionStatus = String(session.status || '').trim().toLowerCase();
    }
    // pending：已进入考场页但尚未点「开始」时也要能出码，避免二维码一直「获取失败」
    if (!['ongoing', 'pending'].includes(sessionStatus)) {
      let msg = '当前考试状态不可获取侧摄链接，请进入考试后再试';
      if (sessionStatus === 'submitted' || sessionStatus === 'force_submitted') {
        msg = '会话已交卷，无法再获取侧摄码；请在交卷前用手机完成侧录。若刚交卷，请刷新页面。';
      } else if (sessionStatus === 'abnormal') {
        msg = '会话状态异常，暂不可获取侧摄链接，请刷新或联系考务。';
      } else if (sessionStatus) {
        msg = `当前会话状态为「${sessionStatus}」，仅未交卷（pending/ongoing）时可获取侧摄链接；请刷新页面或重新进入考试后再试。`;
      }
      return res.status(400).json({ success: false, message: msg });
    }
    const token = jwt.sign(
      { sessionId: Number(sessionId), examId: session.exam_id, purpose: 'side_camera' },
      JWT_SECRET,
      { expiresIn: SIDE_CAMERA_TOKEN_EXPIRY }
    );
    res.json({ success: true, data: { token, expiresIn: SIDE_CAMERA_TOKEN_EXPIRY } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 阶段二优化：截图从磁盘按需拉取（sendFile 流式，不占内存）
router.get('/screenshots/:sessionId/:seq', authenticate, requireRole('enterprise', 'admin', 'enterprise_reviewer'), (req, res) => {
  const filePath = getScreenshot(req.params.sessionId, parseInt(req.params.seq, 10));
  if (!filePath) return res.status(404).json({ success: false, message: '截图不存在或已过期' });
  res.sendFile(filePath);
});

module.exports = router;
