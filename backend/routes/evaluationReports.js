const express = require('express');
const router = express.Router();
const ExamEvaluationReportModel = require('../models/examEvaluationReportModel');
const EvaluationReportService = require('../services/evaluationReportService');
const ExamSessionModel = require('../models/examSessionModel');
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/evaluation-reports/:sessionId
 * 获取单个考生的评估报告
 */
router.get('/:sessionId', requireRole('admin', 'enterprise', 'grader'), async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const report = await ExamEvaluationReportModel.findBySessionId(sessionId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: '评估报告不存在'
      });
    }

    // 权限检查
    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      const exam = await ExamModel.findById(report.exam_id);
      if (!enterprise || !exam || exam.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('获取评估报告失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/evaluation-reports/generate/:sessionId
 * 手动生成评估报告
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

    // 异步生成报告（避免超时）
    EvaluationReportService.generateReport(sessionId)
      .then(report => {
        // 报告生成完成，但响应已经发送，这里可以记录日志
        console.log(`评估报告生成完成: sessionId=${sessionId}`);
      })
      .catch(error => {
        console.error(`评估报告生成失败: sessionId=${sessionId}`, error);
      });

    // 立即返回，报告在后台生成
    res.json({
      success: true,
      message: '评估报告生成任务已启动，请稍后查询结果'
    });
  } catch (error) {
    console.error('启动评估报告生成失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/evaluation-reports/exam/:examId
 * 获取考试的所有评估报告
 */
router.get('/exam/:examId', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const examId = parseInt(req.params.examId);
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const status = req.query.status;

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

    const reports = await ExamEvaluationReportModel.findByExamId(examId, { page, pageSize, status });

    res.json({
      success: true,
      data: {
        reports,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('获取评估报告列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/evaluation-reports/:sessionId/download
 * 下载评估报告（HTML格式）
 */
router.get('/:sessionId/download', requireRole('admin', 'enterprise'), async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const report = await ExamEvaluationReportModel.findBySessionId(sessionId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: '评估报告不存在'
      });
    }

    if (report.generation_status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: '评估报告尚未生成完成'
      });
    }

    // 权限检查
    if (req.user.role === 'enterprise') {
      const enterprise = await EnterpriseModel.findByUserId(req.user.id);
      const exam = await ExamModel.findById(report.exam_id);
      if (!enterprise || !exam || exam.enterprise_id !== enterprise.id) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>考试评估报告 - ${report.real_name || report.username}</title>
  <style>
    body {
      font-family: "Microsoft YaHei", Arial, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 30px; }
    h3 { color: #555; }
    p { margin: 10px 0; }
    strong { color: #2c3e50; }
    ul { margin: 10px 0; padding-left: 30px; }
    li { margin: 5px 0; }
  </style>
</head>
<body>
  <h1>考试评估报告</h1>
  <p><strong>考生姓名：</strong>${report.real_name || report.username}</p>
  <p><strong>考试名称：</strong>${report.exam_name || '未知考试'}</p>
  <p><strong>生成时间：</strong>${report.generated_at || report.created_at}</p>
  <hr>
  <div>${report.report_html || report.report_content || ''}</div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="评估报告_${report.real_name || report.username}_${Date.now()}.html"`);
    res.send(html);
  } catch (error) {
    console.error('下载评估报告失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
