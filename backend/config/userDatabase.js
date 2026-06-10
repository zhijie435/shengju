const mysql = require('mysql2/promise');
const DatabaseManager = require('../services/databaseManager');
require('dotenv').config();

// 用户数据库连接池缓存；支持 2000 人同时在线：限制池数量与每池连接数，避免总连接数爆炸
const MAX_USER_POOLS = Math.max(20, parseInt(process.env.MAX_USER_POOLS, 10) || 100);
const USER_POOL_CONNECTION_LIMIT = Math.max(1, parseInt(process.env.USER_POOL_CONNECTION_LIMIT, 10) || 2);
const userPools = new Map(); // key: userId, value: { pool, lastUsed: timestamp }
const userPoolOrder = []; // LRU 顺序

// 获取用户数据库连接池（LRU 淘汰超出 MAX_USER_POOLS 的池）
async function getUserPool(userId) {
  const key = Number(userId);
  if (userPools.has(key)) {
    const entry = userPools.get(key);
    entry.lastUsed = Date.now();
    const idx = userPoolOrder.indexOf(key);
    if (idx >= 0) {
      userPoolOrder.splice(idx, 1);
      userPoolOrder.push(key);
    }
    return entry.pool;
  }

  while (userPoolOrder.length >= MAX_USER_POOLS) {
    const evictKey = userPoolOrder.shift();
    if (evictKey != null && userPools.has(evictKey)) {
      const old = userPools.get(evictKey);
      userPools.delete(evictKey);
      old.pool.end().catch(() => {});
    }
  }

  const dbName = await DatabaseManager.getUserDatabaseName(key);
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: USER_POOL_CONNECTION_LIMIT,
    queueLimit: 50,
    timezone: '+08:00',
    charset: 'utf8mb4'
  });

  userPools.set(key, { pool, lastUsed: Date.now() });
  userPoolOrder.push(key);
  return pool;
}

// 关闭用户数据库连接池
function closeUserPool(userId) {
  const key = Number(userId);
  if (userPools.has(key)) {
    const entry = userPools.get(key);
    entry.pool.end().catch(() => {});
    userPools.delete(key);
    const idx = userPoolOrder.indexOf(key);
    if (idx >= 0) userPoolOrder.splice(idx, 1);
  }
}

// 关闭所有用户数据库连接池
function closeAllUserPools() {
  for (const [, entry] of userPools.entries()) {
    entry.pool.end().catch(() => {});
  }
  userPools.clear();
  userPoolOrder.length = 0;
}

// 中间件：为请求添加用户数据库连接
async function attachUserDatabase(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: '未认证'
      });
    }

    // 获取用户数据库连接池
    req.userPool = await getUserPool(req.user.id);
    next();
  } catch (error) {
    console.error('附加用户数据库失败:', error);
    return res.status(500).json({
      success: false,
      message: '数据库连接失败'
    });
  }
}

// 中间件：尝试附加用户数据库，失败时 req.userPool 为 undefined（用于 list 等可回退主库的接口）
async function optionalAttachUserDatabase(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      req.userPool = undefined;
      return next();
    }
    req.userPool = await getUserPool(req.user.id);
    next();
  } catch (error) {
    console.warn('附加用户数据库失败，将使用主库:', error.message);
    req.userPool = undefined;
    next();
  }
}

module.exports = {
  getUserPool,
  closeUserPool,
  closeAllUserPools,
  attachUserDatabase,
  optionalAttachUserDatabase
};
