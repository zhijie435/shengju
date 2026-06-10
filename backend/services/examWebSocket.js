/**
 * 考试监控 WebSocket 服务
 * 阶段二优化：截图改存磁盘（不占堆内存）+ 心跳聚合推送（5 秒一批）
 * P2 优化：截图广播 URL 而非 base64
 */
const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const clients = new Map();
const WS_MAX_PAYLOAD = Math.min(1024 * 1024, parseInt(process.env.WS_MAX_PAYLOAD, 10) || 512 * 1024);

// 截图存磁盘（阶段二优化）
const screenshotDir = path.join(__dirname, '../uploads/screenshots');
const screenshotSeqMap = new Map();

function ensureScreenshotDir() {
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
}
ensureScreenshotDir();

async function storeScreenshot(sessionId, base64Data) {
  const seq = (screenshotSeqMap.get(sessionId) || 0) + 1;
  screenshotSeqMap.set(sessionId, seq);
  const dir = path.join(screenshotDir, String(sessionId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${seq}.jpg`);
  // 异步写磁盘，不阻塞 WS 消息处理
  const buf = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  fs.writeFile(filePath, buf, () => {});
  return { sessionId, seq, timestamp: Date.now(), size: buf.length, path: filePath };
}

function getScreenshotFilePath(sessionId, seq) {
  const p = path.join(screenshotDir, String(sessionId), `${seq}.jpg`);
  return fs.existsSync(p) ? p : null;
}

// WS 心跳聚合（阶段二优化：5 秒一批）
let heartbeatBuffer = {};
let heartbeatTimer = null;

function bufferHeartbeat(sessionId, userId, examId) {
  heartbeatBuffer[sessionId] = { sessionId, userId, examId, ts: Date.now() };
}

function startHeartbeatBroadcast() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const keys = Object.keys(heartbeatBuffer);
    if (keys.length === 0) return;
    const batch = { ...heartbeatBuffer };
    heartbeatBuffer = {};
    // 按 examId 分组广播
    const byExam = {};
    for (const [sid, info] of Object.entries(batch)) {
      const eid = info.examId || 'unknown';
      if (!byExam[eid]) byExam[eid] = {};
      byExam[eid][sid] = info;
    }
    for (const [eid, data] of Object.entries(byExam)) {
      broadcastToMonitors(eid, { type: 'heartbeat_batch', data, count: Object.keys(data).length });
    }
  }, 5000);
}

function attachWebSocket(server) {
  startHeartbeatBroadcast();
  const wss = new WebSocketServer({ server, path: '/ws/exam', maxPayload: WS_MAX_PAYLOAD });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const type = url.searchParams.get('type');
    const sessionId = url.searchParams.get('sessionId');
    const examId = url.searchParams.get('examId');

    let user = null;
    if (token) user = verifyToken(token);
    if (!user && type === 'monitor') { ws.close(4001, '需要登录'); return; }

    const clientKey = type === 'student' ? `student:${sessionId || ''}` : `monitor:${examId || ''}`;
    if (!clients.has(clientKey)) clients.set(clientKey, new Set());
    const clientSet = clients.get(clientKey);
    const client = { ws, type, userId: user?.userId, examId, sessionId };
    clientSet.add(client);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (type === 'student' && msg.type === 'heartbeat') {
          // 聚合缓冲，5 秒一批
          bufferHeartbeat(sessionId || '', user?.userId, examId || msg.examId);
          // 同时即时广播重要状态（在线状态）
          broadcastToMonitors(examId || msg.examId, { type: 'heartbeat', sessionId, userId: user?.userId, at: Date.now() });
        } else if (type === 'student' && msg.type === 'violation') {
          broadcastToMonitors(examId || msg.examId, { type: 'violation', sessionId, eventType: msg.eventType, metadata: msg.metadata });
        } else if (type === 'student' && msg.type === 'screenshot') {
          // 阶段二优化：截图存磁盘，只广播 URL
          storeScreenshot(sessionId || '', msg.data).then(meta => {
            broadcastToMonitors(examId || msg.examId, {
              type: 'screenshot', sessionId, seq: meta.seq, timestamp: meta.timestamp,
              url: `/api/exam-monitor/screenshots/${sessionId}/${meta.seq}`
            });
          });
        }
      } catch (e) { console.warn('WS parse error:', e.message); }
    });

    ws.on('close', () => { clientSet.delete(client); if (clientSet.size === 0) clients.delete(clientKey); });
    ws.on('error', () => { clientSet.delete(client); if (clientSet.size === 0) clients.delete(clientKey); });
  });
  return wss;
}

function broadcastToMonitors(examId, msg) {
  const set = clients.get(`monitor:${examId}`);
  if (!set) return;
  const payload = JSON.stringify(msg);
  set.forEach(({ ws }) => { if (ws.readyState === 1) ws.send(payload); });
}

function broadcastToStudent(sessionId, msg) {
  const set = clients.get(`student:${sessionId}`);
  if (!set) return;
  const payload = JSON.stringify(msg);
  set.forEach(({ ws }) => { if (ws.readyState === 1) ws.send(payload); });
}

module.exports = { attachWebSocket, broadcastToMonitors, broadcastToStudent, getScreenshot: getScreenshotFilePath, storeScreenshot };
