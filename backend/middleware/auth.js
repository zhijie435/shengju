const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const GradingAccountModel = require('../models/gradingAccountModel');
const EnterpriseModel = require('../models/enterpriseModel');

// JWT密钥（应该从环境变量读取）
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// P1 优化：认证中间件 LRU 缓存（减少每请求重复查库）
class LRUCache {
  constructor(maxSize = 5000, ttlMs = 60000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) { this.cache.delete(key); return undefined; }
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // 淘汰最旧的条目
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, ts: Date.now() });
  }
  async getOrFetch(key, fetchFn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fetchFn();
    this.set(key, value);
    return value;
  }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
  get size() { return this.cache.size; }
}
const userCache = new LRUCache(5000, 60000);        // 用户缓存 TTL 60s
const permCache = new LRUCache(5000, 120000);        // 权限缓存 TTL 120s
const enterpriseByUserCache = new LRUCache(5000, 60000); // 企业归属缓存 TTL 60s

// 缓存失效（登出/改密/改权限时调用）
function invalidateUserCache(userId) {
  userCache.delete(`user:${userId}`);
  permCache.delete(`perm:${userId}`);
  enterpriseByUserCache.delete(`ent:${userId}`);
}

/**
 * @param {object} user - { id, username, role }
 * @param {object} [opts] - { portal?: 'jobseeker'|'enterprise'|'grader' } 登录门户，防止求职者 token 被提升为企业身份
 */
function generateToken(user, opts) {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role
  };
  const portal = opts && opts.portal;
  if (portal) payload.portal = portal;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/** 从 JWT 解析登录门户（无字段时按角色推断，旧 token 兼容） */
function inferLoginPortal(decoded) {
  if (!decoded || typeof decoded !== 'object') return 'jobseeker';
  if (decoded.type === 'guest') return 'guest';
  if (decoded.source === 'talent_network' && decoded.enterpriseId != null) return 'enterprise';
  if (
    decoded.portal === 'jobseeker' ||
    decoded.portal === 'enterprise' ||
    decoded.portal === 'grader' ||
    decoded.portal === 'admin'
  ) {
    return decoded.portal;
  }
  if (decoded.type === 'enterprise_reviewer') return 'enterprise';
  const r = decoded.role != null ? String(decoded.role).toLowerCase() : '';
  if (r === 'grader') return 'grader';
  if (r === 'enterprise') return 'enterprise';
  if (r === 'admin') return 'admin';
  return 'jobseeker';
}

// 验证JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// 认证中间件
async function authenticate(req, res, next) {
  try {
    // 从请求头获取token
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '未提供认证token'
      });
    }

    const token = authHeader.substring(7); // 移除 'Bearer ' 前缀
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: '无效的token或token已过期'
      });
    }
    // 调试/自检用：保留解码后的 token 信息（不含密钥）
    req.tokenDecoded = decoded;
    req.loginPortal = inferLoginPortal(decoded);

    // 免登录考试：邀请码生成的 guestToken，仅用于 start/submit
    if (decoded.type === 'guest' && decoded.sessionId) {
      req.isGuest = true;
      req.guestSessionId = parseInt(decoded.sessionId, 10);
      req.loginPortal = 'guest';
      return next();
    }

    // 人才网企业账号登录笔试系统：token 内带 enterpriseId，不再查本地 user
    if (decoded.source === 'talent_network' && decoded.enterpriseId != null) {
      const eid = Number(decoded.enterpriseId);
      req.user = {
        id: decoded.userId || decoded.enterpriseId,
        username: decoded.username || '企业用户',
        role: 'enterprise',
        enterpriseId: Number.isFinite(eid) ? eid : decoded.enterpriseId
      };
      req.enterpriseId = req.user.enterpriseId;
      req.loginPortal = 'enterprise';
      return next();
    }

    if (decoded.type === 'enterprise_reviewer' && decoded.enterpriseId != null && decoded.reviewerId != null) {
      const eid = Number(decoded.enterpriseId);
      /** 未带 allowedProjectIds：全部岗位；[]：无岗位；[id…]：限定 */
      let reviewerAllowedProjectIds = null;
      if (Object.prototype.hasOwnProperty.call(decoded, 'allowedProjectIds')) {
        let allowed = decoded.allowedProjectIds;
        if (typeof allowed === 'string') {
          try {
            allowed = JSON.parse(allowed);
          } catch (_) {
            allowed = [];
          }
        }
        if (Array.isArray(allowed)) {
          reviewerAllowedProjectIds = allowed
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0);
        } else {
          reviewerAllowedProjectIds = [];
        }
      }
      req.user = {
        id: Number(decoded.reviewerId),
        username: decoded.username || '审核账号',
        role: 'enterprise_reviewer',
        enterpriseId: Number.isFinite(eid) ? eid : Number(decoded.enterpriseId),
        reviewerAllowedProjectIds
      };
      req.enterpriseId = req.user.enterpriseId;
      req.loginPortal = 'enterprise';
      return next();
    }

    // 根据角色验证用户
    if (decoded.role === 'grader') {
      // 子阅卷账号
      const account = await GradingAccountModel.findById(decoded.userId);
      if (!account || account.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: '账号不存在或已被禁用'
        });
      }
      req.user = {
        id: account.id,
        graderId: account.id,
        username: account.username,
        role: 'grader',
        enterpriseId: account.enterprise_id || null // 企业端子账号有enterprise_id，管理端为null
      };
      req.loginPortal = 'grader';
    } else {
      // P1优化：普通用户查询使用 LRU 缓存
      const user = await userCache.getOrFetch(`user:${decoded.userId}`, () => UserModel.findById(decoded.userId));
      if (!user || user.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: '用户不存在或已被禁用'
        });
      }
      // 角色归一化：兼容历史库中 role 不同命名（administrator/super_admin/管理员 等）
      function normalizeRole(raw) {
        if (raw == null) return '';
        const r = String(raw).trim();
        const low = r.toLowerCase();
        if (!r) return '';
        if (low === 'admin' || low === 'administrator' || low === 'super_admin' || low === 'superadmin' || low === 'super-admin') return 'admin';
        if (r === '管理员' || r === '系统管理员' || r === '超级管理员') return 'admin';
        if (low === 'enterprise' || low === 'company') return 'enterprise';
        if (r === '企业' || r === '企业用户' || r === '政企' || r === '用人单位' || r === '招聘企业') return 'enterprise';
        if (low === 'candidate' || low === 'jobseeker' || low === 'user') return low === 'jobseeker' ? 'candidate' : low;
        return low;
      }
      let normalizedRole = normalizeRole(user.role);
      // 兼容：role 为空但 permissions 表标记了管理员能力
      if (normalizedRole !== 'admin') {
        try {
          // P1优化：权限查询使用 LRU 缓存
          const perms = await permCache.getOrFetch(`perm:${user.id}`, () => UserModel.getPermissions(user.id));
          if (perms && (perms.can_manage_users || perms.can_view_all_data || perms.can_edit_shared)) {
            normalizedRole = 'admin';
          }
        } catch (_) {
          /* ignore */
        }
      }
      req.user = {
        id: user.id,
        username: user.username,
        role: normalizedRole || (user.role || '')
      };
      req.loginPortal = inferLoginPortal(decoded);
      if (req.loginPortal === 'jobseeker' && (req.user.role === 'enterprise' || req.user.role === 'admin')) {
        return res.status(401).json({
          success: false,
          message: '当前为求职者端登录凭证，该账号为企业/管理员身份，请退出后使用政企登录或管理端重新登录'
        });
      }
      if (req.loginPortal === 'admin' && req.user.role !== 'admin') {
        return res.status(401).json({
          success: false,
          message: '当前为管理端登录凭证，与账号角色不符，请重新登录'
        });
      }
    }

    // 求职者门户登录的 token：禁止根据 enterprises 表提升为企业身份（避免同一账号两端串用）
    // enterprises.user_id 已绑定但 users.role 未标 enterprise 时，仅在企业/未标 portal 的旧 token 下提升
    if (
      req.loginPortal !== 'jobseeker' &&
      req.user &&
      !req.isGuest &&
      req.user.role !== 'enterprise' &&
      req.user.role !== 'admin' &&
      req.user.role !== 'grader'
    ) {
      try {
        // 阶段一优化：企业归属查询使用 LRU 缓存
        const ent = await enterpriseByUserCache.getOrFetch(`ent:${req.user.id}`, () => EnterpriseModel.findByUserId(req.user.id));
        if (ent && ent.id != null) {
          req.user.role = 'enterprise';
          req.enterpriseId = ent.id;
          req.user.enterpriseId = ent.id;
        }
      } catch (promoErr) {
        console.warn('Auth enterprise role promotion:', promoErr.message);
      }
    }

    if (req.user && req.user.role === 'enterprise') {
      if (req.user.enterpriseId) {
        req.enterpriseId = req.user.enterpriseId;
      } else {
        try {
          const ent = await enterpriseByUserCache.getOrFetch(`ent:${req.user.id}`, () => EnterpriseModel.findByUserId(req.user.id));
          if (ent) {
            req.enterpriseId = ent.id;
            req.user.enterpriseId = ent.id;
          }
        } catch (lookupErr) {
          // 缺表、库不可写等不应导致整站 500；后续接口再返回 403/404
          console.warn('Auth enterprise lookup failed:', lookupErr.message);
        }
      }
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: '认证过程出错'
    });
  }
}

/**
 * 可选鉴权：无 token / 无效 token 时继续走公开逻辑，不返回 401
 * 用于 GET /jobs、GET /announcements/:id 等求职者端可匿名访问的接口
 */
async function optionalAuthenticate(req, res, next) {
  req.user = undefined;
  req.enterpriseId = undefined;
  req.loginPortal = undefined;
  req.isGuest = false;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return next();
    }
    req.tokenDecoded = decoded;
    req.loginPortal = inferLoginPortal(decoded);
    if (decoded.type === 'guest' && decoded.sessionId) {
      req.isGuest = true;
      req.guestSessionId = parseInt(decoded.sessionId, 10);
      req.loginPortal = 'guest';
      return next();
    }
    if (decoded.source === 'talent_network' && decoded.enterpriseId != null) {
      const eid = Number(decoded.enterpriseId);
      req.user = {
        id: decoded.userId || decoded.enterpriseId,
        username: decoded.username || '企业用户',
        role: 'enterprise',
        enterpriseId: Number.isFinite(eid) ? eid : decoded.enterpriseId
      };
      req.enterpriseId = req.user.enterpriseId;
      req.loginPortal = 'enterprise';
      return next();
    }
    if (decoded.type === 'enterprise_reviewer' && decoded.enterpriseId != null && decoded.reviewerId != null) {
      const eid = Number(decoded.enterpriseId);
      let reviewerAllowedProjectIds = null;
      if (Object.prototype.hasOwnProperty.call(decoded, 'allowedProjectIds')) {
        let allowed = decoded.allowedProjectIds;
        if (typeof allowed === 'string') {
          try {
            allowed = JSON.parse(allowed);
          } catch (_) {
            allowed = [];
          }
        }
        if (Array.isArray(allowed)) {
          reviewerAllowedProjectIds = allowed
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0);
        } else {
          reviewerAllowedProjectIds = [];
        }
      }
      req.user = {
        id: Number(decoded.reviewerId),
        username: decoded.username || '审核账号',
        role: 'enterprise_reviewer',
        enterpriseId: Number.isFinite(eid) ? eid : Number(decoded.enterpriseId),
        reviewerAllowedProjectIds
      };
      req.enterpriseId = req.user.enterpriseId;
      req.loginPortal = 'enterprise';
      return next();
    }
    if (decoded.role === 'grader') {
      const account = await GradingAccountModel.findById(decoded.userId);
      if (account && account.status === 'active') {
        req.user = {
          id: account.id,
          graderId: account.id,
          username: account.username,
          role: 'grader',
          enterpriseId: account.enterprise_id || null
        };
      }
      req.loginPortal = 'grader';
      return next();
    }
    // 阶段一优化：复用 authenticate 的 LRU 缓存
    const user = await userCache.getOrFetch(`user:${decoded.userId}`, () => UserModel.findById(decoded.userId));
    if (user && user.status === 'active') {
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role
      };
      req.loginPortal = inferLoginPortal(decoded);
      if (req.loginPortal === 'jobseeker' && (String(user.role || '').toLowerCase() === 'enterprise' || String(user.role || '').toLowerCase() === 'admin')) {
        req.user = undefined;
        req.enterpriseId = undefined;
        req.loginPortal = undefined;
        return next();
      }
      if (req.user.role === 'enterprise') {
        if (req.user.enterpriseId) {
          req.enterpriseId = req.user.enterpriseId;
        } else {
          try {
            const ent = await enterpriseByUserCache.getOrFetch(`ent:${req.user.id}`, () => EnterpriseModel.findByUserId(req.user.id));
            if (ent) {
              req.enterpriseId = ent.id;
              req.user.enterpriseId = ent.id;
            }
          } catch (_) {
            /* 缺表等 */
          }
        }
      }
    }
    return next();
  } catch (_) {
    return next();
  }
}

// 权限检查中间件（免登录考试 guest 视为通过，具体接口内再校验 sessionId）
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.isGuest) return next();
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '未认证'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: '权限不足'
      });
    }

    next();
  };
}

// 管理员权限检查
function requireAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

module.exports = {
  generateToken,
  verifyToken,
  inferLoginPortal,
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireAdmin,
  JWT_SECRET,
  // P1: 缓存管理（登出/改密/改权限时调用）
  invalidateUserCache,
  userCache,
  permCache,
  enterpriseByUserCache
};
