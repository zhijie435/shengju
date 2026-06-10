'use strict';
const Redis = require('ioredis');

let redis = null;
try {
  redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    lazyConnect: false,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', function() {});
} catch (e) {
  redis = null;
}

/**
 * Redis 缓存中间件（仅 GET 请求，仅成功响应）
 * @param {number} ttl - 缓存秒数（默认30s）
 * @param {function} [keyFn] - 自定义 key 函数，默认用 req.originalUrl
 */
function cacheMiddleware(ttl, keyFn) {
  ttl = ttl || 30;
  return async function(req, res, next) {
    if (!redis || req.method !== 'GET') return next();
    var cacheKey = 'sjrcw:cache:' + (keyFn ? keyFn(req) : req.originalUrl);
    try {
      var cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.send(cached);
      }
    } catch (e) {
      return next();
    }

    var originalJson = res.json.bind(res);
    res.json = function(data) {
      if (res.statusCode === 200) {
        var str = JSON.stringify(data);
        redis.set(cacheKey, str, 'EX', ttl).catch(function() {});
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };
    next();
  };
}

async function clearCache(pattern) {
  pattern = pattern || 'sjrcw:cache:*';
  if (!redis) return 0;
  var keys = await redis.keys(pattern);
  if (keys.length > 0) await redis.del.apply(redis, keys);
  return keys.length;
}

module.exports = { cacheMiddleware: cacheMiddleware, clearCache: clearCache, redis: redis };
