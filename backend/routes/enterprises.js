const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const { pool } = require('../config/database');
const EnterpriseModel = require('../models/enterpriseModel');
const UserModel = require('../models/userModel');
const { authenticate, requireRole } = require('../middleware/auth');

const TALENT_NETWORK_API_URL = process.env.TALENT_NETWORK_API_URL || 'http://127.0.0.1:3001';
const EXAM_TALENT_INTERNAL_API_KEY = process.env.EXAM_TALENT_INTERNAL_API_KEY || '';
const EXAM_INVITATIONS_API_KEY = process.env.EXAM_INVITATIONS_API_KEY || 'shengju-exam-invitations-key';

function postJsonWithHeaders(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body || {});
      const headers = Object.assign(
        {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        extraHeaders || {}
      );
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method: 'POST',
          headers
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => {
            buf += c;
          });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: buf ? JSON.parse(buf) : {} });
            } catch (_) {
              resolve({ status: res.statusCode, data: {} });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// 总管理：企业列表
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const list = await EnterpriseModel.list({
      status: req.query.status,
      name: req.query.name,
      page: req.query.page,
      pageSize: req.query.pageSize
    });
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 总管理：删除企业（危险操作，仅管理员可用）
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的企业ID' });
    }
    const ent = await EnterpriseModel.findById(id);
    if (!ent) {
      return res.status(404).json({ success: false, message: '企业不存在或已删除' });
    }
    await EnterpriseModel.delete(id);
    return res.json({ success: true, message: '已删除企业及其相关数据（根据外键级联策略）' });
  } catch (e) {
    console.error('Delete enterprise error:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

// 企业端：获取自己的企业信息（人才网登录时用 enterpriseId 查，否则用 user_id）
router.get('/me', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    let ent = null;
    const tryId = (v) => {
      const n = v != null && v !== '' ? Number(v) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const idsToTry = [];
    const a = tryId(req.user && req.user.enterpriseId);
    const b = tryId(req.enterpriseId);
    if (a) idsToTry.push(a);
    if (b && b !== a) idsToTry.push(b);
    for (const id of idsToTry) {
      ent = await EnterpriseModel.findById(id);
      if (ent) break;
    }
    // JWT 里的 enterprises.id 已删或迁主键后，回退到主账号绑定的企业行
    if (!ent && req.user && req.user.id != null) {
      ent = await EnterpriseModel.findByUserId(req.user.id);
    }
    // 人才网签：userId 与 enterpriseId 同为笔试主键时，用 enterprises.user_id 再解析主行
    if (
      !ent &&
      req.tokenDecoded &&
      String(req.tokenDecoded.source || '') === 'talent_network' &&
      req.tokenDecoded.enterpriseId != null
    ) {
      const uid = Number(req.tokenDecoded.userId);
      const eidTok = Number(req.tokenDecoded.enterpriseId);
      if (Number.isFinite(uid) && uid > 0 && Number.isFinite(eidTok) && uid === eidTok) {
        const row = await EnterpriseModel.findById(uid);
        if (row && row.user_id != null) {
          const ou = Number(row.user_id);
          if (Number.isFinite(ou) && ou > 0) {
            ent = await EnterpriseModel.findByUserId(ou);
          }
        }
      }
      /** 换票后 JWT 里 enterpriseId 与 userId 可能不同（历史签发/多版本）；再按 token 内 enterpriseId 主键试一次 */
      if (!ent && Number.isFinite(eidTok) && eidTok > 0) {
        ent = await EnterpriseModel.findById(eidTok);
      }
    }
    if (!ent && req.user && req.user.id != null) {
      ent = await EnterpriseModel.findByTalentCompanyId(req.user.id);
    }
    if (!ent && req.user && req.user.id != null) {
      ent = await EnterpriseModel.findById(req.user.id);
    }
    /** 迁库后常见：qms_users.enterprise_id 已指向主企业行，enterprises.user_id 尚未与当前登录 id 对齐 */
    if (!ent && req.user && req.user.id != null) {
      try {
        const [rows] = await pool.execute('SELECT enterprise_id FROM qms_users WHERE id = ? LIMIT 1', [
          req.user.id
        ]);
        const qe = rows && rows[0] && rows[0].enterprise_id;
        const qn = qe != null ? Number(qe) : NaN;
        if (Number.isFinite(qn) && qn > 0) ent = await EnterpriseModel.findById(qn);
      } catch (eq) {
        if (eq.code !== 'ER_BAD_FIELD_ERROR') {
          console.warn('[enterprises/me] qms_users.enterprise_id:', eq.message);
        }
      }
    }
    /**
     * 未解析到企业行：HTTP 200 + success true + data null，避免与网关「路由不存在」404 混淆；
     * 且 exam-admin axios 对 success:false 会全局 ElMessage + reject，此处不应走 success:false。
     */
    if (!ent) {
      return res.status(200).json({
        success: true,
        data: null,
        meta: { linked: false, message: '未关联企业' }
      });
    }
    res.json({ success: true, data: ent });
  } catch (e) {
    console.warn('获取企业信息失败:', e.message);
    res.status(503).json({ success: false, message: '企业信息暂不可用，请确认数据库已初始化' });
  }
});

// 测评缴费设置：与 talentSiteCompat 的 /companies/me/assessment-fee-settings 同源处理，双挂 enterprises 供网关只转发 /enterprises 时仍可用
const talentSiteCompatRouter = require('./talentSiteCompat');
if (typeof talentSiteCompatRouter.getCompatAssessmentFeeSettings === 'function') {
  router.get(
    '/me/assessment-fee-settings',
    authenticate,
    requireRole('enterprise', 'admin'),
    talentSiteCompatRouter.getCompatAssessmentFeeSettings
  );
  router.put(
    '/me/assessment-fee-settings',
    authenticate,
    requireRole('enterprise', 'admin'),
    talentSiteCompatRouter.putCompatAssessmentFeeSettings
  );
}

// 总管理/企业：获取单个企业
router.get('/:id', authenticate, async (req, res) => {
  try {
    const ent = await EnterpriseModel.findById(req.params.id);
    if (!ent) return res.status(404).json({ success: false, message: '企业不存在' });
    if (req.user.role !== 'admin') {
      const mine = req.user.enterpriseId
        ? await EnterpriseModel.findById(req.user.enterpriseId)
        : await EnterpriseModel.findByUserId(req.user.id);
      if (!mine || mine.id !== parseInt(req.params.id)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }
    res.json({ success: true, data: ent });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 总管理：创建企业（支持新建账号或关联已有账号）
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, contactName, contactPhone, contactEmail, address, userId, username, password, talentCompanyId } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '企业名称必填' });

    let finalUserId = userId || null;

    const tid = talentCompanyId != null ? parseInt(talentCompanyId, 10) : NaN;
    if (Number.isFinite(tid) && tid > 0) {
      const bound = await EnterpriseModel.findByTalentCompanyId(tid);
      if (bound) {
        return res.status(409).json({
          success: false,
          message: `该人才网企业已绑定笔试企业（笔试企业ID: ${bound.id}），每个人才网企业仅允许一个考试端账号，请勿重复创建`
        });
      }
    }

    // 若传入 username 且 password 非空，则新建企业账号
    if (username && String(username).trim() && password && String(password).trim()) {
      const existing = await UserModel.findByUsername(String(username).trim());
      if (existing) return res.status(400).json({ success: false, message: '该账号已存在，请换用其他账号' });
      if (String(password).trim().length < 6) return res.status(400).json({ success: false, message: '密码至少6位' });
      finalUserId = await UserModel.create({
        username: String(username).trim(),
        password: String(password).trim(),
        role: 'enterprise',
        real_name: name
      });
    }

    const id = await EnterpriseModel.create({
      name,
      contactName,
      contactPhone,
      contactEmail,
      address,
      userId: finalUserId,
      talentCompanyId: talentCompanyId != null ? parseInt(talentCompanyId, 10) : null
    });

    // 创建成功后，尝试按名称自动匹配人才网企业并建立绑定（最佳努力，不影响主流程）
    (async () => {
      try {
        const base = (TALENT_NETWORK_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
        const keyword = String(name || '').trim();
        if (!keyword || !EXAM_TALENT_INTERNAL_API_KEY) {
          return;
        }
        const { status, data } = await postJsonWithHeaders(
          base + '/api/v1/companies/internal/search',
          { keyword, limit: 10 },
          { 'x-api-key': EXAM_TALENT_INTERNAL_API_KEY }
        );
        if (status !== 200 || !data || !Array.isArray(data.data)) {
          return;
        }
        const exactMatches = data.data.filter((item) => {
          const companyName = (item.companyName || item.company_name || '').trim();
          return companyName && companyName === keyword;
        });
        if (exactMatches.length !== 1) {
          return;
        }
        const companyId = parseInt(exactMatches[0].id, 10);
        if (!companyId || !Number.isFinite(companyId) || companyId <= 0) {
          return;
        }

        const already = await EnterpriseModel.findByTalentCompanyId(companyId);
        if (already && already.id !== id) {
          console.warn('[enterprise-auto-bind] talent_company_id already bound to another enterprise', {
            newEnterpriseId: id,
            existingEnterpriseId: already.id,
            companyId
          });
          return;
        }

        await EnterpriseModel.update(id, { talent_company_id: companyId });

        try {
          await postJsonWithHeaders(
            `${base}/api/v1/companies/internal/${companyId}/bind-exam-enterprise`,
            { examEnterpriseId: id },
            { 'x-api-key': EXAM_TALENT_INTERNAL_API_KEY }
          );
        } catch (bindErr) {
          console.error('[enterprise-auto-bind] bind-exam-enterprise failed:', bindErr);
        }

        console.log('[enterprise-auto-bind] matched', { enterpriseId: id, companyId });
      } catch (autoErr) {
        console.error('[enterprise-auto-bind] error:', autoErr);
      }
    })();

    res.json({ success: true, data: { id } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 由人才网发起：在笔试系统创建企业并回写人才网绑定（API Key 鉴权，无需登录）
// POST /api/enterprises/create-from-talent-network
router.post('/create-from-talent-network', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['x-api_key'] || req.body.apiKey;
    if (!EXAM_INVITATIONS_API_KEY || !apiKey || String(apiKey) !== String(EXAM_INVITATIONS_API_KEY)) {
      return res.status(401).json({ success: false, message: '未授权的内部调用' });
    }

    const { talentCompanyId, companyName, contactName, contactPhone, contactEmail, username, password } = req.body || {};
    const rawTalentId = talentCompanyId != null ? parseInt(talentCompanyId, 10) : NaN;
    if (!rawTalentId || !Number.isFinite(rawTalentId) || rawTalentId <= 0) {
      return res.status(400).json({ success: false, message: '缺少或无效的 talentCompanyId' });
    }
    const name = (companyName || '').toString().trim();
    if (!name) {
      return res.status(400).json({ success: false, message: '企业名称 companyName 必填' });
    }

    let finalUserId = null;
    if (username != null && String(username).trim() && password != null && String(password).trim()) {
      if (String(password).trim().length < 6) {
        return res.status(400).json({ success: false, message: '密码至少6位' });
      }
      const uname = String(username).trim();
      let existing = await UserModel.findByUsername(uname);
      if (!existing && contactPhone && String(contactPhone).trim()) {
        existing = await UserModel.findByPhone(String(contactPhone).trim());
      }
      if (!existing && contactEmail && String(contactEmail).trim()) {
        try {
          const [rows] = await require('../config/database').pool.execute(
            'SELECT id, username, role FROM users WHERE email = ? LIMIT 1',
            [String(contactEmail).trim().toLowerCase()]
          );
          existing = rows && rows[0] ? rows[0] : null;
        } catch (_) {}
      }
      if (existing) {
        if (existing.role === 'enterprise') {
          finalUserId = existing.id;
          await UserModel.updatePassword(existing.id, String(password).trim());
        } else {
          return res.status(400).json({ success: false, message: '该账号已存在且非企业账号，请换用其他账号' });
        }
      } else {
        finalUserId = await UserModel.create({
          username: uname,
          password: String(password).trim(),
          role: 'enterprise',
          email: (contactEmail || '').toString().trim() || null,
          real_name: name,
          phone: (contactPhone || '').toString().trim() || null
        });
      }
    }

    const existingEnt = await EnterpriseModel.findByTalentCompanyId(rawTalentId);
    let id;
    if (existingEnt) {
      id = existingEnt.id;
      const patch = {
        name,
        contactName: (contactName || '').toString().trim() || null,
        contactPhone: (contactPhone || '').toString().trim() || null,
        contactEmail: (contactEmail || '').toString().trim() || null,
        talentCompanyId: rawTalentId,
        status: 'approved'
      };
      if (finalUserId != null) {
        patch.userId = finalUserId;
      }
      await EnterpriseModel.update(id, patch);
    } else {
      id = await EnterpriseModel.create({
        name,
        contactName: (contactName || '').toString().trim() || null,
        contactPhone: (contactPhone || '').toString().trim() || null,
        contactEmail: (contactEmail || '').toString().trim() || null,
        address: null,
        userId: finalUserId,
        talentCompanyId: rawTalentId
      });
      await EnterpriseModel.update(id, { status: 'approved' });
    }

    const base = (TALENT_NETWORK_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
    if (EXAM_TALENT_INTERNAL_API_KEY) {
      try {
        await postJsonWithHeaders(
          `${base}/api/v1/companies/internal/${rawTalentId}/bind-exam-enterprise`,
          { examEnterpriseId: id },
          { 'x-api-key': EXAM_TALENT_INTERNAL_API_KEY }
        );
      } catch (bindErr) {
        console.error('[create-from-talent-network] bind-exam-enterprise failed:', bindErr);
      }
    }

    res.json({ success: true, examEnterpriseId: id, reusedExisting: !!existingEnt });
  } catch (e) {
    console.error('[create-from-talent-network] error:', e);
    res.status(500).json({ success: false, message: e.message || '创建失败' });
  }
});

// 总管理：更新企业（审核、禁用等）
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const selfId = parseInt(req.params.id, 10);
    const tid = req.body.talentCompanyId ?? req.body.talent_company_id;
    if (tid != null && String(tid).trim() !== '') {
      const n = parseInt(tid, 10);
      if (Number.isFinite(n) && n > 0) {
        const other = await EnterpriseModel.findByTalentCompanyId(n);
        if (other && other.id !== selfId) {
          return res.status(409).json({
            success: false,
            message: `人才网企业ID ${n} 已绑定笔试企业 ${other.id}，每个人才网企业仅对应一个考试端账号`
          });
        }
      }
    }
    await EnterpriseModel.update(req.params.id, req.body);
    res.json({ success: true, message: '更新成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 企业端：更新自己的企业信息
router.put('/me/update', authenticate, requireRole('enterprise'), async (req, res) => {
  try {
    const ent = await EnterpriseModel.findByUserId(req.user.id);
    if (!ent) return res.status(404).json({ success: false, message: '未关联企业' });
    const { name, contactName, contactPhone, contactEmail, address } = req.body;
    await EnterpriseModel.update(ent.id, { name, contactName, contactPhone, contactEmail, address });
    res.json({ success: true, message: '更新成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 总管理：删除企业
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await EnterpriseModel.delete(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
