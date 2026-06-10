const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const UserModel = require('../models/userModel');
const EnterpriseModel = require('../models/enterpriseModel');
const { authenticate, requireAdmin, requireRole } = require('../middleware/auth');
const DatabaseManager = require('../services/databaseManager');

const ID_CARD_UPLOAD_DIR = path.join(__dirname, '../uploads/id-cards');

const storageIdCard = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(ID_CARD_UPLOAD_DIR, { recursive: true });
      cb(null, ID_CARD_UPLOAD_DIR);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const userId = req.params.id || '0';
    const ext = (file.originalname && path.extname(file.originalname)) || '.jpg';
    cb(null, `id_${userId}_${Date.now()}${ext.toLowerCase()}`);
  }
});
const uploadIdCard = multer({
  storage: storageIdCard,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片格式'));
    }
  }
});

// 所有路由都需要认证
router.use(authenticate);

/**
 * 求职者个人中心：须放在 PUT /:id 之前，否则 segment 会被当成 :id 且走 requireAdmin → 403
 * （例如 profile、resume 会被误匹配为 id=profile / id=resume）
 */
const talentSiteCompatHandlers = require('./talentSiteCompat');
if (typeof talentSiteCompatHandlers.getCompatUserProfile === 'function') {
  router.get('/profile', talentSiteCompatHandlers.getCompatUserProfile);
}
if (typeof talentSiteCompatHandlers.putCompatUserProfile === 'function') {
  router.put('/profile', talentSiteCompatHandlers.putCompatUserProfile);
}
if (typeof talentSiteCompatHandlers.getCompatUserResume === 'function') {
  router.get('/resume', talentSiteCompatHandlers.getCompatUserResume);
}
if (typeof talentSiteCompatHandlers.putCompatUserResume === 'function') {
  router.put('/resume', talentSiteCompatHandlers.putCompatUserResume);
}
if (typeof talentSiteCompatHandlers.postCompatResumeGenerate === 'function') {
  router.post('/resume/generate', talentSiteCompatHandlers.postCompatResumeGenerate);
}

// 搜索用户（企业/管理员，用于添加考生、企业管理关联账号等）
// 笔试系统主库账号表为 qms_users（与 UserModel / adminCompat 一致）；旧版 users 表在部分环境不存在或字段不一致会导致 500。
router.get('/search', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const { pool } = require('../config/database');
    const q = (req.query.q || '').trim();
    let sql =
      'SELECT id, username, real_name, email, role FROM qms_users WHERE (status IS NULL OR LOWER(TRIM(COALESCE(status,\'\'))) = ?)';
    const params = ['active'];
    if (q) {
      sql += ' AND (username LIKE ? OR COALESCE(real_name,\'\') LIKE ? OR COALESCE(email,\'\') LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY username LIMIT 50';
    let rows;
    try {
      const r = await pool.execute(sql, params);
      rows = r[0];
    } catch (e1) {
      if (e1.code === 'ER_NO_SUCH_TABLE') {
        let sql2 = 'SELECT id, username, real_name, email, role FROM users WHERE status = ?';
        const p2 = ['active'];
        if (q) {
          sql2 += ' AND (username LIKE ? OR real_name LIKE ? OR email LIKE ?)';
          const like = `%${q}%`;
          p2.push(like, like, like);
        }
        sql2 += ' ORDER BY username LIMIT 50';
        const r2 = await pool.execute(sql2, p2);
        rows = r2[0];
      } else {
        throw e1;
      }
    }
    res.json({ success: true, data: rows || [] });
  } catch (e) {
    console.error('[users/search]', e);
    res.status(500).json({ success: false, message: e.message || '搜索失败' });
  }
});

// 上传考生身份证照片（企业/管理员）。管理员可操作任意用户；企业仅可操作本企业考试下的报名考生。
router.put('/:id/id-card-image', requireRole('admin', 'enterprise'), uploadIdCard.single('file'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ success: false, message: '用户ID无效' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择身份证照片文件' });
    }
    const targetUser = await UserModel.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (req.user.role === 'enterprise') {
      const { pool } = require('../config/database');
      const [rows] = await pool.execute(
        'SELECT 1 FROM exam_enrollments en JOIN exams e ON en.exam_id = e.id WHERE en.user_id = ? AND e.enterprise_id = ? LIMIT 1',
        [userId, (await EnterpriseModel.findByUserId(req.user.id))?.id]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: '只能为本企业考试下的考生上传身份证照片' });
      }
    }
    const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
    const updated = await UserModel.updateIdCardImagePath(userId, relativePath);
    if (!updated) {
      return res.status(500).json({ success: false, message: '数据库未支持身份证照片字段，请先执行迁移' });
    }
    res.json({ success: true, message: '上传成功', data: { id_card_image_path: relativePath } });
  } catch (e) {
    if (e.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: '文件大小不能超过 5MB' });
    }
    res.status(500).json({ success: false, message: e.message || '上传失败' });
  }
});

/** 清除考生身份证照记录（无效外链、文件已删等场景） */
router.delete('/:id/id-card-image', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ success: false, message: '用户ID无效' });
    }
    const targetUser = await UserModel.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (req.user.role === 'enterprise') {
      const { pool } = require('../config/database');
      const entId = (await EnterpriseModel.findByUserId(req.user.id))?.id;
      const [rows] = await pool.execute(
        'SELECT 1 FROM exam_enrollments en JOIN exams e ON en.exam_id = e.id WHERE en.user_id = ? AND e.enterprise_id = ? LIMIT 1',
        [userId, entId]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: '只能操作本企业考试下的考生' });
      }
    }
    const ok = await UserModel.updateIdCardImagePath(userId, '');
    if (!ok) {
      return res.status(500).json({ success: false, message: '数据库未支持身份证照片字段' });
    }
    res.json({ success: true, message: '已清除' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '清除失败' });
  }
});

/** 管理端查看考生身份证照：走 API 读盘，避免生产环境仅反代了 /api 而未暴露 /uploads 时图片 404 */
router.get('/:id/id-card-image', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ success: false, message: '用户ID无效' });
    }
    const targetUser = await UserModel.findByIdWithIdCardImage(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (req.user.role === 'enterprise') {
      const { pool } = require('../config/database');
      const entId = (await EnterpriseModel.findByUserId(req.user.id))?.id;
      const [rows] = await pool.execute(
        'SELECT 1 FROM exam_enrollments en JOIN exams e ON en.exam_id = e.id WHERE en.user_id = ? AND e.enterprise_id = ? LIMIT 1',
        [userId, entId]
      );
      if (!rows.length) {
        return res.status(403).json({ success: false, message: '只能查看本企业考试下的考生身份证照片' });
      }
    }
    const raw = targetUser.id_card_image_path != null ? String(targetUser.id_card_image_path).trim() : '';
    if (!raw) {
      return res.status(404).json({ success: false, message: '未上传身份证照片' });
    }
    if (raw.toLowerCase().startsWith('data:')) {
      return res.status(400).json({
        success: false,
        message: '库中为内嵌 base64 旧数据，无法经此接口输出。请使用「更换」重新上传为文件，或联系管理员清理该字段。'
      });
    }
    if (/^https?:\/\//i.test(raw)) {
      return res.redirect(302, raw);
    }
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.includes('..')) {
      return res.status(400).json({ success: false, message: '身份证照路径无效' });
    }
    const backendRoot = path.join(__dirname, '..');
    const absFile = path.resolve(backendRoot, rel);
    const allowedDir = path.resolve(backendRoot, 'uploads', 'id-cards');
    const relToAllowed = path.relative(allowedDir, absFile);
    if (relToAllowed.startsWith('..') || path.isAbsolute(relToAllowed)) {
      return res.status(403).json({ success: false, message: '不允许访问该路径' });
    }
    try {
      await fs.access(absFile);
    } catch {
      return res.status(404).json({ success: false, message: '文件不存在或已被清理，请重新上传' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.sendFile(absFile);
  } catch (e) {
    console.error('[users/:id/id-card-image GET]', e);
    res.status(500).json({ success: false, message: e.message || '读取失败' });
  }
});

// 获取所有用户（仅管理员）
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await UserModel.getAllUsers();
    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: '获取用户列表失败：' + error.message
    });
  }
});

// 创建用户（仅管理员）
router.post('/', requireAdmin, async (req, res) => {
  try {
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

    // 创建用户数据库
    try {
      await DatabaseManager.createUserDatabase(userId);
    } catch (dbError) {
      console.error('创建用户数据库失败:', dbError);
      // 如果数据库创建失败，删除用户
      await UserModel.delete(userId);
      return res.status(500).json({
        success: false,
        message: '创建用户数据库失败'
      });
    }

    res.json({
      success: true,
      message: '用户创建成功',
      userId
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: '创建用户失败：' + error.message
    });
  }
});

// 更新用户信息（仅管理员）
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { email, real_name, status, role } = req.body;

    // 这里可以添加更新用户信息的逻辑
    // 目前UserModel没有update方法，可以根据需要添加

    res.json({
      success: true,
      message: '用户信息更新成功'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: '更新用户信息失败：' + error.message
    });
  }
});

// 更新用户权限（仅管理员）
router.put('/:id/permissions', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const permissions = req.body;

    await UserModel.updatePermissions(userId, permissions);

    res.json({
      success: true,
      message: '权限更新成功'
    });
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({
      success: false,
      message: '更新权限失败：' + error.message
    });
  }
});

// 更新用户状态（仅管理员）
router.put('/:id/status', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { status } = req.body;

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的状态值'
      });
    }

    await UserModel.updateStatus(userId, status);

    res.json({
      success: true,
      message: '用户状态更新成功'
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: '更新用户状态失败：' + error.message
    });
  }
});

// 删除用户（仅管理员）
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // 不能删除自己
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: '不能删除自己的账号'
      });
    }

    // 删除用户数据库
    try {
      await DatabaseManager.deleteUserDatabase(userId);
    } catch (dbError) {
      console.error('删除用户数据库失败:', dbError);
      // 继续删除用户，即使数据库删除失败
    }

    // 删除用户
    await UserModel.delete(userId);

    res.json({
      success: true,
      message: '用户删除成功'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: '删除用户失败：' + error.message
    });
  }
});

// 重置用户密码（仅管理员）
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: '密码长度至少6位'
      });
    }

    await UserModel.updatePassword(userId, newPassword);

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

module.exports = router;
