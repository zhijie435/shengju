const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { exportHtmlToPdf, buildFullHtmlDocument } = require('../utils/pdfExporter');
const { exportHtmlToWord } = require('../utils/wordExporter');

/**
 * POST /api/export/pdf
 * 导出预览内容为PDF
 */
router.post('/pdf', authenticate, async (req, res) => {
  try {
    const { html, paperSize = 'A4', projectInfo } = req.body;

    if (!html || !html.trim()) {
      return res.status(400).json({
        success: false,
        message: '预览内容不能为空，请先预览试题'
      });
    }

    // 构建完整的HTML文档
    const fullHtml = buildFullHtmlDocument(html, paperSize);

    // 导出为PDF
    const pdfBuffer = await exportHtmlToPdf(fullHtml, paperSize);

    // 设置响应头
    const filename = projectInfo?.projectName 
      ? `${projectInfo.projectName}_${new Date().getTime()}.pdf`
      : `试题_${new Date().getTime()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    // 发送PDF文件
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF导出失败:', error);
    res.status(500).json({
      success: false,
      message: `PDF导出失败: ${error.message}`
    });
  }
});

/**
 * POST /api/export/word
 * 导出预览内容为Word文档
 */
router.post('/word', authenticate, async (req, res) => {
  try {
    const { html, paperSize = 'A4', projectInfo } = req.body;

    if (!html || !html.trim()) {
      return res.status(400).json({
        success: false,
        message: '预览内容不能为空，请先预览试题'
      });
    }

    // 导出为Word
    const wordBuffer = await exportHtmlToWord(html, paperSize);

    // 设置响应头
    const filename = projectInfo?.projectName 
      ? `${projectInfo.projectName}_${new Date().getTime()}.docx`
      : `试题_${new Date().getTime()}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', wordBuffer.length);

    // 发送Word文件
    res.send(wordBuffer);
  } catch (error) {
    console.error('Word导出失败:', error);
    res.status(500).json({
      success: false,
      message: `Word导出失败: ${error.message}`
    });
  }
});

module.exports = router;
