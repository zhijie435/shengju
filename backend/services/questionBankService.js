const { pool } = require('../config/database');

class QuestionBankService {
  // 贡献题目到共享题库（状态为pending）
  static async contributeQuestion(userId, questionData) {
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
    } = questionData;

    // 处理HTML内容，提取图片和文本
    const { processHtmlContent } = require('../utils/imageProcessor');
    const processed = processHtmlContent(contentHtml);
    const finalContentText = contentText || processed.textContent;
    const finalImagesBase64 = imagesBase64 || processed.imagesBase64;

    const sql = `
      INSERT INTO question_bank 
      (number, sub_number, content_html, content_text, score, category, subject, 
       tags, difficulty, images_base64, full_content, notes, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const [result] = await pool.execute(sql, [
      number || '',
      subNumber || null,
      contentHtml,
      finalContentText || null,
      score || 0,
      category || '未分类',
      subject || '未分类',
      tags || null,
      difficulty || '中等',
      finalImagesBase64 ? JSON.stringify(finalImagesBase64) : null,
      fullContent || null,
      notes || null,
      userId
    ]);

    const questionId = result.insertId;

    // 创建审核记录
    await pool.execute(
      'INSERT INTO question_bank_reviews (question_id, contributor_id, status) VALUES (?, ?, "pending")',
      [questionId, userId]
    );

    return questionId;
  }

  // 审核题目（管理员）
  static async reviewQuestion(questionId, reviewerId, status, comment = null) {
    // 更新题目状态
    await pool.execute(
      'UPDATE question_bank SET status = ? WHERE id = ?',
      [status, questionId]
    );

    // 更新审核记录
    await pool.execute(
      `UPDATE question_bank_reviews 
       SET reviewer_id = ?, status = ?, comment = ?, reviewed_at = NOW() 
       WHERE question_id = ?`,
      [reviewerId, status, comment, questionId]
    );
  }

  // 获取待审核的题目列表
  static async getPendingQuestions() {
    const sql = `
      SELECT qb.*, u.username as contributor_name, u.real_name as contributor_real_name
      FROM question_bank qb
      LEFT JOIN users u ON qb.created_by = u.id
      WHERE qb.status = 'pending'
      ORDER BY qb.created_at DESC
    `;
    const [rows] = await pool.execute(sql);
    
    // 解析images_base64
    return rows.map(row => {
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
  }

  // 获取已审核的共享题库（所有用户可查看）
  static async getApprovedQuestions(filters = {}) {
    const { category, subject, difficulty, keyword, page = 1, pageSize = 20 } = filters;
    
    let sql = `
      SELECT qb.*, u.username as contributor_name, u.real_name as contributor_real_name
      FROM question_bank qb
      LEFT JOIN users u ON qb.created_by = u.id
      WHERE qb.status = 'approved'
    `;
    const params = [];

    if (category) {
      sql += ' AND qb.category = ?';
      params.push(category);
    }
    if (subject) {
      sql += ' AND qb.subject = ?';
      params.push(subject);
    }
    if (difficulty) {
      sql += ' AND qb.difficulty = ?';
      params.push(difficulty);
    }
    if (keyword) {
      sql += ' AND (qb.content_text LIKE ? OR qb.number LIKE ?)';
      const keywordParam = `%${keyword}%`;
      params.push(keywordParam, keywordParam);
    }

    sql += ' ORDER BY qb.created_at DESC';

    // 分页（LIMIT/OFFSET 不能用 ? 占位符，需拼接）
    const limit = Math.max(1, parseInt(pageSize, 10) || 20);
    const offset = Math.max(0, (Math.max(1, parseInt(page, 10) || 1) - 1) * limit);
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const [rows] = await pool.execute(sql, params);

    // 获取总数
    let countSql = 'SELECT COUNT(*) as total FROM question_bank WHERE status = "approved"';
    const countParams = [];
    if (category) {
      countSql += ' AND category = ?';
      countParams.push(category);
    }
    if (subject) {
      countSql += ' AND subject = ?';
      countParams.push(subject);
    }
    if (difficulty) {
      countSql += ' AND difficulty = ?';
      countParams.push(difficulty);
    }
    if (keyword) {
      countSql += ' AND (content_text LIKE ? OR number LIKE ?)';
      const keywordParam = `%${keyword}%`;
      countParams.push(keywordParam, keywordParam);
    }
    const [countRows] = await pool.execute(countSql, countParams);
    const total = countRows[0].total;

    // 解析images_base64
    const questions = rows.map(row => {
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

    return {
      questions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  // 获取题目详情
  static async getQuestionById(id) {
    const sql = `
      SELECT qb.*, u.username as contributor_name, u.real_name as contributor_real_name
      FROM question_bank qb
      LEFT JOIN users u ON qb.created_by = u.id
      WHERE qb.id = ?
    `;
    const [rows] = await pool.execute(sql, [id]);
    
    if (rows.length === 0) {
      return null;
    }

    const question = rows[0];
    if (question.images_base64) {
      try {
        question.images_base64 = JSON.parse(question.images_base64);
      } catch (e) {
        question.images_base64 = [];
      }
    } else {
      question.images_base64 = [];
    }

    return question;
  }

  // 获取审核记录
  static async getReviewHistory(questionId) {
    const sql = `
      SELECT r.*, 
             c.username as contributor_name, 
             c.real_name as contributor_real_name,
             rev.username as reviewer_name,
             rev.real_name as reviewer_real_name
      FROM question_bank_reviews r
      LEFT JOIN users c ON r.contributor_id = c.id
      LEFT JOIN users rev ON r.reviewer_id = rev.id
      WHERE r.question_id = ?
      ORDER BY r.created_at DESC
    `;
    const [rows] = await pool.execute(sql, [questionId]);
    return rows;
  }

  // 获取分类列表（仅已审核的）
  static async getCategories() {
    const sql = `
      SELECT DISTINCT category, COUNT(*) as count
      FROM question_bank
      WHERE status = 'approved'
      GROUP BY category
      ORDER BY count DESC
    `;
    const [rows] = await pool.execute(sql);
    return rows;
  }

  // 获取科目列表（仅已审核的）
  static async getSubjects(category = null) {
    let sql = `
      SELECT DISTINCT subject, COUNT(*) as count
      FROM question_bank
      WHERE status = 'approved'
    `;
    const params = [];
    
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    
    sql += ' GROUP BY subject ORDER BY count DESC';
    const [rows] = await pool.execute(sql, params);
    return rows;
  }
}

module.exports = QuestionBankService;
