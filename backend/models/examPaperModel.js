const { pool } = require('../config/database');
const { processHtmlContent } = require('../utils/imageProcessor');
const fs = require('fs').promises;
const path = require('path');

// 阶段二优化：试卷进程级缓存（考试期间试卷不变，30 分钟过期）
const _paperCache = new Map();
const PAPER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * 企业端试卷可见范围（无 packageId 时）：已购包关联 ∪ 本企业已创建考试正在引用的试卷。
 * 与 exams.enterprise_id、exams.paper_id、enterprise_package_papers 保持一致，去重。
 */
function appendEnterprisePaperScopeSql(entIds, params) {
  const eph = entIds.map(() => '?').join(',');
  params.push(...entIds, ...entIds);
  return ` AND (
    EXISTS (SELECT 1 FROM enterprise_package_papers epp WHERE epp.paper_id = exam_papers.id AND epp.enterprise_id IN (${eph}))
    OR EXISTS (SELECT 1 FROM exams e WHERE e.paper_id = exam_papers.id AND e.enterprise_id IN (${eph}) AND e.paper_id IS NOT NULL)
  )`;
}

/** 已购测评包 JOIN：支持单 id 或 JWT+主企业等多 id，避免 enterprise_package_papers 已迁主键而 token 仍为旧 id 时列表恒空 */
function enterpriseIdsForPackageFilter(filters) {
  if (filters && Array.isArray(filters.enterpriseIds) && filters.enterpriseIds.length) {
    return [...new Set(filters.enterpriseIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  }
  if (filters && filters.enterpriseId != null && filters.enterpriseId !== '') {
    const n = Number(filters.enterpriseId);
    if (Number.isFinite(n) && n > 0) return [n];
  }
  return [];
}

/**
 * 试卷模型 - 用于保存和管理整套试题
 */
class ExamPaperModel {
  /**
   * 初始化数据库表（如果不存在则创建）
   */
  static async initializeTables() {
    const mysql = require('mysql2/promise');
    const { getConnectionInfo, MAIN_DB_NAME } = require('../config/database');
    
    // 创建一个支持多语句的连接
    const info = getConnectionInfo();
    const connection = await mysql.createConnection({
      ...info,
      database: MAIN_DB_NAME,
      multipleStatements: true
    });
    
    try {
      // 检查表是否存在
      const [tables] = await connection.execute(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = DATABASE() AND table_name = 'exam_papers'`
      );
      
      if (tables[0].count === 0) {
        console.log('检测到 exam_papers 表不存在，正在自动创建...');
        
        // 读取迁移 SQL 文件
        const sqlPath = path.join(__dirname, '../database/migrate_exam_papers_shared.sql');
        const sql = await fs.readFile(sqlPath, 'utf8');
        
        // 执行 SQL（多语句）
        await connection.query(sql);
        
        console.log('✓ exam_papers 表及相关表已成功创建');
      }

      // 无论表是否新建，确保新增字段存在（preview_html、is_enabled、visible_side）
      try {
        const [columns] = await connection.execute(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = 'exam_papers'
           AND COLUMN_NAME IN ('preview_html','exam_type','is_enabled','visible_side','project_info','package_payment_enabled','package_price_yuan','package_pay_wechat_qrcode','package_pay_alipay_qrcode')`
        );
        const columnNames = columns.map(col => col.COLUMN_NAME);

        if (!columnNames.includes('exam_type')) {
          console.log('检测到 exam_papers.exam_type 字段不存在，正在自动添加...');
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN exam_type VARCHAR(20) DEFAULT 'written' COMMENT '考试类型：written-笔试，interview-面试'`
          );
          console.log('exam_type 字段已成功添加');
        }

        if (!columnNames.includes('preview_html')) {
          console.log('检测到 exam_papers.preview_html 字段不存在，正在自动添加...');
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN preview_html LONGTEXT COMMENT '完整的预览HTML内容（包括所有格式、样式、布局）'`
          );
          console.log('preview_html 字段已成功添加');
        }

        if (!columnNames.includes('is_enabled')) {
          console.log('检测到 exam_papers.is_enabled 字段不存在，正在自动添加...');
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用：0-禁用，1-启用'`
          );
          console.log('is_enabled 字段已成功添加');
        }

        if (!columnNames.includes('visible_side')) {
          console.log('检测到 exam_papers.visible_side 字段不存在，正在自动添加...');
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN visible_side ENUM('candidate','enterprise') DEFAULT 'enterprise' COMMENT '显示端：candidate-求职者端, enterprise-企业端'`
          );
          console.log('visible_side 字段已成功添加');
        }

        if (!columnNames.includes('project_info')) {
          console.log('检测到 exam_papers.project_info 字段不存在，正在自动添加...');
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN project_info JSON DEFAULT NULL COMMENT '考试项目设置：指导语、结束语、评分要素、考官题本等'`
          );
          console.log('project_info 字段已成功添加');
        }

        if (!columnNames.includes('package_payment_enabled')) {
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN package_payment_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '企业购买测评包是否需线下扫码付费：0-否，1-是'`
          );
        }
        if (!columnNames.includes('package_price_yuan')) {
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN package_price_yuan DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '企业端购买价（元）'`
          );
        }
        if (!columnNames.includes('package_pay_wechat_qrcode')) {
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN package_pay_wechat_qrcode MEDIUMTEXT NULL COMMENT '微信收款码图片URL或Base64'`
          );
        }
        if (!columnNames.includes('package_pay_alipay_qrcode')) {
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN package_pay_alipay_qrcode MEDIUMTEXT NULL COMMENT '支付宝收款码图片URL或Base64'`
          );
        }
      } catch (colError) {
        console.warn('检查或添加 exam_papers 新字段失败:', colError);
      }
    } catch (error) {
      console.error('初始化表失败:', error);
      throw error;
    } finally {
      await connection.end();
    }
  }

  /**
   * 保存试卷（包括所有大题和小题）
   */
  static async saveExamPaper(data) {
    const {
      paperId: inputPaperId, // 若提供且试卷存在，则更新该试卷（保证考试关联的试卷能更新到 project_info 等）
      paperName,
      projectName,
      totalScore,
      examTime,
      pageSize,
      contentHtml,
      notes,
      previewHtml, // 完整的预览HTML（包括所有格式、样式、布局）
      majorQuestions = [], // 大题数组，每个大题包含小题数组
      examType = 'written', // 考试类型：written-笔试，interview-面试
      isEnabled = 0,
      visibleSide = 'enterprise',
      projectInfo = null // 考试项目设置：指导语、结束语、评分要素等
    } = data;

    // 首先确保表已创建
    await this.initializeTables();

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 处理HTML内容，提取图片和文本
      let processed;
      try {
        processed = processHtmlContent(contentHtml || '');
      } catch (error) {
        console.warn('处理HTML内容失败，使用默认值:', error);
        processed = {
          textContent: '',
          imagesBase64: []
        };
      }

      // 计算小题总数和大题总数
      const questionCount = (majorQuestions || []).reduce((sum, major) => 
        sum + (major.subQuestions ? major.subQuestions.length : 0), 0);
      const majorQuestionCount = (majorQuestions || []).length;
      
      // 验证数据
      if (majorQuestionCount === 0) {
        throw new Error('至少需要一个大题才能保存试卷');
      }

      // 再次确认表存在（使用当前连接）
      const [tableCheck] = await connection.execute(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = DATABASE() AND table_name = 'exam_papers'`
      );
      
      if (tableCheck[0].count === 0) {
        // 表不存在，需要创建（连接池不支持多语句，需要创建临时连接）
        console.log('检测到 exam_papers 表不存在，正在创建临时连接来创建表...');
        const mysql = require('mysql2/promise');
        const { getConnectionInfo, MAIN_DB_NAME } = require('../config/database');
        
        const info = getConnectionInfo();
        const tempConnection = await mysql.createConnection({
          ...info,
          database: MAIN_DB_NAME,
          multipleStatements: true
        });
        
        try {
          const sqlPath = path.join(__dirname, '../database/migrate_exam_papers_shared.sql');
          const sql = await fs.readFile(sqlPath, 'utf8');
          await tempConnection.query(sql);
          console.log('✓ exam_papers 表及相关表已成功创建');
        } finally {
          await tempConnection.end();
        }
      }

      // 检查表是否有preview_html字段，如果没有则自动添加
      let hasPreviewHtml = false;
      try {
        const [columns] = await connection.execute(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = 'exam_papers' 
           AND COLUMN_NAME = 'preview_html'`
        );
        hasPreviewHtml = columns.length > 0;
        
        // 如果字段不存在，自动添加
        if (!hasPreviewHtml) {
          console.log('检测到preview_html字段不存在，正在自动添加...');
          await connection.execute(
            `ALTER TABLE exam_papers 
             ADD COLUMN preview_html LONGTEXT COMMENT '完整的预览HTML内容（包括所有格式、样式、布局）'`
          );
          hasPreviewHtml = true;
          console.log('preview_html字段已成功添加');
        }
      } catch (error) {
        console.warn('检查或添加preview_html字段失败:', error);
        // 如果添加失败，继续执行但不包含该字段
      }

      // 检查表是否有 project_info 字段
      let hasProjectInfo = false;
      try {
        const [piCols] = await connection.execute(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_papers' AND COLUMN_NAME = 'project_info'`
        );
        hasProjectInfo = piCols.length > 0;
      } catch (e) {
        console.warn('检查 project_info 字段失败:', e);
      }

      // 1. 保存试卷基本信息
      const normalizedIsEnabled =
        isEnabled === 1 || isEnabled === '1' || isEnabled === true || isEnabled === 'true' ? 1 : 0;
      const normalizedVisibleSide =
        visibleSide === 'candidate' ? 'candidate' : 'enterprise';
      const normalizedExamType = (examType === 'interview' ? 'interview' : 'written');

      const projectInfoJson = projectInfo != null ? JSON.stringify(projectInfo) : null;

      // total_score 优先按小题分值求和重新计算，避免前端浮点误差（如 0.1+0.2=0.3000000004）
      const recomputedTotalScore = (() => {
        try {
          const majors = Array.isArray(majorQuestions) ? majorQuestions : [];
          let sum = 0;
          for (const m of majors) {
            const subs = m && Array.isArray(m.subQuestions) ? m.subQuestions : [];
            for (const sq of subs) sum += Number(sq && sq.score != null ? sq.score : 0) || 0;
          }
          if (sum > 0) return Math.round(sum * 100) / 100;
        } catch (e) {}
        const v = Number(totalScore) || 0;
        return Math.round(v * 100) / 100;
      })();

      let paperSql, paperParams;
      if (hasPreviewHtml && hasProjectInfo) {
        paperSql = `
          INSERT INTO exam_papers 
          (paper_name, project_name, total_score, exam_time, page_size, 
           content_html, content_text, images_base64, notes, question_count, major_question_count, preview_html, exam_type, is_enabled, visible_side, project_info)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        paperParams = [
          paperName || '未命名试卷',
          projectName || null,
          recomputedTotalScore,
          examTime || 0,
          pageSize || 'A4',
          contentHtml || null,
          processed.textContent || null,
          processed.imagesBase64 ? JSON.stringify(processed.imagesBase64) : null,
          notes || null,
          questionCount,
          majorQuestionCount,
          previewHtml || null,
          normalizedExamType,
          normalizedIsEnabled,
          normalizedVisibleSide,
          projectInfoJson
        ];
      } else if (hasPreviewHtml) {
        paperSql = `
          INSERT INTO exam_papers 
          (paper_name, project_name, total_score, exam_time, page_size, 
           content_html, content_text, images_base64, notes, question_count, major_question_count, preview_html, exam_type, is_enabled, visible_side)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        paperParams = [
          paperName || '未命名试卷',
          projectName || null,
          recomputedTotalScore,
          examTime || 0,
          pageSize || 'A4',
          contentHtml || null,
          processed.textContent || null,
          processed.imagesBase64 ? JSON.stringify(processed.imagesBase64) : null,
          notes || null,
          questionCount,
          majorQuestionCount,
          previewHtml || null,
          normalizedExamType,
          normalizedIsEnabled,
          normalizedVisibleSide
        ];
      } else {
        // 如果没有preview_html字段，不包含它
        paperSql = `
          INSERT INTO exam_papers 
          (paper_name, project_name, total_score, exam_time, page_size, 
           content_html, content_text, images_base64, notes, question_count, major_question_count, exam_type, is_enabled, visible_side)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        paperParams = [
          paperName || '未命名试卷',
          projectName || null,
          recomputedTotalScore,
          examTime || 0,
          pageSize || 'A4',
          contentHtml || null,
          processed.textContent || null,
          processed.imagesBase64 ? JSON.stringify(processed.imagesBase64) : null,
          notes || null,
          questionCount,
          majorQuestionCount,
          normalizedExamType,
          normalizedIsEnabled,
          normalizedVisibleSide
        ];
      }

      let paperId;
      const existingId = inputPaperId != null && Number.isFinite(Number(inputPaperId)) ? Number(inputPaperId) : null;
      if (existingId) {
        const [exRows] = await connection.execute('SELECT id FROM exam_papers WHERE id = ?', [existingId]);
        if (exRows.length > 0) {
          // 更新已有试卷：始终写入 project_info，确保指导语/结束语/测评要素能同步
          await connection.execute(
            `UPDATE exam_papers SET paper_name=?, project_name=?, total_score=?, exam_time=?, page_size=?,
             content_html=?, content_text=?, images_base64=?, notes=?, question_count=?, major_question_count=?,
             preview_html=?, exam_type=?, is_enabled=?, visible_side=?, project_info=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [
              paperName || '未命名试卷', projectName || null, recomputedTotalScore, examTime || 0, pageSize || 'A4',
              contentHtml || null, processed.textContent || null,
              processed.imagesBase64 ? JSON.stringify(processed.imagesBase64) : null,
              notes || null, questionCount, majorQuestionCount, previewHtml || null,
              normalizedExamType, normalizedIsEnabled, normalizedVisibleSide, projectInfoJson, existingId
            ]
          );
          await connection.execute(
            'DELETE FROM exam_paper_sub_questions WHERE major_question_id IN (SELECT id FROM exam_paper_major_questions WHERE paper_id = ?)',
            [existingId]
          );
          await connection.execute('DELETE FROM exam_paper_major_questions WHERE paper_id = ?', [existingId]);
          paperId = existingId;
        }
      }
      if (paperId === undefined) {
        const [paperResult] = await connection.execute(paperSql, paperParams);
        paperId = paperResult.insertId;
      }

      // 小题 score 若为 INT，1.15 等小数入库会被截成 1，客观阅卷满分/总分均错误；升级为 DECIMAL（幂等）
      try {
        const [scoreColRows] = await connection.execute(
          `SELECT DATA_TYPE FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_paper_sub_questions' AND COLUMN_NAME = 'score'`
        );
        const dt = scoreColRows[0] && String(scoreColRows[0].DATA_TYPE || '').toLowerCase();
        if (dt === 'int' || dt === 'tinyint' || dt === 'smallint' || dt === 'mediumint') {
          await connection.execute(
            `ALTER TABLE exam_paper_sub_questions MODIFY COLUMN score DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '分值'`
          );
          console.log('[ExamPaperModel] 已将 exam_paper_sub_questions.score 升级为 DECIMAL(10,2)');
        }
      } catch (e) {
        console.warn('[ExamPaperModel] 检查/升级 exam_paper_sub_questions.score 列失败:', e.message || e);
      }

      // 2. 保存大题和小题
      for (const majorQ of (majorQuestions || [])) {
        // 保存大题
        const majorSql = `
          INSERT INTO exam_paper_major_questions
          (paper_id, major_number, question_type, content_html, content_text,
           total_score, question_count, score_per_question, display_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const majorContentHtml = majorQ.contentHtml || majorQ.content || '';
        const tempDiv = { innerHTML: majorContentHtml };
        const majorContentText = majorContentHtml.replace(/<[^>]*>/g, '').trim();

        const [majorResult] = await connection.execute(majorSql, [
          paperId,
          majorQ.number || '',
          majorQ.type || '',
          majorContentHtml,
          majorContentText,
          majorQ.score || 0,
          majorQ.questionCount || (majorQ.subQuestions ? majorQ.subQuestions.length : 0),
          majorQ.scorePerQuestion || 0,
          majorQ.displayText || ''
        ]);

        const majorQuestionId = majorResult.insertId;

        // 保存该大题下的小题
        if (majorQ.subQuestions && majorQ.subQuestions.length > 0) {
          // 检查表是否有答案、解析、难易程度、题库引用、子小题答案和解析字段
          let hasAnswerFields = false;
          let hasDifficulty = false;
          let hasBankRef = false;
          let hasSubAnswers = false;
          let hasSubExplanations = false;
          try {
            const [columns] = await connection.execute(
              `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
               WHERE TABLE_SCHEMA = DATABASE() 
               AND TABLE_NAME = 'exam_paper_sub_questions' 
               AND COLUMN_NAME IN ('answer', 'answer_html', 'explanation', 'explanation_html', 'standard_answer', 'answer_analysis', 'difficulty', 'question_bank_id', 'sub_answers', 'sub_explanations')`
            );
            const columnNames = columns.map(col => col.COLUMN_NAME);
            hasBankRef = columnNames.includes('question_bank_id');
            hasAnswerFields = columnNames.includes('answer') || columnNames.includes('standard_answer');
            hasDifficulty = columnNames.includes('difficulty');
            hasSubAnswers = columnNames.includes('sub_answers');
            hasSubExplanations = columnNames.includes('sub_explanations');
            
            // 如果表缺少答案或解析字段，尝试添加
            if (!hasAnswerFields) {
              try {
                // 检查是否有standard_answer字段（旧字段名）
                if (columnNames.includes('standard_answer')) {
                  hasAnswerFields = true; // 使用旧字段名
                } else {
                  // 添加新字段
                  await connection.execute(`
                    ALTER TABLE exam_paper_sub_questions 
                    ADD COLUMN answer TEXT COMMENT '答案（纯文本）',
                    ADD COLUMN answer_html LONGTEXT COMMENT '答案HTML格式',
                    ADD COLUMN explanation TEXT COMMENT '解析（纯文本）',
                    ADD COLUMN explanation_html LONGTEXT COMMENT '解析HTML格式'
                  `);
                  hasAnswerFields = true;
                  console.log('✅ 已为 exam_paper_sub_questions 表添加答案和解析字段');
                }
              } catch (error) {
                console.warn('添加答案和解析字段失败:', error.message);
              }
            }
            
            if (!hasDifficulty) {
              try {
                await connection.execute(`
                  ALTER TABLE exam_paper_sub_questions 
                  ADD COLUMN difficulty VARCHAR(20) DEFAULT '中等' COMMENT '难度：简单、中等、困难'
                `);
                hasDifficulty = true;
                console.log('✅ 已为 exam_paper_sub_questions 表添加 difficulty 字段');
              } catch (error) {
                console.warn('添加 difficulty 字段失败:', error.message);
              }
            }
            if (!hasBankRef) {
              try {
                await connection.execute(`
                  ALTER TABLE exam_paper_sub_questions 
                  ADD COLUMN question_bank_id INT DEFAULT NULL COMMENT '题库题目ID',
                  ADD COLUMN question_bank_category VARCHAR(100) DEFAULT NULL COMMENT '题库分类',
                  ADD COLUMN question_bank_subject VARCHAR(100) DEFAULT NULL COMMENT '题库科目'
                `);
                hasBankRef = true;
                console.log('✅ 已为 exam_paper_sub_questions 表添加题库引用字段');
              } catch (error) {
                console.warn('添加题库引用字段失败:', error.message);
              }
            }
            if (!hasSubAnswers) {
              try {
                await connection.execute(`
                  ALTER TABLE exam_paper_sub_questions 
                  ADD COLUMN sub_answers LONGTEXT DEFAULT NULL COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]'
                `);
                hasSubAnswers = true;
                console.log('✅ 已为 exam_paper_sub_questions 表添加 sub_answers 字段');
              } catch (error) {
                console.warn('添加 sub_answers 字段失败:', error.message);
              }
            }
            if (!hasSubExplanations) {
              try {
                await connection.execute(`
                  ALTER TABLE exam_paper_sub_questions 
                  ADD COLUMN sub_explanations LONGTEXT DEFAULT NULL COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]'
                `);
                hasSubExplanations = true;
                console.log('✅ 已为 exam_paper_sub_questions 表添加 sub_explanations 字段');
              } catch (error) {
                console.warn('添加 sub_explanations 字段失败:', error.message);
              }
            }
          } catch (error) {
            console.warn('检查表字段失败:', error.message);
          }
          
          for (const subQ of majorQ.subQuestions) {
            let subSql, subParams;
            const bankId = subQ.questionBankId ?? subQ.bankId ?? null;
            const bankCat = subQ.questionBankCategory ?? subQ.bankCategory ?? null;
            const bankSub = subQ.questionBankSubject ?? subQ.bankSubject ?? null;
            
            // 获取子小题答案和解析
            const subAnswers = subQ.sub_answers || subQ.subAnswers || null;
            const subExplanations = subQ.sub_explanations || subQ.subExplanations || null;

            // 构建字段和参数列表
            const fields = ['paper_id', 'major_question_id', 'number', 'sub_number', 'content_html', 'content_text', 'score', 'full_content'];
            const values = ['?', '?', '?', '?', '?', '?', '?', '?'];
            const paramsList = [
              paperId, majorQuestionId, subQ.number || '', subQ.subNumber || null,
              subQ.fullContent || subQ.contentHtml || subQ.content || '',
              (subQ.fullContent || subQ.contentHtml || subQ.content || '').replace(/<[^>]*>/g, '').trim(),
              subQ.score || 0, subQ.fullContent || subQ.contentHtml || subQ.content || ''
            ];

            // 添加可选字段
            if (hasAnswerFields) {
              fields.push('answer', 'answer_html', 'explanation', 'explanation_html');
              values.push('?', '?', '?', '?');
              paramsList.push(
                subQ.answer || null,
                subQ.answerHtml || null,
                subQ.explanation || null,
                subQ.explanationHtml || null
              );
            }
            if (hasDifficulty) {
              fields.push('difficulty');
              values.push('?');
              paramsList.push(subQ.difficulty || '中等');
            }
            if (hasBankRef) {
              fields.push('question_bank_id', 'question_bank_category', 'question_bank_subject');
              values.push('?', '?', '?');
              paramsList.push(
                bankId ? parseInt(bankId, 10) : null,
                bankCat || null,
                bankSub || null
              );
            }
            if (hasSubAnswers) {
              fields.push('sub_answers');
              values.push('?');
              paramsList.push(subAnswers ? JSON.stringify(subAnswers) : null);
            }
            if (hasSubExplanations) {
              fields.push('sub_explanations');
              values.push('?');
              paramsList.push(subExplanations ? JSON.stringify(subExplanations) : null);
            }

            subSql = `INSERT INTO exam_paper_sub_questions (${fields.join(', ')}) VALUES (${values.join(', ')})`;
            await connection.execute(subSql, paramsList);
          }
        }
      }

      await connection.commit();
      connection.release();

      return {
        paperId: paperId,
        questionCount: questionCount,
        majorQuestionCount: majorQuestionCount
      };
    } catch (error) {
      await connection.rollback();
      connection.release();
      console.error('保存试卷失败，详细错误:', error);
      console.error('错误堆栈:', error.stack);
      throw error;
    }
  }

  /**
   * 根据ID获取试卷
   */
  static async getExamPaperById(id) {
    const sql = 'SELECT * FROM exam_papers WHERE id = ?';
    const [rows] = await pool.execute(sql, [id]);
    if (rows.length === 0) {
      return null;
    }
    const paper = rows[0];
    // 解析images_base64 JSON
    if (paper.images_base64) {
      try {
        paper.images_base64 = JSON.parse(paper.images_base64);
      } catch (e) {
        paper.images_base64 = [];
      }
    } else {
      paper.images_base64 = [];
    }
    // 解析 project_info JSON（考试项目设置）；兼容双重 JSON 字符串
    if (paper.project_info != null && typeof paper.project_info === 'string') {
      let cur = paper.project_info;
      for (let i = 0; i < 4 && typeof cur === 'string'; i++) {
        try {
          cur = JSON.parse(cur);
        } catch (e) {
          cur = null;
          break;
        }
      }
      paper.project_info = cur && typeof cur === 'object' ? cur : null;
    }
    return paper;
  }

  /**
   * 获取试卷的所有大题
   */
  static async getMajorQuestionsByPaperId(paperId) {
    const sql = 'SELECT * FROM exam_paper_major_questions WHERE paper_id = ? ORDER BY major_number';
    const [rows] = await pool.execute(sql, [paperId]);
    return rows;
  }

  /**
   * 获取大题的所有小题
   */
  static async getSubQuestionsByMajorQuestionId(majorQuestionId) {
    const sql = 'SELECT * FROM exam_paper_sub_questions WHERE major_question_id = ? ORDER BY number, sub_number';
    const [rows] = await pool.execute(sql, [majorQuestionId]);
    return rows;
  }

  /**
   * 获取试卷的完整信息（包括所有大题和小题）
   * 阶段二优化：单次 JOIN + 进程级缓存（考试期间试卷不变，30分钟过期）
   */
  static async getExamPaperComplete(id) {
    const cacheKey = `paper:${id}`;
    if (_paperCache.has(cacheKey)) {
      const cached = _paperCache.get(cacheKey);
      if (Date.now() - cached.ts < PAPER_CACHE_TTL) return cached.data;
      _paperCache.delete(cacheKey);
    }

    const paper = await this.getExamPaperById(id);
    if (!paper) return null;

    // 单次 JOIN 取代 N+1：11 次 DB 往返 → 1 次
    const [rows] = await pool.execute(
      `SELECT
        mq.id AS mq_id, mq.major_number, mq.question_type, mq.title, mq.description,
        mq.paper_id, mq.sort_order AS mq_sort,
        sq.id AS sq_id, sq.number, sq.sub_number, sq.content_html, sq.content_text,
        sq.score, sq.difficulty, sq.answer, sq.answer_html, sq.explanation,
        sq.explanation_html, sq.standard_answer, sq.options, sq.answer_type,
        sq.sort_order AS sq_sort, sq.sub_answers, sq.sub_explanations
       FROM exam_paper_major_questions mq
       LEFT JOIN exam_paper_sub_questions sq ON sq.major_question_id = mq.id
       WHERE mq.paper_id = ?
       ORDER BY mq.sort_order, sq.sort_order`,
      [id]
    );

    // JS 层组装嵌套结构
    const mqMap = new Map();
    for (const r of rows) {
      if (!mqMap.has(r.mq_id)) {
        mqMap.set(r.mq_id, {
          id: r.mq_id, major_number: r.major_number, question_type: r.question_type,
          title: r.title, description: r.description, paper_id: r.paper_id,
          sort_order: r.mq_sort, subQuestions: []
        });
      }
      if (r.sq_id) {
        mqMap.get(r.mq_id).subQuestions.push({
          id: r.sq_id, number: r.number, sub_number: r.sub_number,
          content_html: r.content_html, content_text: r.content_text,
          score: r.score, difficulty: r.difficulty, answer: r.answer,
          answer_html: r.answer_html, explanation: r.explanation,
          explanation_html: r.explanation_html, standard_answer: r.standard_answer,
          options: r.options, answer_type: r.answer_type, sort_order: r.sq_sort,
          sub_answers: r.sub_answers, sub_explanations: r.sub_explanations,
          major_question_id: r.mq_id
        });
      }
    }
    const result = { ...paper, majorQuestions: Array.from(mqMap.values()) };

    // 进程级缓存（30 分钟自动过期）
    _paperCache.set(cacheKey, { data: result, ts: Date.now() });

    return result;
  }

  // 试卷更新时清除缓存
  static invalidatePaperCache(paperId) {
    _paperCache.delete(`paper:${paperId}`);
  }

  /**
   * 获取试卷列表（支持筛选和分页）
   */
  static async getExamPapers(filters = {}) {
    // 检查表是否存在
    try {
      const [tables] = await pool.execute(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = DATABASE() AND table_name = 'exam_papers'`
      );
      if (tables[0].count === 0) {
        // 表不存在，返回空数组
        return [];
      }
    } catch (error) {
      console.warn('检查exam_papers表是否存在失败:', error);
      return [];
    }

    const params = [];
    const entIds = enterpriseIdsForPackageFilter(filters);
    const hasEnterprise = entIds.length > 0;
    const hasPackage = filters.packageId != null && String(filters.packageId).trim() !== '';
    let sql = 'SELECT exam_papers.* FROM exam_papers';
    let baseWhereAppended = false;
    if (hasEnterprise && hasPackage) {
      const pkgStr = String(filters.packageId).trim();
      const pkgNum = parseInt(pkgStr, 10);
      const paperKey = Number.isFinite(pkgNum) && pkgNum > 0 ? pkgNum : -1;
      const eph = entIds.map(() => '?').join(',');
      // 兼容：URL 的 package_id 有时是测评包编码、有时是试卷主键；入库侧可能为 paper_8 而链接带 8
      sql +=
        ` INNER JOIN enterprise_package_papers epp ON exam_papers.id = epp.paper_id AND epp.enterprise_id IN (${eph}) AND (epp.package_id = ? OR epp.paper_id = ? OR epp.package_id = CONCAT(\'paper_\', ?))`;
      params.push(...entIds, pkgStr, paperKey, pkgStr);
    } else if (hasEnterprise) {
      sql = 'SELECT DISTINCT exam_papers.* FROM exam_papers WHERE 1=1';
      sql += appendEnterprisePaperScopeSql(entIds, params);
      baseWhereAppended = true;
    }
    if (!baseWhereAppended) {
      sql += ' WHERE 1=1';
    }

    if (filters.paperName) {
      sql += ' AND paper_name LIKE ?';
      params.push(`%${filters.paperName}%`);
    }

    if (filters.projectName) {
      sql += ' AND project_name LIKE ?';
      params.push(`%${filters.projectName}%`);
    }

    if (filters.isEnabled !== undefined && filters.isEnabled !== null) {
      sql += ' AND is_enabled = ?';
      const enabledValue =
        filters.isEnabled === 1 ||
        filters.isEnabled === '1' ||
        filters.isEnabled === true ||
        filters.isEnabled === 'true'
          ? 1
          : 0;
      params.push(enabledValue);
    }

    if (filters.visibleSide) {
      const side =
        filters.visibleSide === 'candidate' ? 'candidate' : 'enterprise';
      sql += ' AND visible_side = ?';
      params.push(side);
    }

    // 排序（验证字段名，防止SQL注入；JOIN 时用表前缀避免歧义）
    const allowedOrderFields = ['created_at', 'updated_at', 'paper_name', 'project_name', 'total_score', 'exam_time', 'question_count'];
    const orderBy = allowedOrderFields.includes(filters.orderBy) ? filters.orderBy : 'created_at';
    const orderDir = (filters.orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const orderByQualified = hasEnterprise ? `exam_papers.${orderBy}` : orderBy;
    sql += ` ORDER BY ${orderByQualified} ${orderDir}`;

    // 分页（LIMIT和OFFSET不能使用占位符，需要直接拼接数值）
    if (filters.page && filters.pageSize) {
      const offset = (filters.page - 1) * filters.pageSize;
      const limitValue = parseInt(filters.pageSize) || 20;
      const offsetValue = parseInt(offset) || 0;
      sql += ` LIMIT ${limitValue} OFFSET ${offsetValue}`;
    }

    let rows;
    try {
      [rows] = await pool.execute(sql, params);
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' && err.message && err.message.includes('enterprise_package_papers') && hasEnterprise) {
        return [];
      }
      throw err;
    }

    // 处理返回数据
    const papers = rows.map(row => {
      if (row.images_base64) {
        try {
          row.images_base64 = JSON.parse(row.images_base64);
        } catch (e) {
          row.images_base64 = [];
        }
      } else {
        row.images_base64 = [];
      }
      return row;
    });
    
    return papers;
  }

  /**
   * 获取试卷总数（用于分页）
   */
  static async getExamPaperCount(filters = {}) {
    // 检查表是否存在
    try {
      const [tables] = await pool.execute(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = DATABASE() AND table_name = 'exam_papers'`
      );
      if (tables[0].count === 0) {
        // 表不存在，返回0
        return 0;
      }
    } catch (error) {
      console.warn('检查exam_papers表是否存在失败:', error);
      return 0;
    }

    const params = [];
    const entIds = enterpriseIdsForPackageFilter(filters);
    const hasEnterprise = entIds.length > 0;
    const hasPackage = filters.packageId != null && String(filters.packageId).trim() !== '';
    let sql = 'SELECT COUNT(*) as total FROM exam_papers';
    let baseWhereAppended = false;
    if (hasEnterprise && hasPackage) {
      const pkgStr = String(filters.packageId).trim();
      const pkgNum = parseInt(pkgStr, 10);
      const paperKey = Number.isFinite(pkgNum) && pkgNum > 0 ? pkgNum : -1;
      const eph = entIds.map(() => '?').join(',');
      sql +=
        ` INNER JOIN enterprise_package_papers epp ON exam_papers.id = epp.paper_id AND epp.enterprise_id IN (${eph}) AND (epp.package_id = ? OR epp.paper_id = ? OR epp.package_id = CONCAT(\'paper_\', ?))`;
      params.push(...entIds, pkgStr, paperKey, pkgStr);
      sql = sql.replace('COUNT(*)', 'COUNT(DISTINCT exam_papers.id)');
    } else if (hasEnterprise) {
      sql = 'SELECT COUNT(DISTINCT exam_papers.id) AS total FROM exam_papers WHERE 1=1';
      sql += appendEnterprisePaperScopeSql(entIds, params);
      baseWhereAppended = true;
    }
    if (!baseWhereAppended) {
      sql += ' WHERE 1=1';
    }

    if (filters.paperName) {
      sql += ' AND paper_name LIKE ?';
      params.push(`%${filters.paperName}%`);
    }

    if (filters.projectName) {
      sql += ' AND project_name LIKE ?';
      params.push(`%${filters.projectName}%`);
    }

    if (filters.isEnabled !== undefined && filters.isEnabled !== null) {
      sql += ' AND is_enabled = ?';
      const enabledValue =
        filters.isEnabled === 1 ||
        filters.isEnabled === '1' ||
        filters.isEnabled === true ||
        filters.isEnabled === 'true'
          ? 1
          : 0;
      params.push(enabledValue);
    }

    if (filters.visibleSide) {
      const side =
        filters.visibleSide === 'candidate' ? 'candidate' : 'enterprise';
      sql += ' AND visible_side = ?';
      params.push(side);
    }

    try {
      const [rows] = await pool.execute(sql, params);
      return rows[0] ? Number(rows[0].total) : 0;
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' && err.message && err.message.includes('enterprise_package_papers') && hasEnterprise) {
        return 0;
      }
      throw err;
    }
  }

  /**
   * 更新试卷信息
   */
  static async updateExamPaper(id, data) {
    const fields = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(data, 'previewHtml')) {
      fields.push('preview_html = ?');
      params.push(data.previewHtml || null);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'isEnabled')) {
      const enabledValue =
        data.isEnabled === 1 ||
        data.isEnabled === '1' ||
        data.isEnabled === true ||
        data.isEnabled === 'true'
          ? 1
          : 0;
      fields.push('is_enabled = ?');
      params.push(enabledValue);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'visibleSide')) {
      const side =
        data.visibleSide === 'candidate' ? 'candidate' : 'enterprise';
      fields.push('visible_side = ?');
      params.push(side);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'projectInfo')) {
      fields.push('project_info = ?');
      params.push(data.projectInfo != null ? JSON.stringify(data.projectInfo) : null);
    }

    const maxQrLen = 2 * 1024 * 1024;
    if (Object.prototype.hasOwnProperty.call(data, 'packagePaymentEnabled')) {
      const on =
        data.packagePaymentEnabled === 1 ||
        data.packagePaymentEnabled === '1' ||
        data.packagePaymentEnabled === true ||
        data.packagePaymentEnabled === 'true';
      fields.push('package_payment_enabled = ?');
      params.push(on ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'packagePriceYuan')) {
      const n = Number(data.packagePriceYuan);
      const y = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
      fields.push('package_price_yuan = ?');
      params.push(y);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'packagePayWechatQrcode')) {
      let s = data.packagePayWechatQrcode;
      if (s != null) {
        s = String(s);
        if (s.length > maxQrLen) s = s.slice(0, maxQrLen);
      }
      fields.push('package_pay_wechat_qrcode = ?');
      params.push(s != null && String(s).trim() !== '' ? s : null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'packagePayAlipayQrcode')) {
      let s = data.packagePayAlipayQrcode;
      if (s != null) {
        s = String(s);
        if (s.length > maxQrLen) s = s.slice(0, maxQrLen);
      }
      fields.push('package_pay_alipay_qrcode = ?');
      params.push(s != null && String(s).trim() !== '' ? s : null);
    }

    if (fields.length === 0) {
      return;
    }

    const sql = `UPDATE exam_papers SET ${fields.join(
      ', '
    )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    params.push(id);
    await pool.execute(sql, params);
  }

  /**
   * 删除试卷
   */
  static async deleteExamPaper(id) {
    // 由于外键约束，删除试卷会自动删除关联的大题和小题
    const sql = 'DELETE FROM exam_papers WHERE id = ?';
    await pool.execute(sql, [id]);
  }
}

module.exports = ExamPaperModel;






