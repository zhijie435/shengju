/**
 * 管理后台门户权限：存于 compat_admin_portal_permissions，无记录表示「未限制」= 全部权限（兼容旧部署）
 */
const { pool } = require('../config/database');

const PERMISSION_OPTIONS = [
  { key: 'dashboard', name: '数据概览' },
  { key: 'jobseekers', name: '求职者管理' },
  { key: 'enterprise', name: '企业端管理' },
  { key: 'talent-pool', name: '人才池管理' },
  { key: 'assessments', name: '测评管理' },
  { key: 'report-templates', name: '报告模板' },
  { key: 'settings', name: '系统设置' },
  { key: 'admins', name: '管理员账号' }
];

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_admin_portal_permissions (
      user_id INT NOT NULL PRIMARY KEY,
      permissions_json TEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableReady = true;
}

function parsePermsJson(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const j = JSON.parse(raw);
    if (j === '*') return ['*'];
    if (Array.isArray(j)) return j.map(String);
  } catch (_) {}
  return [];
}

/** @returns {Promise<string[]|null>} null = 未配置行，视为超级（全部） */
async function getPermissionsUserId(userId) {
  if (!userId) return [];
  await ensureTable();
  const [rows] = await pool.execute(
    'SELECT permissions_json FROM compat_admin_portal_permissions WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (!rows || !rows.length) return null;
  return parsePermsJson(rows[0].permissions_json);
}

/** null 或含 * 视为全权限 */
async function hasPermission(userId, key) {
  const perms = await getPermissionsUserId(userId);
  if (perms === null) return true;
  if (perms.includes('*')) return true;
  return perms.includes(String(key));
}

async function canManageAdminAccounts(userId) {
  return hasPermission(userId, 'admins');
}

async function setPermissionsUserId(userId, perms) {
  await ensureTable();
  const arr = Array.isArray(perms) ? perms.map(String) : [];
  const json = JSON.stringify(arr);
  await pool.execute(
    `INSERT INTO compat_admin_portal_permissions (user_id, permissions_json) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE permissions_json = VALUES(permissions_json), updated_at = CURRENT_TIMESTAMP`,
    [userId, json]
  );
}

function requireAdminPortalPermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (req.isGuest || !req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '需要管理员权限' });
      }
      const ok = await hasPermission(req.user.id, permissionKey);
      if (!ok) {
        return res.status(403).json({ success: false, message: '当前账号无权限执行此操作' });
      }
      next();
    } catch (e) {
      console.warn('[adminPortalPermissions] middleware:', e.message);
      return res.status(500).json({ success: false, message: '权限校验失败' });
    }
  };
}

module.exports = {
  PERMISSION_OPTIONS,
  ensureTable,
  getPermissionsUserId,
  hasPermission,
  canManageAdminAccounts,
  setPermissionsUserId,
  requireAdminPortalPermission
};
