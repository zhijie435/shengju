/**
 * Redis 客户端（阶段二引入，阶段三统一接入）
 * 连接失败时回退到内存模式，不影响现有功能
 */
let redisClient = null;
let fallbackMap = new Map(); // 内存回退

function isConfigured() {
  return !!(process.env.REDIS_HOST && process.env.REDIS_PORT);
}

async function getClient() {
  if (redisClient) return redisClient;
  if (!isConfigured()) return null;
  try {
    const Redis = require('ioredis');
    redisClient = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || '',
      db: 0,
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectionName: 'sjrcw',
      retryStrategy(times) {
        if (times > 3) return null; // 停止重试
        return Math.min(times * 200, 1000);
      }
    });
    await redisClient.connect();
    console.log('✓ Redis 已连接');
  } catch (e) {
    console.warn('[Redis] 连接失败，回退到内存模式:', e.message);
    redisClient = null;
  }
  return redisClient;
}

// ---- 接口（自动选择 Redis 或内存回退）----
async function get(key) {
  const client = await getClient();
  if (client) {
    try { return await client.get(key); } catch (_) {}
  }
  const entry = fallbackMap.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { fallbackMap.delete(key); return null; }
  return entry.value;
}

async function setex(key, ttlSeconds, value) {
  const client = await getClient();
  if (client) {
    try { await client.setex(key, ttlSeconds, String(value)); return; } catch (_) {}
  }
  fallbackMap.set(key, { value: String(value), expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function del(key) {
  const client = await getClient();
  if (client) { try { await client.del(key); } catch (_) {} }
  fallbackMap.delete(key);
}

// 带 TTL 的 set
async function set(key, value, ttlSeconds) {
  const client = await getClient();
  if (client) {
    try { await client.set(key, String(value), 'EX', ttlSeconds); return; } catch (_) {}
  }
  fallbackMap.set(key, { value: String(value), expiresAt: Date.now() + ttlSeconds * 1000 });
}

// 清理过期内存条目
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fallbackMap) {
    if (now > v.expiresAt) fallbackMap.delete(k);
  }
}, 60000);

module.exports = { get, set, setex, del, isConfigured, getClient };
