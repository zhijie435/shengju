const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Document, Packer, Paragraph, TextRun } = require('docx');
const QuestionModel = require('../models/questionModel');
const { processHtmlContent, restoreContentFromDatabase, extractTextFromHtml, processPastedContent } = require('../utils/imageProcessor');
const { processWordDocument, parseWordDocumentAsSubQuestions } = require('../utils/wordProcessor');
const { recognizeQuestions } = require('../utils/questionRecognizer');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachUserDatabase } = require('../config/userDatabase');

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'word-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  },
  fileFilter: function (req, file, cb) {
    // 只允许Word文档
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword' // .doc
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(file.mimetype) || ['.doc', '.docx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持Word文档格式（.doc, .docx）'));
    }
  }
});

/**
 * GET /api/questions/template/sub-questions
 * 下载按小题上传格式的 Word 示例模板（小题之间空两行，含答案、解析、难易程度）
 * 无需登录即可下载
 */
router.get('/template/sub-questions', async (req, res) => {
  try {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: '按小题上传 Word 格式说明', bold: true })],
            spacing: { after: 400 }
          }),
          new Paragraph({
            children: [new TextRun('每道小题之间请空两行。单题格式：题号. 题目内容 + 答案：xxx + 解析：xxx + 难易程度：简单/中等/困难')],
            spacing: { after: 300 }
          }),
          new Paragraph({ children: [new TextRun(' ')], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun(' ')], spacing: { after: 200 } }),
          new Paragraph({
            children: [new TextRun({ text: '示例 1：', bold: true })],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('1. 下列哪个数是正数？A. -1  B. 0  C. 1  D. -2')],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('答案：C')],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('解析：正数大于0，选项中只有1是正数。')],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('难易程度：简单')],
            spacing: { after: 200 }
          }),
          new Paragraph({ children: [new TextRun(' ')], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun(' ')], spacing: { after: 200 } }),
          new Paragraph({
            children: [new TextRun({ text: '示例 2：', bold: true })],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('2. 计算 2+3×4 的结果。')],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('答案：14')],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('解析：先算乘法 3×4=12，再算加法 2+12=14。')],
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun('难易程度：中等')],
            spacing: { after: 200 }
          })
        ]
      }]
    });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const filename = encodeURIComponent('小题上传示例模板.docx');
    res.setHeader('Content-Disposition', `attachment; filename="sub-questions-template.docx"; filename*=UTF-8''${filename}`);
    res.send(buffer);
  } catch (error) {
    console.error('生成 Word 模板失败:', error);
    res.status(500).json({ success: false, message: '生成模板失败: ' + error.message });
  }
});

/**
 * POST /api/questions/upload-word-sub-questions
 * 上传 Word 文档并按「小题之间空两行」解析为小题列表（含答案、解析、难易程度）
 */
router.post('/upload-word-sub-questions', authenticate, (req, res, next) => {
  upload.single('wordFile')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: '文件大小超过限制（最大50MB）' });
        }
        return res.status(400).json({ success: false, message: '文件上传错误: ' + err.message });
      }
      return res.status(400).json({ success: false, message: err.message || '文件上传失败' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择Word文档' });
    }
    const filePath = req.file.path;
    try {
      const result = await parseWordDocumentAsSubQuestions(filePath);
      await fs.unlink(filePath).catch(e => console.error('删除临时文件失败:', e));
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error || '解析失败',
          data: { subQuestions: [] }
        });
      }
      return res.json({
        success: true,
        message: '解析成功，共 ' + (result.subQuestions.length || 0) + ' 道小题',
        data: { subQuestions: result.subQuestions || [] }
      });
    } catch (e) {
      await fs.unlink(filePath).catch(() => {});
      throw e;
    }
  } catch (error) {
    console.error('上传 Word 小题失败:', error);
    res.status(500).json({ success: false, message: '处理失败: ' + error.message });
  }
});

/**
 * POST /api/questions/upload-word
 * 上传Word文档并解析（必须在动态路由之前）
 * 注意：这个路由不需要用户数据库，只需要认证
 */
router.post('/upload-word', authenticate, (req, res, next) => {
  upload.single('wordFile')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: '文件大小超过限制（最大50MB）'
          });
        }
        return res.status(400).json({
          success: false,
          message: '文件上传错误: ' + err.message
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || '文件上传失败'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择Word文档'
      });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const uploadsDir = path.join(__dirname, '../uploads');

    try {
      // 处理Word文档（传入uploads目录用于保存截图）
      const result = await processWordDocument(filePath, uploadsDir);
      
      // 清理上传的临时文件
      await fs.unlink(filePath).catch(err => console.error('删除临时文件失败:', err));

      res.json({
        success: true,
        message: 'Word文档解析成功',
        data: {
          html: result.html,
          images: result.images,
          imagesCount: result.images.length,
          messages: result.messages,
          originalName: originalName,
          screenshotUrls: result.screenshotUrls || [],
          screenshotCount: (result.screenshotUrls || []).length
        }
      });
    } catch (error) {
      // 确保删除临时文件
      await fs.unlink(filePath).catch(err => console.error('删除临时文件失败:', err));
      throw error;
    }
  } catch (error) {
    console.error('上传Word文档失败:', error);
    res.status(500).json({
      success: false,
      message: '处理失败: ' + error.message
    });
  }
});

/**
 * POST /api/questions/process-paste
 * 处理粘贴的HTML内容，将无法显示的图片转换为Base64
 * 注意：这个路由不需要用户数据库，只需要认证
 */
router.post('/process-paste', authenticate, async (req, res) => {
  try {
    const { htmlContent } = req.body;
    
    if (!htmlContent) {
      return res.status(400).json({
        success: false,
        message: 'HTML内容不能为空'
      });
    }
    
    // 处理粘贴内容
    const result = await processPastedContent(htmlContent);
    
    res.json({
      success: true,
      message: result.needsUpload && result.needsUpload.length > 0 
        ? `处理完成，但有 ${result.needsUpload.length} 张图片需要重新上传` 
        : '处理成功',
      data: {
        html: result.html,
        images: result.images,
        imagesCount: result.images.length,
        needsUpload: result.needsUpload || [], // 需要重新上传的图片信息
        hasUnprocessedImages: result.needsUpload && result.needsUpload.length > 0
      }
    });
  } catch (error) {
    console.error('处理粘贴内容失败:', error);
    res.status(500).json({
      success: false,
      message: '处理失败: ' + error.message
    });
  }
});

// 所有需要数据库操作的路由都需要认证和用户数据库
router.use(authenticate);
router.use(attachUserDatabase);

/**
 * POST /api/questions/save
 * 保存大题内容
 */
router.post('/save', async (req, res) => {
  try {
    const {
      contentHtml,
      projectName,
      totalScore,
      examTime,
      pageSize,
      notes
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 处理HTML内容，提取图片和文本
    const processed = processHtmlContent(contentHtml);

    // 保存到数据库（使用用户数据库）
    const questionId = await QuestionModel.saveQuestion(req.userPool, {
      contentHtml: contentHtml,
      contentText: processed.textContent,
      imagesBase64: processed.imagesBase64,
      projectName: projectName,
      totalScore: totalScore || 0,
      examTime: examTime || 0,
      pageSize: pageSize || 'A4',
      notes: notes
    });

    res.json({
      success: true,
      message: '保存成功',
      data: {
        questionId: questionId,
        imagesCount: processed.imagesBase64.length
      }
    });
  } catch (error) {
    console.error('保存大题失败:', error);
    res.status(500).json({
      success: false,
      message: '保存失败: ' + error.message
    });
  }
});

/**
 * POST /api/questions/save-complete
 * 保存整套试题（包括所有小题）
 */
router.post('/save-complete', async (req, res) => {
  try {
    const {
      contentHtml,
      projectName,
      totalScore,
      examTime,
      pageSize,
      notes,
      subQuestions = []
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 处理HTML内容，提取图片和文本
    const processed = processHtmlContent(contentHtml);

    // 保存大题到数据库（使用用户数据库）
    const questionId = await QuestionModel.saveQuestion(req.userPool, {
      contentHtml: contentHtml,
      contentText: processed.textContent,
      imagesBase64: processed.imagesBase64,
      projectName: projectName,
      totalScore: totalScore || 0,
      examTime: examTime || 0,
      pageSize: pageSize || 'A4',
      notes: notes
    });

    // 保存所有小题
    const savedSubQuestionIds = [];
    for (const subQ of subQuestions) {
      try {
        const answerText = subQ.answerHtml ? extractTextFromHtml(subQ.answerHtml) : (subQ.answer || null);
        const explanationText = subQ.explanationHtml ? extractTextFromHtml(subQ.explanationHtml) : (subQ.explanation || null);
        
        const subId = await QuestionModel.saveSubQuestion(req.userPool, {
          questionId: questionId,
          number: subQ.number || '',
          subNumber: subQ.subNumber || null,
          contentHtml: subQ.contentHtml || '',
          contentText: subQ.contentText || null,
          score: subQ.score || 0,
          difficulty: subQ.difficulty || '中等', // 保存难易程度
          type: subQ.type || 'child',
          fullContent: subQ.fullContent || null,
          answer: answerText,
          answerHtml: subQ.answerHtml || null,
          explanation: explanationText,
          explanationHtml: subQ.explanationHtml || null
        });
        savedSubQuestionIds.push(subId);
      } catch (error) {
        console.error('保存小题失败:', error);
        // 继续保存其他小题，不中断流程
      }
    }

    res.json({
      success: true,
      message: '保存成功',
      data: {
        questionId: questionId,
        imagesCount: processed.imagesBase64.length,
        subQuestionsCount: savedSubQuestionIds.length
      }
    });
  } catch (error) {
    console.error('保存整套试题失败:', error);
    res.status(500).json({
      success: false,
      message: '保存失败: ' + error.message
    });
  }
});

/**
 * GET /api/questions/:id
 * 获取大题内容
 */
router.get('/:id', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const question = await QuestionModel.getQuestionById(req.userPool, questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: '大题不存在'
      });
    }

    // 恢复Base64图片到HTML内容中
    let restoredHtml = question.content_html;
    if (question.images_base64 && question.images_base64.length > 0) {
      restoredHtml = restoreContentFromDatabase(question.content_html, question.images_base64);
    }

    res.json({
      success: true,
      data: {
        ...question,
        content_html: restoredHtml
      }
    });
  } catch (error) {
    console.error('获取大题失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/questions/:id/subquestions
 * 获取小题列表
 */
router.get('/:id/subquestions', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const subQuestions = await QuestionModel.getSubQuestionsByQuestionId(req.userPool, questionId);

    // 获取大题信息，用于恢复图片
    const question = await QuestionModel.getQuestionById(req.userPool, questionId);
    const imagesBase64 = question && question.images_base64 ? question.images_base64 : [];

    // 恢复每个小题的Base64图片
    const subQuestionsWithImages = subQuestions.map(subQ => {
      // 恢复Base64图片到HTML内容中
      let restoredHtml = subQ.content_html;
      if (imagesBase64 && imagesBase64.length > 0) {
        restoredHtml = restoreContentFromDatabase(subQ.content_html, imagesBase64);
      }
      
      return {
        ...subQ,
        content_html: restoredHtml
      };
    });

    res.json({
      success: true,
      data: {
        questionId: questionId,
        count: subQuestionsWithImages.length,
        subQuestions: subQuestionsWithImages
      }
    });
  } catch (error) {
    console.error('获取小题列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * PUT /api/questions/:id
 * 更新大题内容
 */
router.put('/:id', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const {
      contentHtml,
      projectName,
      totalScore,
      examTime,
      pageSize,
      notes
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 处理HTML内容
    const processed = processHtmlContent(contentHtml);

    // 更新数据库（使用用户数据库）
    await QuestionModel.updateQuestion(req.userPool, questionId, {
      contentHtml: contentHtml,
      contentText: processed.textContent,
      imagesBase64: processed.imagesBase64,
      projectName: projectName,
      totalScore: totalScore || 0,
      examTime: examTime || 0,
      pageSize: pageSize || 'A4',
      notes: notes
    });

    res.json({
      success: true,
      message: '更新成功',
      data: {
        questionId: questionId
      }
    });
  } catch (error) {
    console.error('更新大题失败:', error);
    res.status(500).json({
      success: false,
      message: '更新失败: ' + error.message
    });
  }
});

/**
 * PUT /api/questions/subquestions/:id
 * 更新小题内容
 */
router.put('/subquestions/:id', async (req, res) => {
  try {
    const subQuestionId = parseInt(req.params.id);
    const {
      number,
      subNumber,
      contentHtml,
      score,
      fullContent,
      answer,
      answerHtml,
      explanation,
      explanationHtml
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 提取纯文本内容
    const contentText = extractTextFromHtml(contentHtml);
    const answerText = answerHtml ? extractTextFromHtml(answerHtml) : (answer || null);
    const explanationText = explanationHtml ? extractTextFromHtml(explanationHtml) : (explanation || null);

    // 更新数据库（使用用户数据库）
    await QuestionModel.updateSubQuestion(req.userPool, subQuestionId, {
      number: number,
      subNumber: subNumber,
      contentHtml: contentHtml,
      contentText: contentText,
      score: score || 0,
      fullContent: fullContent || contentHtml,
      answer: answerText,
      answerHtml: answerHtml || null,
      explanation: explanationText,
      explanationHtml: explanationHtml || null
    });

    res.json({
      success: true,
      message: '更新成功',
      data: {
        subQuestionId: subQuestionId
      }
    });
  } catch (error) {
    console.error('更新小题失败:', error);
    res.status(500).json({
      success: false,
      message: '更新失败: ' + error.message
    });
  }
});

/**
 * POST /api/questions/recognize
 * 识别试题内容（大题、小题、子小题、分值）
 * 注意：这个路由不需要用户数据库，只需要认证
 */
router.post('/recognize', authenticate, async (req, res) => {
  try {
    const { htmlContent } = req.body;

    if (!htmlContent) {
      return res.status(400).json({
        success: false,
        message: 'HTML内容不能为空'
      });
    }

    // 调用识别函数
    const result = recognizeQuestions(htmlContent);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || '识别失败',
        data: result
      });
    }

    res.json({
      success: true,
      message: `识别成功：共识别到 ${result.totalMajorQuestions} 个大题，${result.totalSubQuestions} 道小题`,
      data: result
    });
  } catch (error) {
    console.error('识别试题失败:', error);
    res.status(500).json({
      success: false,
      message: '识别失败: ' + error.message
    });
  }
});

module.exports = router;

