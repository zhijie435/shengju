const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const UserModel = require('../models/userModel');
const GradingAccountModel = require('../models/gradingAccountModel');
const EnterpriseModel = require('../models/enterpriseModel');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { verifyPassword: verifyPwdWithMigration, hashPassword: hashPwdUtils } = require('../utils/password');
const { pool } = require('../config/database');
const { generateToken, authenticate, verifyToken, inferLoginPortal, JWT_SECRET } = require('../middleware/auth');
const aliyunSms = require('../services/aliyunSms');
const faceIdCompare = require('../services/faceIdCompare');

async function ensureCompatSystemSettingsTableAuth() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_system_settings (
      id INT PRIMARY KEY DEFAULT 1,
      payload_json LONGTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理端系统设置'
  `);
}

async function loadAdminSmsLoginPhonesFromDb() {
  try {
    await ensureCompatSystemSettingsTableAuth();
    const [rows] = await pool.execute('SELECT payload_json FROM compat_system_settings WHERE id = 1 LIMIT 1');
    if (!rows || !rows[0] || !rows[0].payload_json) return [];
    const j = JSON.parse(rows[0].payload_json);
    const arr = j && j.adminSmsLoginPhones;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => String(p).replace(/\D/g, ''))
      .filter((p) => p.length >= 10);
  } catch (e) {
    console.warn('[auth] loadAdminSmsLoginPhonesFromDb:', e.message);
    return [];
  }
}

function phoneMatchesAdminSmsWhitelist(rawDigits, whitelist) {
  const p = String(rawDigits || '').replace(/\D/g, '');
  if (p.length < 10 || !whitelist || !whitelist.length) return false;
  const norm = aliyunSms.normalizePhoneCn(p);
  const variants = new Set([p, norm]);
  if (norm.length === 11 && norm.startsWith('1')) variants.add(`86${norm}`);
  if (p.length === 13 && p.startsWith('86')) variants.add(p.slice(2));
  for (const w of whitelist) {
    const wd = String(w).replace(/\D/g, '');
    if (wd.length < 10) continue;
    const wn = aliyunSms.normalizePhoneCn(wd);
    const wvars = new Set([wd, wn]);
    if (wn.length === 11 && wn.startsWith('1')) wvars.add(`86${wn}`);
    if (wd.length === 13 && wd.startsWith('86')) wvars.add(wd.slice(2));
    for (const a of variants) {
      if (wvars.has(a)) return true;
    }
  }
  return false;
}

function normalizeRoleForPortal(raw) {
  if (raw == null) return '';
  const r = String(raw).trim();
  const low = r.toLowerCase();
  if (!r) return '';
  if (low === 'admin' || low === 'administrator' || low === 'super_admin' || low === 'superadmin') return 'admin';
  if (r === '管理员' || r === '系统管理员' || r === '超级管理员') return 'admin';
  if (low === 'enterprise' || low === 'company') return 'enterprise';
  if (r === '企业' || r === '企业用户' || r === '政企' || r === '用人单位' || r === '招聘企业') return 'enterprise';
  if (low === 'candidate' || low === 'jobseeker') return 'candidate';
  if (low === 'user') return 'user';
  return low;
}

/** 显式 userType 时校验登录入口，避免求职者与企业端共用同一套账号密码串端 */
async function assertLoginPortalAllowed(user, userTypeRaw) {
  const ut = String(userTypeRaw || '').trim().toLowerCase();
  if (!ut) return { ok: true };
  const wantEnt = ut === 'enterprise' || ut === 'company';
  const wantJob = ut === 'jobseeker' || ut === 'candidate' || ut === 'user';
  const wantAdmin =
    ut === 'admin' ||
    ut === 'administrator' ||
    ut === '超级管理员' ||
    ut === '系统管理员';
  if (!wantEnt && !wantJob && !wantAdmin) return { ok: true };

  let hasEnterprise = false;
  try {
    const ent = await EnterpriseModel.findByUserId(user.id);
    hasEnterprise = !!(ent && ent.id != null);
  } catch (_) {
    /* ignore */
  }
  const role = normalizeRoleForPortal(user.role);

  if (wantAdmin) {
    if (role !== 'admin') {
      return { ok: false, message: '该账号不是管理员，请使用管理员账号登录管理端' };
    }
    return { ok: true };
  }

  if (wantEnt) {
    if (role === 'admin') return { ok: true };
    if (role === 'enterprise' || hasEnterprise) return { ok: true };
    return { ok: false, message: '该账号不是企业用户，请使用「个人登录」进入求职者端' };
  }
  if (wantJob) {
    if (role === 'admin') {
      return { ok: false, message: '管理员请从管理后台登录' };
    }
    if (role === 'enterprise') {
      return { ok: false, message: '该账号为企业用户，请使用「政企登录」进入企业端' };
    }
    return { ok: true };
  }
  return { ok: true };
}

/** 环境变量 ADMIN_WEB_LOGIN_DISABLED=1/true/yes 时，禁止管理员账号通过 Web 接口登录（含密码登录、短信登录、不传 userType 的兼容登录） */
function isAdminWebLoginDisabled() {
  const v = String(process.env.ADMIN_WEB_LOGIN_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function adminWebLoginDisabledMessage() {
  const m = String(process.env.ADMIN_WEB_LOGIN_MESSAGE || '').trim();
  return m || '管理后台 Web 登录已禁用，请联系运维';
}

function userMatchesPortalHint(user, userTypeRaw) {
  const ut = String(userTypeRaw || '').trim().toLowerCase();
  if (!ut) return true;
  const role = normalizeRoleForPortal(user && user.role);
  const wantEnt = ut === 'enterprise' || ut === 'company';
  const wantJob = ut === 'jobseeker' || ut === 'candidate' || ut === 'user';
  const wantAdmin = ut === 'admin' || ut === 'administrator';
  if (wantAdmin) return role === 'admin';
  if (wantEnt) return role === 'enterprise' || role === 'admin';
  if (wantJob) return role !== 'enterprise' && role !== 'admin';
  return true;
}

async function findBestUserByPhoneForPortal(phoneDigits, userTypeRaw) {
  const p = String(phoneDigits || '').replace(/\D/g, '');
  if (!p || p.length < 10) return null;
  const variants = Array.from(
    new Set([
      p,
      p.length === 11 && p.startsWith('1') ? `86${p}` : null,
      p.length === 13 && p.startsWith('86') ? p.slice(2) : null
    ].filter(Boolean))
  );
  if (!variants.length) return null;
  const placeholders = variants.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT id, username, phone, password_hash, role, real_name, status, id_card, exam_number
     FROM qms_users WHERE phone IN (${placeholders}) ORDER BY id DESC`,
    variants
  );
  if (!rows || !rows.length) return null;
  const poolRows = rows.filter((u) => userMatchesPortalHint(u, userTypeRaw));
  if (!poolRows.length) return null;
  const ut = String(userTypeRaw || '').trim().toLowerCase();
  const wantJob = ut === 'jobseeker' || ut === 'candidate' || ut === 'user';
  const preferJobseekerMain = (cands) =>
    cands.find((u) => normalizeRoleForPortal(u.role) === 'user') ||
    cands.find((u) => {
      const r = normalizeRoleForPortal(u.role);
      return r === 'candidate' || r === 'jobseeker';
    }) ||
    cands[0];
  /** 同号多行时：id DESC 会使最新 cand_ 在前，先命中考生号、专业测评为空。优先 role=user 的求职者主号 */
  let picked = null;
  if (ut && wantJob) {
    picked = preferJobseekerMain(poolRows);
  } else if (!ut) {
    const jrows = poolRows.filter((u) => {
      const r = normalizeRoleForPortal(u.role);
      return r !== 'enterprise' && r !== 'admin';
    });
    picked = jrows.length > 0 ? preferJobseekerMain(jrows) : poolRows.find((u) => userMatchesPortalHint(u, userTypeRaw)) || poolRows[0];
  } else {
    picked = poolRows.find((u) => userMatchesPortalHint(u, userTypeRaw)) || poolRows[0];
  }
  /**
   * 合并企业后常见情况：同手机号下既有 enterprise 账号又有考生账号。
   * 这里若回退到 rows[0]（通常是最新创建的 enterprise）会导致“个人端短信登录不上”。
   * 因此：有 portal 提示时，只返回匹配当前入口角色的账号；不再跨端回退。
   */
  if (ut) return picked || null;
  return picked || rows[0] || null;
}

/** 同手机号下全部可登录账号（用于求职者密码登录：避免误命中「已注册主号」导致身份证后6位永远错误） */
async function findAllUsersByPhoneVariants(phoneDigits) {
  const p = String(phoneDigits || '').replace(/\D/g, '');
  if (!p || p.length < 10) return [];
  const variants = Array.from(
    new Set([
      p,
      p.length === 11 && p.startsWith('1') ? `86${p}` : null,
      p.length === 13 && p.startsWith('86') ? p.slice(2) : null
    ].filter(Boolean))
  );
  if (!variants.length) return [];
  const placeholders = variants.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT id, username, phone, password_hash, role, real_name, status
     FROM qms_users WHERE phone IN (${placeholders})
     UNION
     SELECT id, username, phone, password_hash, role, real_name, status
     FROM qms_users WHERE username IN (${placeholders})
     ORDER BY id ASC`,
    [...variants, ...variants]
  );
  const seen = new Set();
  const out = [];
  for (const u of rows || []) {
    const id = Number(u.id);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(u);
  }
  return out;
}

/**
 * 求职者密码登录：在同手机号/用户名多账号中，用密码命中「企业导入考生」账号，而非仅 role=user 的注册主号。
 */
async function findJobseekerUserByPassword(rawLogin, phoneDigits, password, utRaw) {
  const uname = String(rawLogin || '').trim();
  const isPhoneLogin = /^\d{10,15}$/.test(phoneDigits);
  const idNorm = uname.replace(/\s/g, '').toUpperCase();
  const tryList = [];

  if (idNorm.length >= 15) {
    const byId = await UserModel.findByIdCardSafe(idNorm);
    if (byId) tryList.push(byId);
  }
  if (isPhoneLogin) {
    const all = await findAllUsersByPhoneVariants(phoneDigits);
    for (const u of all) tryList.push(u);
  }
  const byU = await UserModel.findByUsername(uname);
  if (byU) tryList.push(byU);
  if (/^\d{6,24}$/.test(uname)) {
    const byExam = await UserModel.findByExamNumberSafe(uname);
    if (byExam) tryList.push(byExam);
  }
  try {
    const fromCoop = await UserModel.findUsersByCoopBasicInfo(phoneDigits, idNorm);
    for (const u of fromCoop) tryList.push(u);
  } catch (_) {
    /* ignore */
  }

  const seen = new Set();
  const prefer = (u) => normalizeRoleForPortal(u.role);
  const sorted = [];
  for (const u of tryList) {
    const id = Number(u.id);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    sorted.push(u);
  }
  sorted.sort((a, b) => {
    const ra = prefer(a);
    const rb = prefer(b);
    const score = (r) => (r === 'candidate' ? 0 : r === 'user' ? 1 : 2);
    return score(ra) - score(rb);
  });

  for (const u of sorted) {
    if (u.status !== 'active') continue;
    const portalPre = await assertLoginPortalAllowed(u, utRaw);
    if (!portalPre.ok) continue;
    if (!u.id_card || String(u.id_card).trim().length < 15) {
      await enrichUserIdCardFromCoopApplication(u);
    }
    if (await UserModel.verifyCandidatePortalPassword(u, password)) return u;
  }
  return null;
}

/** 登录前从公告报名 extra_json 补全 qms_users.id_card，便于身份证后 6 位校验 */
async function enrichUserIdCardFromCoopApplication(user) {
  if (!user || !user.id) return;
  if (user.id_card && UserModel.normalizeIdCard(user.id_card).length >= 15) return;
  try {
    const [rows] = await pool.execute(
      `SELECT extra_json FROM compat_cooperation_applications
       WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 5`,
      [user.id]
    );
    for (const r of rows || []) {
      let ex = {};
      try {
        ex = r.extra_json ? JSON.parse(r.extra_json) : {};
      } catch (_) {
        continue;
      }
      const b = ex.basicInfo && typeof ex.basicInfo === 'object' ? ex.basicInfo : {};
      const rm = ex.enterpriseRosterMeta && typeof ex.enterpriseRosterMeta === 'object' ? ex.enterpriseRosterMeta : {};
      const idc = UserModel.normalizeIdCard(
        b.idCardNumber || b.idNumber || rm.idCard || ex.idCard || ''
      );
      if (idc.length >= 15) {
        user.id_card = idc;
        await UserModel.mergeCandidateProfileFieldsSafe(user.id, { id_card: idc });
        return;
      }
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') console.warn('[auth] enrichUserIdCardFromCoopApplication:', e.message);
  }
}

async function detectPhonePortalHints(phoneDigits) {
  const p = String(phoneDigits || '').replace(/\D/g, '');
  if (!p || p.length < 10) return { hasEnterprise: false, hasJobseeker: false, hasAdmin: false };
  const variants = Array.from(
    new Set([
      p,
      p.length === 11 && p.startsWith('1') ? `86${p}` : null,
      p.length === 13 && p.startsWith('86') ? p.slice(2) : null
    ].filter(Boolean))
  );
  if (!variants.length) return { hasEnterprise: false, hasJobseeker: false, hasAdmin: false };
  const placeholders = variants.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT id, role FROM qms_users WHERE phone IN (${placeholders}) ORDER BY id DESC`,
    variants
  );
  let hasEnterprise = false;
  let hasJobseeker = false;
  let hasAdmin = false;
  for (const r of rows || []) {
    const role = normalizeRoleForPortal(r && r.role);
    if (role === 'enterprise') hasEnterprise = true;
    else if (role === 'admin') hasAdmin = true;
    else hasJobseeker = true;
  }
  return { hasEnterprise, hasJobseeker, hasAdmin };
}

async function trySyncSjJobseekerByPhone(phoneDigits) {
  const p = String(phoneDigits || '').replace(/\D/g, '');
  if (!p || p.length < 10) return null;
  const variants = Array.from(
    new Set([
      p,
      p.length === 11 && p.startsWith('1') ? `86${p}` : null,
      p.length === 13 && p.startsWith('86') ? p.slice(2) : null
    ].filter(Boolean))
  );
  if (!variants.length) return null;
  const placeholders = variants.map(() => '?').join(', ');
  let sj = null;
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, phone, email
       FROM sj_users
       WHERE phone IN (${placeholders})
       ORDER BY id DESC
       LIMIT 1`,
      variants
    );
    sj = rows && rows[0] ? rows[0] : null;
  } catch (e) {
    return null;
  }
  if (!sj) return null;
  const baseName = (sj.username && String(sj.username).trim()) ? String(sj.username).trim() : `sj_${p.slice(-6)}`;
  let syncUsername = baseName;
  let tryIdx = 0;
  while (await UserModel.findByUsername(syncUsername)) {
    tryIdx += 1;
    syncUsername = `${baseName}_${tryIdx}`;
    if (tryIdx > 20) {
      syncUsername = `${baseName}_${Date.now()}`;
      break;
    }
  }
  try {
    await UserModel.create({
      username: syncUsername,
      password: crypto.randomBytes(12).toString('hex'),
      role: 'user',
      email: sj.email || null,
      real_name: sj.username || syncUsername,
      phone: sj.phone || p
    });
  } catch (ce) {
    if (!(ce && (ce.code === 'ER_DUP_ENTRY' || String(ce.message || '').includes('Duplicate')))) {
      return null;
    }
  }
  const u = await findBestUserByPhoneForPortal(p, 'jobseeker');
  return u || null;
}

async function findOrCreateEnterpriseUserByPhone(phoneDigits) {
  const p = String(phoneDigits || '').replace(/\D/g, '');
  if (!p || p.length < 10) return null;
  const variants = Array.from(
    new Set([
      p,
      p.length === 11 && p.startsWith('1') ? `86${p}` : null,
      p.length === 13 && p.startsWith('86') ? p.slice(2) : null
    ].filter(Boolean))
  );
  if (!variants.length) return null;
  const placeholders = variants.map(() => '?').join(', ');
  let ent = null;
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM enterprises
       WHERE contact_phone IN (${placeholders})
       ORDER BY id ASC
       LIMIT 1`,
      variants
    );
    ent = rows && rows[0] ? rows[0] : null;
  } catch (_) {
    ent = null;
  }
  if (!ent) return null;

  // 1) enterprises.user_id 已绑定时直接返回对应用户
  if (ent.user_id != null && Number.isFinite(Number(ent.user_id)) && Number(ent.user_id) > 0) {
    const u = await UserModel.findById(Number(ent.user_id));
    if (u) return u;
  }

  // 2) 尝试复用同手机号已有企业账号
  let picked = await findBestUserByPhoneForPortal(p, 'enterprise');
  if (!picked) {
    // 3) 兜底创建企业账号并回写 enterprises.user_id
    const base = (ent.name && String(ent.name).trim()) ? String(ent.name).trim() : `enterprise_${p.slice(-6)}`;
    let username = String(base).replace(/\s+/g, '_').slice(0, 40) || `enterprise_${p.slice(-6)}`;
    let i = 0;
    while (await UserModel.findByUsername(username)) {
      i += 1;
      username = `${String(base).replace(/\s+/g, '_').slice(0, 32)}_${i}`;
      if (i > 30) {
        username = `enterprise_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        break;
      }
    }
    try {
      await UserModel.create({
        username,
        password: crypto.randomBytes(12).toString('hex'),
        role: 'enterprise',
        email: ent.contact_email || null,
        real_name: ent.contact_name || ent.name || username,
        phone: ent.contact_phone || p
      });
    } catch (ce) {
      if (!(ce && (ce.code === 'ER_DUP_ENTRY' || String(ce.message || '').includes('Duplicate')))) {
        return null;
      }
    }
    picked = await findBestUserByPhoneForPortal(p, 'enterprise');
  }
  if (!picked) return null;

  try {
    await pool.execute('UPDATE enterprises SET user_id = ? WHERE id = ?', [picked.id, ent.id]);
  } catch (_) {
    // ignore link failure, still allow login
  }
  return picked;
}

const EXAM_INVITATIONS_API_KEY = process.env.EXAM_INVITATIONS_API_KEY || 'shengju-exam-invitations-key';
const TALENT_NETWORK_API_URL = process.env.TALENT_NETWORK_API_URL || 'http://127.0.0.1:3001';

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body || {});
      const req = lib.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: buf ? JSON.parse(buf) : {} });
          } catch (e) {
            resolve({ status: res.statusCode, data: {} });
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

const FACE_VERIFY_TEMP_TOKEN_EXPIRY = '10m';

/**
 * 登录后「先发 tempToken、再扫脸换正式 JWT」仅用于考生考试端。
 * 人才网/求职者网站登录不触发（网站端无采集与比对链路）；进考场时仍可按考试配置要求刷脸签到等。
 */
function isExamStudentLoginClient(reqBody) {
  if (!reqBody || typeof reqBody !== 'object') return false;
  if (reqBody.examStudentLogin === true || reqBody.examStudentClient === true) return true;
  if (reqBody.examStudentLogin === 1 || reqBody.examStudentClient === 1) return true;
  const esl = String(reqBody.examStudentLogin ?? '').trim().toLowerCase();
  const esc = String(reqBody.examStudentClient ?? '').trim().toLowerCase();
  if (esl === 'true' || esl === '1' || esc === 'true' || esc === '1') return true;
  const c = String(reqBody.client || '').trim().toLowerCase();
  return c === 'exam_student' || c === 'exam-student';
}

/** 同手机号/身份证合并的 qms_users.id，报名与身份证照可能挂在子号上 */
async function getExamFaceVerifyMergedUserIds(userId) {
  try {
    const merged = await UserModel.getAllIdsWithSamePhoneAsUser(userId);
    if (merged && merged.length) return merged;
  } catch (e) {
    console.warn('[auth] getExamFaceVerifyMergedUserIds:', e.message);
  }
  const n = Number(userId);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

async function mergedAccountHasIdCard(userId) {
  const ids = await getExamFaceVerifyMergedUserIds(userId);
  if (!ids.length) return false;
  try {
    const ph = ids.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT 1 FROM qms_users WHERE id IN (${ph}) AND COALESCE(TRIM(id_card_image_path), '') <> '' LIMIT 1`,
      ids
    );
    return rows && rows.length > 0;
  } catch (e) {
    console.warn('mergedAccountHasIdCard:', e.message);
    return false;
  }
}

// 判断当前账号（含同手机号合并子号）是否有需登录后人脸核验的考试报名：
// - 笔试/通用：monitor_config.faceVerifyEnabled
// - 面试等：answer_system_config.interviewConfig.requireIdentityVerify（与进考场签到逻辑一致）
// 考试状态含 draft：与专业测评邀请、报名列表一致，避免仅草稿/未发布时不触发
async function hasFaceVerifyExam(userId) {
  const ids = await getExamFaceVerifyMergedUserIds(userId);
  if (!ids.length) return false;
  try {
    const ph = ids.map(() => '?').join(',');
    const params = [...ids];
    const [rows] = await pool.execute(
      `SELECT 1
       FROM exam_enrollments en
       JOIN exams e ON e.id = en.exam_id
       WHERE en.user_id IN (${ph})
         AND e.status IN ('draft','published','ongoing')
         AND (
           (
             e.monitor_config IS NOT NULL
             AND (
               (JSON_VALID(e.monitor_config)
                 AND (
                   JSON_EXTRACT(e.monitor_config, '$.faceVerifyEnabled') = CAST('true' AS JSON)
                   OR LOWER(JSON_UNQUOTE(JSON_EXTRACT(e.monitor_config, '$.faceVerifyEnabled'))) IN ('true', '1')
                 ))
               OR e.monitor_config LIKE '%\"faceVerifyEnabled\":true%'
               OR e.monitor_config LIKE '%\"faceVerifyEnabled\": true%'
             )
           )
           OR (
             e.answer_system_config IS NOT NULL
             AND (
               (JSON_VALID(e.answer_system_config)
                 AND (
                   JSON_EXTRACT(e.answer_system_config, '$.interviewConfig.requireIdentityVerify') = CAST('true' AS JSON)
                   OR LOWER(JSON_UNQUOTE(JSON_EXTRACT(e.answer_system_config, '$.interviewConfig.requireIdentityVerify'))) IN ('true', '1')
                 ))
               OR e.answer_system_config LIKE '%\"requireIdentityVerify\":true%'
               OR e.answer_system_config LIKE '%\"requireIdentityVerify\": true%'
             )
           )
         )
       LIMIT 1`,
      params
    );
    return rows && rows.length > 0;
  } catch (e) {
    console.warn('hasFaceVerifyExam error:', e.message);
    // 查询失败时不应误判为「需要人脸」，否则已关闭开关的考生仍被拦在登录人脸页
    return false;
  }
}

// 短信验证码存储（优先 Redis，回退进程内存，兼容 PM2 cluster）
const redisClient = require('../services/redisClient');
const SMS_TTL_SEC = 5 * 60; // 5 分钟

// 短信绕过开关：设 SMS_BYPASS=true 后跳过真实短信发送和验证，手机号格式也不校验（仅开发/演示用）
const SMS_BYPASS = String(process.env.SMS_BYPASS || '').toLowerCase() === 'true';

async function getSmsCode(phone) {
  return await redisClient.get(`sms:${phone}`);
}
async function setSmsCode(phone, code) {
  await redisClient.setex(`sms:${phone}`, SMS_TTL_SEC, code);
}
async function delSmsCode(phone) {
  await redisClient.del(`sms:${phone}`);
}

/** 校验并消费短信验证码（SMS_BYPASS 时接受任意 6 位数字） */
async function verifyAndConsumeSmsCode(phoneDigits, submittedCode) {
  const p = String(phoneDigits || '').replace(/\D/g, '');
  // 短信绕过模式：接受任意验证码
  if (SMS_BYPASS) {
    const code = String(submittedCode || '').trim();
    if (!code || code.length < 4) return { ok: false, message: '请填写验证码（绕过模式下至少4位）' };
    return { ok: true };
  }
  if (p.length < 10) return { ok: false, message: '手机号格式不正确' };
  const norm = aliyunSms.normalizePhoneCn(p);
  const code = String(submittedCode || '').trim();
  if (!code) return { ok: false, message: '请填写短信验证码' };
  const stored = (await getSmsCode(norm)) || (await getSmsCode(p));
  if (!stored || stored !== code) return { ok: false, message: '验证码错误或已过期' };
  await delSmsCode(p);
  await delSmsCode(norm);
  if (norm.length === 11 && norm.startsWith('1')) await delSmsCode(`86${norm}`);
  if (p.length === 13 && p.startsWith('86')) await delSmsCode(p.slice(2));
  return { ok: true };
}

/** 按手机号滑动窗口限制「成功发出」的短信次数，减少触发阿里云小时级频控 */
const smsSendSuccessWindow = new Map();
function getSmsWindow(norm) {
  const HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let w = smsSendSuccessWindow.get(norm);
  if (!w || now - w.start >= HOUR) {
    w = { start: now, count: 0 };
    smsSendSuccessWindow.set(norm, w);
  }
  return w;
}
function assertSmsSendAllowance(norm) {
  const maxPerHour = parseInt(process.env.SMS_MAX_SENDS_PER_PHONE_PER_HOUR || '4', 10);
  if (!norm || maxPerHour <= 0) return { ok: true };
  const w = getSmsWindow(norm);
  if (w.count >= maxPerHour) {
    return {
      ok: false,
      message:
        '该号码本小时获取验证码次数已达上限，请约1小时后再试，或使用「密码登录」：注册时的用户名或邮箱 + 密码。'
    };
  }
  return { ok: true };
}
function bumpSmsSendSuccess(norm) {
  const maxPerHour = parseInt(process.env.SMS_MAX_SENDS_PER_PHONE_PER_HOUR || '4', 10);
  if (!norm || maxPerHour <= 0) return;
  const w = getSmsWindow(norm);
  w.count += 1;
  smsSendSuccessWindow.set(norm, w);
}

/** 带 announcementId 登录时，须在对应招聘公告报名名单中（考生端 / 求职者个人中心） */
async function assertAnnouncementEnrollmentAccess(userId, announcementId) {
  const annId = parseInt(announcementId, 10);
  if (!Number.isFinite(annId) || annId <= 0) return { ok: true };
  try {
    let ids = [Number(userId)];
    try {
      const merged = await UserModel.getAllIdsWithSamePhoneAsUser(userId);
      if (merged && merged.length) ids = merged;
    } catch (_) {
      /* ignore */
    }
    ids = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
    const ph = ids.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT 1 FROM compat_cooperation_applications WHERE user_id IN (${ph}) AND announcement_id = ? LIMIT 1`,
      [...ids, annId]
    );
    if (rows && rows.length) return { ok: true };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { ok: true };
    console.warn('[auth] assertAnnouncementEnrollmentAccess:', e.message);
  }
  return {
    ok: false,
    message: '您不在该招聘公告的报名名单中，请使用名单中的手机号与身份证后6位登录'
  };
}

// 登录
router.post('/login', async (req, res) => {
  try {
    const rawLogin = String((req.body && (req.body.username || req.body.identifier)) || '').trim();
    const phoneDigits = rawLogin.replace(/\D/g, '');
    const username = rawLogin;
    const password = req.body && req.body.password;
    const utRaw = (req.body && req.body.userType) || '';
    const ut = String(utRaw).trim().toLowerCase();
    const wantEnterprise = ut === 'enterprise' || ut === 'company';
    const wantJobseeker = ut === 'jobseeker' || ut === 'candidate' || ut === 'user';
    const wantAdmin =
      ut === 'admin' || ut === 'administrator' || ut === '超级管理员' || ut === '系统管理员';
    const legacyNoPortal = !ut;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '账号（用户名/手机号/邮箱）和密码不能为空'
      });
    }

    // 查找用户：支持用户名、邮箱或手机号（手机号允许含空格、横线等，先抽数字再匹配）
    const uname = username;
    const isPhoneLogin = /^\d{10,15}$/.test(phoneDigits);
    let user = null;

    // 求职者个人中心：同号多账号时用密码命中导入考生号（身份证后6位），避免只命中已注册主号
    if (wantJobseeker) {
      user = await findJobseekerUserByPassword(rawLogin, phoneDigits, password, utRaw);
    }

    // 显式企业/求职者入口 + 手机号：优先按门户选 qms 账号，避免手机号兼作求职者用户名时误命中求职者导致企业端密码永远错误
    if (!user && isPhoneLogin && (wantEnterprise || wantJobseeker)) {
      user = await findBestUserByPhoneForPortal(phoneDigits, utRaw);
      if (!user && wantEnterprise) {
        user = await findOrCreateEnterpriseUserByPhone(phoneDigits);
      }
    }

    if (!user) {
      user = await UserModel.findByUsername(uname);
      if (user && isPhoneLogin && (wantEnterprise || wantJobseeker)) {
        const portalPre = await assertLoginPortalAllowed(user, utRaw);
        if (!portalPre.ok) {
          const byPhone = await findBestUserByPhoneForPortal(phoneDigits, utRaw);
          if (byPhone) {
            user = byPhone;
          } else if (wantEnterprise) {
            user = await findOrCreateEnterpriseUserByPhone(phoneDigits);
          } else {
            user = null;
          }
        }
      }
    }
    if (!user && /^\d{6,24}$/.test(uname)) {
      user = await UserModel.findByExamNumberSafe(uname);
    }
    if (!user && isPhoneLogin && legacyNoPortal) {
      user = await findBestUserByPhoneForPortal(phoneDigits, utRaw);
    }
    if (!user && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawLogin)) {
      user = await UserModel.findByEmail(rawLogin);
    }
    if (!user && (legacyNoPortal || wantJobseeker)) {
      // 本地未找到考试系统用户时：尝试用人才网求职者账号(sj_users)登录，成功则自动同步到 qms_users（企业端显式登录时不走此路径，避免把求职者同步进 qms 后误发求职者 token）
      try {
        const hashOf = (alg, s) =>
          crypto.createHash(alg).update(String(s ?? ''), 'utf8').digest('hex');
        let sj = null;
        const sjPhoneA = /^\d{10,15}$/.test(phoneDigits) ? phoneDigits : uname;
        const sjPhoneB =
          phoneDigits.length === 11 && phoneDigits.startsWith('1') ? `86${phoneDigits}` : uname;
        const sjPhoneC =
          phoneDigits.length === 13 && phoneDigits.startsWith('86') ? phoneDigits.slice(2) : uname;
        try {
          const [rows] = await pool.execute(
            `SELECT id, username, phone, email, password_hash
             FROM sj_users
             WHERE username = ? OR email = ? OR phone = ? OR phone = ? OR phone = ?
             LIMIT 1`,
            [uname, uname, sjPhoneA, sjPhoneB, sjPhoneC]
          );
          sj = rows && rows[0] ? rows[0] : null;
        } catch (e1) {
          // 兼容 sj_users 表字段名为 password 的情况
          if (e1 && e1.code === 'ER_BAD_FIELD_ERROR') {
            const [rows2] = await pool.execute(
              `SELECT id, username, phone, email, password
               FROM sj_users
               WHERE username = ? OR email = ? OR phone = ? OR phone = ? OR phone = ?
               LIMIT 1`,
              [uname, uname, sjPhoneA, sjPhoneB, sjPhoneC]
            );
            sj = rows2 && rows2[0] ? rows2[0] : null;
          } else {
            throw e1;
          }
        }

        if (sj) {
          const sjPwdHash = sj.password_hash || sj.password || '';
          let ok = false;
          if (typeof sjPwdHash === 'string' && sjPwdHash.startsWith('$2')) {
            // bcrypt
            ok = await bcrypt.compare(String(password), sjPwdHash);
          } else if (typeof sjPwdHash === 'string' && /^[a-f0-9]{32}$/i.test(sjPwdHash)) {
            // md5
            ok = hashOf('md5', password).toLowerCase() === sjPwdHash.toLowerCase();
          } else if (typeof sjPwdHash === 'string' && /^[a-f0-9]{40}$/i.test(sjPwdHash)) {
            // sha1
            ok = hashOf('sha1', password).toLowerCase() === sjPwdHash.toLowerCase();
          } else if (typeof sjPwdHash === 'string' && /^[a-f0-9]{64}$/i.test(sjPwdHash)) {
            // sha256
            ok = hashOf('sha256', password).toLowerCase() === sjPwdHash.toLowerCase();
          } else if (sjPwdHash) {
            // 明文（不推荐，但做兼容）
            ok = String(sjPwdHash) === String(password);
          }
          if (ok) {
            const syncUsername = (sj.username && String(sj.username).trim()) ? String(sj.username).trim() : uname;
            try {
              await UserModel.create({
                username: syncUsername,
                password: String(password),
                role: 'user',
                email: sj.email || null,
                real_name: sj.real_name || sj.username || null,
                phone: sj.phone || null
              });
            } catch (ce) {
              // 可能已存在则忽略
              if (!(ce && (ce.code === 'ER_DUP_ENTRY' || String(ce.message || '').includes('Duplicate')))) {
                throw ce;
              }
            }
            user = await UserModel.findByUsername(syncUsername);
          } else if (
            !user &&
            isExamStudentLoginClient(req.body) &&
            (wantJobseeker || legacyNoPortal)
          ) {
            // 人才网用户名（如 gaoyajun）密码与考试系统不一致时：改按同手机号下的考试考生账号校验
            const sjPh = String(sj.phone || '').replace(/\D/g, '');
            if (sjPh.length >= 10) {
              const qmsByPhone = await findBestUserByPhoneForPortal(sjPh, utRaw);
              if (
                qmsByPhone &&
                qmsByPhone.status === 'active' &&
                (await UserModel.verifyPassword(password, qmsByPhone.password_hash))
              ) {
                user = qmsByPhone;
              }
            }
          }
        }
      } catch (eSync) {
        console.warn('sj_users -> qms_users 同步登录失败:', eSync.message);
      }
    }

    if (!user && wantEnterprise && isPhoneLogin) {
      user = await findOrCreateEnterpriseUserByPhone(phoneDigits);
    }

    if (!user && (legacyNoPortal || wantEnterprise)) {
      // 本地未找到用户时，尝试人才网企业账号登录（企业端用手机号/邮箱在笔试系统登录）
      try {
        const base = TALENT_NETWORK_API_URL.replace(/\/$/, '');
        const { status, data } = await postJson(base + '/api/v1/auth/login-for-exam', {
          identifier: uname,
          password: password
        });
        if (status === 200 && data && data.success && data.data && data.data.examEnterpriseId) {
          const d = data.data;
          const examEnterpriseId = d.examEnterpriseId;
          const companyName = (d.companyName || '').trim() || '企业';
          const examToken = jwt.sign(
            {
              userId: examEnterpriseId,
              username: companyName,
              role: 'enterprise',
              source: 'talent_network',
              enterpriseId: examEnterpriseId,
              portal: 'enterprise'
            },
            JWT_SECRET,
            { expiresIn: '7d' }
          );
          const examUser = {
            id: examEnterpriseId,
            username: companyName,
            role: 'enterprise',
            enterpriseId: examEnterpriseId,
            enterpriseName: companyName
          };
          return res.json({
            success: true,
            token: examToken,
            user: examUser,
            data: {
              token: examToken,
              accessToken: examToken,
              userId: examEnterpriseId,
              username: companyName,
              role: 'enterprise',
              enterpriseId: examEnterpriseId,
              enterpriseName: companyName
            }
          });
        }
      } catch (e) {
        console.warn('人才网 login-for-exam 尝试失败:', e.message);
      }
    }

    if (!user) {
      console.error(`登录失败: 用户不存在 - ${username}`);
      const examStudent = isExamStudentLoginClient(req.body);
      const annIdHint = parseInt(req.body && req.body.announcementId, 10);
      const hasAnnLogin = Number.isFinite(annIdHint) && annIdHint > 0;
      const hint = examStudent || (wantJobseeker && hasAnnLogin)
        ? '请用企业导入名单中的手机号（或身份证号）登录，密码为身份证后6位（未填身份证则为123456）。无需注册。'
        : wantJobseeker
          ? '企业导入考生请使用手机号 + 身份证后6位登录个人中心，无需注册。'
          : process.env.NODE_ENV !== 'production'
            ? '（测试账号需先执行：cd backend && node scripts/create_test_accounts.js；正式环境请确认已在考生管理中被企业导入且手机号一致；企业端也可用人才网企业账号登录）'
            : '';
      const baseMsg =
        examStudent || (wantJobseeker && hasAnnLogin)
          ? '账号未开通或不在该招聘公告名单中'
          : '用户名、手机号、邮箱或密码错误';
      return res.status(200).json({
        success: false,
        message: baseMsg + (hint ? `。${hint}` : '')
      });
    }

    // 检查用户状态
    if (user.status !== 'active') {
      return res.status(200).json({
        success: false,
        message: '账号已被禁用，请联系管理员'
      });
    }

    if (wantJobseeker) {
      await enrichUserIdCardFromCoopApplication(user);
    }
    // Token 缓存：同一账号 5 分钟内重复登录直接返回（跳过昂贵的 bcrypt）
    const tokenCacheKey = `login_token:${user.id}`;
    const cachedLogin = await redisClient.get(tokenCacheKey).catch(() => null);
    if (cachedLogin) {
      return res.json(JSON.parse(cachedLogin));
    }

    // 验证密码（求职者：支持未写入 bcrypt 时用身份证后 6 位明文匹配并自动设密）
    let _lazyMigrateHash = null;
    let isValidPassword;
    if (wantJobseeker) {
      isValidPassword = await UserModel.verifyCandidatePortalPassword(user, password);
    } else {
      const { match, newHash } = await verifyPwdWithMigration(password, user.password_hash);
      isValidPassword = match;
      _lazyMigrateHash = newHash;
    }
    if (!isValidPassword) {
      console.error(`登录失败: 密码错误 - ${username}`);
      const examStudent = isExamStudentLoginClient(req.body);
      const annIdPwd = parseInt(req.body && req.body.announcementId, 10);
      const annPwdCtx = Number.isFinite(annIdPwd) && annIdPwd > 0;
      let msg =
        examStudent || (wantJobseeker && annPwdCtx)
          ? '密码错误：请用身份证后6位（未填身份证则为123456）。登录账号请使用导入名单中的手机号。'
          : wantJobseeker
            ? '密码错误：企业导入考生请使用身份证后6位（未填身份证则为123456），账号为手机号。'
            : '用户名、手机号、邮箱或密码错误';
      if (!examStudent && isPhoneLogin && (wantEnterprise || wantJobseeker)) {
        const otherUt = wantEnterprise ? 'jobseeker' : 'enterprise';
        const altUser = await findBestUserByPhoneForPortal(phoneDigits, otherUt);
        if (
          altUser &&
          altUser.id !== user.id &&
          altUser.status === 'active' &&
          (await UserModel.verifyPassword(password, altUser.password_hash))
        ) {
          msg = wantEnterprise
            ? '您输入的密码对应求职者账号。企业端请使用企业注册时的密码；若尚未注册企业，请先在首页选择「企业注册」。'
            : '您输入的密码对应企业账号。请使用「政企登录」进入企业端，或使用求职者账号的密码登录个人中心。';
        }
      }
      return res.status(200).json({
        success: false,
        message: msg
      });
    }

    // 懒迁移：如果是旧 bcrypt 格式，异步升级为 PBKDF2（不阻塞响应）
    if (_lazyMigrateHash) {
      pool.execute('UPDATE qms_users SET password_hash = ? WHERE id = ?', [_lazyMigrateHash, user.id])
        .catch(e => console.error('[密码迁移] 失败:', e.message));
    }

    if (req.body.announcementId != null && (isExamStudentLoginClient(req.body) || wantJobseeker)) {
      const annCheck = await assertAnnouncementEnrollmentAccess(user.id, req.body.announcementId);
      if (!annCheck.ok) {
        return res.status(200).json({ success: false, message: annCheck.message });
      }
    }

    if (isAdminWebLoginDisabled() && normalizeRoleForPortal(user.role) === 'admin') {
      return res.status(200).json({ success: false, message: adminWebLoginDisabledMessage() });
    }

    // 若同手机号任一号已上传身份证照，且存在启用人脸识别的考试：仅考生考试端登录要求先扫脸再发正式 token
    if (isExamStudentLoginClient(req.body)) {
      let needFaceVerify = await mergedAccountHasIdCard(user.id);
      if (needFaceVerify) {
        needFaceVerify = await hasFaceVerifyExam(user.id);
      }
      if (needFaceVerify) {
        const tempToken = jwt.sign(
          { userId: user.id, purpose: 'face_verify' },
          JWT_SECRET,
          { expiresIn: FACE_VERIFY_TEMP_TOKEN_EXPIRY }
        );
        return res.json({
          success: true,
          needFaceVerify: true,
          userId: user.id,
          tempToken,
          message: '请完成人脸核验'
        });
      }
    }

    if (!legacyNoPortal) {
      const portalRes = await assertLoginPortalAllowed(user, utRaw);
      if (!portalRes.ok) {
        return res.status(200).json({ success: false, message: portalRes.message });
      }
    }

    // 更新最后登录时间
    await UserModel.updateLastLogin(user.id);

    const tokenOpts = {};
    if (wantEnterprise) tokenOpts.portal = 'enterprise';
    else if (wantJobseeker) tokenOpts.portal = 'jobseeker';
    else if (wantAdmin) tokenOpts.portal = 'admin';
    else if (normalizeRoleForPortal(user.role) === 'admin') tokenOpts.portal = 'admin';
    const token = generateToken(user, tokenOpts);

    // 获取用户权限
    const permissions = await UserModel.getPermissions(user.id);

    const loginResponse = {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        real_name: user.real_name,
        permissions
      },
      data: {
        token,
        accessToken: token,
        userId: user.id,
        username: user.username,
        role: user.role,
        userType: user.role,
        email: user.email,
        real_name: user.real_name,
        permissions
      }
    };
    // 登录成功后缓存响应 5 分钟（加速同账号重复登录）
    redisClient.set(tokenCacheKey, JSON.stringify(loginResponse), 300).catch(() => {});
    res.json(loginResponse);
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: '登录失败：' + error.message
    });
  }
});

/**
 * 供笔试系统 login-by-talent-network 调用：校验人才网签发的 JWT，并返回绑定的笔试企业 id。
 * 同域部署时 TALENT_NETWORK_API_URL 指向本机，必须注册此路由，否则会 404/401 导致换票失败。
 */
router.post('/validate-for-exam', async (req, res) => {
  try {
    const token = (req.body && req.body.token) || '';
    if (!token) {
      return res.status(400).json({ success: false, message: '请提供 token' });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的 token 或已过期' });
    }
    if (decoded.source === 'talent_network' && decoded.enterpriseId != null) {
      return res.status(401).json({
        success: false,
        message: '请使用人才网企业端登录 token，不要使用笔试系统已换发的 token'
      });
    }
    const portal = inferLoginPortal(decoded);
    const roleRaw = String(decoded.role || '').trim();
    const roleLow = roleRaw.toLowerCase();
    const cnEnterprise =
      roleRaw === '企业' ||
      roleRaw === '企业用户' ||
      roleRaw === '政企' ||
      roleRaw === '用人单位' ||
      roleRaw === '招聘企业';
    const isEnt =
      portal === 'enterprise' ||
      roleLow === 'enterprise' ||
      roleLow === 'company' ||
      cnEnterprise;
    if (!isEnt) {
      return res.status(401).json({
        success: false,
        message: '仅企业用户可进入笔试系统，请使用人才网「政企/企业」账号登录后再试'
      });
    }
    const uid = decoded.userId;
    if (uid == null) {
      return res.status(401).json({ success: false, message: 'token 中缺少用户标识' });
    }
    let ent = await EnterpriseModel.findByUserId(uid);
    if (!ent) ent = await EnterpriseModel.findByTalentCompanyId(uid);
    if (!ent) ent = await EnterpriseModel.findById(uid);
    if (!ent) {
      return res.status(403).json({
        success: false,
        message: '未找到关联企业，请先在人才网完成企业资料或绑定笔试企业'
      });
    }
    let examEnterpriseId = null;
    if (ent.exam_enterprise_id != null && Number.isFinite(Number(ent.exam_enterprise_id))) {
      examEnterpriseId = Number(ent.exam_enterprise_id);
    } else if (ent.examEnterpriseId != null && Number.isFinite(Number(ent.examEnterpriseId))) {
      examEnterpriseId = Number(ent.examEnterpriseId);
    } else {
      const rawCs = ent.company_status ?? ent.companyStatus ?? ent.profile_json ?? ent.extra_profile;
      if (rawCs != null && rawCs !== '') {
        try {
          const cs = typeof rawCs === 'object' ? rawCs : JSON.parse(String(rawCs));
          if (cs && typeof cs === 'object' && cs.examEnterpriseId != null) {
            const x = Number(cs.examEnterpriseId);
            if (Number.isFinite(x) && x > 0) examEnterpriseId = x;
          }
        } catch (_) {
          /* ignore */
        }
      }
    }
    if (examEnterpriseId == null && ent.talent_company_id != null) {
      const tc = Number(ent.talent_company_id);
      if (Number.isFinite(tc) && tc > 0) examEnterpriseId = tc;
    }
    if (examEnterpriseId == null || !Number.isFinite(examEnterpriseId) || examEnterpriseId <= 0) {
      examEnterpriseId = Number(ent.id);
    }
    if (!examEnterpriseId || !Number.isFinite(examEnterpriseId) || examEnterpriseId <= 0) {
      return res.status(502).json({
        success: false,
        message: '无法解析有效的笔试企业编号，请在企业中心完成「绑定笔试系统」'
      });
    }
    const companyName = (ent.name || decoded.username || '').trim() || '企业';
    return res.json({
      success: true,
      examEnterpriseId,
      companyName
    });
  } catch (e) {
    console.error('[validate-for-exam]', e);
    return res.status(500).json({ success: false, message: e.message || '校验失败' });
  }
});

// 人才网企业账号登录笔试系统：用人才网 token 换取笔试 token，仅企业且已绑定 exam_enterprise_id 可用
router.post('/login-by-talent-network', async (req, res) => {
  try {
    const token = (req.body && req.body.token) || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') && req.headers.authorization.slice(7));
    if (!token) {
      return res.status(400).json({ success: false, message: '请提供人才网 token' });
    }
    const base = TALENT_NETWORK_API_URL.replace(/\/$/, '');
    if (!base || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(base) || /^https?:\/\/localhost(?::\d+)?$/i.test(base)) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[login-by-talent-network] TALENT_NETWORK_API_URL 指向本机或未配置，生产环境将无法校验人才网 token');
      }
    }
    let status;
    let data;
    try {
      const out = await postJson(base + '/api/v1/auth/validate-for-exam', { token });
      status = out.status;
      data = out.data;
    } catch (netErr) {
      console.error('[login-by-talent-network] 无法请求人才网:', netErr.message);
      return res.status(502).json({
        success: false,
        message:
          '无法连接人才网校验服务。请在笔试系统服务器设置环境变量 TALENT_NETWORK_API_URL 为人才网站点根地址（如 https://你的域名），并保证服务器能访问该地址。'
      });
    }
    if (status !== 200 || !data || data.success !== true) {
      return res.status(status === 401 ? 401 : status === 403 ? 403 : 502).json({
        success: false,
        message: (data && data.message) || '人才网校验失败，请先登录人才网并绑定笔试系统企业'
      });
    }
    const examEnterpriseIdNum = parseInt(data.examEnterpriseId, 10);
    if (!examEnterpriseIdNum || !Number.isFinite(examEnterpriseIdNum) || examEnterpriseIdNum <= 0) {
      return res.status(502).json({
        success: false,
        message:
          '人才网未返回有效的笔试企业编号(examEnterpriseId)。请在人才网企业中心完成「绑定笔试系统/一键创建」并确认 exam_enterprise_id 与当前笔试库 enterprises 一致后再试。'
      });
    }
    const examEnterpriseId = examEnterpriseIdNum;
    const companyName = (data.companyName || '').trim() || '企业';
    const examToken = jwt.sign(
      {
        userId: examEnterpriseId,
        username: companyName,
        role: 'enterprise',
        source: 'talent_network',
        enterpriseId: examEnterpriseId
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({
      success: true,
      token: examToken,
      user: {
        id: examEnterpriseId,
        username: companyName,
        role: 'enterprise',
        enterpriseId: examEnterpriseId,
        enterpriseName: companyName
      }
    });
  } catch (e) {
    console.error('login-by-talent-network error:', e);
    res.status(500).json({ success: false, message: e.message || '登录失败' });
  }
});

// 系统间密码同步（按手机号），供求职者端调用，将考试系统中的考生密码更新为与求职端一致
router.post('/sync-password', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.body.apiKey;
    if (apiKey !== EXAM_INVITATIONS_API_KEY) {
      return res.status(401).json({ success: false, message: '未授权' });
    }
    const phoneRaw = (req.body.phone || '').toString().replace(/\D/g, '');
    const password = (req.body.password || '').toString();
    if (!phoneRaw || phoneRaw.length < 10 || !password) {
      return res.status(400).json({ success: false, message: 'phone 和 password 为必填' });
    }
    let user = await UserModel.findByPhone(phoneRaw);
    if (!user && phoneRaw.length === 11 && phoneRaw.startsWith('1')) {
      user = await UserModel.findByPhone('86' + phoneRaw);
    }
    if (!user && phoneRaw.length === 13 && phoneRaw.startsWith('86')) {
      user = await UserModel.findByPhone(phoneRaw.slice(2));
    }
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const passwordHash = await hashPwdUtils(password);
    await UserModel.updatePasswordHash(user.id, passwordHash);
    return res.json({ success: true });
  } catch (e) {
    console.error('sync-password error:', e);
    return res.status(500).json({ success: false, message: e.message || '同步密码失败' });
  }
});

// 发送短信验证码（配置阿里云短信后走 SendSms；SMS_BYPASS=true 时跳过真实发送）
router.post('/send-sms', async (req, res) => {
  try {
    const { phone } = req.body;
    const p = (phone || '').replace(/\D/g, '');
    // 短信绕过模式：跳过手机号格式校验
    if (!SMS_BYPASS && p.length < 11) {
      return res.status(400).json({ success: false, message: '请输入正确的手机号' });
    }
    const phoneForCode = SMS_BYPASS ? (p || '00000000000') : p;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const norm = SMS_BYPASS ? phoneForCode : aliyunSms.normalizePhoneCn(p);
    const smsPurposeRaw = String((req.body && req.body.purpose) || '').toLowerCase();
    const smsPurpose = smsPurposeRaw === 'register' ? 'register' : 'general';

    // 短信绕过模式：直接存 code 到 Redis/内存，跳过真实发送
    if (SMS_BYPASS) {
      await setSmsCode(norm, code);
      if (norm !== phoneForCode) await setSmsCode(phoneForCode, code);
      console.log('[SMS_BYPASS] code for', norm, ':', code);
      return res.json({ success: true, message: '验证码已发送（绕过模式）', bypass: true });
    }
    if (smsPurposeRaw === 'admin') {
      const whitelist = await loadAdminSmsLoginPhonesFromDb();
      if (!whitelist.length) {
        return res.status(403).json({
          success: false,
          message:
            '未配置管理员短信登录手机号。请使用密码登录，或由管理员在「系统设置 → 安全设置」中填写「允许短信登录的管理手机号」后再试'
        });
      }
      if (!phoneMatchesAdminSmsWhitelist(p, whitelist)) {
        return res.status(403).json({
          success: false,
          message: '该手机号未在系统设置中允许用于管理端短信登录'
        });
      }
    }
    if (aliyunSms.isConfigured()) {
      const allow = assertSmsSendAllowance(norm);
      if (!allow.ok) {
        return res.status(429).json({ success: false, message: allow.message });
      }
      try {
        await aliyunSms.sendVerificationCode(norm, code, { purpose: smsPurpose });
        bumpSmsSendSuccess(norm);
        await setSmsCode(norm, code);
        if (norm !== p) await setSmsCode(p, code);
      } catch (sendErr) {
        console.warn('[send-sms] Aliyun SendSms:', sendErr.message || sendErr);
        return res.status(502).json({
          success: false,
          message: aliyunSms.humanizeAliyunSmsSendError(sendErr.message)
        });
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          success: false,
          message: '短信服务未配置，请联系管理员配置阿里云短信环境变量'
        });
      }
      const allowDev = assertSmsSendAllowance(norm);
      if (!allowDev.ok) {
        return res.status(429).json({ success: false, message: allowDev.message });
      }
      bumpSmsSendSuccess(norm);
      await setSmsCode(norm, code);
      if (norm !== p) await setSmsCode(p, code);
      console.log('[DEV] SMS code for', norm, ':', code);
    }
    res.json({ success: true, message: '验证码已发送' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '发送失败' });
  }
});

// 手机号+验证码登录
router.post('/login-by-phone', async (req, res) => {
  try {
    const { phone, code } = req.body;
    const p = (phone || '').replace(/\D/g, '');
    if (p.length < 11) {
      return res.status(400).json({ success: false, message: '请输入正确的手机号' });
    }
    const norm = aliyunSms.normalizePhoneCn(p);
    const vr = await verifyAndConsumeSmsCode(p, code);
    if (!vr.ok) {
      return res.status(401).json({ success: false, message: vr.message });
    }
    const utRaw = String((req.body && req.body.userType) || '').trim();
    const portalUt = utRaw || 'jobseeker';

    if (portalUt === 'admin' || portalUt === 'administrator') {
      const whitelist = await loadAdminSmsLoginPhonesFromDb();
      if (!whitelist.length) {
        return res.status(403).json({
          success: false,
          message:
            '未配置管理员短信登录手机号。请使用密码登录，或由管理员在「系统设置 → 安全设置」中配置允许使用的手机号'
        });
      }
      if (!phoneMatchesAdminSmsWhitelist(p, whitelist)) {
        return res.status(403).json({
          success: false,
          message: '该手机号未在系统设置中允许用于管理端短信登录'
        });
      }
      const adminUser = await findBestUserByPhoneForPortal(p, 'admin');
      if (!adminUser) {
        return res.status(401).json({
          success: false,
          message: '该手机号未绑定系统管理员账号'
        });
      }
      if (normalizeRoleForPortal(adminUser.role) !== 'admin') {
        return res.status(403).json({ success: false, message: '该手机号对应的账号不是管理员' });
      }
      if (adminUser.status !== 'active') {
        return res.status(401).json({ success: false, message: '账号已被禁用' });
      }
      if (isAdminWebLoginDisabled()) {
        return res.status(403).json({ success: false, message: adminWebLoginDisabledMessage() });
      }
      await UserModel.updateLastLogin(adminUser.id);
      const adminToken = generateToken(adminUser, { portal: 'admin' });
      const adminPerms = await UserModel.getPermissions(adminUser.id);
      return res.json({
        success: true,
        token: adminToken,
        data: {
          token: adminToken,
          accessToken: adminToken,
          userId: adminUser.id,
          username: adminUser.username,
          userType: 'admin',
          role: adminUser.role,
          email: adminUser.email
        },
        user: {
          id: adminUser.id,
          username: adminUser.username,
          role: adminUser.role,
          email: adminUser.email,
          real_name: adminUser.real_name,
          phone: adminUser.phone,
          permissions: adminPerms
        }
      });
    }

    let user = await findBestUserByPhoneForPortal(p, portalUt);
    if (!user) {
      if (portalUt === 'enterprise' || portalUt === 'company') {
        user = await findOrCreateEnterpriseUserByPhone(p);
      } else {
        user = await trySyncSjJobseekerByPhone(p);
      }
    }
    if (!user) {
      let notFoundMsg =
        req.body.announcementId != null
          ? '该手机号不在本公告导入名单中，请核对名单或使用密码登录（手机号/身份证号 + 身份证后6位）'
          : '该手机号未注册；企业导入考生请使用名单手机号 + 身份证后6位密码登录，无需注册';
      if (portalUt === 'jobseeker' || portalUt === 'candidate' || portalUt === 'user') {
        try {
          const hints = await detectPhonePortalHints(p);
          if (hints.hasEnterprise && !hints.hasJobseeker) {
            notFoundMsg = '该手机号已绑定企业账号，请使用「政企登录」进入企业端';
          } else if (hints.hasAdmin && !hints.hasJobseeker) {
            notFoundMsg = '该手机号为管理员账号，请从管理后台登录';
          }
        } catch (_) {
          // ignore hint detect failure
        }
      }
      return res.status(401).json({
        success: false,
        message: notFoundMsg
      });
    }
    if (user.status !== 'active') {
      return res.status(401).json({ success: false, message: '账号已被禁用' });
    }
    if (isAdminWebLoginDisabled() && normalizeRoleForPortal(user.role) === 'admin') {
      return res.status(403).json({ success: false, message: adminWebLoginDisabledMessage() });
    }
    const portalRes = await assertLoginPortalAllowed(user, portalUt);
    if (!portalRes.ok) {
      return res.status(403).json({ success: false, message: portalRes.message });
    }
    const wantJobSms =
      portalUt === 'jobseeker' || portalUt === 'candidate' || portalUt === 'user';
    if (req.body.announcementId != null && (isExamStudentLoginClient(req.body) || wantJobSms)) {
      const annCheck = await assertAnnouncementEnrollmentAccess(user.id, req.body.announcementId);
      if (!annCheck.ok) {
        return res.status(200).json({ success: false, message: annCheck.message });
      }
    }
    if (isExamStudentLoginClient(req.body)) {
      let needFaceVerify = await mergedAccountHasIdCard(user.id);
      if (needFaceVerify) {
        needFaceVerify = await hasFaceVerifyExam(user.id);
      }
      if (needFaceVerify) {
        const tempToken = jwt.sign(
          { userId: user.id, purpose: 'face_verify' },
          JWT_SECRET,
          { expiresIn: FACE_VERIFY_TEMP_TOKEN_EXPIRY }
        );
        return res.json({
          success: true,
          needFaceVerify: true,
          userId: user.id,
          tempToken,
          message: '请完成人脸核验'
        });
      }
    }
    await UserModel.updateLastLogin(user.id);
    const wantEnt = portalUt === 'enterprise' || portalUt === 'company';
    const tokenPortal = wantEnt ? 'enterprise' : 'jobseeker';
    const token = generateToken(user, { portal: tokenPortal });
    const permissions = await UserModel.getPermissions(user.id);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        real_name: user.real_name,
        phone: user.phone,
        permissions
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '登录失败' });
  }
});

// 扫脸身份核验（登录后需核验时用 tempToken + 现场人脸图）
router.post('/face-verify', async (req, res) => {
  try {
    const { tempToken, faceImage } = req.body;
    if (!tempToken || !faceImage) {
      return res.status(400).json({ success: false, message: '请提供临时凭证并拍摄人脸' });
    }
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: '核验凭证无效或已过期，请重新登录' });
    }
    if (decoded.purpose !== 'face_verify' || !decoded.userId) {
      return res.status(401).json({ success: false, message: '无效的核验凭证' });
    }
    const userId = decoded.userId;
    const user = await UserModel.findByIdWithIdCardImage(userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ success: false, message: '用户不存在或已被禁用' });
    }
    let idCardPath = user.id_card_image_path && String(user.id_card_image_path).trim();
    if (!idCardPath) {
      try {
        const merged = await UserModel.getAllIdsWithSamePhoneAsUser(userId);
        for (const oid of merged) {
          if (Number(oid) === Number(userId)) continue;
          const u2 = await UserModel.findByIdWithIdCardImage(oid);
          if (u2 && u2.status === 'active' && u2.id_card_image_path && String(u2.id_card_image_path).trim()) {
            idCardPath = String(u2.id_card_image_path).trim();
            break;
          }
        }
      } catch (e) {
        console.warn('[face-verify] merge id card path:', e.message);
      }
    }
    if (!idCardPath) {
      return res.status(400).json({ success: false, message: '该账号未配置身份证照片，请使用账号密码直接登录' });
    }
    const cmp = await faceIdCompare.compareLiveFaceWithIdCard({
      idCardImageRef: idCardPath,
      liveFaceImageBase64: faceImage
    });
    if (!cmp.ok) {
      return res.status(400).json({ success: false, message: cmp.message || '人脸与身份证核验未通过' });
    }
    await UserModel.updateLastLogin(userId);
    const rFace = normalizeRoleForPortal(user.role);
    const tokenPortal =
      user.role === 'enterprise' || rFace === 'enterprise'
        ? 'enterprise'
        : rFace === 'admin'
          ? 'admin'
          : 'jobseeker';
    const token = generateToken(user, { portal: tokenPortal });
    const permissions = await UserModel.getPermissions(userId);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        real_name: user.real_name,
        permissions
      }
    });
  } catch (e) {
    console.error('Face verify error:', e);
    res.status(500).json({ success: false, message: e.message || '验证失败' });
  }
});

// 公开自助注册（首页、求职者注册页；无需 token，与管理员「创建账号」/register 分离）
async function handleSelfRegister(req, res) {
  try {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim();
    const phoneRaw = String(body.phone || '').trim();
    const password = body.password != null ? String(body.password) : '';
    const userTypeRaw = String(body.userType || 'jobseeker').toLowerCase();
    const isEnterprise = userTypeRaw === 'enterprise' || userTypeRaw === 'company';

    if (!username || username.length < 2) {
      return res.status(400).json({ success: false, message: '用户名至少 2 个字符' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: '请填写有效邮箱' });
    }
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    // 短信绕过模式：跳过手机号格式校验
    if (!SMS_BYPASS && phoneDigits.length < 10) {
      return res.status(400).json({ success: false, message: '请填写有效手机号' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: '密码至少 6 位' });
    }

    if (await UserModel.findByUsername(username)) {
      return res.status(400).json({ success: false, message: '用户名已被使用' });
    }
    const phoneNorm = phoneDigits;
    const portalForReg = isEnterprise ? 'enterprise' : 'jobseeker';
    const existingSamePortal = await findBestUserByPhoneForPortal(phoneNorm, portalForReg);
    if (existingSamePortal) {
      return res.status(400).json({
        success: false,
        message: isEnterprise
          ? '该手机号已注册企业账号，请直接「政企登录」'
          : '该手机号已注册求职者账号，请直接登录个人中心'
      });
    }

    // 短信绕过模式下始终走验证码校验（但接受任意码）；正常模式仅配置了阿里云才校验
    if (SMS_BYPASS || aliyunSms.isConfigured()) {
      const smsCode = String(body.smsCode || body.code || '').trim();
      const vr = await verifyAndConsumeSmsCode(phoneDigits, smsCode);
      if (!vr.ok) {
        return res.status(400).json({ success: false, message: vr.message });
      }
    }

    try {
      const [emRows] = await pool.execute(
        'SELECT id FROM qms_users WHERE email = ? AND TRIM(COALESCE(email,\'\')) <> \'\' LIMIT 1',
        [email]
      );
      if (emRows && emRows[0]) {
        return res.status(400).json({ success: false, message: '邮箱已被注册' });
      }
    } catch (eEm) {
      if (eEm.code !== 'ER_BAD_FIELD_ERROR') console.warn('register-self email check:', eEm.message);
    }

    const role = isEnterprise ? 'enterprise' : 'user';
    const phoneToSave = phoneNorm.length >= 10 ? phoneNorm : phoneRaw;
    const userId = await UserModel.create({
      username,
      password,
      role,
      email,
      real_name: username,
      phone: phoneToSave
    });
    await UserModel.updatePhoneSafe(userId, phoneToSave);

    let enterpriseId = null;
    if (isEnterprise) {
      try {
        enterpriseId = await EnterpriseModel.create({
          name: username,
          contactName: username,
          contactPhone: phoneNorm.length >= 10 ? phoneNorm : phoneRaw,
          contactEmail: email,
          address: null,
          userId
        });
      } catch (ee) {
        console.error('register-self enterprise:', ee.message);
        try {
          await pool.execute('DELETE FROM qms_users WHERE id = ?', [userId]);
        } catch (eDel) {
          console.warn('register-self rollback user:', eDel.message);
        }
        return res.status(500).json({
          success: false,
          message: '企业档案创建失败，请稍后重试或联系管理员'
        });
      }
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(500).json({ success: false, message: '注册异常，请重试' });
    }
    const token = generateToken(
      { id: user.id, username: user.username, role: user.role },
      { portal: isEnterprise ? 'enterprise' : 'jobseeker' }
    );

    return res.status(201).json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        email: user.email,
        userType: isEnterprise ? 'enterprise' : 'jobseeker',
        accessToken: token,
        token,
        enterpriseId
      }
    });
  } catch (error) {
    console.error('register-self error:', error);
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: '用户名、手机或邮箱已存在' });
    }
    return res.status(500).json({
      success: false,
      message: '注册失败：' + (error.message || '服务器错误')
    });
  }
}

router.post('/register-self', handleSelfRegister);

// 兼容旧前端：无鉴权调用 /register 时按公开注册处理；管理员携带 token 调用时仍是后台建号
router.post('/register', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
    if (!bearerToken) {
      return handleSelfRegister(req, res);
    }
    const decoded = verifyToken(bearerToken);
    if (!decoded || !decoded.userId) {
      return handleSelfRegister(req, res);
    }
    const operator = await UserModel.findById(decoded.userId);
    if (!operator || normalizeRoleForPortal(operator.role) !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以创建账号'
      });
    }

    const { username, password, role = 'user', email, real_name } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空'
      });
    }

    // 检查用户名是否已存在
    const existingUser = await UserModel.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '用户名已存在'
      });
    }

    // 创建用户
    const userId = await UserModel.create({
      username,
      password,
      role,
      email,
      real_name
    });

    res.json({
      success: true,
      message: '账号创建成功',
      userId
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: '注册失败：' + error.message
    });
  }
});

// 刷新token
router.post('/refresh', authenticate, async (req, res) => {
  try {
    // 重新生成token
    const user = await UserModel.findById(req.user.id);
    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: '用户不存在或已被禁用'
      });
    }

    const prevPortal = req.tokenDecoded && req.tokenDecoded.portal;
    const token = generateToken(user, prevPortal ? { portal: prevPortal } : {});

    res.json({
      success: true,
      token
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: '刷新token失败'
    });
  }
});

// 获取当前用户信息
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    const userWithIdCard = await UserModel.findByIdWithIdCardImage(req.user.id).catch(() => user);
    const permissions = await UserModel.getPermissions(req.user.id);
    let need_face_verify = !!(userWithIdCard && userWithIdCard.id_card_image_path && userWithIdCard.id_card_image_path.trim());
    if (need_face_verify) {
      need_face_verify = await hasFaceVerifyExam(user.id);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        real_name: user.real_name,
        permissions,
        need_face_verify
      }
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

// 自检：查看当前 token 解析出的用户/角色（用于排查 401/403）
router.get('/whoami', authenticate, async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id);
    const permissions = await UserModel.getPermissions(req.user.id).catch(() => null);
    res.json({
      success: true,
      data: {
        user: req.user,
        tokenDecoded: req.tokenDecoded || null,
        loginPortal: req.loginPortal != null ? req.loginPortal : null,
        dbUser: user || null,
        permissions,
        enterpriseId: req.enterpriseId || null,
        isGuest: !!req.isGuest
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'whoami失败' });
  }
});

// 子阅卷账号登录
router.post('/login-grader', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空'
      });
    }

    // 查找子阅卷账号
    const account = await GradingAccountModel.findByUsername(username);
    if (!account) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 检查账号状态
    if (account.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: '账号已被禁用，请联系管理员'
      });
    }

    // 验证密码
    const isValidPassword = await GradingAccountModel.verifyPassword(password, account.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 更新最后登录时间
    await GradingAccountModel.updateLastLogin(account.id);

    // 生成token（使用grader角色）
    const token = generateToken(
      {
        id: account.id,
        username: account.username,
        role: 'grader'
      },
      { portal: 'grader' }
    );

    res.json({
      success: true,
      data: {
        token,
        account: {
          id: account.id,
          username: account.username,
          real_name: account.real_name,
          email: account.email,
          enterprise_id: account.enterprise_id || null // 返回企业ID，用于判断账号类型
        }
      }
    });
  } catch (error) {
    console.error('Grader login error:', error);
    res.status(500).json({
      success: false,
      message: '登录失败：' + error.message
    });
  }
});

let compatEnterpriseReviewersLoginTableReady = false;
async function ensureCompatEnterpriseReviewersTableForAuth() {
  if (compatEnterpriseReviewersLoginTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_reviewers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NOT NULL,
      username VARCHAR(128) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      allowed_project_ids LONGTEXT NULL COMMENT 'JSON 数组；NULL=可审全部岗位',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_reviewer_username (username),
      KEY idx_ent (enterprise_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业子审核账号'
  `);
  compatEnterpriseReviewersLoginTableReady = true;
}

/** 企业子审核账号登录（tests.html 仅审核视图） */
router.post('/login-enterprise-reviewer', async (req, res) => {
  try {
    const username = String((req.body && req.body.username) || '').trim();
    const password = req.body && req.body.password;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    await ensureCompatEnterpriseReviewersTableForAuth();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_enterprise_reviewers WHERE username = ? AND status = ? LIMIT 1',
      [username, 'active']
    );
    const row = rows && rows[0];
    if (!row) {
      return res.status(401).json({ success: false, message: '账号或密码错误' });
    }
    const { match: ok } = await verifyPwdWithMigration(String(password), String(row.password_hash || ''));
    if (!ok) {
      return res.status(401).json({ success: false, message: '账号或密码错误' });
    }
    const payload = {
      type: 'enterprise_reviewer',
      reviewerId: row.id,
      enterpriseId: row.enterprise_id,
      username: row.username
    };
    if (row.allowed_project_ids != null && String(row.allowed_project_ids).trim() !== '') {
      try {
        const j = JSON.parse(row.allowed_project_ids);
        if (Array.isArray(j)) payload.allowedProjectIds = j;
      } catch (_) {
        payload.allowedProjectIds = [];
      }
    }
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    let reviewerAllowedProjectIds = null;
    if (Object.prototype.hasOwnProperty.call(payload, 'allowedProjectIds')) {
      reviewerAllowedProjectIds = payload.allowedProjectIds
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
    return res.json({
      success: true,
      token,
      user: {
        id: row.id,
        username: row.username,
        role: 'enterprise_reviewer',
        enterpriseId: row.enterprise_id,
        reviewerAllowedProjectIds
      }
    });
  } catch (e) {
    console.error('login-enterprise-reviewer error:', e);
    return res.status(500).json({ success: false, message: e.message || '登录失败' });
  }
});

module.exports = router;
