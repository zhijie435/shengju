const express = require('express');
const router = express.Router();
const QuestionBankModel = require('../models/questionBankModel');
const QuestionBankCleaner = require('../models/questionBankCleaner');
const QuestionBankService = require('../services/questionBankService');
const QuestionModel = require('../models/questionModel');
const { processHtmlContent, extractTextFromHtml } = require('../utils/imageProcessor');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachUserDatabase, optionalAttachUserDatabase } = require('../config/userDatabase');

// 共享题库相关路由需要认证
router.use(authenticate);

/**
 * POST /api/question-bank/check-duplicate
 * 检查试题是否重复
 */
router.post('/check-duplicate', async (req, res) => {
  try {
    const {
      contentHtml,
      category,
      subject
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 处理HTML内容，提取文本用于查重
    const processed = processHtmlContent(contentHtml);
    const textContent = (processed.textContent || '').trim();

    // 查找重复的题目
    const duplicates = await QuestionBankModel.findDuplicates({
      contentText: textContent,
      category: category || '未分类',
      subject: subject || '未分类'
    });

    if (duplicates.length > 0) {
      return res.json({
        success: true,
        isDuplicate: true,
        duplicates: duplicates,
        message: `发现 ${duplicates.length} 道相似题目`
      });
    }

    res.json({
      success: true,
      isDuplicate: false,
      duplicates: [],
      message: '未发现重复题目'
    });
  } catch (error) {
    console.error('查重失败:', error);
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      message: '查重失败: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/question-bank/save
 * 保存小题到题库
 */
router.post('/save', async (req, res) => {
  try {
    const {
      number,
      subNumber,
      contentHtml,
      score,
      category,
      subject,
      grade,
      tags,
      questionType,
      examPurpose,
      difficulty,
      fullContent,
      notes,
      answer,
      answerHtml,
      explanation,
      explanationHtml,
      subAnswers,
      subExplanations,
      overwriteId // 如果提供，表示覆盖指定ID的题目
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 处理HTML内容，提取图片和文本
    const processed = processHtmlContent(contentHtml);
    
    if (!processed || typeof processed !== 'object') {
      throw new Error('处理HTML内容失败，返回结果无效');
    }

    let questionId;

    // 如果指定了覆盖ID，先删除旧题目（覆盖模式不检查重复）
    if (overwriteId) {
      await QuestionBankModel.deleteQuestion(overwriteId, category || '未分类', subject || '未分类');
    } else {
      // 保存前检查是否重复（非覆盖模式才检查）
      const textContent = (processed.textContent || '').trim();
      if (textContent) {
        const duplicates = await QuestionBankModel.findDuplicates({
          contentText: textContent,
          category: category || '未分类',
          subject: subject || '未分类',
          similarityThreshold: 0.85 // 相似度阈值85%以上视为重复
        });

        if (duplicates.length > 0) {
          // 找到重复题目，拒绝保存
          const duplicateInfo = duplicates[0]; // 取相似度最高的
          return res.status(400).json({
            success: false,
            isDuplicate: true,
            message: `题目已存在，不能重复上传！相似度：${Math.round(duplicateInfo.similarity * 100)}%`,
            duplicate: {
              id: duplicateInfo.id,
              number: duplicateInfo.number,
              contentText: duplicateInfo.contentText,
              similarity: duplicateInfo.similarity
            },
            duplicates: duplicates.slice(0, 5) // 返回前5个相似题目
          });
        }
      }
    }

    // 提取答案和解析的纯文本
    const answerText = answerHtml ? extractTextFromHtml(answerHtml) : (answer || null);
    const explanationText = explanationHtml ? extractTextFromHtml(explanationHtml) : (explanation || null);

    // 保存到题库
    questionId = await QuestionBankModel.saveQuestion({
      number: number || '',
      subNumber: subNumber || null,
      contentHtml: contentHtml,
      contentText: processed.textContent || '',
      score: score || 0,
      category: category || '未分类',
      subject: subject || '未分类',
      grade: grade || null,
      tags: tags || null,
      questionType: questionType || null,
      examPurpose: examPurpose || null,
      difficulty: difficulty || '中等',
      imagesBase64: processed.imagesBase64 || [],
      fullContent: fullContent || contentHtml,
      answer: answerText,
      answerHtml: answerHtml || null,
      explanation: explanationText,
      explanationHtml: explanationHtml || null,
      subAnswers: subAnswers || null,
      subExplanations: subExplanations || null,
      notes: notes || null
    });

    res.json({
      success: true,
      message: overwriteId ? '覆盖成功' : '保存到题库成功',
      data: {
        questionId: questionId,
        imagesCount: processed.imagesBase64.length
      }
    });
  } catch (error) {
    console.error('保存到题库失败:', error);
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      message: '保存失败: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/question-bank/list
 * 获取题库列表（支持分类、科目、年级等筛选）
 * 题库数据与保存接口一致，均使用主库，确保按分类/科目筛选能查到已保存的题目
 */
router.get('/list', async (req, res) => {
  try {
    // 使用主库查询（与 POST /save 存储位置一致），否则会查到空的用户库导致筛选无结果
    const poolForList = undefined;
    // 从查询参数中获取筛选条件，如果未传递则使用默认值
    const {
      category,
      subject,
      difficulty,
      questionType,
      examPurpose,
      grade,
      useCountMin,
      useCountMax,
      keyword,
      difficultyEasy,
      difficultyMedium,
      difficultyHard,
      page = 1,
      pageSize = 10,
      orderBy = 'number',
      orderDir = 'ASC'
    } = req.query;

    // 规范化筛选值：trim 后空字符串视为「全部」，避免前端传空或空格导致筛选失效
    const norm = (v, defaultVal = '全部') => (v != null && String(v).trim() !== '' ? String(v).trim() : defaultVal);
    const filters = {
      category: norm(category),
      subject: norm(subject),
      difficulty: norm(difficulty),
      questionType: norm(questionType),
      examPurpose: (examPurpose != null ? String(examPurpose).trim() : '') || '',
      grade: norm(grade),
      useCountMin: useCountMin != null && String(useCountMin).trim() !== '' ? parseInt(useCountMin, 10) : undefined,
      useCountMax: useCountMax != null && String(useCountMax).trim() !== '' ? parseInt(useCountMax, 10) : undefined,
      keyword: (keyword != null ? String(keyword).trim() : '') || '',
      difficultyEasy: difficultyEasy && String(difficultyEasy).trim() !== '' && difficultyEasy !== '0' ? parseInt(difficultyEasy, 10) : undefined,
      difficultyMedium: difficultyMedium && String(difficultyMedium).trim() !== '' && difficultyMedium !== '0' ? parseInt(difficultyMedium, 10) : undefined,
      difficultyHard: difficultyHard && String(difficultyHard).trim() !== '' && difficultyHard !== '0' ? parseInt(difficultyHard, 10) : undefined,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10)),
      orderBy: orderBy && ['created_at', 'updated_at', 'number', 'score', 'difficulty', 'use_count'].includes(orderBy) ? orderBy : 'number',
      orderDir: (orderDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    };
    
    // 记录筛选条件，便于调试
    console.log('📋 接收到的筛选条件:', JSON.stringify(filters, null, 2));

    // 验证分页参数
    if (filters.page < 1) filters.page = 1;
    if (filters.pageSize < 1 || filters.pageSize > 100) filters.pageSize = 10;

    const total = await QuestionBankModel.getQuestionCount(filters, poolForList);
    let questions = await QuestionBankModel.getQuestions(filters, poolForList);
    
    // 注意：难度比例筛选应该在分页之前进行，但为了不影响分页功能，
    // 我们只在没有设置具体难度筛选时才应用比例筛选
    // 如果用户同时设置了难度筛选和难度比例，优先使用难度筛选
    if ((filters.difficultyEasy || filters.difficultyMedium || filters.difficultyHard) && 
        (!filters.difficulty || filters.difficulty === '全部')) {
      const easyRatio = filters.difficultyEasy || 0;
      const mediumRatio = filters.difficultyMedium || 0;
      const hardRatio = filters.difficultyHard || 0;
      
      // 计算总比例
      const totalRatio = easyRatio + mediumRatio + hardRatio;
      
      if (totalRatio > 0) {
        // 按难度分组
        const easyQuestions = questions.filter(q => q.difficulty === '简单');
        const mediumQuestions = questions.filter(q => q.difficulty === '中等');
        const hardQuestions = questions.filter(q => q.difficulty === '困难');
        
        // 计算每种难度应该选择的数量（基于比例）
        // 注意：这里应该基于当前页的数据量，而不是总数
        const totalNeeded = Math.min(questions.length, filters.pageSize || 10);
        const easyCount = Math.round((easyRatio / totalRatio) * totalNeeded);
        const mediumCount = Math.round((mediumRatio / totalRatio) * totalNeeded);
        const hardCount = totalNeeded - easyCount - mediumCount; // 剩余的数量分配给困难
        
        // 按顺序选择题目（保持顺序）
        const selectedEasy = easyQuestions.slice(0, Math.min(easyCount, easyQuestions.length));
        const selectedMedium = mediumQuestions.slice(0, Math.min(mediumCount, mediumQuestions.length));
        const selectedHard = hardQuestions.slice(0, Math.min(hardCount, hardQuestions.length));
        
        // 合并结果，保持原有顺序
        questions = [...selectedEasy, ...selectedMedium, ...selectedHard];
        
        // 如果总数不足，补充其他难度的题目
        if (questions.length < totalNeeded) {
          const remaining = totalNeeded - questions.length;
          const allRemaining = [...easyQuestions.slice(selectedEasy.length), 
                                ...mediumQuestions.slice(selectedMedium.length),
                                ...hardQuestions.slice(selectedHard.length)];
          questions = [...questions, ...allRemaining.slice(0, remaining)];
        }
        
        // 注意：应用难度比例筛选后，总数可能会改变，需要重新计算
        // 但为了保持分页的一致性，我们仍然使用原始的总数
      }
    }

    // 恢复Base64图片到HTML内容中
    const { restoreContentFromDatabase } = require('../utils/imageProcessor');
    const questionsWithImages = questions.map(question => {
      let restoredHtml = question.content_html;
      if (question.images_base64 && question.images_base64.length > 0) {
        restoredHtml = restoreContentFromDatabase(question.content_html, question.images_base64);
      }
      return {
        ...question,
        content_html: restoredHtml
      };
    });

    // 基于实际返回的数据重新计算总数和总页数
    const actualCount = questionsWithImages.length;
    let actualTotal = total;
    let actualTotalPages = 0;
    
    if (actualCount === 0) {
      // 没有数据
      actualTotal = 0;
      actualTotalPages = 0;
    } else if (total > 0) {
      // 如果当前页返回的数据少于预期，说明这是最后一页
      const expectedCount = parseInt(filters.pageSize) || 10;
      
      if (actualCount < expectedCount && filters.page > 1) {
        // 当前页数据不满，说明这是最后一页
        // 重新计算总数：当前页之前的数量 + 当前页的数量
        actualTotal = (filters.page - 1) * expectedCount + actualCount;
        actualTotalPages = filters.page;
      } else if (actualCount < expectedCount && filters.page === 1) {
        // 第一页数据不满，说明总数就是当前页的数量
        actualTotal = actualCount;
        actualTotalPages = 1;
      } else {
        // 正常情况，使用统计的总数
        actualTotal = total;
        actualTotalPages = Math.ceil(total / expectedCount);
      }
    } else {
      // 如果统计为0，但实际有数据返回，基于实际数据计算
      const expectedCount = parseInt(filters.pageSize) || 10;
      if (actualCount < expectedCount) {
        // 数据不满一页，总数就是当前数量
        actualTotal = actualCount;
        actualTotalPages = 1;
      } else {
        // 数据满一页，但统计为0，可能是统计有问题
        // 这种情况下，至少显示当前页的数据
        actualTotal = actualCount;
        actualTotalPages = 1;
      }
    }
    
    res.json({
      success: true,
      data: {
        questions: questionsWithImages,
        total: actualTotal,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages: actualTotalPages,
        actualCount: questionsWithImages.length // 实际返回的数据量
      }
    });
  } catch (error) {
    console.error('获取题库列表失败:', error);
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/question-bank/categories
 * 获取所有分类列表
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = await QuestionBankModel.getCategories();
    res.json({
      success: true,
      data: {
        categories: categories
      }
    });
  } catch (error) {
    console.error('获取分类列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/subjects
 * 获取所有科目列表
 */
router.get('/subjects', async (req, res) => {
  try {
    const subjects = await QuestionBankModel.getSubjects();
    res.json({
      success: true,
      data: {
        subjects: subjects
      }
    });
  } catch (error) {
    console.error('获取科目列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * 固定科目列表（与小题筛选、上传到题库共用，保证选项一致）
 */
const SUBJECT_MAP_BY_CATEGORY = {
  '教育类': [
    '教育基础知识',
    '数学', '语文', '英语', '物理', '化学', '生物',
    '历史', '地理', '政治', '思想品德', '科学', '音乐', '美术', '体育'
  ],
  '卫生类': [
    '卫生基础知识',
    '临床医学', '护理学', '医学检验', '医学影像',
    '药学', '公共卫生', '中医学', '口腔医学', '麻醉学'
  ],
  '综合类': [
    '公共基础知识', '职业能力测验', '综合应用能力',
    '申论', '行测', '面试'
  ],
  '专业类': [
    '计算机科学与技术', '电子信息工程', '机械工程',
    '土木工程', '电气工程', '会计学', '财务管理',
    '人力资源管理', '市场营销', '工商管理'
  ],
  '未分类': ['未分类']
};

/**
 * GET /api/question-bank/subjects-by-category
 * 根据分类获取科目列表（数据库已有科目 + 固定列表 + 未分类，与筛选/上传选项一致）
 */
router.get('/subjects-by-category', async (req, res) => {
  try {
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: '请提供分类参数'
      });
    }

    const fixedList = SUBJECT_MAP_BY_CATEGORY[category] || SUBJECT_MAP_BY_CATEGORY['未分类'] || [];
    const fromDb = await QuestionBankModel.getSubjectsByCategoryFromDb(category);
    const fromRows = await QuestionBankModel.getDistinctSubjectsFromRowsByCategory(category);
    const merged = [...new Set([...fixedList, ...fromDb, ...fromRows, '未分类'])];
    const subjects = merged.filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    res.json({
      success: true,
      data: {
        subjects,
        category
      }
    });
  } catch (error) {
    console.error('根据分类获取科目列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/all
 * 获取所有题库试题（用于预览生成）
 */
router.get('/all', async (req, res) => {
  try {
    console.log('[题库API] 开始获取所有题库试题');
    
    // 获取所有试题，不进行分页
    const filters = {
      category: '全部',
      subject: '全部',
      page: 1,
      pageSize: 10000, // 设置一个很大的值以获取所有试题
      orderBy: 'number',
      orderDir: 'ASC'
    };

    console.log('[题库API] 查询过滤器:', filters);
    const questions = await QuestionBankModel.getQuestions(filters);
    console.log('[题库API] 查询到试题数量:', questions ? questions.length : 0);

    // 恢复Base64图片到HTML内容中
    const { restoreContentFromDatabase } = require('../utils/imageProcessor');
    const questionsWithImages = questions.map(question => {
      let restoredHtml = question.full_content || question.content_html || '';
      if (question.images_base64 && question.images_base64.length > 0) {
        restoredHtml = restoreContentFromDatabase(restoredHtml, question.images_base64);
      }
      return {
        ...question,
        content_html: restoredHtml,
        full_content: restoredHtml
      };
    });

    console.log('[题库API] 处理完成，返回试题数量:', questionsWithImages.length);

    res.json({
      success: true,
      data: {
        questions: questionsWithImages,
        total: questionsWithImages.length
      }
    });
  } catch (error) {
    console.error('[题库API] 获取所有题库试题失败:', error);
    console.error('[题库API] 错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/question-bank/question-types
 * 获取所有题型列表
 */
router.get('/question-types', async (req, res) => {
  try {
    const questionTypes = await QuestionBankModel.getQuestionTypes();
    res.json({
      success: true,
      data: {
        questionTypes: questionTypes
      }
    });
  } catch (error) {
    console.error('获取题型列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/grades
 * 获取所有年级列表
 */
router.get('/grades', async (req, res) => {
  try {
    const grades = await QuestionBankModel.getGrades();
    res.json({
      success: true,
      data: {
        grades: grades
      }
    });
  } catch (error) {
    console.error('获取年级列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * POST /api/question-bank/increment-use-count
 * 增加使用次数
 * 需要提供category和subject（如果所有题目都在同一个表中）
 */
router.post('/increment-use-count', async (req, res) => {
  try {
    const { ids, category, subject } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供题目ID列表'
      });
    }

    await QuestionBankModel.incrementUseCount(ids, category, subject);

    res.json({
      success: true,
      message: `成功更新 ${ids.length} 道题目的使用次数`
    });
  } catch (error) {
    console.error('更新使用次数失败:', error);
    res.status(500).json({
      success: false,
      message: '更新失败: ' + error.message
    });
  }
});

/**
 * POST /api/question-bank/batch-save
 * 批量保存多个小题到题库
 * 必须在动态路由 /:id 之前定义
 */
router.post('/batch-save', async (req, res) => {
  try {
    const { questions, category, subject, grade } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供要保存的题目列表'
      });
    }

    if (!category || !subject) {
      return res.status(400).json({
        success: false,
        message: '分类和科目不能为空'
      });
    }

    const results = [];
    const errors = [];
    const skipped = [];

    // 逐个保存题目（先查重，重复则跳过不写入）
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      try {
        if (!question.contentHtml) {
          errors.push({
            index: i,
            message: '题目内容不能为空'
          });
          continue;
        }

        // 处理HTML内容，提取图片和文本
        const processed = processHtmlContent(question.contentHtml);
        const textContent = (processed.textContent || '').trim();

        // 查重：与题库已有题目比对，重复则跳过
        const duplicates = await QuestionBankModel.findDuplicates({
          contentText: textContent,
          category: category,
          subject: subject,
          similarityThreshold: 0.85
        });
        if (duplicates.length > 0) {
          skipped.push({
            index: i,
            reason: '题目已存在，重复未入库'
          });
          continue;
        }

        // 提取答案和解析的纯文本
        const answerText = question.answerHtml ? extractTextFromHtml(question.answerHtml) : (question.answer || null);
        const explanationText = question.explanationHtml ? extractTextFromHtml(question.explanationHtml) : (question.explanation || null);

        // 保存到题库
        const questionId = await QuestionBankModel.saveQuestion({
          number: question.number || '',
          subNumber: question.subNumber || null,
          contentHtml: question.contentHtml,
          contentText: processed.textContent || '',
          score: question.score || 0,
          category: category,
          subject: subject,
          grade: grade || null,
          tags: question.tags || null,
          questionType: question.questionType || null,
          examPurpose: question.examPurpose || null,
          difficulty: question.difficulty || '中等',
          imagesBase64: processed.imagesBase64 || [],
          fullContent: question.fullContent || question.contentHtml,
          answer: answerText,
          answerHtml: question.answerHtml || null,
          explanation: explanationText,
          explanationHtml: question.explanationHtml || null,
          notes: question.notes || null
        });

        results.push({
          index: i,
          questionId: questionId,
          success: true
        });
      } catch (error) {
        errors.push({
          index: i,
          message: error.message || '保存失败'
        });
      }
    }

    res.json({
      success: true,
      message: `成功保存 ${results.length} 道，跳过重复 ${skipped.length} 道，失败 ${errors.length} 道`,
      data: {
        successCount: results.length,
        skippedCount: skipped.length,
        errorCount: errors.length,
        results: results,
        skipped: skipped,
        errors: errors
      }
    });
  } catch (error) {
    console.error('批量保存到题库失败:', error);
    res.status(500).json({
      success: false,
      message: '批量保存失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/:id
 * 获取题库题目详情
 * 支持查询参数：category, subject（如果提供，可以加快查询速度）
 */
router.get('/:id', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const { category, subject } = req.query;
    
    const question = await QuestionBankModel.getQuestionById(questionId, category, subject);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: '题目不存在'
      });
    }

    // 恢复Base64图片到HTML内容中
    const { restoreContentFromDatabase } = require('../utils/imageProcessor');
    let restoredHtml = question.content_html || '';
    if (question.images_base64 && question.images_base64.length > 0) {
      restoredHtml = restoreContentFromDatabase(question.content_html || '', question.images_base64);
    }
    // 若 content_html 为空则用 full_content 兜底（并恢复图片），再兜底 content_text，避免详情无内容
    if (!restoredHtml || (typeof restoredHtml === 'string' && !restoredHtml.trim())) {
      let fallback = question.full_content || '';
      if (fallback && question.images_base64 && question.images_base64.length > 0) {
        fallback = restoreContentFromDatabase(fallback, question.images_base64);
      }
      restoredHtml = (fallback && fallback.trim()) ? fallback : (question.content_text || '');
    }
    // 明确返回答案、解析、难度（兼容旧表无此字段或字段为 null），统一从 row 取多种可能键名
    const row = question;
    const answer = (row.answer != null && row.answer !== '' && row.answer !== 'null' && row.answer !== 'undefined') ? row.answer : (row.Answer != null && row.Answer !== '' && row.Answer !== 'null' && row.Answer !== 'undefined' ? row.Answer : null);
    const answer_html = (row.answer_html != null && row.answer_html !== '' && row.answer_html !== 'null' && row.answer_html !== 'undefined') ? row.answer_html : (answer != null ? answer : null);
    const explanation = (row.explanation != null && row.explanation !== '' && row.explanation !== 'null' && row.explanation !== 'undefined') ? row.explanation : (row.Explanation != null && row.Explanation !== '' && row.Explanation !== 'null' && row.Explanation !== 'undefined' ? row.Explanation : null);
    const explanation_html = (row.explanation_html != null && row.explanation_html !== '' && row.explanation_html !== 'null' && row.explanation_html !== 'undefined') ? row.explanation_html : (explanation != null ? explanation : null);
    const difficulty = (row.difficulty != null && String(row.difficulty).trim() !== '' && row.difficulty !== 'null' && row.difficulty !== 'undefined') ? row.difficulty : '中等';

    // 详细的调试日志
    console.log('🔍 [后端] 获取题目详情 - 原始数据:', {
      id: row.id,
      'row.answer': row.answer,
      'row.answer_html': row.answer_html,
      'row.explanation': row.explanation,
      'row.explanation_html': row.explanation_html,
      'row.difficulty': row.difficulty,
      'row.sub_answers': row.sub_answers ? (typeof row.sub_answers === 'string' ? row.sub_answers.substring(0, 100) + '...' : JSON.stringify(row.sub_answers).substring(0, 100) + '...') : null,
      'row.sub_explanations': row.sub_explanations ? (typeof row.sub_explanations === 'string' ? row.sub_explanations.substring(0, 100) + '...' : JSON.stringify(row.sub_explanations).substring(0, 100) + '...') : null,
      'row.sub_answers_type': typeof row.sub_answers,
      'row.sub_explanations_type': typeof row.sub_explanations
    });
    console.log('🔍 [后端] 处理后的字段值:', {
      answer: answer,
      answer_html: answer_html,
      explanation: explanation,
      explanation_html: explanation_html,
      difficulty: difficulty,
      sub_answers: row.sub_answers ? (Array.isArray(row.sub_answers) ? `数组(${row.sub_answers.length}项)` : typeof row.sub_answers) : null,
      sub_explanations: row.sub_explanations ? (Array.isArray(row.sub_explanations) ? `数组(${row.sub_explanations.length}项)` : typeof row.sub_explanations) : null
    });

    const payload = {
      id: row.id,
      number: row.number,
      sub_number: row.sub_number,
      category: row.category,
      subject: row.subject,
      grade: row.grade,
      tags: row.tags,
      question_type: row.question_type,
      exam_purpose: row.exam_purpose,
      score: row.score != null ? row.score : 0,
      use_count: row.use_count != null ? row.use_count : 0,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      content_html: restoredHtml,
      content_text: row.content_text,
      full_content: row.full_content,
      images_base64: row.images_base64,
      notes: row.notes,
      answer: answer != null ? answer : '',
      answer_html: answer_html != null ? answer_html : (answer != null ? answer : ''),
      explanation: explanation != null ? explanation : '',
      explanation_html: explanation_html != null ? explanation_html : (explanation != null ? explanation : ''),
      difficulty: difficulty,
      sub_answers: row.sub_answers || null,
      sub_explanations: row.sub_explanations || null
    };

    console.log('🔍 [后端] 最终返回的payload中的答案和解析字段:', {
      'payload.answer': payload.answer,
      'payload.answer_html': payload.answer_html,
      'payload.explanation': payload.explanation,
      'payload.explanation_html': payload.explanation_html,
      'payload.difficulty': payload.difficulty,
      'payload.sub_answers': payload.sub_answers ? (Array.isArray(payload.sub_answers) ? `数组(${payload.sub_answers.length}项)` : typeof payload.sub_answers) : null,
      'payload.sub_explanations': payload.sub_explanations ? (Array.isArray(payload.sub_explanations) ? `数组(${payload.sub_explanations.length}项)` : typeof payload.sub_explanations) : null
    });

    res.json({
      success: true,
      data: payload
    });
  } catch (error) {
    console.error('获取题目详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * PUT /api/question-bank/:id
 * 更新题库题目
 * 需要提供原始category和subject（从查询结果中获取）
 */
router.put('/:id', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const {
      number,
      subNumber,
      contentHtml,
      score,
      category,
      subject,
      grade,
      tags,
      questionType,
      examPurpose,
      difficulty,
      fullContent,
      notes,
      answer,
      answerHtml,
      explanation,
      explanationHtml,
      subAnswers,
      subExplanations,
      originalCategory,
      originalSubject
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 处理HTML内容
    const processed = processHtmlContent(contentHtml);
    
    // 提取答案和解析的纯文本
    const answerText = answerHtml ? extractTextFromHtml(answerHtml) : (answer || null);
    const explanationText = explanationHtml ? extractTextFromHtml(explanationHtml) : (explanation || null);

    // 更新数据库（需要原始类别和科目）
    await QuestionBankModel.updateQuestion(
      questionId,
      {
        number: number || '',
        subNumber: subNumber || null,
        contentHtml: contentHtml,
        contentText: processed.textContent,
        score: score || 0,
        category: category || '未分类',
        subject: subject || '未分类',
        grade: grade || null,
        tags: tags || null,
        questionType: questionType || null,
        examPurpose: examPurpose || null,
        difficulty: difficulty || '中等',
        imagesBase64: processed.imagesBase64,
        fullContent: fullContent || contentHtml,
        answer: answerText,
        answerHtml: answerHtml || null,
        explanation: explanationText,
        explanationHtml: explanationHtml || null,
        subAnswers: subAnswers || null,
        subExplanations: subExplanations || null,
        notes: notes || null
      },
      originalCategory || category,
      originalSubject || subject
    );

    res.json({
      success: true,
      message: '更新成功',
      data: {
        questionId: questionId
      }
    });
  } catch (error) {
    console.error('更新题目失败:', error);
    res.status(500).json({
      success: false,
      message: '更新失败: ' + error.message
    });
  }
});

/**
 * DELETE /api/question-bank/batch
 * 批量删除题库题目（必须放在 /:id 之前，否则会被匹配为 id=batch）
 * 需要 body: { ids, category?, subject? }
 */
router.delete('/batch', async (req, res) => {
  try {
    const body = req.body || {};
    const ids = body.ids;
    const category = (body.category != null && String(body.category).trim() !== '') ? String(body.category).trim() : null;
    const subject = (body.subject != null && String(body.subject).trim() !== '') ? String(body.subject).trim() : null;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择要删除的题目'
      });
    }

    await QuestionBankModel.deleteQuestions(ids, category, subject);

    res.json({
      success: true,
      message: `成功删除 ${ids.length} 道题目`
    });
  } catch (error) {
    console.error('批量删除失败:', error);
    res.status(500).json({
      success: false,
      message: '删除失败: ' + error.message
    });
  }
});

/**
 * DELETE /api/question-bank/:id
 * 删除题库题目
 * 支持查询参数：category, subject（如果提供，可以加快删除速度）
 */
router.delete('/:id', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    if (isNaN(questionId)) {
      return res.status(400).json({
        success: false,
        message: '题目ID无效'
      });
    }
    const category = (req.query.category != null && String(req.query.category).trim() !== '') ? String(req.query.category).trim() : null;
    const subject = (req.query.subject != null && String(req.query.subject).trim() !== '') ? String(req.query.subject).trim() : null;

    await QuestionBankModel.deleteQuestion(questionId, category, subject);

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除题目失败:', error);
    res.status(500).json({
      success: false,
      message: '删除失败: ' + error.message
    });
  }
});

/**
 * POST /api/question-bank/clean
 * 清空所有题库表的数据并删除空表
 */
router.post('/clean', async (req, res) => {
  console.log('收到清理请求:', req.body);
  try {
    const { action } = req.body; // 'clear': 只清空数据, 'delete': 只删除空表, 'all': 清空并删除

    if (action === 'clear') {
      const result = await QuestionBankCleaner.clearAllQuestionData();
      res.json({
        success: true,
        message: `已清空 ${result.cleared} 个表的数据`,
        data: result
      });
    } else if (action === 'delete') {
      const result = await QuestionBankCleaner.deleteEmptyTables();
      res.json({
        success: true,
        message: `已删除 ${result.deleted} 个空表`,
        data: result
      });
    } else if (action === 'sync') {
      const result = await QuestionBankCleaner.syncTableInfo();
      res.json({
        success: true,
        message: `已同步 ${result.synced} 个表的信息`,
        data: result
      });
    } else if (action === 'delete-unlinked') {
      const result = await QuestionBankCleaner.deleteUnlinkedTables();
      res.json({
        success: true,
        message: `已删除 ${result.deleted} 个不关联的表`,
        data: result
      });
    } else {
      // 默认执行完整清理
      const result = await QuestionBankCleaner.cleanAndSync();
      res.json({
        success: true,
        message: '清理完成',
        data: result
      });
    }
  } catch (error) {
    console.error('清理失败:', error);
    res.status(500).json({
      success: false,
      message: '清理失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/tables
 * 获取所有题库表的信息
 */
router.get('/tables', async (req, res) => {
  try {
    const tables = await QuestionBankCleaner.getAllQuestionBankTables();
    res.json({
      success: true,
      data: tables
    });
  } catch (error) {
    console.error('获取表列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取表列表失败: ' + error.message
    });
  }
});

/**
 * POST /api/question-bank/contribute
 * 贡献题目到共享题库（待审核状态）
 */
router.post('/contribute', async (req, res) => {
  try {
    const {
      number,
      subNumber,
      contentHtml,
      contentText,
      score,
      category,
      subject,
      grade,
      tags,
      questionType,
      examPurpose,
      difficulty,
      imagesBase64,
      fullContent,
      notes
    } = req.body;

    if (!contentHtml) {
      return res.status(400).json({
        success: false,
        message: '内容不能为空'
      });
    }

    // 检查用户权限
    const UserModel = require('../models/userModel');
    const permissions = await UserModel.getPermissions(req.user.id);
    if (!permissions || !permissions.can_contribute) {
      return res.status(403).json({
        success: false,
        message: '您没有贡献题目的权限'
      });
    }

    const questionId = await QuestionBankService.contributeQuestion(req.user.id, {
      number,
      subNumber,
      contentHtml,
      contentText,
      score,
      category,
      subject,
      grade,
      tags,
      questionType,
      examPurpose,
      difficulty,
      imagesBase64,
      fullContent,
      notes
    });

    res.json({
      success: true,
      message: '题目已提交，等待管理员审核',
      data: {
        questionId
      }
    });
  } catch (error) {
    console.error('贡献题目失败:', error);
    res.status(500).json({
      success: false,
      message: '贡献失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/shared/list
 * 获取共享题库列表（仅已审核的）
 */
router.get('/shared/list', async (req, res) => {
  try {
    const filters = {
      category: req.query.category,
      subject: req.query.subject,
      difficulty: req.query.difficulty,
      keyword: req.query.keyword,
      page: parseInt(req.query.page) || 1,
      pageSize: parseInt(req.query.pageSize) || 20
    };

    const result = await QuestionBankService.getApprovedQuestions(filters);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('获取共享题库列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/shared/:id
 * 获取共享题库题目详情
 */
router.get('/shared/:id', async (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const question = await QuestionBankService.getQuestionById(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: '题目不存在'
      });
    }

    // 只有已审核的题目才能查看
    if (question.status !== 'approved') {
      // 管理员可以查看待审核的题目
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: '题目尚未审核通过'
        });
      }
    }

    res.json({
      success: true,
      data: question
    });
  } catch (error) {
    console.error('获取题目详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/pending
 * 获取待审核题目列表（仅管理员）
 */
router.get('/pending', requireAdmin, async (req, res) => {
  try {
    const questions = await QuestionBankService.getPendingQuestions();
    res.json({
      success: true,
      data: {
        questions,
        count: questions.length
      }
    });
  } catch (error) {
    console.error('获取待审核题目失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * POST /api/question-bank/review
 * 审核题目（仅管理员）
 */
router.post('/review', requireAdmin, async (req, res) => {
  try {
    const { questionId, status, comment } = req.body;

    if (!questionId || !status) {
      return res.status(400).json({
        success: false,
        message: '题目ID和审核状态不能为空'
      });
    }

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的审核状态'
      });
    }

    await QuestionBankService.reviewQuestion(questionId, req.user.id, status, comment);

    res.json({
      success: true,
      message: status === 'approved' ? '题目已审核通过' : '题目已拒绝'
    });
  } catch (error) {
    console.error('审核题目失败:', error);
    res.status(500).json({
      success: false,
      message: '审核失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/shared/categories
 * 获取共享题库分类列表
 */
router.get('/shared/categories', async (req, res) => {
  try {
    const categories = await QuestionBankService.getCategories();
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('获取分类列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * GET /api/question-bank/shared/subjects
 * 获取共享题库科目列表
 */
router.get('/shared/subjects', async (req, res) => {
  try {
    const category = req.query.category;
    const subjects = await QuestionBankService.getSubjects(category);
    res.json({
      success: true,
      data: subjects
    });
  } catch (error) {
    console.error('获取科目列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取失败: ' + error.message
    });
  }
});

/**
 * POST /api/question-bank/sync-sub-questions
 * 同步 sub_questions 表中的所有小题到题库管理表
 */
router.post('/sync-sub-questions', authenticate, attachUserDatabase, async (req, res) => {
  try {
    const { category = '未分类', subject = '未分类', overwrite = false } = req.body;
    
    console.log(`🔄 开始同步小题到题库: category=${category}, subject=${subject}, overwrite=${overwrite}`);
    
    // 获取用户数据库连接
    const userPool = req.userPool;
    if (!userPool) {
      return res.status(400).json({
        success: false,
        message: '用户数据库连接不可用'
      });
    }
    
    // 获取所有小题
    const [subQuestions] = await userPool.execute(
      `SELECT sq.*, q.project_name 
       FROM sub_questions sq 
       LEFT JOIN questions q ON sq.question_id = q.id 
       ORDER BY sq.question_id, sq.number, sq.sub_number`
    );
    
    if (!subQuestions || subQuestions.length === 0) {
      return res.json({
        success: true,
        message: '没有找到需要同步的小题',
        data: {
          total: 0,
          synced: 0,
          skipped: 0,
          failed: 0
        }
      });
    }
    
    console.log(`📊 找到 ${subQuestions.length} 道小题需要同步`);
    
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    
    for (const subQ of subQuestions) {
      try {
        // 提取文本内容
        const contentText = subQ.content_text || extractTextFromHtml(subQ.content_html || '');
        
        if (!overwrite) {
          // 检查重复
          const duplicates = await QuestionBankModel.findDuplicates({
            contentText: contentText.trim(),
            category: category,
            subject: subject
          });
          
          if (duplicates.length > 0) {
            console.log(`⏭️  跳过重复题目: ID=${subQ.id}, 题号=${subQ.number}`);
            skipped++;
            continue;
          }
        }
        
        // 处理HTML内容，提取图片
        const processed = processHtmlContent(subQ.content_html || '');
        
        // 准备保存数据
        const questionData = {
          number: subQ.number || '',
          subNumber: subQ.sub_number || null,
          contentHtml: subQ.content_html || '',
          contentText: contentText || processed.textContent || '',
          score: subQ.score || 0,
          category: category,
          subject: subject,
          grade: null, // sub_questions 表中没有年级信息
          tags: null,
          questionType: null, // sub_questions 表中没有题型信息
          examPurpose: null, // sub_questions 表中没有考察目的信息
          difficulty: '中等', // 默认难度
          imagesBase64: processed.imagesBase64 || [],
          fullContent: subQ.full_content || subQ.content_html || '',
          notes: subQ.question_id ? `来源大题ID: ${subQ.question_id}` : null,
          answer: subQ.answer || null,
          answerHtml: subQ.answer_html || null,
          explanation: subQ.explanation || null,
          explanationHtml: subQ.explanation_html || null
        };
        
        // 保存到题库
        const bankId = await QuestionBankModel.saveQuestion(questionData);
        console.log(`✅ 同步成功: 小题ID=${subQ.id} -> 题库ID=${bankId}`);
        synced++;
        
      } catch (error) {
        console.error(`❌ 同步失败: 小题ID=${subQ.id}`, error);
        failed++;
        errors.push({
          subQuestionId: subQ.id,
          number: subQ.number,
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `同步完成: 成功 ${synced} 道，跳过 ${skipped} 道，失败 ${failed} 道`,
      data: {
        total: subQuestions.length,
        synced,
        skipped,
        failed,
        errors: errors.length > 0 ? errors : undefined
      }
    });
    
  } catch (error) {
    console.error('同步小题失败:', error);
    res.status(500).json({
      success: false,
      message: '同步失败: ' + error.message
    });
  }
});

module.exports = router;

