const express = require('express');
const router = express.Router();
const GradingAccountModel = require('../models/gradingAccountModel');
const { authenticate, requireRole, requireAdmin } = require('../middleware/auth');
const EnterpriseModel = require('../models/enterpriseModel');

/** 企业登录：优先 JWT 中的 enterpriseId（人才网换票等），再查 enterprises.user_id，避免列表恒为空 */
async function resolveEnterpriseId(req) {
  if (req.user.role !== 'enterprise') return null;
  let eid = req.enterpriseId ?? req.user?.enterpriseId;
  if (eid != null && eid !== '') {
    const n = Number(eid);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const ent = await EnterpriseModel.findByUserId(req.user.id);
  return ent?.id ?? null;
}

// 所有路由都需要认证
router.use(authenticate);

// 初始化表（如果不存在）- 在第一次请求时执行
let initializationPromise = null;
router.use(async (req, res, next) => {
  if (!initializationPromise) {
    initializationPromise = require('../models/gradingAccountModel').initializeTables().catch(err => {
      console.error('初始化表失败:', err);
      initializationPromise = null;
    });
  }
  // 等待初始化完成（最多 5 秒，确保表能创建完）
  try {
    await Promise.race([
      initializationPromise,
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  } catch (err) {}
  next();
});

// 获取子阅卷账号列表
router.get('/', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const { page = 1, pageSize = 20, status, search } = req.query;
    let enterpriseId = null;

    // 企业管理员只能查看本企业的账号
    if (req.user.role === 'enterprise') {
      enterpriseId = await resolveEnterpriseId(req);
      if (enterpriseId == null) {
        return res.json({ success: true, data: { list: [], total: 0 } });
      }
    }

    const result = await GradingAccountModel.findAll({
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      status,
      enterpriseId,
      search
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get grading accounts error:', error);
    console.error('Error stack:', error.stack);
    
    // 如果是表不存在的错误，提供更友好的提示
    if (error.message && error.message.includes('不存在')) {
      return res.status(500).json({
        success: false,
        message: error.message + ' 请运行：node backend/scripts/run_grading_system_migration.js'
      });
    }
    
    res.status(500).json({
      success: false,
      message: '获取账号列表失败：' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 创建子阅卷账号
router.post('/', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const { real_name, email, phone, enterprise_id } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空（请确认表单已填写且请求为 JSON）'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: '密码长度至少6位'
      });
    }

    // 检查用户名是否已存在
    const existing = await GradingAccountModel.findByUsername(username);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: '用户名已存在'
      });
    }

    // 企业管理员只能创建本企业的账号
    let finalEnterpriseId = enterprise_id;
    if (req.user.role === 'enterprise') {
      const eid = await resolveEnterpriseId(req);
      if (eid == null) {
        return res.status(403).json({
          success: false,
          message: '无权限：未解析到企业身份，请重新登录或检查 enterprises 绑定'
        });
      }
      finalEnterpriseId = eid;
    }

    const accountId = await GradingAccountModel.create({
      username,
      password,
      real_name,
      email,
      phone,
      created_by: req.user.id,
      enterprise_id: finalEnterpriseId
    });

    res.json({
      success: true,
      message: '账号创建成功',
      data: { id: accountId }
    });
  } catch (error) {
    console.error('Create grading account error:', error);
    res.status(500).json({
      success: false,
      message: '创建账号失败：' + error.message
    });
  }
});

// 更新子阅卷账号信息
router.put('/:id', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const account = await GradingAccountModel.findById(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: '账号不存在'
      });
    }

    // 企业管理员只能更新本企业的账号
    if (req.user.role === 'enterprise') {
      const eid = await resolveEnterpriseId(req);
      if (eid == null || account.enterprise_id !== eid) {
        return res.status(403).json({
          success: false,
          message: '无权限'
        });
      }
    }

    const { real_name, email, phone, status } = req.body;
    await GradingAccountModel.update(accountId, {
      real_name,
      email,
      phone,
      status
    });

    res.json({
      success: true,
      message: '账号信息更新成功'
    });
  } catch (error) {
    console.error('Update grading account error:', error);
    res.status(500).json({
      success: false,
      message: '更新账号信息失败：' + error.message
    });
  }
});

// 重置密码
router.post('/:id/reset-password', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const account = await GradingAccountModel.findById(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: '账号不存在'
      });
    }

    // 企业管理员只能重置本企业的账号密码
    if (req.user.role === 'enterprise') {
      const eid = await resolveEnterpriseId(req);
      if (eid == null || account.enterprise_id !== eid) {
        return res.status(403).json({
          success: false,
          message: '无权限'
        });
      }
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: '密码长度至少6位'
      });
    }

    await GradingAccountModel.updatePassword(accountId, newPassword);

    res.json({
      success: true,
      message: '密码重置成功'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: '重置密码失败：' + error.message
    });
  }
});

// 删除子阅卷账号
router.delete('/:id', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const account = await GradingAccountModel.findById(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: '账号不存在'
      });
    }

    // 企业管理员只能删除本企业的账号
    if (req.user.role === 'enterprise') {
      const eid = await resolveEnterpriseId(req);
      if (eid == null || account.enterprise_id !== eid) {
        return res.status(403).json({
          success: false,
          message: '无权限'
        });
      }
    }

    await GradingAccountModel.delete(accountId);

    res.json({
      success: true,
      message: '账号删除成功'
    });
  } catch (error) {
    console.error('Delete grading account error:', error);
    res.status(500).json({
      success: false,
      message: '删除账号失败：' + error.message
    });
  }
});

module.exports = router;
