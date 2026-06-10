const express = require('express');
const router = express.Router();
const ExamSummaryModel = require('../models/examSummaryModel');
const ExamSummaryService = require('../services/examSummaryService');
const ExamSessionModel = require('../models/examSessionModel');
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/exam-summaries/:sessionId
 * 获取单个考生的汇总数据
 */
router.get('/:sessionId', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const summary = await ExamSummaryModel.findBySessionId(sessionId);

    if (!summary) {
      return res.status(404).json({
        success: false,
        message: '汇总数据不存在'
      });
    }

    // 权限检查
    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      const exam = await ExamModel.findById(summary.exam_id);
      if (!enterprise || !exam || exam.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('获取汇总数据失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/exam-summaries/exam/:examId
 * 获取考试的所有考生汇总数据（支持分页）
 */
router.get('/exam/:examId', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const examId = parseInt(req.params.examId);
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;

    // 权限检查
    const exam = await ExamModel.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: '考试不存在' });
    }

    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      if (!enterprise || exam.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    try {
      await ExamSummaryService.ensureExamSummariesForExam(examId);
    } catch (e) {
      console.warn('[exam-summaries/exam] ensureExamSummariesForExam:', e.message || e);
    }
    const summaries = await ExamSummaryModel.findByExamId(examId, { page, pageSize });
    const total = await ExamSummaryModel.countByExamId(examId);

    res.json({
      success: true,
      data: {
        summaries,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error('获取汇总数据列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/exam-summaries/generate/:sessionId
 * 手动生成汇总数据
 */
router.post('/generate/:sessionId', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);

    // 权限检查
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: '考试会话不存在' });
    }

    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      const exam = await ExamModel.findById(session.exam_id);
      if (!enterprise || !exam || exam.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    const summary = await ExamSummaryService.generateSummary(sessionId);

    res.json({
      success: true,
      message: '汇总数据生成成功',
      data: summary
    });
  } catch (error) {
    console.error('生成汇总数据失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/exam-summaries/exam/:examId/statistics
 * 获取考试整体统计信息
 */
router.get('/exam/:examId/statistics', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const examId = parseInt(req.params.examId);

    // 权限检查
    const exam = await ExamModel.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: '考试不存在' });
    }

    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      if (!enterprise || exam.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    try {
      await ExamSummaryService.ensureExamSummariesForExam(examId);
    } catch (e) {
      console.warn('[exam-summaries/statistics] ensureExamSummariesForExam:', e.message || e);
    }
    const statistics = await ExamSummaryService.getExamStatistics(examId);

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('获取考试统计信息失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
