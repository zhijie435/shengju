/**
 * 圣举 legacy 管理端 admin/index.html 依赖的 /admin/* 接口（挂在 /api/v1 与 /api 下）
 */
const express = require('express');
const router = express.Router();
const { pool, poolShengju, MAIN_DB_NAME, SHENGJU_DB_NAME } = require('../config/database');
const { getEnterpriseCompatDiag } = require('../utils/adminEnterpriseDiag');
const { authenticate, requireRole } = require('../middleware/auth');
const EnterpriseModel = require('../models/enterpriseModel');
const UserModel = require('../models/userModel');
const { tableExists, sqlIdent, getEnterpriseColumnMap } = require('../utils/enterpriseSchema');
const {
  PERMISSION_OPTIONS,
  getPermissionsUserId,
  canManageAdminAccounts,
  setPermissionsUserId
} = require('../utils/adminPortalPermissions');

const DEFAULT_NEW_ADMIN_PERMISSIONS = [
  'dashboard',
  'jobseekers',
  'enterprise',
  'talent-pool',
  'assessments',
  'report-templates',
  'settings'
];

const JOBSEEKER_ROLE_WHERE =
  "(role IN ('candidate','user') OR role IS NULL OR TRIM(COALESCE(role,'')) = '')";

/** 管理端「删除」求职者实为 status=inactive，列表与统计需排除，否则看起来像未删除 */
/** status 为 ENUM 列，mysql2 prepared statement 对 CAST(status AS CHAR) 会抛 "Incorrect arguments to mysqld_stmt_execute"，此处直接用 ENUM 值比较 */
const JOBSEEKER_NOT_DISABLED_SQL = ` AND (status IS NULL OR status <> 'inactive')`;

const JOBSEEKER_ACTIVE_WHERE = `${JOBSEEKER_ROLE_WHERE}${JOBSEEKER_NOT_DISABLED_SQL}`;

/** MySQL DATETIME / mysql2 Date 统一为本地可读时间，避免 String(date).split('T') 在非 ISO 下截断 */
function formatSqlDatetimeForAdmin(v, dateOnly) {
  if (v == null || v === '') return '-';
  let d;
  if (v instanceof Date) {
    d = v;
  } else {
    const s = String(v).trim();
    if (!s) return '-';
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s;
    d = new Date(normalized);
  }
  if (Number.isNaN(d.getTime())) return typeof v === 'string' && v.length ? v.slice(0, 32) : '-';
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (dateOnly) return datePart;
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildLastNMonthLabels(n) {
  const labels = [];
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    labels.push(`${m}月`);
    keys.push(`${y}-${m}`);
  }
  return { labels, keys };
}

/** 按自然月统计近 n 个月新增（与 labels 对齐） */
async function monthlyNewCountsFromUsers(nMonths) {
  const { labels, keys } = buildLastNMonthLabels(nMonths);
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  try {
    const [rows] = await pool.execute(
      `SELECT YEAR(created_at) AS y, MONTH(created_at) AS m, COUNT(*) AS c
       FROM qms_users
       WHERE (${JOBSEEKER_ACTIVE_WHERE})
         AND created_at IS NOT NULL
         AND created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ${nMonths - 1} MONTH)
       GROUP BY YEAR(created_at), MONTH(created_at)`
    );
    for (const r of rows || []) {
      const k = `${r.y}-${r.m}`;
      if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k] = Number(r.c) || 0;
    }
  } catch (e) {
    console.warn('[adminCompat] monthlyNewCountsFromUsers:', e.message);
  }
  return { labels, series: keys.map((k) => counts[k]) };
}

async function monthlyNewCountsFromEnterprises(nMonths) {
  const { labels, keys } = buildLastNMonthLabels(nMonths);
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  try {
    const [rows] = await pool.execute(
      `SELECT YEAR(created_at) AS y, MONTH(created_at) AS m, COUNT(*) AS c
       FROM enterprises
       WHERE created_at IS NOT NULL
         AND created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ${nMonths - 1} MONTH)
       GROUP BY YEAR(created_at), MONTH(created_at)`
    );
    for (const r of rows || []) {
      const k = `${r.y}-${r.m}`;
      if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k] = Number(r.c) || 0;
    }
  } catch (e) {
    console.warn('[adminCompat] monthlyNewCountsFromEnterprises:', e.message);
  }
  return { labels, series: keys.map((k) => counts[k]) };
}

function moduleUsagePercentages(primary) {
  const p = Array.isArray(primary) ? primary.map((x) => Number(x) || 0) : [0, 0, 0];
  const sum = p.reduce((a, b) => a + b, 0);
  if (sum <= 0) return p.map(() => 0);
  return p.map((x) => Math.round(((x / sum) * 100 + Number.EPSILON) * 10) / 10);
}

function safeInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** 同路径在 server.js 已显式注册（避免 Router 链未命中导致 404）；此处保留一份兼容直接挂载 adminCompat 的部署 */
router.get('/admin/diag/enterprise-compat', authenticate, requireRole('admin'), getEnterpriseCompatDiag);

/** 人才网库 enterprises 行 → 与 GET /admin/companies 一致的 DTO（列名各库可能不同） */
function mapShengjuRawEnterpriseToAdminDto(r) {
  if (!r || r.id == null) return null;
  const id = Number(r.id);
  const rawStatus = String(r.status ?? r.audit_state ?? r.audit_status ?? '').trim().toLowerCase();
  const name =
    r.name ||
    r.company_name ||
    r.enterprise_name ||
    r.org_name ||
    r.title ||
    '';
  return {
    id,
    name: (name != null && String(name).trim() !== '') ? String(name).trim() : `企业#${id}`,
    industry: String(r.industry ?? r.sector ?? r.business_type ?? '').trim(),
    city: String(r.city ?? r.address ?? r.region ?? r.district ?? '').trim(),
    contact: String(r.contact_name ?? r.contact ?? r.legal_person ?? r.liaison ?? '').trim(),
    phone: String(r.contact_phone ?? r.phone ?? r.mobile ?? r.tel ?? '').trim(),
    certification:
      rawStatus === 'pending'
        ? '待认证'
        : rawStatus === '' || rawStatus === 'approved' || rawStatus === 'active'
          ? '已认证'
          : '未认证',
    status:
      rawStatus === '' || rawStatus === 'approved' || rawStatus === 'active' ? '正常' : '禁用',
    freeMembership: false,
    registerDate: r.created_at
      ? String(r.created_at).split('T')[0]
      : r.create_time
        ? String(r.create_time).split('T')[0]
        : r.gmt_create
          ? String(r.gmt_create).split('T')[0]
          : ''
  };
}

router.get('/admin/statistics', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const data = {
      users: { total: 0 },
      enterprises: { total: 0, active: 0 },
      jobs: { total: 0 },
      assessments: { total: 0 },
      today: { newUsers: 0, newEnterprises: 0, newJobs: 0, newApplications: 0 },
      charts: {
        userGrowth: {
          labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
          jobseekers: [0, 0, 0, 0, 0, 0],
          enterprises: [0, 0, 0, 0, 0, 0]
        },
        moduleUsage: {
          labels: ['发布岗位', '候选人申请', '认证企业'],
          primary: [0, 0, 0],
          secondary: [0, 0, 0]
        }
      },
      notifications: { pendingEnterpriseVerifications: 0 }
    };

    try {
      const [[r]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM qms_users WHERE COALESCE(role,'') NOT IN ('admin','grader')
         AND COALESCE(LOWER(TRIM(CAST(status AS CHAR))), 'active') <> 'inactive'`
      );
      data.users.total = Number(r.c) || 0;
    } catch (e) {
      console.warn('[adminCompat] statistics users:', e.message);
    }

    try {
      const [[t]] = await pool.execute('SELECT COUNT(*) AS c FROM enterprises');
      data.enterprises.total = Number(t.c) || 0;
      const [[a]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM enterprises WHERE status = 'approved' OR status IS NULL OR TRIM(COALESCE(status,'')) = ''`
      );
      data.enterprises.active = Number(a.c) || 0;
    } catch (e) {
      console.warn('[adminCompat] statistics enterprises:', e.message);
    }

    if (await tableExists('compat_enterprise_jobs')) {
      try {
        const [[j]] = await pool.execute('SELECT COUNT(*) AS n FROM compat_enterprise_jobs');
        data.jobs.total = Number(j.n) || 0;
      } catch (e) {
        /* ignore */
      }
    }

    if (await tableExists('exam_sessions')) {
      try {
        const [[s]] = await pool.execute(
          `SELECT COUNT(*) AS n FROM exam_sessions WHERE status IN ('submitted','graded','ongoing')`
        );
        data.assessments.total = Number(s.n) || 0;
      } catch (e) {
        /* ignore */
      }
    }

    try {
      const [[p]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM enterprises WHERE LOWER(TRIM(COALESCE(status,''))) = 'pending'`
      );
      data.notifications.pendingEnterpriseVerifications = Number(p.c) || 0;
    } catch (e) {
      /* ignore */
    }

    try {
      const [[u]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM qms_users WHERE created_at IS NOT NULL AND DATE(created_at) = CURDATE()`
      );
      data.today.newUsers = Number(u.c) || 0;
    } catch (e) {
      /* 列不存在则跳过 */
    }

    try {
      const [[e]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM enterprises WHERE created_at IS NOT NULL AND DATE(created_at) = CURDATE()`
      );
      data.today.newEnterprises = Number(e.c) || 0;
    } catch (e) {
      /* ignore */
    }

    data.charts.moduleUsage.primary = [data.jobs.total, data.assessments.total, data.enterprises.active];
    data.charts.moduleUsage.secondary = moduleUsagePercentages(data.charts.moduleUsage.primary);

    try {
      const js = await monthlyNewCountsFromUsers(6);
      const es = await monthlyNewCountsFromEnterprises(6);
      data.charts.userGrowth.labels = js.labels;
      data.charts.userGrowth.jobseekers = js.series;
      data.charts.userGrowth.enterprises = es.series;
    } catch (e) {
      console.warn('[adminCompat] statistics userGrowth series:', e.message);
    }

    res.json({ success: true, data });
  } catch (e) {
    console.error('[adminCompat] GET /admin/statistics:', e);
    res.status(500).json({ success: false, message: e.message || '统计失败' });
  }
});

router.get('/admin/activities', authenticate, requireRole('admin'), async (req, res) => {
  const page = Math.max(1, safeInt(req.query.page, 1));
  const size = Math.min(50, Math.max(1, safeInt(req.query.size, 5)));
  const activities = [];
  const fmtTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '');
  try {
    let rows;
    try {
      [rows] = await pool.execute(
        `SELECT id, username, real_name, email, created_at, last_login_at FROM qms_users 
         WHERE COALESCE(role,'') NOT IN ('admin','grader')
           AND (created_at IS NOT NULL OR last_login_at IS NOT NULL)
         ORDER BY COALESCE(last_login_at, created_at) DESC LIMIT 30`
      );
    } catch (eCol) {
      if (!/last_login|Unknown column/i.test(String(eCol.message || ''))) throw eCol;
      [rows] = await pool.execute(
        `SELECT id, username, real_name, email, created_at FROM qms_users 
         WHERE COALESCE(role,'') NOT IN ('admin','grader') AND created_at IS NOT NULL
         ORDER BY created_at DESC LIMIT 30`
      );
    }
    for (const r of rows || []) {
      const dispName = r.real_name || r.username || r.id;
      const hasLogin =
        r.last_login_at != null && String(r.last_login_at).trim() !== '' && String(r.last_login_at) !== '0000-00-00 00:00:00';
      activities.push({
        id: `u_${r.id}`,
        type: hasLogin ? '用户登录' : '账号创建',
        typeColor: hasLogin ? 'green' : 'blue',
        typeIcon: hasLogin ? 'fa-sign-in-alt' : 'fa-user-clock',
        description: hasLogin
          ? `用户「${dispName}」登录系统`
          : `用户「${dispName}」账号创建于 ${fmtTime(r.created_at) || '-'}`,
        userName: dispName || '-',
        userEmail: r.email || '-',
        time: fmtTime(hasLogin ? r.last_login_at : r.created_at),
        link: '#',
        linkText: '查看'
      });
    }
  } catch (e) {
    console.warn('[adminCompat] activities users:', e.message);
  }
  try {
    await ensureCompatEnterpriseVerificationRequestsTable();
    const compatPendingWhere = `(
      NOT (
        LOWER(TRIM(COALESCE(CAST(r.status AS CHAR), ''))) IN (
          'approved','rejected','pass','deny','fail',
          '已通过','已拒绝','审核通过','未通过','不通过'
        )
      )
    )`;
    const [rCompat] = await pool.execute(
      `SELECT r.enterprise_id AS id, r.updated_at AS ent_time
       FROM compat_enterprise_verification_requests r
       WHERE ${compatPendingWhere}
       ORDER BY r.updated_at DESC LIMIT 15`
    );
    const ec = await getEnterpriseColumnMap();
    const namePart = ec.name ? `${sqlIdent(ec.name)} AS ent_display_name` : 'NULL AS ent_display_name';
    const ids = (rCompat || []).map((x) => Number(x.id)).filter((n) => Number.isFinite(n));
    const entById = new Map();
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      try {
        const [ents] = await pool.execute(
          `SELECT id, ${namePart} FROM enterprises WHERE id IN (${ph})`,
          ids
        );
        for (const e of ents || []) {
          entById.set(Number(e.id), e);
        }
      } catch (e2) {
        console.warn('[adminCompat] activities enterprise names:', e2.message);
      }
    }
    for (const row of rCompat || []) {
      const eid = Number(row.id);
      const er = entById.get(eid);
      const disp =
        er && er.ent_display_name != null && String(er.ent_display_name).trim() !== ''
          ? String(er.ent_display_name).trim()
          : `企业#${eid}`;
      activities.push({
        id: `e_${eid}`,
        type: '企业认证',
        typeColor: 'green',
        typeIcon: 'fa-building',
        description: `企业「${disp}」提交认证资料`,
        userName: disp || '-',
        userEmail: '-',
        time: fmtTime(row.ent_time),
        link: '#',
        linkText: '查看'
      });
    }
  } catch (e) {
    console.warn('[adminCompat] activities enterprises:', e.message);
  }

  activities.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const total = activities.length;
  const start = (page - 1) * size;
  const pageData = activities.slice(start, start + size);
  res.json({ success: true, data: pageData, total, page, size });
});

router.get('/admin/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const page = Math.max(1, safeInt(req.query.page, 1));
    const size = Math.min(100, Math.max(1, safeInt(req.query.size, 20)));
    const offset = (page - 1) * size;
    const keyword = (req.query.keyword || '').trim();
    const userType = (req.query.userType || '').trim();
    const statusQ = req.query.status;

    let where = `WHERE COALESCE(role,'') NOT IN ('admin','grader')`;
    const params = [];
    if (keyword) {
      where += ' AND (username LIKE ? OR email LIKE ? OR real_name LIKE ? OR phone LIKE ?)';
      const k = `%${keyword}%`;
      params.push(k, k, k, k);
    }
    if (userType === 'enterprise') {
      where += ` AND role = 'enterprise'`;
    } else if (userType === 'jobseeker' || userType === 'candidate') {
      where += ` AND (role IN ('candidate','user') OR role IS NULL OR role = '')`;
    }
    if (statusQ === '1') {
      where += ` AND (status = 'active' OR status = 1 OR status IS NULL)`;
    } else if (statusQ === '0') {
      where += ` AND status IS NOT NULL AND status NOT IN ('active',1,'1')`;
    }

    // 使用 pool.query（text protocol）避免 mysql2 binary protocol 处理 ENUM 列时抛 ER_WRONG_ARGUMENTS
    const [rows] = await pool.query(
      `SELECT id, username, real_name, email, phone, status, role, created_at FROM qms_users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );
    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS c FROM qms_users ${where}`, params);
    const total = Number(cnt.c) || 0;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const data = (rows || []).map((u) => ({
      id: u.id,
      name: u.real_name,
      username: u.username,
      email: u.email || '',
      phone: u.phone || '',
      registerDate: u.created_at ? String(u.created_at).split('T')[0] : '',
      createdAt: u.created_at,
      status:
        u.status === 'active' || u.status === 1 || u.status == null || u.status === ''
          ? 'active'
          : 'inactive'
    }));
    res.json({ success: true, data, total, totalPages });
  } catch (e) {
    console.error('[adminCompat] GET /admin/users:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.get('/admin/enterprises', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const ec = await getEnterpriseColumnMap();
    const userTbl = (await tableExists('qms_users')) ? 'qms_users' : 'users';
    const page = Math.max(1, safeInt(req.query.page, 1));
    const size = Math.min(100, Math.max(1, safeInt(req.query.size, 20)));
    const offset = (page - 1) * size;
    const keyword = (req.query.keyword || '').trim();
    const statusQ = req.query.status;

    const nameExpr = ec.name ? `e.${sqlIdent(ec.name)}` : `CAST(e.id AS CHAR)`;
    const phoneExpr = ec.phone ? `e.${sqlIdent(ec.phone)}` : 'NULL';
    const emailExpr = ec.email ? `e.${sqlIdent(ec.email)}` : 'NULL';
    const statusExpr = ec.status ? `e.${sqlIdent(ec.status)}` : 'NULL';

    let where = 'WHERE 1=1';
    const params = [];
    if (keyword) {
      const k = `%${keyword}%`;
      const ors = [];
      if (ec.name) {
        ors.push(`e.${sqlIdent(ec.name)} LIKE ?`);
        params.push(k);
      }
      if (ec.phone) {
        ors.push(`e.${sqlIdent(ec.phone)} LIKE ?`);
        params.push(k);
      }
      if (ec.email) {
        ors.push(`e.${sqlIdent(ec.email)} LIKE ?`);
        params.push(k);
      }
      ors.push('u.username LIKE ?');
      params.push(k);
      where += ` AND (${ors.join(' OR ')})`;
    }
    if (statusQ === '1') {
      where += ec.status
        ? ` AND (e.${sqlIdent(ec.status)} = 'approved' OR e.${sqlIdent(ec.status)} IS NULL OR TRIM(COALESCE(e.${sqlIdent(ec.status)},'')) = '')`
        : ' AND 1=1';
    } else if (statusQ === '0') {
      where += ec.status
        ? ` AND e.${sqlIdent(ec.status)} IS NOT NULL AND e.${sqlIdent(ec.status)} NOT IN ('approved') AND TRIM(e.${sqlIdent(ec.status)}) <> ''`
        : ' AND 1=0';
    }

    const sqlList = `SELECT e.id, ${nameExpr} AS ent_name, ${phoneExpr} AS ent_phone, ${emailExpr} AS ent_email, ${statusExpr} AS ent_status, u.username
      FROM enterprises e LEFT JOIN ${userTbl} u ON e.user_id = u.id ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`;
    const sqlCount = `SELECT COUNT(*) AS c FROM enterprises e LEFT JOIN ${userTbl} u ON e.user_id = u.id ${where}`;

    // 使用 pool.query（text protocol）避免 mysql2 binary protocol 处理 ENUM 列时抛 ER_WRONG_ARGUMENTS
    const [rows] = await pool.query(sqlList, [...params, size, offset]);
    const [[cnt]] = await pool.query(sqlCount, params);
    const total = Number(cnt.c) || 0;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const data = (rows || []).map((row) => ({
      id: row.id,
      companyName: row.ent_name != null && String(row.ent_name).trim() !== '' ? String(row.ent_name) : `企业#${row.id}`,
      industry: null,
      scale: null,
      username: row.username || '-',
      phone: row.ent_phone != null ? String(row.ent_phone) : '-',
      status: row.ent_status === 'approved' || !row.ent_status || String(row.ent_status).trim() === '' ? 'active' : 'inactive'
    }));
    res.json({ success: true, data, total, totalPages });
  } catch (e) {
    console.error('[adminCompat] GET /admin/enterprises:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.get('/admin/assessments', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await tableExists('exam_sessions'))) {
      return res.json({ success: true, data: [], total: 0, totalPages: 1 });
    }
    const page = Math.max(1, safeInt(req.query.page, 1));
    const size = Math.min(100, Math.max(1, safeInt(req.query.size, 20)));
    const offset = (page - 1) * size;

    // 使用 pool.query（text protocol）避免 mysql2 binary protocol 处理 exam_sessions.status ENUM 列时抛 ER_WRONG_ARGUMENTS
    const [rows] = await pool.query(
      `SELECT s.id, s.exam_id, s.user_id, s.submitted_at, s.status AS session_status,
              e.name AS exam_name, ent.name AS ent_name,
              u.real_name AS user_real, u.username AS user_name
       FROM exam_sessions s
       LEFT JOIN exams e ON e.id = s.exam_id
       LEFT JOIN enterprises ent ON ent.id = e.enterprise_id
       LEFT JOIN qms_users u ON u.id = s.user_id
       WHERE s.status = 'submitted'
       ORDER BY s.submitted_at DESC
       LIMIT ? OFFSET ?`,
      [size, offset]
    );
    const [[cnt]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM exam_sessions WHERE status = 'submitted'`
    );
    const total = Number(cnt.c) || 0;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const data = (rows || []).map((r) => ({
      id: r.id,
      packageName: r.exam_name || '考试记录',
      username: r.user_real || r.user_name || '-',
      companyName: r.ent_name || '-',
      score: 0,
      totalScore: 100,
      completedAt: r.submitted_at
    }));
    res.json({ success: true, data, total, totalPages });
  } catch (e) {
    console.warn('[adminCompat] GET /admin/assessments:', e.message);
    res.json({ success: true, data: [], total: 0, totalPages: 1 });
  }
});

router.get('/admin/notifications', authenticate, requireRole('admin'), async (req, res) => {
  res.json({ success: true, data: { items: [], unreadCount: 0 } });
});

router.put('/admin/notifications/:id/read', authenticate, requireRole('admin'), async (req, res) => {
  res.json({ success: true });
});

router.put('/admin/notifications/read-all', authenticate, requireRole('admin'), async (req, res) => {
  res.json({ success: true });
});

async function ensureCompatEnterpriseVerificationRequestsTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_verification_requests (
      enterprise_id INT PRIMARY KEY,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      payload JSON NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业端提交认证材料，管理端待审'
  `);
}

router.get('/admin/verifications', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatEnterpriseVerificationRequestsTable();
    const ec = await getEnterpriseColumnMap();
    const nameCol = ec.name ? sqlIdent(ec.name) : null;
    const timeCol = ec.updated || ec.created;
    /** 主状态列：待审常见取值 */
    const broadMainPending = ec.status
      ? (() => {
          const c = `LOWER(TRIM(COALESCE(CAST(e.${sqlIdent(ec.status)} AS CHAR), '')))`;
          return `${c} IN (
            'pending','review','submitted','auditing','wait','waiting','0',
            '待审核','待认证','审核中'
          )`;
        })()
      : '1=0';
    const broadVsPending = ec.verificationStatus
      ? (() => {
          const c = `LOWER(TRIM(COALESCE(CAST(e.${sqlIdent(ec.verificationStatus)} AS CHAR), '')))`;
          return `${c} IN (
            'pending','review','submitted','auditing','0',
            '待审核','待认证','审核中'
          )`;
        })()
      : '1=0';

    const mapVerificationRow = (row) => {
      let industryType = '';
      let contactPerson = '';
      try {
        let p = row.verificationPayload;
        if (p && typeof p === 'string') p = JSON.parse(p);
        if (p && typeof p === 'object') {
          industryType = p.industryType || p.industry_type || '';
        }
      } catch (e) {
        /* ignore */
      }
      const { verificationPayload, ...rest } = row;
      return { ...rest, industryType, contactPerson };
    };

    /**
     * 待审：排除「已通过/已拒绝」即可（比白名单 IN 更稳，避免库里状态写法不在列表里时整表被滤空）
     * CAST 避免 status 类型异常导致 LOWER 比较失败
     */
    const compatPendingWhere = `(
      NOT (
        LOWER(TRIM(COALESCE(CAST(r.status AS CHAR), ''))) IN (
          'approved','rejected','pass','deny','fail',
          '已通过','已拒绝','审核通过','未通过','不通过'
        )
      )
    )`;
    /** 兼容表里已是终态的企业：不得再仅靠 enterprises 表「仍像待审」而出现在 fromEnt（避免已通过仍出现在待审） */
    const compatTerminalInList = `LOWER(TRIM(COALESCE(CAST(status AS CHAR), ''))) IN (
      'approved','rejected','pass','deny','fail',
      '已通过','已拒绝','审核通过','未通过','不通过'
    )`;
    const excludeCompatTerminalSubquery = `e.id NOT IN (
      SELECT enterprise_id FROM compat_enterprise_verification_requests WHERE ${compatTerminalInList}
    )`;
    const excludeVsTerminal = ec.verificationStatus
      ? `AND NOT (
      LOWER(TRIM(COALESCE(CAST(e.${sqlIdent(ec.verificationStatus)} AS CHAR), ''))) IN (
        'approved','rejected','pass','deny','fail',
        '已通过','已拒绝','审核通过','未通过','不通过'
      )
    )`
      : '';

    /** 1) 以兼容表为主：合并主库 + 人才网库中的 compat_enterprise_verification_requests */
    const [compatRowsMain] = await pool.execute(
      `SELECT r.enterprise_id AS id,
              r.payload AS verificationPayload,
              r.updated_at AS verificationSubmittedAt,
              'pending' AS status
       FROM compat_enterprise_verification_requests r
       WHERE ${compatPendingWhere}
       ORDER BY r.updated_at DESC
       LIMIT 200`
    );
    let compatRows = [...(compatRowsMain || [])];
    if (poolShengju) {
      try {
        const [compatRowsSj] = await poolShengju.execute(
          `SELECT r.enterprise_id AS id,
                  r.payload AS verificationPayload,
                  r.updated_at AS verificationSubmittedAt,
                  'pending' AS status
           FROM compat_enterprise_verification_requests r
           WHERE ${compatPendingWhere}
           ORDER BY r.updated_at DESC
           LIMIT 200`
        );
        const seen = new Set(compatRows.map((x) => Number(x.id)));
        for (const row of compatRowsSj || []) {
          const eid = Number(row.id);
          if (!seen.has(eid)) {
            compatRows.push(row);
            seen.add(eid);
          }
        }
      } catch (eSj) {
        console.warn('[adminCompat] verifications compat shengju:', eSj.message);
      }
    }
    compatRows.sort(
      (a, b) => new Date(b.verificationSubmittedAt || 0) - new Date(a.verificationSubmittedAt || 0)
    );
    compatRows = compatRows.slice(0, 200);
    const compatIds = new Set((compatRows || []).map((x) => Number(x.id)));

    /** 批量补企业名称、提交时间（主库 + 人才网库） */
    let entById = new Map();
    if (compatIds.size && nameCol) {
      const ids = [...compatIds].filter((n) => Number.isFinite(n));
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        const timeSelect = timeCol ? `, e.${sqlIdent(timeCol)} AS ent_time` : '';
        try {
          const [ents] = await pool.execute(
            `SELECT e.id, e.${nameCol} AS ent_name${timeSelect} FROM enterprises e WHERE e.id IN (${ph})`,
            ids
          );
          for (const er of ents || []) {
            entById.set(Number(er.id), er);
          }
        } catch (e2) {
          console.warn('[adminCompat] verifications enterprise lookup:', e2.message);
        }
      }
    }
    const missingNameIds = [...compatIds].filter((id) => Number.isFinite(id) && !entById.has(id));
    if (missingNameIds.length && poolShengju) {
      const ph2 = missingNameIds.map(() => '?').join(',');
      try {
        const [shent] = await poolShengju.query(
          `SELECT id, name, company_name, updated_at, created_at FROM enterprises WHERE id IN (${ph2})`,
          missingNameIds
        );
        for (const er of shent || []) {
          const nm = er.name || er.company_name;
          if (nm != null && String(nm).trim() !== '') {
            entById.set(Number(er.id), {
              id: er.id,
              ent_name: String(nm).trim(),
              ent_time: er.updated_at || er.created_at
            });
          }
        }
      } catch (e3) {
        console.warn('[adminCompat] verifications shengju enterprise names:', e3.message);
      }
    }

    const fromCompat = (compatRows || []).map((r) => {
      const id = Number(r.id);
      const ent = entById.get(id);
      const submitted = r.verificationSubmittedAt || (ent && ent.ent_time) || null;
      let companyName =
        ent && ent.ent_name != null && String(ent.ent_name).trim() !== ''
          ? String(ent.ent_name)
          : `企业#${id}`;
      return mapVerificationRow({
        id,
        companyName,
        verificationSubmittedAt: submitted,
        status: 'pending',
        verificationPayload: r.verificationPayload
      });
    });

    /** 2) enterprises 表待审、但兼容表尚无记录（如新注册 pending）；已在兼容表出现过的 id 不再重复 */
    let fromEnt = [];
    if (ec.status || ec.verificationStatus) {
      /* nameCol 已是 sqlIdent(ec.name)（含反引号），勿再套一层 sqlIdent，否则会报「非法列名」 */
      const nameExpr = nameCol ? `e.${nameCol}` : 'CAST(e.id AS CHAR)';
      const updatedExpr = ec.updated
        ? `e.${sqlIdent(ec.updated)}`
        : ec.created
          ? `e.${sqlIdent(ec.created)}`
          : 'NULL';
      const where = `(${broadMainPending}) OR (${broadVsPending})`;
      const entExtraWhere = ` AND ${excludeCompatTerminalSubquery} ${excludeVsTerminal}`;
      try {
        let erows;
        if (compatIds.size > 0) {
          const idArr = [...compatIds];
          const ph = idArr.map(() => '?').join(',');
          [erows] = await pool.execute(
            `SELECT e.id,
                    ${nameExpr} AS companyName,
                    ${updatedExpr} AS verificationSubmittedAt,
                    'pending' AS status,
                    NULL AS verificationPayload
             FROM enterprises e
             WHERE (${where}) AND e.id NOT IN (${ph})${entExtraWhere}
             ORDER BY e.id DESC
             LIMIT 200`,
            idArr
          );
        } else {
          [erows] = await pool.execute(
            `SELECT e.id,
                    ${nameExpr} AS companyName,
                    ${updatedExpr} AS verificationSubmittedAt,
                    'pending' AS status,
                    NULL AS verificationPayload
             FROM enterprises e
             WHERE ${where}${entExtraWhere}
             ORDER BY e.id DESC
             LIMIT 200`
          );
        }
        fromEnt = (erows || []).map(mapVerificationRow);
      } catch (e3) {
        console.warn('[adminCompat] verifications enterprises pending:', e3.message);
      }
    }

    const merged = [...fromCompat, ...fromEnt];
    merged.sort((a, b) => Number(b.id) - Number(a.id));

    let rawCompatTableCount = null;
    try {
      const [[cntRow]] = await pool.query(
        'SELECT COUNT(*) AS c FROM compat_enterprise_verification_requests'
      );
      rawCompatTableCount = Number(cntRow?.c) || 0;
      if (merged.length === 0 && rawCompatTableCount > 0) {
        console.warn(
          '[adminCompat] verifications: compat 表有',
          rawCompatTableCount,
          '条但合并后为 0，请核对 status / enterprises 映射'
        );
      }
    } catch (cntErr) {
      console.warn('[adminCompat] verifications raw count:', cntErr.message);
    }

    const payload = { success: true, data: merged.slice(0, 200) };
    if (rawCompatTableCount != null) {
      payload.meta = { rawCompatTableCount, returned: payload.data.length };
    }
    res.json(payload);
  } catch (e) {
    console.error('[adminCompat] GET /admin/verifications:', e.message, e.stack);
    return res.status(500).json({
      success: false,
      message: e.message || '查询认证列表失败',
      data: [],
    });
  }
});

router.put('/admin/verifications/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: '无效的企业 ID' });
    }
    try {
      await ensureCompatEnterpriseVerificationRequestsTable();
      await pool.execute(
        `UPDATE compat_enterprise_verification_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE enterprise_id = ?`,
        [id]
      );
    } catch (e) {
      /* ignore */
    }
    if (poolShengju) {
      try {
        await poolShengju.execute(
          `UPDATE compat_enterprise_verification_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE enterprise_id = ?`,
          [id]
        );
      } catch (e) {
        /* ignore */
      }
      try {
        await poolShengju.execute('UPDATE enterprises SET verification_status = ? WHERE id = ?', ['approved', id]);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      await pool.execute('UPDATE enterprises SET verification_status = ? WHERE id = ?', ['approved', id]);
    } catch (e) {
      /* 列不存在 */
    }
    await EnterpriseModel.update(id, { status: 'approved' });
    res.json({ success: true, message: '已通过' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '操作失败' });
  }
});

router.put('/admin/verifications/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: '无效的企业 ID' });
    }
    try {
      await ensureCompatEnterpriseVerificationRequestsTable();
      await pool.execute(
        `UPDATE compat_enterprise_verification_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE enterprise_id = ?`,
        [id]
      );
    } catch (e) {
      /* ignore */
    }
    if (poolShengju) {
      try {
        await poolShengju.execute(
          `UPDATE compat_enterprise_verification_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE enterprise_id = ?`,
          [id]
        );
      } catch (e) {
        /* ignore */
      }
      try {
        await poolShengju.execute('UPDATE enterprises SET verification_status = ? WHERE id = ?', ['rejected', id]);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      await pool.execute('UPDATE enterprises SET verification_status = ? WHERE id = ?', ['rejected', id]);
    } catch (e) {
      /* 列不存在 */
    }
    await EnterpriseModel.update(id, { status: 'rejected' });
    res.json({ success: true, message: '已拒绝' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '操作失败' });
  }
});

router.get('/admin/jobseekers/statistics', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const whereActive = `WHERE ${JOBSEEKER_ACTIVE_WHERE}`;
    const [[t]] = await pool.execute(`SELECT COUNT(*) AS c FROM qms_users ${whereActive}`);
    const total = Number(t.c) || 0;
    let active = 0;
    try {
      const [[a]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM qms_users ${whereActive} AND last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );
      active = Number(a.c) || 0;
    } catch (e) {
      /* last_login_at 可能不存在 */
    }
    let todayNew = 0;
    try {
      const [[d]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM qms_users ${whereActive} AND created_at IS NOT NULL AND DATE(created_at) = CURDATE()`
      );
      todayNew = Number(d.c) || 0;
    } catch (e) {
      /* ignore */
    }
    let growthLabels = ['1月', '2月', '3月', '4月', '5月', '6月'];
    let growthJobseekers = [0, 0, 0, 0, 0, 0];
    let growthMembers = [0, 0, 0, 0, 0, 0];
    try {
      const mg = await monthlyNewCountsFromUsers(6);
      growthLabels = mg.labels;
      growthJobseekers = mg.series;
    } catch (e) {
      /* ignore */
    }
    res.json({
      success: true,
      data: {
        cards: {
          totalJobseekers: total,
          activeJobseekers: active,
          totalMembers: 0,
          todayNew
        },
        charts: {
          growth: {
            labels: growthLabels,
            jobseekers: growthJobseekers,
            members: growthMembers
          },
          memberDistribution: {
            labels: ['非会员', '普通', '高级', '尊享'],
            data: [total, 0, 0, 0]
          }
        }
      }
    });
  } catch (e) {
    console.error('[adminCompat] jobseekers/statistics:', e);
    res.status(500).json({ success: false, message: e.message || '统计失败' });
  }
});

router.get('/admin/jobseekers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const page = Math.max(1, safeInt(req.query.page, 1));
    const size = Math.min(100, Math.max(1, safeInt(req.query.size, 10)));
    const offset = (page - 1) * size;
    const keyword = (req.query.keyword || '').trim();
    let where = `WHERE ${JOBSEEKER_ACTIVE_WHERE}`;
    const params = [];
    if (keyword) {
      where += ' AND (username LIKE ? OR email LIKE ? OR real_name LIKE ? OR phone LIKE ?)';
      const k = `%${keyword}%`;
      params.push(k, k, k, k);
    }
    // 使用 pool.query（text protocol）而非 pool.execute（binary protocol），避免 mysql2 binary protocol 处理 ENUM 列时抛出 ER_WRONG_ARGUMENTS
    const [rows] = await pool.query(
      `SELECT id, username, real_name, email, phone, status, created_at, last_login_at FROM qms_users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );
    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS c FROM qms_users ${where}`, params);
    const data = (rows || []).map((r) => ({
      id: r.id,
      name: r.real_name || r.username || String(r.id),
      email: r.email || '',
      phone: r.phone != null && String(r.phone).trim() !== '' ? String(r.phone).trim() : '—',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(r.real_name || r.username || 'U')}&background=4F46E5&color=fff`,
      memberType: 'none',
      registerDate: r.created_at ? formatSqlDatetimeForAdmin(r.created_at, true) : '-',
      lastLogin: r.last_login_at ? formatSqlDatetimeForAdmin(r.last_login_at, false) : '-',
      status:
        r.status === 'active' || r.status === 1 || r.status == null || r.status === ''
          ? 'active'
          : 'inactive'
    }));
    res.json({ success: true, data, total: Number(cnt.c) || 0, page });
  } catch (e) {
    console.error('[adminCompat] GET /admin/jobseekers:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.put('/admin/jobseekers/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: '无效的用户 ID' });
    }
    const b = req.body || {};
    const updates = [];
    const vals = [];
    if (b.name !== undefined) {
      updates.push('real_name = ?');
      vals.push(b.name);
    }
    if (b.email !== undefined) {
      updates.push('email = ?');
      vals.push(b.email);
    }
    if (b.phone !== undefined) {
      updates.push('phone = ?');
      vals.push(b.phone);
    }
    if (b.status !== undefined) {
      updates.push('status = ?');
      vals.push(b.status);
    }
    if (!updates.length) {
      return res.json({ success: true, message: '无变更' });
    }
    vals.push(id);
    await pool.execute(`UPDATE qms_users SET ${updates.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
});

router.delete('/admin/jobseekers/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: '无效的用户 ID' });
    }
    await UserModel.updateStatus(id, 'inactive');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '操作失败' });
  }
});

// ==================== 企业状况（companies）兼容接口 ====================
// enterprise-management.html 依赖 /admin/companies 与 PATCH /admin/companies/:id
async function ensureCompatAdminCompaniesTable() {
  // enterprises 表可能没有 free_membership 字段；为兼容“免付费会员”开关，单独建映射表
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_admin_company_settings (
      enterprise_id INT PRIMARY KEY,
      free_membership TINYINT(1) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理端企业扩展配置（兼容 legacy /admin/companies）'
  `);
}

/** 与「动态补 enterprises」逻辑同版本，便于在接口 meta 或日志中确认是否已部署本文件 */
const COMPANIES_BACKFILL_BUILD_ID = 'insertSingleEnterpriseRow-20260403d';

/** 解析 MySQL SHOW COLUMNS 中的 enum('a','b') */
function parseMysqlEnumValues(typeStr) {
  const m = /^enum\s*\((.+)\)\s*$/i.exec(String(typeStr || '').trim());
  if (!m) return null;
  const inner = m[1];
  const out = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== "'") continue;
    let j = i + 1;
    let buf = '';
    while (j < inner.length) {
      if (inner[j] === '\\' && j + 1 < inner.length) {
        buf += inner[j + 1];
        j += 2;
        continue;
      }
      if (inner[j] === "'") {
        out.push(buf);
        i = j;
        break;
      }
      buf += inner[j];
      j++;
    }
  }
  return out.length ? out : null;
}

function pickEnterpriseNameColumnField(fields) {
  const order = [
    'name',
    'company_name',
    'enterprise_name',
    'org_name',
    'title',
    'firm_name',
    'ent_name',
    'corp_name',
    'qymc',
    'companyname'
  ];
  for (const c of order) {
    if (fields[c]) return c;
  }
  return null;
}

function pickEnterpriseUserIdColumnField(fields) {
  for (const c of ['user_id', 'owner_id', 'admin_user_id', 'uid', 'account_id']) {
    if (fields[c]) return c;
  }
  return null;
}

function firstEnumOrEmpty(meta) {
  const en = parseMysqlEnumValues(meta.type);
  if (en && en.length) return en[0];
  return '';
}

/** 根据列类型生成 INSERT 可用的 status（整型列勿写字符串 'pending'） */
function inferEnterpriseStatusInsertValue(statusCol) {
  if (!statusCol) return 'pending';
  const typeStr = String(statusCol.type || '');
  const t = typeStr.toLowerCase();
  const en = parseMysqlEnumValues(typeStr);
  if (en && en.length) {
    const lower = en.map((x) => String(x).toLowerCase());
    const pref = ['pending', 'approved', 'active', 'draft', 'normal', 'enabled', '1', '0', 'yes', 'no'];
    for (const p of pref) {
      const i = lower.indexOf(p);
      if (i >= 0) return en[i];
    }
    return en[0];
  }
  if (/\b(tinyint|smallint|mediumint|bigint|int)\b/.test(t) || t.startsWith('bit')) {
    if (statusCol.defaultVal != null && statusCol.defaultVal !== '') {
      const n = Number(statusCol.defaultVal);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }
  return 'pending';
}

async function nextExplicitEnterpriseId() {
  try {
    const [[r]] = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM enterprises');
    return r && r.n != null ? Number(r.n) : 1;
  } catch (e) {
    console.warn('[adminCompat] nextExplicitEnterpriseId:', e.message);
    return 1;
  }
}

/** 读 enterprises 表结构，生成合法的 status 字面量并识别 NOT NULL 列（避免 ENUM / user_id NOT NULL 导致 INSERT 全失败） */
async function getEnterpriseInsertSpec() {
  const [rows] = await pool.query('SHOW COLUMNS FROM enterprises');
  const fields = {};
  for (const r of rows || []) {
    fields[r.Field] = {
      nullOk: r.Null === 'YES',
      defaultVal: r.Default,
      type: r.Type || '',
      extra: String(r.Extra || '')
    };
  }
  const statusValue = inferEnterpriseStatusInsertValue(fields.status);
  return {
    fields,
    statusValue,
    nameField: pickEnterpriseNameColumnField(fields),
    userIdField: pickEnterpriseUserIdColumnField(fields)
  };
}

/**
 * 为指定 enterprise_id 找可写入 enterprises.user_id 的值：优先项目发布人，其次尚未绑定企业的 qms 企业账号。
 */
async function findUserIdForEnterpriseStub(enterpriseId, userIdColumn) {
  const eid = Number(enterpriseId);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  if (!userIdColumn) {
    console.warn('[adminCompat] findUserIdForEnterpriseStub: enterprises 表未识别到 user_id/owner_id 列，无法做 qms 关联');
    return null;
  }
  const uidIdent = sqlIdent(userIdColumn);
  try {
    if (await tableExists('compat_enterprise_projects')) {
      const [[r]] = await pool.query(
        'SELECT user_id FROM compat_enterprise_projects WHERE enterprise_id = ? AND user_id IS NOT NULL LIMIT 1',
        [eid]
      );
      if (r && r.user_id != null) return Number(r.user_id);
    }
  } catch (e) {
    console.warn('[adminCompat] findUserIdForEnterpriseStub project:', e.message);
  }
  try {
    if (await tableExists('qms_users')) {
      const [urs] = await pool.query(
        `SELECT u.id FROM qms_users u
         WHERE (
            LOWER(TRIM(COALESCE(u.role, ''))) IN ('enterprise', 'company', 'ent', 'employer', 'hr')
            OR TRIM(COALESCE(u.role, '')) IN ('企业', '企业用户', '政企', '企业账号')
          )
          AND NOT EXISTS (SELECT 1 FROM enterprises e WHERE e.${uidIdent} = u.id)
         ORDER BY u.id ASC LIMIT 1`
      );
      if (urs && urs[0] && urs[0].id != null) return Number(urs[0].id);
    }
  } catch (e) {
    console.warn('[adminCompat] findUserIdForEnterpriseStub qms:', e.message);
  }
  return null;
}

function pushBackfillDiag(diag, entry) {
  if (!diag || !diag.errors || !entry) return;
  diag.errors.push(entry);
  if (diag.errors.length > 20) diag.errors.shift();
}

/**
 * 仅写 id + 名称列 + user 列 + status，避免其它 NOT NULL/外键列被误填 0 导致整段失败。
 */
async function tryInsertEnterpriseMinimal(spec, { id, entName, userId }) {
  const f = spec.fields;
  const nameField = spec.nameField;
  const userIdField = spec.userIdField;
  const cols = [];
  const vals = [];
  if (id != null && Number.isFinite(Number(id)) && f.id) {
    cols.push(sqlIdent('id'));
    vals.push(Number(id));
  }
  if (nameField && f[nameField]) {
    cols.push(sqlIdent(nameField));
    vals.push(entName);
  }
  if (userIdField && f[userIdField] && userId != null && Number.isFinite(Number(userId))) {
    cols.push(sqlIdent(userIdField));
    vals.push(Number(userId));
  }
  if (f.status) {
    cols.push(sqlIdent('status'));
    vals.push(spec.statusValue);
  }
  if (!cols.length) return { ok: false, err: 'minimal: no columns', sql: '', vals: [] };
  const sql = `INSERT INTO enterprises (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  try {
    await pool.execute(sql, vals);
    return { ok: true, sql, vals };
  } catch (e) {
    return { ok: false, err: e.message, code: e.code, sql, vals };
  }
}

/**
 * 按当前表结构插入一行 enterprises；显式 id 用于兼容表里的 enterprise_id，省略 id 则用自增。
 */
async function insertSingleEnterpriseRow(spec, { id, name, userId }, diag) {
  const f = spec.fields;
  const nameField = spec.nameField;
  if (!nameField || !f[nameField]) {
    const msg = 'enterprises 表无名称列';
    console.warn('[adminCompat] insertSingleEnterpriseRow:', msg);
    pushBackfillDiag(diag, { step: 'precheck', enterpriseId: id != null ? id : null, message: msg });
    return false;
  }
  const userIdField = spec.userIdField;
  const entName = (name && String(name).trim()) || (id != null ? `企业#${id}` : '未命名企业');

  const idMeta = f.id;
  const idIsAuto =
    idMeta && String(idMeta.extra || '').toLowerCase().includes('auto_increment');
  let insertId = id != null && Number.isFinite(Number(id)) ? Number(id) : null;
  if (insertId == null && f.id && !idIsAuto) {
    insertId = await nextExplicitEnterpriseId();
  }

  /** 先尝试最小列集（规避 talent_company_id 等外键被填 0） */
  const minTry = await tryInsertEnterpriseMinimal(spec, { id: insertId, entName, userId });
  if (minTry.ok) {
    console.warn(
      '[adminCompat] insertSingleEnterpriseRow OK(minimal)',
      COMPANIES_BACKFILL_BUILD_ID,
      'id=' + (insertId != null ? insertId : idIsAuto ? 'AUTO' : '—'),
      'userId=' + (userId != null ? userId : '—')
    );
    return true;
  }
  pushBackfillDiag(diag, {
    step: 'minimal',
    enterpriseId: id != null ? id : insertId,
    userId: userId != null ? userId : null,
    message: minTry.err || 'fail',
    code: minTry.code,
    sql: minTry.sql
  });

  const values = {};
  if (insertId != null && Number.isFinite(Number(insertId)) && f.id) {
    values.id = Number(insertId);
  }
  values[nameField] = entName;
  if (userIdField && f[userIdField]) {
    const uMeta = f[userIdField];
    const hasNoDefault = uMeta.defaultVal == null || uMeta.defaultVal === undefined;
    if (!uMeta.nullOk && hasNoDefault) {
      if (userId == null || !Number.isFinite(Number(userId))) {
        const msg = `缺少必填 ${userIdField} 且未解析到 userId（minimal 也已失败：${minTry.err || ''}）`;
        console.warn('[adminCompat] insertSingleEnterpriseRow:', msg);
        pushBackfillDiag(diag, { step: 'userId', enterpriseId: id != null ? id : insertId, message: msg });
        return false;
      }
      values[userIdField] = Number(userId);
    } else if (userId != null && Number.isFinite(Number(userId))) {
      values[userIdField] = Number(userId);
    }
  }
  if (f.status) values.status = spec.statusValue;
  if (f.contact_name) values.contact_name = entName;
  if (f.contact_phone) values.contact_phone = '';
  if (f.contact_email) values.contact_email = '';
  if (f.address) values.address = '';

  for (const colName of Object.keys(f)) {
    const meta = f[colName];
    if (values[colName] !== undefined) continue;
    const ex = String(meta.extra || '').toLowerCase();
    if (ex.includes('auto_increment')) continue;
    if (meta.nullOk) continue;
    if (meta.defaultVal != null && meta.defaultVal !== undefined) continue;
    if (colName === 'id' && idIsAuto && values.id === undefined) continue;
    /** 外键类 *_id 勿自动填 0，交给 DB 默认值或触发最小路径已试 */
    if (/_id$/i.test(colName) && colName !== 'id' && colName !== userIdField) {
      continue;
    }
    const t = String(meta.type || '').toLowerCase();
    if (t.startsWith('enum(')) {
      values[colName] = firstEnumOrEmpty(meta);
    } else if (t.indexOf('json') >= 0) {
      values[colName] = '{}';
    } else if (t.indexOf('int') >= 0 || t.indexOf('decimal') >= 0 || t.indexOf('float') >= 0) {
      values[colName] = 0;
    } else if (t.indexOf('date') >= 0 || t.indexOf('time') >= 0) {
      values[colName] = new Date();
    } else {
      values[colName] = '';
    }
  }

  const cols = Object.keys(values).filter((k) => f[k]);
  if (!cols.length) {
    console.warn('[adminCompat] insertSingleEnterpriseRow: 无有效列可写入', { tried: Object.keys(values), nameField });
    pushBackfillDiag(diag, { step: 'full', enterpriseId: id != null ? id : insertId, message: 'no columns after build' });
    return false;
  }
  const placeholders = cols.map(() => '?').join(', ');
  const ident = cols.map((c) => sqlIdent(c));
  const vals = cols.map((k) => values[k]);
  const sql = `INSERT INTO enterprises (${ident.join(', ')}) VALUES (${placeholders})`;
  try {
    await pool.execute(sql, vals);
    console.warn(
      '[adminCompat] insertSingleEnterpriseRow OK(full)',
      COMPANIES_BACKFILL_BUILD_ID,
      'id=' + (values.id != null ? values.id : idIsAuto ? 'AUTO' : '—'),
      'userId=' + (spec.userIdField && values[spec.userIdField] != null ? values[spec.userIdField] : '—')
    );
    return true;
  } catch (e) {
    console.warn('[adminCompat] insertSingleEnterpriseRow FAIL(full)', COMPANIES_BACKFILL_BUILD_ID, e.message);
    console.warn('[adminCompat] insertSingleEnterpriseRow SQL', sql, vals);
    pushBackfillDiag(diag, { step: 'full', enterpriseId: id != null ? id : insertId, message: e.message, code: e.code, sql });
    return false;
  }
}

/**
 * 认证材料 / 项目表中的 enterprise_id 补建主表行（逐条 INSERT，适配 ENUM、NOT NULL、显式主键 id）。
 */
async function ensureEnterpriseRowsFromCompatReferencedIds(spec, diag) {
  if (!(await tableExists('enterprises'))) return 0;
  const eidSet = new Set();
  try {
    if (await tableExists('compat_enterprise_verification_requests')) {
      const [r1] = await pool.query(
        'SELECT DISTINCT enterprise_id AS eid FROM compat_enterprise_verification_requests WHERE enterprise_id IS NOT NULL AND enterprise_id > 0'
      );
      for (const r of r1 || []) if (r.eid != null) eidSet.add(Number(r.eid));
    }
  } catch (e) {
    console.warn('[adminCompat] compat verification ids:', e.message);
  }
  try {
    if (await tableExists('compat_enterprise_projects')) {
      const [r2] = await pool.query(
        'SELECT DISTINCT enterprise_id AS eid FROM compat_enterprise_projects WHERE enterprise_id IS NOT NULL AND enterprise_id > 0'
      );
      for (const r of r2 || []) if (r.eid != null) eidSet.add(Number(r.eid));
    }
  } catch (e) {
    console.warn('[adminCompat] compat project ids:', e.message);
  }
  let n = 0;
  for (const eid of eidSet) {
    if (!Number.isFinite(eid) || eid <= 0) continue;
    try {
      const [[ex]] = await pool.query('SELECT id FROM enterprises WHERE id = ? LIMIT 1', [eid]);
      if (ex) continue;
    } catch (_) {
      continue;
    }
    const uid = await findUserIdForEnterpriseStub(eid, spec.userIdField);
    const ok = await insertSingleEnterpriseRow(
      spec,
      {
        id: eid,
        name: `企业#${eid}`,
        userId: uid
      },
      diag
    );
    if (ok) n++;
  }
  console.warn(
    '[adminCompat] compat enterprise_id 补建摘要',
    COMPANIES_BACKFILL_BUILD_ID,
    '待处理数=' + eidSet.size,
    '成功插入=' + n
  );
  return n;
}

/**
 * qms_users 企业角色账号尚无 enterprises.user_id 关联时补建一行（自增 id）。
 */
async function ensureEnterpriseRowsForQmsEnterpriseUsers(spec, diag) {
  if (!(await tableExists('enterprises')) || !(await tableExists('qms_users'))) return 0;
  if (!spec.userIdField) {
    console.warn('[adminCompat] ensureEnterpriseRowsForQmsEnterpriseUsers: 无 user_id 类列，跳过 qms 补行');
    return 0;
  }
  const uidIdent = sqlIdent(spec.userIdField);
  let users = [];
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.real_name, u.email, u.phone
       FROM qms_users u
       WHERE (
          LOWER(TRIM(COALESCE(u.role, ''))) IN ('enterprise', 'company', 'ent', 'employer', 'hr')
          OR TRIM(COALESCE(u.role, '')) IN ('企业', '企业用户', '政企', '企业账号')
        )
        AND NOT EXISTS (SELECT 1 FROM enterprises e WHERE e.${uidIdent} = u.id)`
    );
    users = rows || [];
  } catch (e) {
    console.warn('[adminCompat] ensureEnterpriseRowsForQmsEnterpriseUsers list:', e.message);
    return 0;
  }
  let n = 0;
  for (const u of users) {
    const nm =
      (u.real_name && String(u.real_name).trim()) ||
      (u.username && String(u.username).trim()) ||
      `企业用户#${u.id}`;
    const ok = await insertSingleEnterpriseRow(spec, { id: undefined, name: nm, userId: u.id }, diag);
    if (ok) n++;
  }
  console.warn(
    '[adminCompat] qms 企业账号补建摘要',
    COMPANIES_BACKFILL_BUILD_ID,
    '待处理账号数=' + users.length,
    '成功插入=' + n
  );
  return n;
}

router.get('/admin/companies', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatAdminCompaniesTable();
    const insertSpec = await getEnterpriseInsertSpec();
    const backfillDiag = { errors: [] };
    /** 先按兼容表里的 enterprise_id 补主键行，再为仅存在于 qms 的企业账号自增补行 */
    let backfilled =
      (await ensureEnterpriseRowsFromCompatReferencedIds(insertSpec, backfillDiag)) +
      (await ensureEnterpriseRowsForQmsEnterpriseUsers(insertSpec, backfillDiag));
    console.warn(
      '[adminCompat] GET /admin/companies 补建结束',
      COMPANIES_BACKFILL_BUILD_ID,
      '合计新插入=' + backfilled,
      'enterprises.status 选用值=' + insertSpec.statusValue
    );
    const ec = await getEnterpriseColumnMap();
    const page = Math.max(1, safeInt(req.query.page, 1));
    const size = Math.min(5000, Math.max(1, safeInt(req.query.size, 20)));
    const offset = (page - 1) * size;
    const keyword = (req.query.keyword || '').trim();

    const nameExpr = ec.name ? `e.${sqlIdent(ec.name)}` : `CAST(e.id AS CHAR)`;
    const phoneExpr = ec.phone ? `e.${sqlIdent(ec.phone)}` : 'NULL';
    const emailExpr = ec.email ? `e.${sqlIdent(ec.email)}` : 'NULL';
    const industryExpr = ec.industry ? `e.${sqlIdent(ec.industry)}` : "''";
    const cityExpr = ec.city ? `e.${sqlIdent(ec.city)}` : "''";
    const contactExpr = ec.contact ? `e.${sqlIdent(ec.contact)}` : "''";
    const statusExpr = ec.status ? `e.${sqlIdent(ec.status)}` : 'NULL';
    const createdExpr = ec.created ? `e.${sqlIdent(ec.created)}` : 'NULL';

    let where = 'WHERE 1=1';
    const params = [];
    if (keyword) {
      const k = `%${keyword}%`;
      const ors = [];
      if (ec.name) {
        ors.push(`e.${sqlIdent(ec.name)} LIKE ?`);
        params.push(k);
      }
      if (ec.phone) {
        ors.push(`e.${sqlIdent(ec.phone)} LIKE ?`);
        params.push(k);
      }
      if (ec.email) {
        ors.push(`e.${sqlIdent(ec.email)} LIKE ?`);
        params.push(k);
      }
      if (ors.length) where += ` AND (${ors.join(' OR ')})`;
    }

    const selectSql = `
      SELECT e.id,
             ${nameExpr} AS ent_name,
             ${phoneExpr} AS ent_phone,
             ${emailExpr} AS ent_email,
             ${industryExpr} AS ent_industry,
             ${cityExpr} AS ent_city,
             ${contactExpr} AS ent_contact,
             ${statusExpr} AS ent_status,
             ${createdExpr} AS ent_created,
             COALESCE(s.free_membership, 0) AS free_membership
      FROM enterprises e
      LEFT JOIN compat_admin_company_settings s ON s.enterprise_id = e.id
      ${where}
      ORDER BY e.id DESC
      LIMIT ? OFFSET ?`;

    // 使用 pool.query（text protocol）避免 mysql2 binary protocol 处理 ENUM 列时抛 ER_WRONG_ARGUMENTS
    const [rows] = await pool.query(selectSql, [...params, size, offset]);
    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS c FROM enterprises e ${where}`, params);

    let data = (rows || []).map((r) => {
      const rawSt = r.ent_status;
      const stLower = rawSt != null && rawSt !== '' ? String(rawSt).trim().toLowerCase() : '';
      const stNum = Number(rawSt);
      const isNum0 = Number.isFinite(stNum) && stNum === 0;
      const isNum1 = Number.isFinite(stNum) && stNum === 1;
      return {
      id: Number(r.id),
      name: (r.ent_name != null && String(r.ent_name).trim() !== '') ? String(r.ent_name) : `企业#${Number(r.id)}`,
      industry: r.ent_industry != null ? String(r.ent_industry) : '',
      city: r.ent_city != null ? String(r.ent_city) : '',
      contact: r.ent_contact != null ? String(r.ent_contact) : '',
      phone: r.ent_phone != null ? String(r.ent_phone) : '',
      certification:
        stLower === 'pending' || isNum0
          ? '待认证'
          : (stLower === '' || stLower === 'approved' || stLower === 'active' || isNum1)
            ? '已认证'
            : '未认证',
      status:
        (stLower === '' || stLower === 'approved' || stLower === 'active' || isNum1)
          ? '正常'
          : '禁用',
      freeMembership: !!Number(r.free_membership || 0),
      registerDate: r.ent_created ? String(r.ent_created).split('T')[0] : ''
    };
    });

    let total = Number(cnt.c) || 0;
    // 主库 enterprises 为空时仍尝试合并人才库（小 size 请求也要补全，避免仅人才库有企业时管理端一直 0 条）
    if (poolShengju && page === 1 && (size >= 20 || data.length === 0)) {
      try {
        const [srows] = await poolShengju.query('SELECT * FROM enterprises ORDER BY id DESC LIMIT 5000');
        const have = new Set(data.map((d) => d.id));
        for (const raw of srows || []) {
          const dto = mapShengjuRawEnterpriseToAdminDto(raw);
          if (!dto || have.has(dto.id)) continue;
          have.add(dto.id);
          data.push(dto);
        }
        data.sort((a, b) => Number(b.id) - Number(a.id));
        total = data.length;
      } catch (e) {
        console.warn('[adminCompat] GET /admin/companies shengju merge:', e.message);
      }
    }

    const payload = { success: true, data, total, page, size };
    const wantDiag = String(req.query.diag || '') === '1' || data.length === 0;
    if (wantDiag) {
      const meta = {
        companiesBackfillBuild: COMPANIES_BACKFILL_BUILD_ID,
        mainDatabase: MAIN_DB_NAME,
        backfilledEnterpriseRows: backfilled,
        shengjuDatabase: SHENGJU_DB_NAME || null,
        dataLength: data.length,
        enterprisesStatusInsertValue: insertSpec.statusValue,
        enterprisesNameColumn: insertSpec.nameField || null,
        enterprisesUserIdColumn: insertSpec.userIdField || null,
        backfillErrors: backfillDiag.errors
      };
      try {
        const [[ecnt]] = await pool.query('SELECT COUNT(*) AS c FROM enterprises');
        meta.enterprisesTableCount = Number(ecnt && ecnt.c) || 0;
      } catch (e1) {
        meta.enterprisesTableCountError = e1.message;
      }
      try {
        if (await tableExists('qms_users')) {
          const [[qc]] = await pool.query(
            `SELECT COUNT(*) AS c FROM qms_users u WHERE LOWER(TRIM(COALESCE(u.role,''))) IN ('enterprise','company','ent','employer','hr')
             OR TRIM(COALESCE(u.role,'')) IN ('企业','企业用户','政企','企业账号')`
          );
          meta.qmsEnterpriseRoleUsers = Number(qc && qc.c) || 0;
        }
      } catch (e2) {
        meta.qmsEnterpriseRoleUsersError = e2.message;
      }
      try {
        if (await tableExists('compat_enterprise_verification_requests')) {
          const [[vc]] = await pool.query(
            'SELECT COUNT(DISTINCT enterprise_id) AS c FROM compat_enterprise_verification_requests WHERE enterprise_id IS NOT NULL AND enterprise_id > 0'
          );
          meta.distinctVerificationEnterpriseIds = Number(vc && vc.c) || 0;
        }
      } catch (_) {
        /* ignore */
      }
      try {
        if (await tableExists('compat_enterprise_projects')) {
          const [[pc]] = await pool.query(
            'SELECT COUNT(DISTINCT enterprise_id) AS c FROM compat_enterprise_projects WHERE enterprise_id IS NOT NULL AND enterprise_id > 0'
          );
          meta.distinctProjectEnterpriseIds = Number(pc && pc.c) || 0;
        }
      } catch (_) {
        /* ignore */
      }
      if (data.length === 0 && meta.enterprisesTableCount === 0) {
        meta.hint =
          'insertSingleEnterpriseRow-20260403d：status 为整型时用数字默认 0；id 无自增时用 MAX(id)+1。若仍失败请看 backfillErrors。';
      }
      payload.meta = meta;
    } else if (backfilled > 0) {
      payload.meta = {
        companiesBackfillBuild: COMPANIES_BACKFILL_BUILD_ID,
        backfilledEnterpriseRows: backfilled,
        mainDatabase: MAIN_DB_NAME
      };
    }
    res.json(payload);
  } catch (e) {
    console.error('[adminCompat] GET /admin/companies:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.patch('/admin/companies/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatAdminCompaniesTable();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: '无效的企业 ID' });
    const freeMembership = !!(req.body && req.body.freeMembership);
    await pool.execute(
      `INSERT INTO compat_admin_company_settings (enterprise_id, free_membership)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE free_membership = VALUES(free_membership)`,
      [id, freeMembership ? 1 : 0]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[adminCompat] PATCH /admin/companies/:id:', e);
    res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
});

// ==================== 报告模板 / 简历模板兼容接口 ====================
let compatTemplatesReady = false;
async function ensureCompatTemplateTables() {
  if (compatTemplatesReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_report_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      platform VARCHAR(50) NOT NULL DEFAULT 'enterprise',
      type VARCHAR(50) NOT NULL DEFAULT 'development',
      industry VARCHAR(100) DEFAULT '',
      description TEXT NULL,
      content MEDIUMTEXT NULL,
      fields LONGTEXT NULL,
      charts LONGTEXT NULL,
      status TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_platform (platform),
      INDEX idx_type (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 管理端报告模板'
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_resume_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      content MEDIUMTEXT NULL,
      status TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 管理端简历模板'
  `);
  try {
    await pool.execute(
      `ALTER TABLE compat_resume_templates ADD COLUMN category VARCHAR(50) NULL COMMENT 'modern|professional|executive' AFTER description`
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!/Duplicate column/i.test(msg) && !/ER_DUP_FIELDNAME/i.test(msg)) {
      console.warn('[adminCompat] ALTER compat_resume_templates.category:', msg);
    }
  }
  compatTemplatesReady = true;
}

function parseJsonOrEmpty(val) {
  if (!val) return [];
  try {
    const j = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(j) ? j : [];
  } catch (_) {
    return [];
  }
}

// 报告模板管理（admin）
router.get('/admin/report-templates', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const [rows] = await pool.execute(
      `SELECT * FROM compat_report_templates ORDER BY sort_order ASC, id DESC`
    );
    const data = (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      type: r.type,
      industry: r.industry || '',
      description: r.description || '',
      content: r.content || '',
      fields: parseJsonOrEmpty(r.fields),
      charts: parseJsonOrEmpty(r.charts),
      status: Number(r.status) ? 1 : 0,
      sortOrder: r.sort_order || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.error('[adminCompat] GET /admin/report-templates:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.get('/admin/report-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: '无效的模板 ID' });
    const [rows] = await pool.execute(`SELECT * FROM compat_report_templates WHERE id = ? LIMIT 1`, [id]);
    const r = rows && rows[0];
    if (!r) return res.status(404).json({ success: false, message: '模板不存在' });
    res.json({
      success: true,
      data: {
        id: r.id,
        name: r.name,
        platform: r.platform,
        type: r.type,
        industry: r.industry || '',
        description: r.description || '',
        content: r.content || '',
        fields: parseJsonOrEmpty(r.fields),
        charts: parseJsonOrEmpty(r.charts),
        status: Number(r.status) ? 1 : 0,
        sortOrder: r.sort_order || 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.post('/admin/report-templates', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '名称不能为空' });
    const platform = (b.platform || 'enterprise').trim();
    const type = (b.type || 'development').trim();
    const industry = (b.industry || '').trim();
    const description = b.description || '';
    const content = b.content || '';
    const fields = b.fields != null ? JSON.stringify(b.fields) : null;
    const charts = b.charts != null ? JSON.stringify(b.charts) : null;
    const status = b.status != null ? (Number(b.status) ? 1 : 0) : 1;
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    const [r] = await pool.execute(
      `INSERT INTO compat_report_templates (name, platform, type, industry, description, content, fields, charts, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, platform, type, industry, description, content, fields, charts, status, sortOrder]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) {
    console.error('[adminCompat] POST /admin/report-templates:', e);
    res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

router.put('/admin/report-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: '无效的模板 ID' });
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '名称不能为空' });
    const platform = (b.platform || 'enterprise').trim();
    const type = (b.type || 'development').trim();
    const industry = (b.industry || '').trim();
    const description = b.description || '';
    const content = b.content || '';
    const fields = b.fields != null ? JSON.stringify(b.fields) : null;
    const charts = b.charts != null ? JSON.stringify(b.charts) : null;
    const status = b.status != null ? (Number(b.status) ? 1 : 0) : 1;
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    await pool.execute(
      `UPDATE compat_report_templates
       SET name = ?, platform = ?, type = ?, industry = ?, description = ?, content = ?, fields = ?, charts = ?, status = ?, sort_order = ?
       WHERE id = ?`,
      [name, platform, type, industry, description, content, fields, charts, status, sortOrder, id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[adminCompat] PUT /admin/report-templates/:id:', e);
    res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
});

router.delete('/admin/report-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: '无效的模板 ID' });
    await pool.execute(`DELETE FROM compat_report_templates WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

// 简历模板管理（admin）
router.get('/admin/resume-templates', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const [rows] = await pool.execute(
      `SELECT * FROM compat_resume_templates ORDER BY sort_order ASC, id DESC`
    );
    const data = (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      content: r.content || '',
      status: Number(r.status) ? 1 : 0,
      sortOrder: r.sort_order || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.error('[adminCompat] GET /admin/resume-templates:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.post('/admin/resume-templates', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '名称不能为空' });
    const description = b.description || '';
    const content = b.content || '';
    const status = b.status != null ? (Number(b.status) ? 1 : 0) : 1;
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    const [r] = await pool.execute(
      `INSERT INTO compat_resume_templates (name, description, content, status, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [name, description, content, status, sortOrder]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

router.put('/admin/resume-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: '无效的模板 ID' });
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '名称不能为空' });
    const description = b.description || '';
    const content = b.content || '';
    const status = b.status != null ? (Number(b.status) ? 1 : 0) : 1;
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    await pool.execute(
      `UPDATE compat_resume_templates SET name = ?, description = ?, content = ?, status = ?, sort_order = ? WHERE id = ?`,
      [name, description, content, status, sortOrder, id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
});

router.delete('/admin/resume-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: '无效的模板 ID' });
    await pool.execute(`DELETE FROM compat_resume_templates WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

function mapUserStatusToInt(st) {
  const s = String(st || '').toLowerCase();
  if (s === 'active' || s === '1' || st === 1) return 1;
  return 0;
}

async function fetchAdminUsersRows() {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, email, phone, role, status FROM qms_users
       WHERE LOWER(TRIM(COALESCE(role,''))) IN ('admin','administrator','super_admin','superadmin')
       ORDER BY id ASC`
    );
    return rows || [];
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      const [rows] = await pool.execute(
        `SELECT id, username, email, role, status FROM qms_users
         WHERE LOWER(TRIM(COALESCE(role,''))) IN ('admin','administrator','super_admin','superadmin')
         ORDER BY id ASC`
      );
      return (rows || []).map((r) => ({ ...r, phone: null }));
    }
    throw e;
  }
}

function dtoAdminUser(row, perms) {
  return {
    id: row.id,
    username: row.username || '',
    email: row.email || '',
    phone: row.phone || '',
    status: mapUserStatusToInt(row.status),
    adminPermissions: perms === null ? null : perms
  };
}

/** 当前登录管理员：权限选项 + 自身权限（任意管理员可调） */
router.get('/admin/admins/me', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const row = await UserModel.findById(req.user.id);
    if (!row) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    let phone = '';
    try {
      const [pr] = await pool.execute('SELECT phone FROM qms_users WHERE id = ? LIMIT 1', [req.user.id]);
      if (pr && pr[0] && pr[0].phone != null) phone = String(pr[0].phone);
    } catch (_) {}
    const perms = await getPermissionsUserId(req.user.id);
    const data = dtoAdminUser({ ...row, phone }, perms);
    data.permissionOptions = PERMISSION_OPTIONS;
    return res.json({
      success: true,
      data
    });
  } catch (e) {
    console.warn('[adminCompat] GET /admin/admins/me:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

/** 管理员列表（需「管理员账号」权限，或历史上未写入权限表则视为全权限） */
router.get('/admin/admins', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const allowed = await canManageAdminAccounts(req.user.id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: '无权限查看管理员列表' });
    }
    const rows = await fetchAdminUsersRows();
    const data = [];
    for (const r of rows) {
      const perms = await getPermissionsUserId(r.id);
      data.push(dtoAdminUser(r, perms));
    }
    return res.json({ success: true, data, permissionOptions: PERMISSION_OPTIONS });
  } catch (e) {
    console.warn('[adminCompat] GET /admin/admins:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

router.put('/admin/admins/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const allowed = await canManageAdminAccounts(req.user.id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: '无权限修改管理员权限' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的用户 ID' });
    }
    const target = await UserModel.findById(id);
    const tr = String((target && target.role) || '')
      .toLowerCase()
      .trim();
    const adminRoles = new Set(['admin', 'administrator', 'super_admin', 'superadmin']);
    if (!target || !adminRoles.has(tr)) {
      return res.status(404).json({ success: false, message: '目标不是管理员账号' });
    }
    const body = req.body || {};
    let next = body.adminPermissions;
    if (!Array.isArray(next)) {
      return res.status(400).json({ success: false, message: 'adminPermissions 须为数组' });
    }
    next = next.map((x) => String(x).trim()).filter(Boolean);
    const validKeys = new Set(PERMISSION_OPTIONS.map((p) => p.key));
    if (next.includes('*')) {
      next = ['*'];
    } else {
      next = next.filter((k) => validKeys.has(k));
    }
    await setPermissionsUserId(id, next);
    return res.json({ success: true });
  } catch (e) {
    console.warn('[adminCompat] PUT /admin/admins/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/** 新建管理员账号（写入 qms_users + 默认门户权限，不含 admins） */
router.post('/admin/admins', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const allowed = await canManageAdminAccounts(req.user.id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: '无权限创建管理员' });
    }
    const b = req.body || {};
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const email = (b.email || '').trim() || null;
    const real_name = (b.real_name || '').trim() || null;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '密码至少 6 位' });
    }
    const existing = await UserModel.findByUsername(username);
    if (existing) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    const userId = await UserModel.create({
      username,
      password,
      role: 'admin',
      email,
      real_name
    });
    await setPermissionsUserId(userId, DEFAULT_NEW_ADMIN_PERMISSIONS.slice());
    return res.json({ success: true, data: { userId } });
  } catch (e) {
    console.warn('[adminCompat] POST /admin/admins:', e.message);
    return res.status(500).json({ success: false, message: e.message || '创建失败' });
  }
});

module.exports = router;
