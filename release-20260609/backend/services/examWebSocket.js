/**
 * 考试监控 WebSocket 服务
 * 考生端上报心跳和违规事件，企业端/总管理订阅监控数据
 * 支持约 2000 人同时在线：单进程可承载数千连接；多实例部署时需配合负载均衡粘性会话或 Redis 广播
 *
 * P2 优化：截图不再通过 WS 传输 base64 数据（50-200KB/张），改为服务端暂存 + 广播 URL
 */
const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');

const clients = new Map(); // sessionId or examId -> Set<{ws, type, userId, examId?}>
const WS_MAX_PAYLOAD = Math.min(1024 * 1024, parseInt(process.env.WS_MAX_PAYLOAD, 10) || 512 * 1024); // 默认 512KB

// P2 优化：截图内存缓存（LRU，最大 200 张，TTL 5 分钟，替代 WS 广播 base64）
const screenshotCache = new Map(); // key: `${sessionId}:${seq}`, value: { data, ts }
const SCREENSHOT_CACHE_MAX = 200;
const SCREENSHOT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const screenshotSeqMap = new Map(); // sessionId → 自增序号

function storeScreenshot(sessionId, data) {
  const seq = (screenshotSeqMap.get(sessionId) || 0) + 1;
  screenshotSeqMap.set(sessionId, seq);
  const key = `${sessionId}:${seq}`;
  // 淘汰最旧条目
  if (screenshotCache.size >= SCREENSHOT_CACHE_MAX) {
    const oldest = screenshotCache.keys().next().value;
    screenshotCache.delete(oldest);
  }
  screenshotCache.set(key, { data, ts: Date.now() });
  return { sessionId, seq, key, timestamp: Date.now(), size: typeof data === 'string' ? data.length : 0 };
}

function getScreenshot(sessionId, seq) {
  const key = `${sessionId}:${seq}`;
  const entry = screenshotCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SCREENSHOT_CACHE_TTL_MS) {
    screenshotCache.delete(key);
    return null;
  }
  return entry.data;
}

// 定期清理过期截图
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of screenshotCache) {
    if (now - entry.ts > SCREENSHOT_CACHE_TTL_MS) screenshotCache.delete(key);
  }
}, 60000);

function attachWebSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/exam',
    maxPayload: WS_MAX_PAYLOAD
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const type = url.searchParams.get('type'); // 'student' | 'monitor'
    const sessionId = url.searchParams.get('sessionId');
    const examId = url.searchParams.get('examId');

    let user = null;
    if (token) user = verifyToken(token);

    if (!user && type === 'monitor') {
      ws.close(4001, '需要登录');
      return;
    }

    const clientKey = type === 'student' ? `student:${sessionId || ''}` : `monitor:${examId || ''}`;
    if (!clients.has(clientKey)) clients.set(clientKey, new Set());
    const clientSet = clients.get(clientKey);
    const client = { ws, type, userId: user?.userId, examId, sessionId };
    clientSet.add(client);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (type === 'student' && msg.type === 'heartbeat') {
          broadcastToMonitors(examId || msg.examId, { type: 'heartbeat', sessionId, userId: user?.userId, at: Date.now() });
        } else if (type === 'student' && msg.type === 'violation') {
          broadcastToMonitors(examId || msg.examId, { type: 'violation', sessionId, eventType: msg.eventType, metadata: msg.metadata });
        } else if (type === 'student' && msg.type === 'screenshot') {
          // P2 优化：截图服务端暂存，广播轻量 URL（不传 base64）
          const meta = storeScreenshot(sessionId || '', msg.data);
          broadcastToMonitors(examId || msg.examId, {
            type: 'screenshot',
            sessionId,
            seq: meta.seq,
            timestamp: meta.timestamp,
            size: meta.size,
            url: `/api/v1/exam-monitor/screenshots/${sessionId}/${meta.seq}`
          });
        }
      } catch (e) {
        console.warn('WS message parse error:', e.message);
      }
    });

    ws.on('close', () => {
      clientSet.delete(client);
      if (clientSet.size === 0) clients.delete(clientKey);
    });

    ws.on('error', () => {
      clientSet.delete(client);
      if (clientSet.size === 0) clients.delete(clientKey);
    });
  });

  return wss;
}

function broadcastToMonitors(examId, msg) {
  const key = `monitor:${examId}`;
  const set = clients.get(key);
  if (!set) return;
  const payload = JSON.stringify(msg);
  set.forEach(({ ws }) => {
    if (ws.readyState === 1) ws.send(payload);
  });
}

function broadcastToStudent(sessionId, msg) {
  const key = `student:${sessionId}`;
  const set = clients.get(key);
  if (!set) return;
  const payload = JSON.stringify(msg);
  set.forEach(({ ws }) => {
    if (ws.readyState === 1) ws.send(payload);
  });
}

module.exports = { attachWebSocket, broadcastToMonitors, broadcastToStudent, getScreenshot, screenshotCache };
