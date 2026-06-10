const { pool } = require('../config/database');
const QuestionBankTableManager = require('./questionBankTableManager');

/**
 * 题库模型 - 支持动态表（每个类别+科目一个表）
 */
class QuestionBankModel {
  /**
   * 动态题库按「分类+科目」分表，各表 AUTO_INCREMENT 独立；跨表合并时仅用 id 去重会误删不同表中的同号记录。
   */
  static _questionBankRowDedupeKey(row) {
    const c = String(row.category != null ? row.category : '').trim();
    const s = String(row.subject != null ? row.subject : '').trim();
    const id = row.id != null ? String(row.id) : '';
    return `${c}\u001f${s}\u001f${id}`;
  }

  /**
   * 获取表名（根据类别和科目）
   * @param {string} category - 类别
   * @param {string} subject - 科目
   * @param {object} [poolOpt] - 可选数据库连接池（不传则使用主库）
   * @returns {Promise<string>} 表名
   */
  static async getTable(category, subject, poolOpt) {
    return await QuestionBankTableManager.getTable(category || '未分类', subject || '未分类', poolOpt);
  }

  /**
   * 根据类别+科目解析实际应查询的表名（兼容旧表名：优先使用已存在的、存有该分类+科目的表）
   * @param {string} category - 类别
   * @param {string} subject - 科目
   * @param {object} [db] - 可选数据库连接池
   * @returns {Promise<string>} 表名
   */
  static async resolveTableNameForQuery(category, subject, db) {
    const conn = db || pool;
    const cat = (category || '未分类').trim();
    const sub = (subject || '未分类').trim();
    const tables = await QuestionBankTableManager.getAllTables(conn);
    const matched = tables.find(t => (t.category || '').trim() === cat && (t.subject || '').trim() === sub);
    if (matched) {
      return matched.table_name;
    }
    return await this.getTable(category, subject, conn);
  }

  /**
   * 保存小题到题库
   */
  static async saveQuestion(data) {
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
      notes,
      answer,
      answerHtml,
      explanation,
      explanationHtml,
      subAnswers,
      subExplanations
    } = data;

    // 获取或创建表
    const tableName = await this.getTable(category, subject);

    // 检查表字段（兼容旧表）
    let hasGrade = false;
    let hasQuestionType = false;
    let hasExamPurpose = false;
    let hasAnswer = false;
    let hasAnswerHtml = false;
    let hasExplanation = false;
    let hasExplanationHtml = false;
    let hasSubAnswers = false;
    let hasSubExplanations = false;
    try {
      const [columns] = await pool.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME IN ('grade', 'question_type', 'exam_purpose', 'answer', 'answer_html', 'explanation', 'explanation_html', 'sub_answers', 'sub_explanations')`,
        [tableName]
      );
      hasGrade = columns.some(col => col.COLUMN_NAME === 'grade');
      hasQuestionType = columns.some(col => col.COLUMN_NAME === 'question_type');
      hasExamPurpose = columns.some(col => col.COLUMN_NAME === 'exam_purpose');
      hasAnswer = columns.some(col => col.COLUMN_NAME === 'answer');
      hasAnswerHtml = columns.some(col => col.COLUMN_NAME === 'answer_html');
      hasExplanation = columns.some(col => col.COLUMN_NAME === 'explanation');
      hasExplanationHtml = columns.some(col => col.COLUMN_NAME === 'explanation_html');
      hasSubAnswers = columns.some(col => col.COLUMN_NAME === 'sub_answers');
      hasSubExplanations = columns.some(col => col.COLUMN_NAME === 'sub_explanations');
      
      // 如果表缺少答案或解析字段，尝试添加
      if (!hasAnswer) {
        try {
          await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN answer TEXT COMMENT '答案'`);
          hasAnswer = true;
          console.log(`✅ 已为表 ${tableName} 添加 answer 字段`);
        } catch (error) {
          console.warn(`添加 answer 字段失败:`, error.message);
        }
      }
      if (!hasAnswerHtml) {
        try {
          await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN answer_html LONGTEXT COMMENT '答案HTML格式'`);
          hasAnswerHtml = true;
          console.log(`✅ 已为表 ${tableName} 添加 answer_html 字段`);
        } catch (error) {
          console.warn(`添加 answer_html 字段失败:`, error.message);
        }
      }
      if (!hasExplanation) {
        try {
          await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN explanation TEXT COMMENT '解析'`);
          hasExplanation = true;
          console.log(`✅ 已为表 ${tableName} 添加 explanation 字段`);
        } catch (error) {
          console.warn(`添加 explanation 字段失败:`, error.message);
        }
      }
      if (!hasExplanationHtml) {
        try {
          await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN explanation_html LONGTEXT COMMENT '解析HTML格式'`);
          hasExplanationHtml = true;
          console.log(`✅ 已为表 ${tableName} 添加 explanation_html 字段`);
        } catch (error) {
          console.warn(`添加 explanation_html 字段失败:`, error.message);
        }
      }
      if (!hasSubAnswers) {
        try {
          await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN sub_answers LONGTEXT COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]'`);
          hasSubAnswers = true;
          console.log(`✅ 已为表 ${tableName} 添加 sub_answers 字段`);
        } catch (error) {
          console.warn(`添加 sub_answers 字段失败:`, error.message);
        }
      }
      if (!hasSubExplanations) {
        try {
          await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN sub_explanations LONGTEXT COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]'`);
          hasSubExplanations = true;
          console.log(`✅ 已为表 ${tableName} 添加 sub_explanations 字段`);
        } catch (error) {
          console.warn(`添加 sub_explanations 字段失败:`, error.message);
        }
      }
    } catch (error) {
      console.warn('检查表字段失败:', error);
    }

    // 构建SQL（根据字段是否存在）
    let sql, params;
    // 优先使用包含答案和解析的完整结构
    if (hasAnswer && hasExplanation) {
      // 完整字段结构（包含答案和解析）
      const fields = ['number', 'sub_number', 'content_html', 'content_text', 'score', 'category', 'subject', 'difficulty', 'images_base64', 'full_content', 'answer', 'answer_html', 'explanation', 'explanation_html', 'notes'];
      const values = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?'];
      const paramsList = [
        number || '',
        subNumber || null,
        contentHtml,
        contentText || null,
        score || 0,
        category || '未分类',
        subject || '未分类',
        difficulty || '中等',
        imagesBase64 ? JSON.stringify(imagesBase64) : null,
        fullContent || null,
        answer || null,
        answerHtml || null,
        explanation || null,
        explanationHtml || null,
        notes || null
      ];
      
      // 添加可选字段
      if (hasGrade) {
        fields.push('grade');
        values.push('?');
        paramsList.push(grade || null);
      }
      if (hasQuestionType) {
        fields.push('question_type');
        values.push('?');
        paramsList.push(questionType || null);
      }
      if (hasExamPurpose) {
        fields.push('exam_purpose');
        values.push('?');
        paramsList.push(examPurpose || null);
      }
      if (hasGrade || hasQuestionType) {
        fields.push('tags');
        values.push('?');
        paramsList.push(tags || null);
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
      
      sql = `INSERT INTO \`${tableName}\` (${fields.map(f => `\`${f}\``).join(', ')}) VALUES (${values.join(', ')})`;
      params = paramsList;
    } else {
      // 如果表缺少答案和解析字段，但我们已经尝试添加了，再次检查
      // 如果仍然没有，使用不包含答案和解析的SQL（但这种情况应该很少见）
      const fields = ['number', 'sub_number', 'content_html', 'content_text', 'score', 'category', 'subject', 'difficulty', 'images_base64', 'full_content', 'notes'];
      const values = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?'];
      const paramsList = [
        number || '',
        subNumber || null,
        contentHtml,
        contentText || null,
        score || 0,
        category || '未分类',
        subject || '未分类',
        difficulty || '中等',
        imagesBase64 ? JSON.stringify(imagesBase64) : null,
        fullContent || null,
        notes || null
      ];
      
      // 添加可选字段（如果存在）
      if (hasGrade) {
        fields.push('grade');
        values.push('?');
        paramsList.push(grade || null);
      }
      if (hasQuestionType) {
        fields.push('question_type');
        values.push('?');
        paramsList.push(questionType || null);
      }
      if (hasExamPurpose) {
        fields.push('exam_purpose');
        values.push('?');
        paramsList.push(examPurpose || null);
      }
      if (hasGrade || hasQuestionType || !hasQuestionType) {
        fields.push('tags');
        values.push('?');
        paramsList.push(tags || questionType || null);
      }
      
      // 如果答案和解析字段存在，添加它们
      if (hasAnswer) {
        fields.push('answer');
        values.push('?');
        paramsList.push(answer || null);
      }
      if (hasAnswerHtml) {
        fields.push('answer_html');
        values.push('?');
        paramsList.push(answerHtml || null);
      }
      if (hasExplanation) {
        fields.push('explanation');
        values.push('?');
        paramsList.push(explanation || null);
      }
      if (hasExplanationHtml) {
        fields.push('explanation_html');
        values.push('?');
        paramsList.push(explanationHtml || null);
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
      
      sql = `INSERT INTO \`${tableName}\` (${fields.map(f => `\`${f}\``).join(', ')}) VALUES (${values.join(', ')})`;
      params = paramsList;
    }

    const [result] = await pool.execute(sql, params);
    
    // 调试信息：输出保存的数据
    console.log(`💾 保存题目到表 ${tableName}: ID=${result.insertId}, category=${category}, subject=${subject}`);
    console.log(`   内容预览: ${(contentText || '').substring(0, 50)}...`);
    console.log(`   答案: ${answer ? (answer.substring(0, 30) + '...') : '无'}`);
    console.log(`   解析: ${explanation ? (explanation.substring(0, 30) + '...') : '无'}`);
    console.log(`   难易程度: ${difficulty || '中等'}`);
    console.log(`   子小题答案: ${subAnswers ? (Array.isArray(subAnswers) ? `数组(${subAnswers.length}项)` : JSON.stringify(subAnswers).substring(0, 50) + '...') : '无'}`);
    console.log(`   子小题解析: ${subExplanations ? (Array.isArray(subExplanations) ? `数组(${subExplanations.length}项)` : JSON.stringify(subExplanations).substring(0, 50) + '...') : '无'}`);
    console.log(`   使用的SQL字段: ${sql.match(/INSERT INTO[^(]+\(([^)]+)\)/)?.[1] || '未知'}`);
    console.log(`   是否包含sub_answers字段: ${sql.includes('sub_answers')}`);
    console.log(`   是否包含sub_explanations字段: ${sql.includes('sub_explanations')}`);

    return result.insertId;
  }

  /**
   * 获取题库列表（支持跨表查询，支持按用户库筛选所有题目）
   * @param {object} filters - 筛选条件（分类、科目、年级、难度等）
   * @param {object} [poolOpt] - 可选数据库连接池（传则查该库下所有题目并应用筛选）
   */
  static async getQuestions(filters = {}, poolOpt) {
    const { category, subject } = filters;
    const db = poolOpt || pool;
    
    console.log(`🔍 getQuestions 被调用，category=${category}, subject=${subject}, usePool=${!!poolOpt}`);
    
    // 如果指定了类别和科目（且不是"全部"），先查对应表；若无结果则跨表按 category+subject 再查（保证科目筛选生效）
    if (category && category !== '全部' && category.trim() !== '' && 
        subject && subject !== '全部' && subject.trim() !== '') {
      console.log(`📊 查询指定表: category=${category}, subject=${subject}`);
      const singleResult = await this.getQuestionsFromTable(category, subject, filters, db);
      if (singleResult.length > 0) return singleResult;
      console.log(`📊 指定表无结果，回退跨表按 category+subject 筛选`);
      return await this.getQuestionsFromAllTables(filters, db);
    }
    
    // 否则查询所有表（应用其他筛选条件）
    console.log(`📊 跨表查询，应用筛选条件:`, JSON.stringify(filters, null, 2));
    return await this.getQuestionsFromAllTables(filters, db);
  }

  /**
   * 从指定表获取题目
   * @param {object} [db] - 可选数据库连接池（不传则使用主库）
   */
  static async getQuestionsFromTable(category, subject, filters = {}, db) {
    const conn = db || pool;
    const tableName = await this.resolveTableNameForQuery(category, subject, conn);
    let sql = `SELECT * FROM \`${tableName}\` WHERE 1=1`;
    const params = [];
    
    const cat = (category || '未分类').trim();
    const sub = (subject || '未分类').trim();
    // 用 TRIM 比较，避免库中前后空格导致筛选不到
    sql += ' AND TRIM(COALESCE(category,\'\')) = ? AND TRIM(COALESCE(subject,\'\')) = ?';
    params.push(cat, sub);
    
    console.log(`🔍 查询表 ${tableName}, category=${cat}, subject=${sub}`);

    // 难度筛选
    if (filters.difficulty && filters.difficulty !== '全部') {
      sql += ' AND difficulty = ?';
      params.push(filters.difficulty);
    }

    // 题型筛选
    if (filters.questionType && filters.questionType !== '全部') {
      sql += ' AND question_type = ?';
      params.push(filters.questionType);
    }

    // 考察目的筛选
    if (filters.examPurpose && filters.examPurpose.trim() !== '') {
      sql += ' AND exam_purpose LIKE ?';
      params.push(`%${filters.examPurpose}%`);
    }

    // 年级筛选（「全部」「所有」均表示不筛选）
    if (filters.grade && filters.grade !== '全部' && filters.grade !== '所有') {
      sql += ' AND grade = ?';
      params.push(filters.grade);
    }

    // 使用次数筛选
    if (filters.useCountMin !== undefined && filters.useCountMin !== null) {
      sql += ' AND use_count >= ?';
      params.push(filters.useCountMin);
    }
    if (filters.useCountMax !== undefined && filters.useCountMax !== null) {
      sql += ' AND use_count <= ?';
      params.push(filters.useCountMax);
    }

    // 关键词搜索
    if (filters.keyword) {
      sql += ' AND (content_text LIKE ? OR number LIKE ?)';
      const keyword = `%${filters.keyword}%`;
      params.push(keyword, keyword);
    }

    // 排序
    const allowedOrderFields = ['created_at', 'updated_at', 'number', 'score', 'difficulty', 'use_count'];
    const orderBy = allowedOrderFields.includes(filters.orderBy) ? filters.orderBy : 'created_at';
    const orderDir = (filters.orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDir}`;

    // 分页
    if (filters.page && filters.pageSize) {
      const offset = (filters.page - 1) * filters.pageSize;
      const limitValue = parseInt(filters.pageSize) || 20;
      const offsetValue = parseInt(offset) || 0;
      sql += ` LIMIT ${limitValue} OFFSET ${offsetValue}`;
    }

    try {
      const [rows] = await conn.execute(sql, params);
      const parsedRows = this.parseRows(rows);
      
      // 去重：基于ID和content_text去重（防止重复显示）
      const uniqueQuestions = [];
      const seenIds = new Set(); // 单表内 id 唯一；仍用分类+科目+id 与跨表逻辑一致
      const seenContentText = new Set(); // 基于内容去重（第二优先级）
      const seenContentHtml = new Set(); // 基于HTML内容去重（第三优先级）
      
      for (const question of parsedRows) {
        const rowKey = QuestionBankModel._questionBankRowDedupeKey(question);
        if (seenIds.has(rowKey)) {
          console.warn(`⚠️ [去重] 发现重复行的题目，已跳过: ${rowKey}`);
          continue;
        }
        
        const contentText = (question.content_text || '').trim();
        const contentHtml = (question.content_html || '').trim();
        
        // 第二优先级：如果内容文本不为空且长度足够，使用内容文本去重
        if (contentText && contentText.length >= 10) {
          // 使用内容文本的前500字符作为唯一标识（增加长度以提高准确性）
          const contentKey = contentText.substring(0, 500);
          if (seenContentText.has(contentKey)) {
            console.warn(`⚠️ [去重] 发现重复内容的题目，已跳过: ID=${question.id}, content=${contentKey.substring(0, 50)}...`);
            continue;
          }
          seenContentText.add(contentKey);
        }
        
        // 第三优先级：如果内容文本为空或太短，使用HTML内容去重
        if ((!contentText || contentText.length < 10) && contentHtml && contentHtml.length > 20) {
          const htmlKey = contentHtml.substring(0, 500);
          if (seenContentHtml.has(htmlKey)) {
            console.warn(`⚠️ [去重] 发现重复HTML内容的题目，已跳过: ID=${question.id}`);
            continue;
          }
          seenContentHtml.add(htmlKey);
        }
        
        seenIds.add(rowKey);
        uniqueQuestions.push(question);
      }
      
      if (parsedRows.length !== uniqueQuestions.length) {
        console.log(`✅ [去重] 查询结果: 原始${parsedRows.length}条，去重后${uniqueQuestions.length}条（去除了${parsedRows.length - uniqueQuestions.length}条重复）`);
      }
      
      return uniqueQuestions;
    } catch (error) {
      console.error('getQuestionsFromTable SQL错误:', error.message);
      throw error;
    }
  }

  /**
   * 从所有表获取题目（跨表查询，支持按条件筛选所有题目）
   * @param {object} [db] - 可选数据库连接池（不传则使用主库）
   */
  static async getQuestionsFromAllTables(filters = {}, db) {
    const conn = db || pool;
    console.log(`🔍 getQuestionsFromAllTables 被调用，筛选条件:`, JSON.stringify(filters, null, 2));
    
    // 获取所有表（使用同一连接池，实现按用户库筛选）
    let tables = await QuestionBankTableManager.getAllTables(conn);
    
    // 过滤掉审核表和管理表（双重保险）
    tables = tables.filter(table => {
      const tableName = table.table_name;
      return tableName !== 'question_bank_reviews' && 
             tableName !== 'question_bank_tables' &&
             !tableName.startsWith('question_bank_reviews') &&
             !tableName.endsWith('_reviews');
    });
    
    console.log(`📊 找到 ${tables.length} 个表需要查询`);
    
    if (tables.length === 0) {
      console.log('⚠️ 没有找到任何表');
      return [];
    }

    // 获取各表列集合 + 交集（用于 WHERE 条件）；UNION 的 SELECT 列使用「交集 + 任一张表存在的扩展列」，
    // 避免某张旧表缺少 sub_answers 等字段时，交集把整列删掉，导致列表接口永远不返回答案/子题结构。
    let commonColumns = null;
    let columnSets = [];
    try {
      columnSets = [];
      for (const table of tables) {
        const [columns] = await conn.execute(
          `SELECT COLUMN_NAME 
           FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [table.table_name]
        );
        const columnNames = columns.map(c => c.COLUMN_NAME);
        columnSets.push(new Set(columnNames));
      }

      if (columnSets.length > 0) {
        commonColumns = Array.from(columnSets[0]);
        for (let i = 1; i < columnSets.length; i++) {
          commonColumns = commonColumns.filter(col => columnSets[i].has(col));
        }
      }
    } catch (error) {
      console.warn('获取表列信息失败，使用备用方法:', error.message);
      return await this.getQuestionsFromAllTablesFallback(filters, conn);
    }

    if (!commonColumns || commonColumns.length === 0) {
      console.warn('未找到共同列，使用备用方法');
      return await this.getQuestionsFromAllTablesFallback(filters, conn);
    }

    // 确保必要的列存在（如果不存在，使用备用方法）
    const requiredColumns = ['id', 'content_html', 'content_text', 'created_at'];
    const hasRequiredColumns = requiredColumns.every(col => commonColumns.includes(col));
    if (!hasRequiredColumns) {
      console.warn('缺少必要列，使用备用方法');
      return await this.getQuestionsFromAllTablesFallback(filters, conn);
    }

    const WANT_EXTRA_UNION_COLUMNS = [
      'sub_answers', 'sub_explanations', 'answer', 'answer_html',
      'explanation', 'explanation_html', 'full_content', 'images_base64',
      'sub_number', 'notes', 'use_count', 'last_used_at',
      'question_type', 'exam_purpose', 'grade', 'tags',
      'number', 'score', 'difficulty', 'category', 'subject'
    ];
    const unionSelectColumns = [...commonColumns];
    for (const c of WANT_EXTRA_UNION_COLUMNS) {
      if (!unionSelectColumns.includes(c) && columnSets.some(s => s.has(c))) {
        unionSelectColumns.push(c);
      }
    }

    // 构建UNION查询
    const unionQueries = [];
    const allParams = [];

    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      const set = columnSets[ti];
      const parts = unionSelectColumns.map((col) =>
        set.has(col) ? `\`${col}\`` : `NULL AS \`${col}\``
      );
      const columnsStr = parts.join(', ');
      // 使用明确的列列表而不是 SELECT *
      let tableSql = `SELECT ${columnsStr} FROM \`${table.table_name}\` WHERE 1=1`;
      const tableParams = [];

      // 类别、科目筛选（用 TRIM 比较，与单表一致）
      if (filters.category && filters.category !== '全部' && commonColumns.includes('category')) {
        tableSql += ' AND TRIM(COALESCE(category,\'\')) = ?';
        tableParams.push((filters.category || '').trim());
      }
      if (filters.subject && filters.subject !== '全部' && commonColumns.includes('subject')) {
        tableSql += ' AND TRIM(COALESCE(subject,\'\')) = ?';
        tableParams.push((filters.subject || '').trim());
      }

      // 难度筛选（检查列是否存在）
      if (filters.difficulty && filters.difficulty !== '全部' && commonColumns.includes('difficulty')) {
        tableSql += ' AND difficulty = ?';
        tableParams.push(filters.difficulty);
      }

      // 题型筛选（检查列是否存在）
      if (filters.questionType && filters.questionType !== '全部' && commonColumns.includes('question_type')) {
        tableSql += ' AND question_type = ?';
        tableParams.push(filters.questionType);
      }

      // 考察目的筛选（检查列是否存在）
      if (filters.examPurpose && filters.examPurpose.trim() !== '' && commonColumns.includes('exam_purpose')) {
        tableSql += ' AND exam_purpose LIKE ?';
        tableParams.push(`%${filters.examPurpose}%`);
      }

      // 年级筛选（检查列是否存在）
      if (filters.grade && filters.grade !== '全部' && filters.grade !== '所有' && commonColumns.includes('grade')) {
        tableSql += ' AND grade = ?';
        tableParams.push(filters.grade);
      }

      // 使用次数筛选（检查列是否存在）
      if (commonColumns.includes('use_count')) {
        if (filters.useCountMin !== undefined && filters.useCountMin !== null) {
          tableSql += ' AND use_count >= ?';
          tableParams.push(filters.useCountMin);
        }
        if (filters.useCountMax !== undefined && filters.useCountMax !== null) {
          tableSql += ' AND use_count <= ?';
          tableParams.push(filters.useCountMax);
        }
      }

      // 关键词搜索（检查列是否存在）
      if (filters.keyword) {
        const keywordConditions = [];
        if (commonColumns.includes('content_text')) {
          keywordConditions.push('content_text LIKE ?');
          tableParams.push(`%${filters.keyword}%`);
        }
        if (commonColumns.includes('number')) {
          keywordConditions.push('number LIKE ?');
          tableParams.push(`%${filters.keyword}%`);
        }
        if (keywordConditions.length > 0) {
          tableSql += ` AND (${keywordConditions.join(' OR ')})`;
        }
      }

      unionQueries.push(`(${tableSql})`);
      allParams.push(...tableParams);
    }

    // 合并查询
    let sql = unionQueries.join(' UNION ALL ');
    
    // 排序（检查排序列是否存在）
    const allowedOrderFields = ['created_at', 'updated_at', 'number', 'score', 'difficulty', 'use_count'];
    let orderBy = allowedOrderFields.includes(filters.orderBy) ? filters.orderBy : 'created_at';
    // 确保排序列在 UNION 选择列中存在（可能与 commonColumns 一致或为扩展列）
    if (!unionSelectColumns.includes(orderBy)) {
      orderBy = 'created_at'; // 默认使用 created_at
    }
    const orderDir = (filters.orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${orderBy} ${orderDir}`;

    // 分页
    if (filters.page && filters.pageSize) {
      const offset = (filters.page - 1) * filters.pageSize;
      const limitValue = parseInt(filters.pageSize) || 20;
      const offsetValue = parseInt(offset) || 0;
      sql += ` LIMIT ${limitValue} OFFSET ${offsetValue}`;
    }

    try {
      // 注意：UNION查询的参数绑定比较复杂，这里简化处理
      const [rows] = await conn.execute(sql, allParams);
      const parsedRows = this.parseRows(rows);
      
      // 去重：基于ID和content_text去重
      const uniqueQuestions = [];
      const seenIds = new Set();
      const seenContentText = new Set();
      
      for (const question of parsedRows) {
        const rowKey = QuestionBankModel._questionBankRowDedupeKey(question);
        if (seenIds.has(rowKey)) {
          console.warn(`⚠️ 发现跨表同号记录，已按分类+科目+id 去重保留首条: ${rowKey}`);
          continue;
        }
        
        const contentText = (question.content_text || '').trim();
        
        // 如果内容文本不为空且长度足够，使用内容去重
        if (contentText && contentText.length >= 10) {
          const contentKey = contentText.substring(0, 300);
          if (seenContentText.has(contentKey)) {
            console.warn(`⚠️ 发现重复内容的题目，已跳过: ID=${question.id}, content=${contentKey.substring(0, 50)}...`);
            continue;
          }
          seenContentText.add(contentKey);
        }
        
        seenIds.add(rowKey);
        uniqueQuestions.push(question);
      }
      
      if (parsedRows.length !== uniqueQuestions.length) {
        console.log(`✅ 跨表查询结果: 原始${parsedRows.length}条，去重后${uniqueQuestions.length}条（去除了${parsedRows.length - uniqueQuestions.length}条重复）`);
      }
      
      return uniqueQuestions;
    } catch (error) {
      console.error('getQuestionsFromAllTables SQL错误:', error.message);
      // 如果UNION查询失败，尝试逐个表查询
      return await this.getQuestionsFromAllTablesFallback(filters, conn);
    }
  }

  /**
   * 备用方法：逐个表查询（修复：先合并所有数据，再排序和分页）
   * @param {object} [db] - 可选数据库连接池
   */
  static async getQuestionsFromAllTablesFallback(filters = {}, db) {
    const conn = db || pool;
    let tables = await QuestionBankTableManager.getAllTables(conn);
    
    // 过滤掉审核表和管理表（双重保险）
    tables = tables.filter(table => {
      const tableName = table.table_name;
      return tableName !== 'question_bank_reviews' && 
             tableName !== 'question_bank_tables' &&
             !tableName.startsWith('question_bank_reviews') &&
             !tableName.endsWith('_reviews');
    });
    
    let allQuestions = [];

    // 创建一个临时的 filters 副本，去掉分页参数，先获取所有数据
    const queryFilters = { ...filters };
    delete queryFilters.page;
    delete queryFilters.pageSize;

    for (const table of tables) {
      try {
        // 不传分页参数，获取该表的所有符合条件的数据（使用同一连接池）
        const questions = await this.getQuestionsFromTable(
          table.category,
          table.subject,
          queryFilters,
          conn
        );
        allQuestions = allQuestions.concat(questions);
      } catch (error) {
        console.warn(`查询表 ${table.table_name} 失败:`, error.message);
      }
    }

    // 手动排序和分页
    const allowedOrderFields = ['created_at', 'updated_at', 'number', 'score', 'difficulty', 'use_count'];
    const orderBy = filters.orderBy && allowedOrderFields.includes(filters.orderBy) ? filters.orderBy : 'created_at';
    const orderDir = (filters.orderDir || 'DESC').toUpperCase() === 'ASC' ? 1 : -1;

    // 排序
    allQuestions.sort((a, b) => {
      let aVal = a[orderBy];
      let bVal = b[orderBy];
      
      // 处理日期类型
      if (orderBy === 'created_at' || orderBy === 'updated_at') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      } else {
        // 处理数字类型
        aVal = (aVal !== null && aVal !== undefined && aVal !== '') ? (isNaN(aVal) ? aVal : parseFloat(aVal)) : 0;
        bVal = (bVal !== null && bVal !== undefined && bVal !== '') ? (isNaN(bVal) ? bVal : parseFloat(bVal)) : 0;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * orderDir;
      }
      return (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) * orderDir;
    });

    // 分页（在排序后）
    if (filters.page && filters.pageSize) {
      const start = (filters.page - 1) * parseInt(filters.pageSize) || 0;
      const end = start + parseInt(filters.pageSize) || 20;
      allQuestions = allQuestions.slice(start, end);
    }

    return allQuestions;
  }

  /**
   * 解析行数据（处理JSON字段）
   */
  static parseRows(rows) {
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
      // 解析子小题答案和解析字段
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

  /**
   * 获取题库总数（支持按用户库统计）
   * @param {object} [poolOpt] - 可选数据库连接池（不传则使用主库）
   */
  static async getQuestionCount(filters = {}, poolOpt) {
    const conn = poolOpt || pool;
    const { category, subject } = filters;
    
    if (category && category !== '全部' && subject && subject !== '全部') {
      const tableName = await this.resolveTableNameForQuery(category, subject, conn);
      const cat = (category || '未分类').trim();
      const sub = (subject || '未分类').trim();
      let sql = `SELECT COUNT(*) as total FROM \`${tableName}\` WHERE 1=1`;
      const params = [];
      sql += ' AND TRIM(COALESCE(category,\'\')) = ? AND TRIM(COALESCE(subject,\'\')) = ?';
      params.push(cat, sub);

      if (filters.difficulty && filters.difficulty !== '全部') {
        sql += ' AND difficulty = ?';
        params.push(filters.difficulty);
      }

      if (filters.questionType && filters.questionType !== '全部') {
        sql += ' AND question_type = ?';
        params.push(filters.questionType);
      }

      if (filters.examPurpose && filters.examPurpose.trim() !== '') {
        sql += ' AND exam_purpose LIKE ?';
        params.push(`%${filters.examPurpose}%`);
      }

      if (filters.grade && filters.grade !== '全部' && filters.grade !== '所有') {
        sql += ' AND grade = ?';
        params.push(filters.grade);
      }

      if (filters.useCountMin !== undefined && filters.useCountMin !== null) {
        sql += ' AND use_count >= ?';
        params.push(filters.useCountMin);
      }
      if (filters.useCountMax !== undefined && filters.useCountMax !== null) {
        sql += ' AND use_count <= ?';
        params.push(filters.useCountMax);
      }

      if (filters.keyword) {
        sql += ' AND (content_text LIKE ? OR number LIKE ?)';
        const keyword = `%${filters.keyword}%`;
        params.push(keyword, keyword);
      }

      const [rows] = await conn.execute(sql, params);
      const singleTotal = rows[0].total;
      if (singleTotal > 0) return singleTotal;
      // 指定表无结果时回退跨表统计，保证总数与列表一致
    }

    // 跨表统计（使用相同的筛选条件，同一连接池实现按用户库筛选）
    let tables = await QuestionBankTableManager.getAllTables(conn);
    
    // 过滤掉审核表和管理表（双重保险）
    tables = tables.filter(table => {
      const tableName = table.table_name;
      return tableName !== 'question_bank_reviews' && 
             tableName !== 'question_bank_tables' &&
             !tableName.startsWith('question_bank_reviews') &&
             !tableName.endsWith('_reviews');
    });
    
    let total = 0;

    for (const table of tables) {
      try {
        // 检查表是否存在
        const tableName = table.table_name;
        const [tableExists] = await conn.execute(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = DATABASE() AND table_name = ?`,
          [tableName]
        );
        
        if (tableExists[0].count === 0) {
          continue; // 表不存在，跳过
        }
        
        // 构建统计SQL（与getQuestionsFromTable使用相同的筛选逻辑）
        let sql = `SELECT COUNT(*) as total FROM \`${tableName}\` WHERE 1=1`;
        const params = [];

        // 类别、科目筛选（用 TRIM 比较，与查询一致）
        if (filters.category && filters.category !== '全部') {
          sql += ' AND TRIM(COALESCE(category,\'\')) = ?';
          params.push((filters.category || '').trim());
        }
        if (filters.subject && filters.subject !== '全部') {
          sql += ' AND TRIM(COALESCE(subject,\'\')) = ?';
          params.push((filters.subject || '').trim());
        }

        // 难度筛选
        if (filters.difficulty && filters.difficulty !== '全部') {
          sql += ' AND difficulty = ?';
          params.push(filters.difficulty);
        }

        // 题型筛选
        if (filters.questionType && filters.questionType !== '全部') {
          sql += ' AND question_type = ?';
          params.push(filters.questionType);
        }

        // 考察目的筛选
        if (filters.examPurpose && filters.examPurpose.trim() !== '') {
          sql += ' AND exam_purpose LIKE ?';
          params.push(`%${filters.examPurpose}%`);
        }

        // 年级筛选（与单表、列表接口一致：「所有」视为不筛选）
        if (filters.grade && filters.grade !== '全部' && filters.grade !== '所有') {
          sql += ' AND grade = ?';
          params.push(filters.grade);
        }

        // 使用次数筛选
        if (filters.useCountMin !== undefined && filters.useCountMin !== null) {
          sql += ' AND use_count >= ?';
          params.push(filters.useCountMin);
        }
        if (filters.useCountMax !== undefined && filters.useCountMax !== null) {
          sql += ' AND use_count <= ?';
          params.push(filters.useCountMax);
        }

        // 关键词搜索
        if (filters.keyword) {
          sql += ' AND (content_text LIKE ? OR number LIKE ?)';
          const keyword = `%${filters.keyword}%`;
          params.push(keyword, keyword);
        }

        const [rows] = await conn.execute(sql, params);
        total += rows[0].total || 0;
      } catch (error) {
        console.warn(`统计表 ${table.table_name} 失败:`, error.message);
      }
    }

    return total;
  }

  /**
   * 获取所有分类列表
   */
  static async getCategories() {
    const tables = await QuestionBankTableManager.getAllTables();
    const categories = new Set();

    for (const table of tables) {
      try {
        const tableName = await this.getTable(table.category, table.subject);
        const [rows] = await pool.execute(`SELECT DISTINCT category FROM \`${tableName}\``);
        rows.forEach(row => categories.add(row.category));
      } catch (error) {
        console.warn(`获取分类失败 ${table.table_name}:`, error.message);
      }
    }

    return Array.from(categories).sort();
  }

  /**
   * 获取所有科目列表
   */
  static async getSubjects() {
    const tables = await QuestionBankTableManager.getAllTables();
    const subjects = new Set();

    for (const table of tables) {
      try {
        const tableName = await this.getTable(table.category, table.subject);
        const [rows] = await pool.execute(`SELECT DISTINCT subject FROM \`${tableName}\``);
        rows.forEach(row => subjects.add(row.subject));
      } catch (error) {
        console.warn(`获取科目失败 ${table.table_name}:`, error.message);
      }
    }

    return Array.from(subjects).sort();
  }

  /**
   * 根据分类获取科目列表（来自题库中已存在的表，用于与固定列表合并，保证筛选与上传选项一致）
   */
  static async getSubjectsByCategoryFromDb(category) {
    if (!category || category === '全部') return [];
    const tables = await QuestionBankTableManager.getAllTables();
    const subjects = new Set();
    for (const table of tables) {
      if (table.category === category && table.subject) {
        subjects.add(table.subject);
      }
    }
    return Array.from(subjects).sort();
  }

  /**
   * 根据分类从题目行中取 DISTINCT subject（与列表展示的科目完全一致，保证筛选可选到列表里出现的科目）
   */
  static async getDistinctSubjectsFromRowsByCategory(category, poolOpt) {
    if (!category || category === '全部') return [];
    const conn = poolOpt || pool;
    const tables = await QuestionBankTableManager.getAllTables(conn);
    const cat = (category || '未分类').trim();
    const subjects = new Set();
    for (const table of tables) {
      if ((table.category || '').trim() !== cat) continue;
      const tableName = table.table_name;
      try {
        const [cols] = await conn.execute(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN ('category','subject')`,
          [tableName]
        );
        const hasCategory = cols.some(c => c.COLUMN_NAME === 'category');
        const hasSubject = cols.some(c => c.COLUMN_NAME === 'subject');
        if (!hasSubject) continue;
        let sql = `SELECT DISTINCT subject FROM \`${tableName.replace(/`/g, '``')}\` WHERE subject IS NOT NULL AND TRIM(COALESCE(subject,'')) != ''`;
        const params = [];
        if (hasCategory) {
          sql += ' AND category = ?';
          params.push(cat);
        }
        const [rows] = await conn.execute(sql, params);
        rows.forEach(r => r.subject && subjects.add(String(r.subject).trim()));
      } catch (e) {
        console.warn(`getDistinctSubjectsFromRowsByCategory ${tableName}:`, e.message);
      }
    }
    return Array.from(subjects).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  /**
   * 增加使用次数
   */
  static async incrementUseCount(ids, category, subject) {
    if (!ids || ids.length === 0) {
      return;
    }

    // 如果提供了类别和科目，只更新对应表
    if (category && subject) {
      const tableName = await this.getTable(category, subject);
      const placeholders = ids.map(() => '?').join(',');
      const sql = `
        UPDATE \`${tableName}\` 
        SET use_count = use_count + 1, last_used_at = NOW()
        WHERE id IN (${placeholders})
      `;
      await pool.execute(sql, ids);
      return;
    }

    // 否则需要在所有表中查找并更新
    const tables = await QuestionBankTableManager.getAllTables();
    for (const table of tables) {
      try {
        const tableName = table.table_name;
        const placeholders = ids.map(() => '?').join(',');
        const sql = `
          UPDATE \`${tableName}\` 
          SET use_count = use_count + 1, last_used_at = NOW()
          WHERE id IN (${placeholders})
        `;
        await pool.execute(sql, ids);
      } catch (error) {
        // 忽略错误，继续下一个表
      }
    }
  }

  /**
   * 组题：根据条件筛选题目
   */
  static async groupQuestions(filters = {}) {
    return await this.getQuestions(filters);
  }

  /**
   * 根据ID获取题库题目（需要知道类别和科目）
   */
  static async getQuestionById(id, category, subject) {
    if (!category || !subject) {
      // 如果不知道类别和科目，需要在所有表中查找
      const tables = await QuestionBankTableManager.getAllTables();
      for (const table of tables) {
        try {
          const tableName = table.table_name;
          const [rows] = await pool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
          if (rows.length > 0) {
            const question = this.parseRows(rows)[0];
            // 调试信息
            console.log(`📖 从表 ${tableName} 获取题目 ID=${id}:`, {
              hasAnswer: !!question.answer,
              hasAnswerHtml: !!question.answer_html,
              hasExplanation: !!question.explanation,
              hasExplanationHtml: !!question.explanation_html,
              difficulty: question.difficulty,
              hasSubAnswers: !!question.sub_answers,
              hasSubExplanations: !!question.sub_explanations,
              subAnswersType: typeof question.sub_answers,
              subExplanationsType: typeof question.sub_explanations
            });
            return question;
          }
        } catch (error) {
          // 继续查找
        }
      }
      return null;
    }

    const tableName = await this.getTable(category, subject);
    const [rows] = await pool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return null;
    }
    const question = this.parseRows(rows)[0];
    // 调试信息
    console.log(`📖 从表 ${tableName} 获取题目 ID=${id}:`, {
      hasAnswer: !!question.answer,
      hasAnswerHtml: !!question.answer_html,
      hasExplanation: !!question.explanation,
      hasExplanationHtml: !!question.explanation_html,
      difficulty: question.difficulty,
      answerPreview: question.answer ? question.answer.substring(0, 30) + '...' : '无',
      explanationPreview: question.explanation ? question.explanation.substring(0, 30) + '...' : '无',
      hasSubAnswers: !!question.sub_answers,
      hasSubExplanations: !!question.sub_explanations,
      subAnswersType: typeof question.sub_answers,
      subExplanationsType: typeof question.sub_explanations,
      subAnswersPreview: question.sub_answers ? (Array.isArray(question.sub_answers) ? `数组(${question.sub_answers.length}项)` : JSON.stringify(question.sub_answers).substring(0, 50) + '...') : '无',
      subExplanationsPreview: question.sub_explanations ? (Array.isArray(question.sub_explanations) ? `数组(${question.sub_explanations.length}项)` : JSON.stringify(question.sub_explanations).substring(0, 50) + '...') : '无'
    });
    return question;
  }

  /**
   * 更新题库题目
   */
  static async updateQuestion(id, data, category, subject) {
    const {
      number,
      subNumber,
      contentHtml,
      contentText,
      score,
      category: newCategory,
      subject: newSubject,
      tags,
      difficulty,
      imagesBase64,
      fullContent,
      notes,
      answer,
      answerHtml,
      explanation,
      explanationHtml,
      subAnswers,
      subExplanations
    } = data;

    // 如果类别或科目改变了，需要迁移到新表
    if (newCategory && newSubject && (newCategory !== category || newSubject !== subject)) {
      // 先删除旧记录
      await this.deleteQuestion(id, category, subject);
      // 在新表中创建记录
      return await this.saveQuestion({
        ...data,
        category: newCategory,
        subject: newSubject
      });
    }

    // 否则更新当前表
    const tableName = await this.getTable(category || newCategory, subject || newSubject);
    
    // 检查表字段
    let hasAnswer = false;
    let hasExplanation = false;
    let hasSubAnswers = false;
    let hasSubExplanations = false;
    try {
      const [columns] = await pool.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME IN ('answer', 'answer_html', 'explanation', 'explanation_html', 'sub_answers', 'sub_explanations')`,
        [tableName]
      );
      hasAnswer = columns.some(col => col.COLUMN_NAME === 'answer');
      hasExplanation = columns.some(col => col.COLUMN_NAME === 'explanation');
      hasSubAnswers = columns.some(col => col.COLUMN_NAME === 'sub_answers');
      hasSubExplanations = columns.some(col => col.COLUMN_NAME === 'sub_explanations');
    } catch (error) {
      console.warn('检查表字段失败:', error);
    }

    // 构建更新SQL
    const updates = [
      'number = ?',
      'sub_number = ?',
      'content_html = ?',
      'content_text = ?',
      'score = ?',
      'category = ?',
      'subject = ?',
      'tags = ?',
      'difficulty = ?',
      'images_base64 = ?',
      'full_content = ?'
    ];
    const params = [
      number || '',
      subNumber || null,
      contentHtml,
      contentText || null,
      score || 0,
      newCategory || category || '未分类',
      newSubject || subject || '未分类',
      tags || null,
      difficulty || '中等',
      imagesBase64 ? JSON.stringify(imagesBase64) : null,
      fullContent || null
    ];

    if (hasAnswer) {
      updates.push('answer = ?', 'answer_html = ?');
      params.push(answer || null, answerHtml || null);
    }
    if (hasExplanation) {
      updates.push('explanation = ?', 'explanation_html = ?');
      params.push(explanation || null, explanationHtml || null);
    }
    if (hasSubAnswers) {
      updates.push('sub_answers = ?');
      params.push(subAnswers ? JSON.stringify(subAnswers) : null);
    }
    if (hasSubExplanations) {
      updates.push('sub_explanations = ?');
      params.push(subExplanations ? JSON.stringify(subExplanations) : null);
    }

    updates.push('notes = ?');
    params.push(notes || null);
    params.push(id);

    const sql = `UPDATE \`${tableName}\` SET ${updates.join(', ')} WHERE id = ?`;
    await pool.execute(sql, params);
  }

  /**
   * 删除题库题目
   * 始终按 id 在所有题库表中查找并删除，不依赖 category/subject，避免前后端不一致导致删不到
   */
  static async deleteQuestion(id, category, subject) {
    const questionId = parseInt(id, 10);
    if (isNaN(questionId)) {
      throw new Error('题目ID无效');
    }
    const tables = await QuestionBankTableManager.getAllTables(pool);
    if (!tables || tables.length === 0) {
      console.warn('题库表列表为空，无法删除');
      return;
    }
    let deleted = false;
    for (const table of tables) {
      try {
        const tableName = table.table_name;
        const [result] = await pool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [questionId]);
        if (result.affectedRows > 0) {
          deleted = true;
          break;
        }
      } catch (err) {
        console.warn(`删除表 ${tableName} 时出错:`, err.message);
      }
    }
    if (!deleted) {
      console.warn(`未在任何题库表中找到 id=${questionId} 的记录`);
    }
  }

  /**
   * 批量删除
   * 必须使用与列表查询相同的表解析（resolveTableNameForQuery）；与列表同库
   */
  static async deleteQuestions(ids, category, subject) {
    if (!ids || ids.length === 0) return;
    const idList = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    if (idList.length === 0) {
      throw new Error('没有有效的题目ID');
    }
    const cat = (category != null && String(category).trim() !== '') ? String(category).trim() : null;
    const sub = (subject != null && String(subject).trim() !== '') ? String(subject).trim() : null;
    if (!cat || !sub) {
      const tables = await QuestionBankTableManager.getAllTables(pool);
      for (const table of tables) {
        try {
          const tableName = table.table_name;
          const placeholders = idList.map(() => '?').join(',');
          await pool.execute(`DELETE FROM \`${tableName}\` WHERE id IN (${placeholders})`, idList);
        } catch (error) {
          // 继续
        }
      }
      return;
    }
    const tableName = await this.resolveTableNameForQuery(cat, sub);
    const placeholders = idList.map(() => '?').join(',');
    await pool.execute(`DELETE FROM \`${tableName}\` WHERE id IN (${placeholders})`, idList);
  }

  /**
   * 查找重复的题目
   * @param {Object} options - 查找选项
   * @param {string} options.contentText - 题目文本内容
   * @param {string} options.category - 类别
   * @param {string} options.subject - 科目
   * @param {number} options.similarityThreshold - 相似度阈值（0-1），默认0.8
   * @returns {Promise<Array>} 重复的题目列表
   */
  /**
   * 去掉题干前的题号（如 1. 2、 (1) 等），便于与题库中同一道题匹配。仅当数字后紧跟题号分隔符（.、．、）等）时才去除，避免误删题干中的数字（如 80元）
   */
  static stripLeadingQuestionNumberFromText(text) {
    if (!text || typeof text !== 'string') return (text || '').trim();
    const t = String(text).trim();
    const stripped = t.replace(/^\s*(\d{1,3}(\.\d+)?(\(\d+\))?[\.、．\s]+|[（(]\s*\d+\s*[）)]\s*[\.、．\s]*)/, '').trim();
    return stripped.replace(/\s+/g, ' ').trim() || t;
  }

  static async findDuplicates(options) {
    const {
      contentText,
      category,
      subject,
      similarityThreshold = 0.8
    } = options;

    if (!contentText || !contentText.trim()) {
      return [];
    }

    const tableName = await this.getTable(category || '未分类', subject || '未分类');
    const contentForMatch = contentText.trim();

    // 计算文本的简化版本（去除空格、标点等，用于相似度比较）
    const normalizeText = (text) => {
      return text
        .replace(/\s+/g, '')
        .replace(/[，。、；：！？""''（）【】《》]/g, '')
        .toLowerCase()
        .trim();
    };

    const normalizedInput = normalizeText(contentForMatch);

    // 如果规范化后的文本太短，直接返回空数组
    if (normalizedInput.length < 5) {
      return [];
    }

    const minLength = Math.max(5, Math.floor(normalizedInput.length * 0.3)); // 至少30%长度匹配

    // 查询同一类别和科目下的所有题目
    let sql = `
      SELECT id, number, content_text, content_html, score, category, subject,
             difficulty, tags, created_at, updated_at
      FROM \`${tableName}\`
      WHERE category = ? AND subject = ?
      AND content_text IS NOT NULL
      AND LENGTH(content_text) >= ?
    `;
    const params = [category || '未分类', subject || '未分类', minLength];

    try {
      const [rows] = await pool.execute(sql, params);
      const duplicates = [];

      for (const row of rows) {
        if (!row.content_text) continue;
        const normalizedRow = normalizeText(row.content_text);
        
        // 计算相似度（使用简单的字符重叠率）
        const similarity = this.calculateSimilarity(normalizedInput, normalizedRow);
        
        if (similarity >= similarityThreshold) {
          duplicates.push({
            id: row.id,
            number: row.number,
            contentText: row.content_text.substring(0, 200), // 只返回前200字符预览
            contentHtml: row.content_html,
            score: row.score,
            category: row.category,
            subject: row.subject,
            difficulty: row.difficulty,
            tags: row.tags,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            similarity: similarity
          });
        }
      }

      // 按相似度降序排序
      duplicates.sort((a, b) => b.similarity - a.similarity);

      return duplicates;
    } catch (error) {
      console.error('查找重复题目失败:', error);
      return [];
    }
  }

  /**
   * 根据题目内容在题库中查找最佳匹配，并返回答案和解析（用于阅卷系统从题库同步）
   * @param {string} contentText - 题目纯文本内容
   * @param {string} category - 类别
   * @param {string} subject - 科目
   * @param {number} similarityThreshold - 相似度阈值，默认 0.7
   * @returns {Promise<{answer:string,answerHtml:string,explanation:string,explanationHtml:string}|null>}
   */
  static async findBestMatchWithAnswer(contentText, category, subject, similarityThreshold = 0.7) {
    if (!contentText || !contentText.trim()) return null;
    const duplicates = await this.findDuplicates({ contentText, category, subject, similarityThreshold });
    if (!duplicates || duplicates.length === 0) return null;
    const best = duplicates[0];
    const question = await this.getQuestionById(best.id, category, subject);
    if (!question) return null;
    const answer = question.answer || (question.answer_html ? String(question.answer_html).replace(/<[^>]+>/g, '').trim() : '') || '';
    const explanation = question.explanation || (question.explanation_html ? String(question.explanation_html).replace(/<[^>]+>/g, '').trim() : '') || '';
    const hasSub = (question.sub_answers && Array.isArray(question.sub_answers) && question.sub_answers.length > 0) ||
      (question.sub_explanations && Array.isArray(question.sub_explanations) && question.sub_explanations.length > 0);
    if (!answer && !explanation && !hasSub) return null;
    return {
      answer: answer || null,
      answerHtml: question.answer_html || null,
      explanation: explanation || null,
      explanationHtml: question.explanation_html || null,
      sub_answers: question.sub_answers || null,
      sub_explanations: question.sub_explanations || null
    };
  }

  /**
   * 在所有题库表（所有分类+科目）中查找与 contentText 最佳匹配的小题，并返回其答案和解析（用于阅卷系统自动带出）
   * @param {string} contentText - 题目纯文本内容
   * @param {number} similarityThreshold - 相似度阈值，默认 0.6
   * @returns {Promise<{answer:string,answerHtml:string,explanation:string,explanationHtml:string}|null>}
   */
  static async findBestMatchWithAnswerAcrossAll(contentText, similarityThreshold = 0.6) {
    if (!contentText || !contentText.trim()) return null;
    const tables = await QuestionBankTableManager.getAllTables();
    const seen = new Set();
    for (const t of tables) {
      const key = `${(t.category || '').trim()}|${(t.subject || '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const match = await this.findBestMatchWithAnswer(contentText, t.category, t.subject, similarityThreshold);
        if (match) return match;
      } catch (err) {
        // 忽略单表查询错误，继续尝试下一表
      }
    }
    return null;
  }

  /**
   * 计算两个文本的相似度（0-1之间）
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} 相似度（0-1）
   */
  static calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;

    // 使用最长公共子序列（LCS）算法计算相似度
    const len1 = text1.length;
    const len2 = text2.length;

    if (len1 === 0 || len2 === 0) return 0;

    // 如果长度差异太大，相似度降低
    const lengthRatio = Math.min(len1, len2) / Math.max(len1, len2);
    if (lengthRatio < 0.5) return 0;

    // 计算最长公共子序列长度
    const lcs = this.longestCommonSubsequence(text1, text2);
    const similarity = (lcs * 2) / (len1 + len2);

    // 结合长度比例
    return similarity * lengthRatio;
  }

  /**
   * 计算最长公共子序列长度
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} LCS长度
   */
  static longestCommonSubsequence(text1, text2) {
    const m = text1.length;
    const n = text2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (text1[i - 1] === text2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * 获取所有题型列表
   */
  static async getQuestionTypes() {
    const tables = await QuestionBankTableManager.getAllTables();
    const questionTypes = new Set();

    // 默认题型
    const defaultTypes = [
      '单选题', '多选题', '判断题', '填空题', '简答题', 
      '论述题', '计算题', '证明题', '案例分析题', '综合题'
    ];
    defaultTypes.forEach(type => questionTypes.add(type));

    // 从所有表中获取题型
    for (const table of tables) {
      try {
        const tableName = await this.getTable(table.category, table.subject);
        
        // 检查表中是否有question_type字段
        const [columns] = await pool.execute(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = ? 
           AND COLUMN_NAME = 'question_type'`,
          [tableName]
        );
        
        if (columns.length > 0) {
          const [rows] = await pool.execute(
            `SELECT DISTINCT question_type FROM \`${tableName}\` 
             WHERE question_type IS NOT NULL AND question_type != ''`
          );
          rows.forEach(row => {
            if (row.question_type) {
              questionTypes.add(row.question_type);
            }
          });
        }
      } catch (error) {
        console.warn(`获取题型失败 ${table.table_name}:`, error.message);
      }
    }

    return Array.from(questionTypes).sort();
  }

  /**
   * 获取所有年级列表（仅教育类）
   */
  static async getGrades() {
    const tables = await QuestionBankTableManager.getAllTables();
    const grades = new Set();

    // 默认年级
    const defaultGrades = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '高一', '高二', '高三'];
    defaultGrades.forEach(grade => grades.add(grade));

    // 从所有表中获取年级
    for (const table of tables) {
      try {
        const tableName = await this.getTable(table.category, table.subject);
        
        // 检查表中是否有grade字段
        const [columns] = await pool.execute(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = ? 
           AND COLUMN_NAME = 'grade'`,
          [tableName]
        );
        
        if (columns.length > 0) {
          const [rows] = await pool.execute(
            `SELECT DISTINCT grade FROM \`${tableName}\` 
             WHERE grade IS NOT NULL AND grade != ''`
          );
          rows.forEach(row => {
            if (row.grade) {
              grades.add(row.grade);
            }
          });
        }
      } catch (error) {
        console.warn(`获取年级失败 ${table.table_name}:`, error.message);
      }
    }

    return Array.from(grades).sort();
  }
}

module.exports = QuestionBankModel;
