class QuestionModel {
  // 保存大题内容
  static async saveQuestion(pool, data) {
    const {
      contentHtml,
      contentText,
      imagesBase64,
      projectName,
      totalScore,
      examTime,
      pageSize,
      notes
    } = data;

    const sql = `
      INSERT INTO questions 
      (content_html, content_text, images_base64, project_name, total_score, exam_time, page_size, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.execute(sql, [
      contentHtml,
      contentText,
      imagesBase64 ? JSON.stringify(imagesBase64) : null,
      projectName || null,
      totalScore || 0,
      examTime || 0,
      pageSize || 'A4',
      notes || null
    ]);

    return result.insertId;
  }

  // 根据ID获取大题
  static async getQuestionById(pool, id) {
    const sql = 'SELECT * FROM questions WHERE id = ?';
    const [rows] = await pool.execute(sql, [id]);
    if (rows.length === 0) {
      return null;
    }
    const question = rows[0];
    // 解析images_base64 JSON
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

  // 保存小题
  static async saveSubQuestion(pool, data) {
    const {
      questionId,
      number,
      subNumber,
      contentHtml,
      contentText,
      score,
      difficulty,
      type,
      fullContent,
      answer,
      answerHtml,
      explanation,
      explanationHtml,
      subAnswers,
      subExplanations
    } = data;

    // 检查表字段
    let hasDifficulty = false;
    let hasSubAnswers = false;
    let hasSubExplanations = false;
    try {
      const [columns] = await pool.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = 'sub_questions' 
         AND COLUMN_NAME IN ('difficulty', 'sub_answers', 'sub_explanations')`
      );
      hasDifficulty = columns.some(col => col.COLUMN_NAME === 'difficulty');
      hasSubAnswers = columns.some(col => col.COLUMN_NAME === 'sub_answers');
      hasSubExplanations = columns.some(col => col.COLUMN_NAME === 'sub_explanations');
    } catch (error) {
      console.warn('检查字段失败:', error);
    }

    // 构建字段和参数列表
    const fields = ['question_id', 'number', 'sub_number', 'content_html', 'content_text', 'score', 'type', 'full_content'];
    const values = ['?', '?', '?', '?', '?', '?', '?', '?'];
    const paramsList = [
      questionId,
      number,
      subNumber || null,
      contentHtml,
      contentText || null,
      score || 0,
      type || 'child',
      fullContent || null
    ];

    // 添加可选字段
    if (hasDifficulty) {
      fields.push('difficulty');
      values.push('?');
      paramsList.push(difficulty || '中等');
    }

    // 添加答案和解析字段
    fields.push('answer', 'answer_html', 'explanation', 'explanation_html');
    values.push('?', '?', '?', '?');
    paramsList.push(
      answer || null,
      answerHtml || null,
      explanation || null,
      explanationHtml || null
    );

    // 添加子小题答案和解析字段
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

    const sql = `INSERT INTO sub_questions (${fields.join(', ')}) VALUES (${values.join(', ')})`;
    const [result] = await pool.execute(sql, paramsList);

    return result.insertId;
  }

  // 删除大题的所有小题
  static async deleteSubQuestionsByQuestionId(pool, questionId) {
    const sql = 'DELETE FROM sub_questions WHERE question_id = ?';
    await pool.execute(sql, [questionId]);
  }

  // 获取大题的所有小题
  static async getSubQuestionsByQuestionId(pool, questionId) {
    const sql = 'SELECT * FROM sub_questions WHERE question_id = ? ORDER BY number, sub_number';
    const [rows] = await pool.execute(sql, [questionId]);
    // 解析JSON字段
    return rows.map(row => {
      if (row.sub_answers) {
        try {
          row.sub_answers = JSON.parse(row.sub_answers);
        } catch (e) {
          console.warn('解析 sub_answers 失败:', e);
          row.sub_answers = null;
        }
      }
      if (row.sub_explanations) {
        try {
          row.sub_explanations = JSON.parse(row.sub_explanations);
        } catch (e) {
          console.warn('解析 sub_explanations 失败:', e);
          row.sub_explanations = null;
        }
      }
      return row;
    });
  }

  // 更新大题内容
  static async updateQuestion(pool, id, data) {
    const {
      contentHtml,
      contentText,
      imagesBase64,
      projectName,
      totalScore,
      examTime,
      pageSize,
      notes
    } = data;

    const sql = `
      UPDATE questions 
      SET content_html = ?, content_text = ?, images_base64 = ?, 
          project_name = ?, total_score = ?, exam_time = ?, page_size = ?, notes = ?
      WHERE id = ?
    `;

    await pool.execute(sql, [
      contentHtml,
      contentText,
      imagesBase64 ? JSON.stringify(imagesBase64) : null,
      projectName || null,
      totalScore || 0,
      examTime || 0,
      pageSize || 'A4',
      notes || null,
      id
    ]);
  }

  // 更新小题内容
  static async updateSubQuestion(pool, id, data) {
    const {
      number,
      subNumber,
      contentHtml,
      contentText,
      score,
      fullContent,
      answer,
      answerHtml,
      explanation,
      explanationHtml,
      subAnswers,
      subExplanations
    } = data;

    // 检查表字段
    let hasSubAnswers = false;
    let hasSubExplanations = false;
    try {
      const [columns] = await pool.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = 'sub_questions' 
         AND COLUMN_NAME IN ('sub_answers', 'sub_explanations')`
      );
      hasSubAnswers = columns.some(col => col.COLUMN_NAME === 'sub_answers');
      hasSubExplanations = columns.some(col => col.COLUMN_NAME === 'sub_explanations');
    } catch (error) {
      console.warn('检查字段失败:', error);
    }

    // 构建更新SQL
    const updates = [
      'number = ?',
      'sub_number = ?',
      'content_html = ?',
      'content_text = ?',
      'score = ?',
      'full_content = ?',
      'answer = ?',
      'answer_html = ?',
      'explanation = ?',
      'explanation_html = ?'
    ];
    const params = [
      number || null,
      subNumber || null,
      contentHtml,
      contentText || null,
      score || 0,
      fullContent || null,
      answer || null,
      answerHtml || null,
      explanation || null,
      explanationHtml || null
    ];

    if (hasSubAnswers) {
      updates.push('sub_answers = ?');
      params.push(subAnswers ? JSON.stringify(subAnswers) : null);
    }
    if (hasSubExplanations) {
      updates.push('sub_explanations = ?');
      params.push(subExplanations ? JSON.stringify(subExplanations) : null);
    }

    params.push(id);
    const sql = `UPDATE sub_questions SET ${updates.join(', ')} WHERE id = ?`;
    await pool.execute(sql, params);
  }

  // 根据ID获取小题
  static async getSubQuestionById(pool, id) {
    const sql = 'SELECT * FROM sub_questions WHERE id = ?';
    const [rows] = await pool.execute(sql, [id]);
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    // 解析JSON字段
    if (row.sub_answers) {
      try {
        row.sub_answers = JSON.parse(row.sub_answers);
      } catch (e) {
        console.warn('解析 sub_answers 失败:', e);
        row.sub_answers = null;
      }
    }
    if (row.sub_explanations) {
      try {
        row.sub_explanations = JSON.parse(row.sub_explanations);
      } catch (e) {
        console.warn('解析 sub_explanations 失败:', e);
        row.sub_explanations = null;
      }
    }
    return row;
  }
}

module.exports = QuestionModel;

