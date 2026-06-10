const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const ExamPaperModel = require('../models/examPaperModel');
const UserModel = require('../models/userModel');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { normalizeRoleForList, collectEnterpriseScopeIds } = require('../utils/enterpriseScopeIds');

/**
 * 题库/总管理拉试卷列表：应看全库。optionalAuthenticate 里 role 可能是「管理员」等原始值，须按权限表二次判定。
 */
async function isAdminExamPaperList(req) {
  if (!req.user || req.isGuest) return false;
  const norm = normalizeRoleForList(req.user.role);
  if (norm === 'enterprise' || norm === 'enterprise_reviewer') return false;
  if (norm === 'grader') return false;
  if (norm === 'admin') return true;
  try {
    const perms = await UserModel.getPermissions(req.user.id);
    if (perms && (perms.can_manage_users || perms.can_view_all_data || perms.can_edit_shared)) return true;
  } catch (_) {
    /* ignore */
  }
  return false;
}

// 试卷管理接口当前对内使用，为方便与多个前端（3000 题库、3001 管理端等）集成，
// 暂时不强制认证。如果以后需要收紧权限，可以在网关层或反向代理层再加鉴权。

/**
 * POST /api/exam-papers/save
 * 保存试卷（包括所有大题和小题）
 */
router.post('/save', async (req, res) => {
  // 在 try 块外声明变量，以便在 catch 块中使用
  let paperName, projectName, totalScore, examTime, pageSize, contentHtml, notes, previewHtml, majorQuestions, examType, projectInfo, paperId;
  
  try {
    console.log('📥 [后端] 收到导入试卷请求');
    
    // 确保表已创建
    await ExamPaperModel.initializeTables();
    
    ({
      paperName,
      projectName,
      totalScore,
      examTime,
      pageSize,
      contentHtml,
      notes,
      previewHtml, // 完整的预览HTML（包括所有格式、样式、布局）
      majorQuestions = [],
      examType = 'written', // 考试类型：written-笔试，interview-面试
      projectInfo = null, // 考试项目设置：指导语、结束语、评分要素等（来自试题编辑）
      paperId: paperId = null // 若提供且试卷存在，则更新该试卷而非新建（保证考试关联的试卷能更新到指导语/评分要素等）
    } = req.body);

    console.log('📋 [后端] 请求数据:', {
      paperId: paperId ?? '(未传，将新建试卷)',
      hasProjectInfo: !!(projectInfo && typeof projectInfo === 'object'),
      projectInfoKeys: projectInfo && typeof projectInfo === 'object' ? Object.keys(projectInfo) : [],
      paperName: paperName || projectName,
      examType: examType,
      totalScore: totalScore,
      examTime: examTime,
      pageSize: pageSize,
      majorQuestionsCount: majorQuestions ? majorQuestions.length : 0,
      previewHtmlLength: previewHtml ? previewHtml.length : 0,
      contentHtmlLength: contentHtml ? contentHtml.length : 0
    });

    if (!paperName && !projectName) {
      console.warn('⚠️ [后端] 试卷名称为空');
      return res.status(400).json({
        success: false,
        message: '试卷名称不能为空'
      });
    }

    if (!majorQuestions || majorQuestions.length === 0) {
      console.warn('⚠️ [后端] 没有大题数据');
      return res.status(400).json({
        success: false,
        message: '请至少包含一个大题'
      });
    }

    // 统计小题总数
    const totalSubQuestions = majorQuestions.reduce((sum, major) => 
      sum + (major.subQuestions ? major.subQuestions.length : 0), 0);
    console.log('📊 [后端] 数据统计:', {
      majorQuestionsCount: majorQuestions.length,
      totalSubQuestions: totalSubQuestions
    });

    const result = await ExamPaperModel.saveExamPaper({
      paperId: paperId ? parseInt(paperId, 10) : null,
      paperName: paperName || projectName,
      projectName: projectName,
      totalScore: totalScore || 0,
      examTime: examTime || 0,
      pageSize: pageSize || 'A4',
      contentHtml: contentHtml || '',
      notes: notes || '',
      previewHtml: previewHtml || null, // 完整的预览HTML
      majorQuestions: majorQuestions,
      examType: examType === 'interview' ? 'interview' : 'written',
      projectInfo: projectInfo || null
    });

    console.log('✅ [后端] 试卷保存成功:', {
      paperId: result.paperId,
      questionCount: result.questionCount,
      majorQuestionCount: result.majorQuestionCount
    });

    res.json({
      success: true,
      message: '保存成功',
      data: result
    });
  } catch (error) {
    console.error('保存试卷失败:', error);
    console.error('错误堆栈:', error.stack);
    console.error('请求数据:', {
      paperName,
      projectName,
      totalScore,
      examTime,
      pageSize,
      majorQuestionsCount: majorQuestions ? majorQuestions.length : 0,
      previewHtmlLength: previewHtml ? previewHtml.length : 0
    });
    res.status(500).json({
      success: false,
      message: '保存失败: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
});

/**
 * GET /api/exam-papers
 * 获取试卷列表（必须在 /:id 之前）
 * 企业/子账号/阅卷子账号：从 token 注入 enterpriseId；无 packageId 时返回「已购 enterprise_package_papers ∪ 本企业 exams 正在引用的 paper_id」并去重，与考试归属一致。
 * 带 packageId 时仍仅返回该包内已关联试卷。管理员：默认全库；仅当 query.enterpriseId 有值时按上述企业范围过滤。
 */
router.get('/', optionalAuthenticate, async (req, res) => {
  const normRole = normalizeRoleForList(req.user && req.user.role);
  const isAdmin = await isAdminExamPaperList(req);
  let enterpriseIdFilter;
  let enterpriseIdsFilter;
  if (isAdmin) {
    if (req.query.enterpriseId != null && String(req.query.enterpriseId).trim() !== '') {
      const n = parseInt(req.query.enterpriseId, 10);
      if (Number.isFinite(n) && n > 0) enterpriseIdFilter = n;
    }
  } else {
    const scopeIds = await collectEnterpriseScopeIds(req);
    if (scopeIds.length > 1) {
      enterpriseIdsFilter = scopeIds;
    } else if (scopeIds.length === 1) {
      enterpriseIdFilter = scopeIds[0];
    } else {
      const rawEnt =
        req.enterpriseId != null && req.enterpriseId !== ''
          ? req.enterpriseId
          : req.user && req.user.enterpriseId != null
            ? req.user.enterpriseId
            : null;
      if (rawEnt != null) {
        const eid = parseInt(rawEnt, 10);
        if (Number.isFinite(eid) && eid > 0) enterpriseIdFilter = eid;
      }
    }
    const qEnt = req.query.enterpriseId != null ? parseInt(String(req.query.enterpriseId).trim(), 10) : NaN;
    if (
      Number.isFinite(qEnt) &&
      qEnt > 0 &&
      enterpriseIdFilter != null &&
      qEnt !== enterpriseIdFilter
    ) {
      console.warn('[exam-papers] 链接中的 enterpriseId 与当前登录企业不一致，已以登录身份为准', {
        queryEnterpriseId: qEnt,
        tokenEnterpriseId: enterpriseIdFilter
      });
    }
    // 企业/子审核账号未解析到笔试企业 ID 时，禁止按「无 enterprise 条件」查全库（避免误暴露全部试卷）
    if (
      enterpriseIdFilter == null &&
      enterpriseIdsFilter == null &&
      (normRole === 'enterprise' || normRole === 'enterprise_reviewer')
    ) {
      const page = parseInt(req.query.page, 10) || 1;
      const pageSize = parseInt(req.query.pageSize, 10) || 20;
      return res.json({
        success: true,
        data: { papers: [], total: 0, page, pageSize, totalPages: 0 }
      });
    }
  }

  const filters = {
    paperName: req.query.paperName,
    projectName: req.query.projectName,
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    orderBy: req.query.orderBy || 'created_at',
    orderDir: req.query.orderDir || 'DESC',
    isEnabled: req.query.isEnabled,
    visibleSide: req.query.visibleSide,
    enterpriseId: enterpriseIdFilter,
    enterpriseIds: enterpriseIdsFilter,
    packageId: req.query.packageId != null ? req.query.packageId : undefined
  };

  let papers = [];
  let total = 0;
  try {
    await ExamPaperModel.initializeTables();
    papers = await ExamPaperModel.getExamPapers(filters);
    total = await ExamPaperModel.getExamPaperCount(filters);
  } catch (error) {
    // enterprise_package_papers 表可能未创建或其它库表异常时，返回空列表避免 500
    console.warn('获取试卷列表异常，返回空列表:', error.message);
  }

  res.json({
    success: true,
    data: {
      papers,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.ceil(total / filters.pageSize)
    }
  });
});

/**
 * GET /api/exam-papers/:id/major-questions
 * 获取试卷的大题列表（须在 GET /:id 之前注册）
 */
router.get('/:id/major-questions', async (req, res) => {
  try {
    await ExamPaperModel.initializeTables();
    const paperId = parseInt(req.params.id);
    const [rows] = await pool.execute(
      'SELECT * FROM exam_paper_major_questions WHERE paper_id = ? ORDER BY major_number',
      [paperId]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '获取失败' });
  }
});

/**
 * GET /api/exam-papers/:id/sub-questions
 * 获取试卷的小题列表（须在 GET /:id 之前注册）
 */
router.get('/:id/sub-questions', async (req, res) => {
  try {
    await ExamPaperModel.initializeTables();
    const paperId = parseInt(req.params.id);
    // 关联大题表获取题型信息，并按题号排序
    const [rows] = await pool.execute(
      `SELECT sq.*, mq.question_type, mq.major_number
       FROM exam_paper_sub_questions sq
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '获取失败' });
  }
});

const OBJECTIVE_TYPES = ['choice', 'judge', 'multichoice', '选择题', '判断题', '多选题', '单选题'];
function isObjectiveQuestionType(type) {
  if (!type) return false;
  const t = String(type);
  return OBJECTIVE_TYPES.some(ot => t.includes(ot));
}

/**
 * GET /api/exam-papers/:id/objective-questions
 * 获取试卷中的客观题（单选题、多选题、判断题）列表，用于阅卷前设置标准答案
 */
router.get('/:id/objective-questions', async (req, res) => {
  try {
    await ExamPaperModel.initializeTables();
    const paperId = parseInt(req.params.id);
    const [rows] = await pool.execute(
      `SELECT sq.*, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY sq.number, sq.sub_number`,
      [paperId]
    );
    const objective = rows.filter(r => isObjectiveQuestionType(r.question_type));
    res.json({ success: true, data: objective });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '获取失败' });
  }
});

/**
 * 确保 exam_paper_sub_questions 表有阅卷相关列（standard_answer 等）
 */
async function ensureGradingColumns() {
  try {
    const [cols] = await pool.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_paper_sub_questions' AND COLUMN_NAME IN ('standard_answer','answer_analysis','grading_points')"
    );
    const has = new Set((cols || []).map(c => c.COLUMN_NAME));
    if (!has.has('standard_answer')) {
      await pool.execute("ALTER TABLE exam_paper_sub_questions ADD COLUMN standard_answer TEXT COMMENT '标准答案'");
    }
    if (!has.has('answer_analysis')) {
      await pool.execute("ALTER TABLE exam_paper_sub_questions ADD COLUMN answer_analysis LONGTEXT COMMENT '答案解析'");
    }
    if (!has.has('grading_points')) {
      await pool.execute("ALTER TABLE exam_paper_sub_questions ADD COLUMN grading_points JSON COMMENT '主观题评分要点'");
    }
  } catch (e) {
    console.warn('[ensureGradingColumns]', e.message);
  }
}

/**
 * PUT /api/exam-papers/sub-questions/:id
 * 更新小题标准答案、解析、评分要点（仅更新传入的字段）
 */
router.put('/sub-questions/:id', async (req, res) => {
  try {
    await ExamPaperModel.initializeTables();
    await ensureGradingColumns();
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: '无效的小题ID' });
    }
    const { standard_answer, answer_analysis, grading_points } = req.body;
    const updates = [];
    const params = [];
    if (standard_answer !== undefined) {
      updates.push('standard_answer = ?');
      params.push(standard_answer != null && String(standard_answer).trim() !== '' ? String(standard_answer).trim() : null);
    }
    if (answer_analysis !== undefined) {
      updates.push('answer_analysis = ?');
      params.push(answer_analysis != null && String(answer_analysis).trim() !== '' ? answer_analysis : null);
    }
    if (grading_points !== undefined) {
      updates.push('grading_points = ?');
      params.push(grading_points != null ? (typeof grading_points === 'string' ? grading_points : JSON.stringify(grading_points)) : null);
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '无有效更新字段' });
    }
    params.push(id);
    const [result] = await pool.execute(
      `UPDATE exam_paper_sub_questions SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '小题不存在或已删除' });
    }
    res.json({ success: true, message: '更新成功' });
  } catch (e) {
    console.error('[PUT sub-questions/:id]', e.message, e.code);
    let hint = '';
    if (/Unknown column/.test(e.message || '')) {
      hint = '。请执行迁移: node backend/scripts/run_grading_migration.js';
    }
    res.status(500).json({ success: false, message: (e.message || '更新失败') + hint });
  }
});

/**
 * GET /api/exam-papers/:id
 * 获取试卷信息（必须在 /:id/major-questions 和 /:id/sub-questions 之后）
 */
router.get('/:id', async (req, res) => {
  try {
    // 确保表已创建
    await ExamPaperModel.initializeTables();
    
    const id = parseInt(req.params.id);
    const paper = await ExamPaperModel.getExamPaperComplete(id);
    
    if (!paper) {
      return res.status(404).json({
        success: false,
        message: '试卷不存在'
      });
    }

    res.json({
      success: true,
      data: paper
    });
  } catch (error) {
    console.error('获取试卷失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/exam-papers/:id/project-info-debug
 * 诊断接口：查看某试卷的 project_info 是否写入、便于排查指导语/测评要素未同步问题
 */
router.get('/:id/project-info-debug', async (req, res) => {
  try {
    await ExamPaperModel.initializeTables();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, message: '无效的试卷ID' });
    }
    const paper = await ExamPaperModel.getExamPaperById(id);
    if (!paper) {
      return res.status(404).json({ success: false, message: '试卷不存在' });
    }
    const raw = paper.project_info;
    const hasContent = raw && typeof raw === 'object' && (
      (raw.guidingWords && String(raw.guidingWords).trim()) ||
      (raw.closingWords && String(raw.closingWords).trim()) ||
      (Array.isArray(raw.evaluationElements) && raw.evaluationElements.length > 0)
    );
    res.json({
      success: true,
      data: {
        paperId: id,
        hasProjectInfoColumn: true,
        project_info: raw,
        hasGuidingWords: !!(raw && raw.guidingWords),
        hasClosingWords: !!(raw && raw.closingWords),
        evaluationElementsCount: (raw && Array.isArray(raw.evaluationElements)) ? raw.evaluationElements.length : 0,
        hasContent,
        hint: hasContent ? '数据库中有内容，若前端仍不显示请检查面试设置/答题预览是否请求了该 paper_id' : '数据库中 project_info 为空或未含指导语/结束语/测评要素，请在试题编辑中打开本试卷、填写考试项目设置后保存'
      }
    });
  } catch (e) {
    console.error('project-info-debug error:', e);
    res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

/**
 * PUT /api/exam-papers/:id
 * 更新试卷信息
 */
router.put('/:id', async (req, res) => {
  try {
    // 确保表已创建
    await ExamPaperModel.initializeTables();
    
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: '无效的试卷ID'
      });
    }

    const body = req.body || {};
    const updateData = {};

    if (Object.prototype.hasOwnProperty.call(body, 'previewHtml')) {
      const previewHtml = body.previewHtml;
      // 允许 previewHtml 为空或为 null，仅表示清空或不设置内容
      updateData.previewHtml = previewHtml || null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'isEnabled')) {
      const raw = body.isEnabled;
      const enabledValue =
        raw === 1 ||
        raw === '1' ||
        raw === true ||
        raw === 'true'
          ? 1
          : 0;
      updateData.isEnabled = enabledValue;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'visibleSide')) {
      const rawSide = String(body.visibleSide || '').trim();
      if (rawSide !== 'candidate' && rawSide !== 'enterprise') {
        return res.status(400).json({
          success: false,
          message: 'visibleSide 参数无效，只能是 candidate 或 enterprise'
        });
      }
      updateData.visibleSide = rawSide;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'projectInfo')) {
      updateData.projectInfo = body.projectInfo;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'packagePaymentEnabled')) {
      updateData.packagePaymentEnabled = body.packagePaymentEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'packagePriceYuan')) {
      updateData.packagePriceYuan = body.packagePriceYuan;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'packagePayWechatQrcode')) {
      updateData.packagePayWechatQrcode = body.packagePayWechatQrcode;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'packagePayAlipayQrcode')) {
      updateData.packagePayAlipayQrcode = body.packagePayAlipayQrcode;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '无有效更新字段'
      });
    }

    await ExamPaperModel.updateExamPaper(id, updateData);

    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新试卷失败:', error);
    res.status(500).json({
      success: false,
      message: '更新失败: ' + error.message
    });
  }
});

/**
 * DELETE /api/exam-papers/:id
 * 删除试卷
 */
router.delete('/:id', async (req, res) => {
  try {
    // 确保表已创建
    await ExamPaperModel.initializeTables();
    
    const id = parseInt(req.params.id);
    await ExamPaperModel.deleteExamPaper(id);

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除试卷失败:', error);
    res.status(500).json({
      success: false,
      message: '删除失败: ' + error.message
    });
  }
});

module.exports = router;

