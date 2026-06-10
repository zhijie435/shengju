const EnterpriseModel = require('../models/enterpriseModel');

/** 与 exam-papers、exams 列表一致：归一化 role 字符串 */
function normalizeRoleForList(raw) {
  if (raw == null) return '';
  const r = String(raw).trim();
  const low = r.toLowerCase();
  if (!r) return '';
  if (low === 'admin' || low === 'administrator' || low === 'super_admin' || low === 'superadmin' || low === 'super-admin') return 'admin';
  if (r === '管理员' || r === '系统管理员' || r === '超级管理员') return 'admin';
  if (low === 'enterprise' || low === 'company') return 'enterprise';
  if (r === '企业' || r === '企业用户' || r === '政企' || r === '用人单位' || r === '招聘企业') return 'enterprise';
  if (low === 'enterprise_reviewer') return 'enterprise_reviewer';
  if (low === 'grader') return 'grader';
  return low;
}

/**
 * 企业端：合并 JWT / 主账号 enterprises 行 / 地址栏 enterpriseId（已校验归属），用于 IN 查询。
 * 人才换票 JWT 的 enterpriseId 与真实考试 enterprises.id 不一致时，避免列表恒空。
 */
async function collectEnterpriseScopeIds(req) {
  const normRole = normalizeRoleForList(req.user && req.user.role);
  const ids = new Set();
  const rawA = req.enterpriseId != null && req.enterpriseId !== '' ? parseInt(String(req.enterpriseId), 10) : NaN;
  if (Number.isFinite(rawA) && rawA > 0) ids.add(rawA);
  if (req.user && req.user.enterpriseId != null && req.user.enterpriseId !== '') {
    const rawB = parseInt(String(req.user.enterpriseId), 10);
    if (Number.isFinite(rawB) && rawB > 0) ids.add(rawB);
  }
  if (!(normRole === 'enterprise' || normRole === 'enterprise_reviewer') || !req.user) {
    return [...ids];
  }
  try {
    const uid = req.user.id != null ? Number(req.user.id) : NaN;
    const jwtEnt = Number.isFinite(rawA) && rawA > 0 ? rawA : NaN;
    const tokenLooksLikeEnterprisePk =
      Number.isFinite(uid) &&
      Number.isFinite(jwtEnt) &&
      uid === jwtEnt &&
      (normRole === 'enterprise' || String(req.user.role || '').toLowerCase() === 'enterprise');
    if (tokenLooksLikeEnterprisePk) {
      const row = await EnterpriseModel.findById(uid);
      if (row && row.user_id != null) {
        const ou = Number(row.user_id);
        if (Number.isFinite(ou) && ou > 0) {
          const ent = await EnterpriseModel.findByUserId(ou);
          if (ent && ent.id != null) {
            const n = Number(ent.id);
            if (Number.isFinite(n) && n > 0) ids.add(n);
          }
        }
      }
    } else if (req.user.id != null) {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (ent && ent.id != null) {
        const n = Number(ent.id);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
  } catch (_) {
    /* ignore */
  }
  const qStr =
    req.query && req.query.enterpriseId != null ? String(req.query.enterpriseId).trim() : '';
  const qEnt = qStr !== '' ? parseInt(qStr, 10) : NaN;
  if (Number.isFinite(qEnt) && qEnt > 0 && (normRole === 'enterprise' || normRole === 'enterprise_reviewer')) {
    try {
      if (!ids.has(qEnt)) {
        const row = await EnterpriseModel.findById(qEnt);
        if (row && req.user) {
          const uid = req.user.id != null ? Number(req.user.id) : NaN;
          const ou = row.user_id != null ? Number(row.user_id) : NaN;
          const tc = row.talent_company_id != null ? Number(row.talent_company_id) : NaN;
          const tokEnt =
            req.user.enterpriseId != null ? parseInt(String(req.user.enterpriseId), 10) : NaN;
          let allow = false;
          if (Number.isFinite(ou) && ou > 0 && Number.isFinite(uid) && ou === uid) allow = true;
          if (!allow && Number.isFinite(tc) && tc > 0 && Number.isFinite(uid) && tc === uid) allow = true;
          if (!allow && Number.isFinite(tokEnt) && tokEnt > 0 && qEnt === tokEnt) allow = true;
          const dec = req.tokenDecoded;
          if (!allow && dec && dec.source === 'talent_network' && dec.userId != null) {
            const ju = Number(dec.userId);
            if (Number.isFinite(ju) && ju > 0 && Number.isFinite(tc) && tc === ju) allow = true;
          }
          if (allow) ids.add(qEnt);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return [...ids];
}

module.exports = {
  normalizeRoleForList,
  collectEnterpriseScopeIds
};
