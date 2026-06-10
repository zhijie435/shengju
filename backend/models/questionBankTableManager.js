const { pool } = require('../config/database');

/**
 * 题库表管理器 - 为每个类别+科目组合创建独立表
 */
class QuestionBankTableManager {
  /**
   * 生成表名（根据类别和科目）
   * @param {string} category - 类别
   * @param {string} subject - 科目
   * @returns {string} 表名
   */
  static getTableName(category, subject) {
    const cat = (category || '未分类').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    const sub = (subject || '未分类').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    return `question_bank_${cat}_${sub}`;
  }

  /**
   * 确保表存在（如果不存在则创建）
   * @param {string} category - 类别
   * @param {string} subject - 科目
   * @param {object} [poolOpt] - 可选数据库连接池（不传则使用主库）
   * @returns {Promise<string>} 表名
   */
  static async ensureTable(category, subject, poolOpt) {
    const db = poolOpt || pool;
    const tableName = this.getTableName(category, subject);
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');

    const [tables] = await db.execute(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [safeTableName]
    );

    if (tables[0].count === 0) {
      const defaultCategory = (category || '未分类').replace(/'/g, "''");
      const defaultSubject = (subject || '未分类').replace(/'/g, "''");
      const comment = `题库表：${category || '未分类'} - ${subject || '未分类'}`.replace(/'/g, "''");
      
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS \`${safeTableName.replace(/`/g, '``')}\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          number VARCHAR(50) NOT NULL COMMENT '题号（如：1, 2, 3）',
          sub_number VARCHAR(50) COMMENT '子题号（如：(1), (2) 或 1.1, 1.2）',
          content_html LONGTEXT NOT NULL COMMENT 'HTML格式的小题内容',
          content_text TEXT COMMENT '纯文本内容',
          score INT DEFAULT 0 COMMENT '分值',
          category VARCHAR(100) DEFAULT '${defaultCategory}' COMMENT '分类',
          subject VARCHAR(100) DEFAULT '${defaultSubject}' COMMENT '科目',
          grade VARCHAR(50) COMMENT '年级（仅教育类）',
          tags VARCHAR(255) COMMENT '标签（逗号分隔，兼容旧数据）',
          question_type VARCHAR(100) COMMENT '题型（如：单选题、填空题等）',
          exam_purpose VARCHAR(255) COMMENT '考察目的',
          difficulty VARCHAR(20) DEFAULT '中等' COMMENT '难度：简单、中等、困难',
          images_base64 LONGTEXT COMMENT 'Base64编码的图片（JSON格式数组）',
          full_content LONGTEXT COMMENT '完整内容（包含题号）',
          answer TEXT COMMENT '答案',
          answer_html LONGTEXT COMMENT '答案HTML格式',
          explanation TEXT COMMENT '解析',
          explanation_html LONGTEXT COMMENT '解析HTML格式',
          sub_answers LONGTEXT COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]',
          sub_explanations LONGTEXT COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]',
          notes TEXT COMMENT '备注信息',
          use_count INT DEFAULT 0 COMMENT '使用次数',
          last_used_at TIMESTAMP NULL COMMENT '最后使用时间',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_category (category),
          INDEX idx_subject (subject),
          INDEX idx_grade (grade),
          INDEX idx_question_type (question_type),
          INDEX idx_difficulty (difficulty),
          INDEX idx_use_count (use_count),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='${comment}'
      `;

      await db.execute(createTableSQL);

      try {
        await db.execute(
          `INSERT INTO question_bank_tables (table_name, category, subject, question_count)
           VALUES (?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [safeTableName, category || '未分类', subject || '未分类']
        );
      } catch (error) {
        console.warn('管理表不存在，跳过记录:', error.message);
      }
    }

    return safeTableName;
  }

  /**
   * 获取所有关联的表名（只返回管理表中注册的表）
   * @param {object} [poolOpt] - 可选数据库连接池（不传则使用主库，用于按用户库筛选所有题目）
   * @returns {Promise<Array>} 表信息数组
   */
  static async getAllTables(poolOpt) {
    const db = poolOpt || pool;
    // 确保管理表存在
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS question_bank_tables (
          id INT AUTO_INCREMENT PRIMARY KEY,
          table_name VARCHAR(255) NOT NULL UNIQUE,
          category VARCHAR(100) NOT NULL,
          subject VARCHAR(100) NOT NULL,
          question_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_category (category),
          INDEX idx_subject (subject)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (error) {
      console.warn('创建管理表失败（可能已存在）:', error.message);
    }

    // 方法1: 从管理表获取已注册的表
    const registeredTables = new Map();
    try {
      const [rows] = await db.execute(
        'SELECT table_name, category, subject, question_count FROM question_bank_tables ORDER BY category, subject'
      );
      
      for (const row of rows) {
        registeredTables.set(row.table_name, {
          category: row.category,
          subject: row.subject,
          question_count: row.question_count
        });
      }
    } catch (error) {
      console.warn('从管理表获取表列表失败:', error.message);
    }

    // 方法2: 扫描数据库中所有question_bank_开头的表（补充遗漏的表）
    const allTables = new Map();
    
    // 先添加已注册的表
    for (const [tableName, info] of registeredTables) {
      allTables.set(tableName, info);
    }

    try {
      // 查询所有question_bank_开头的表（排除审核表和管理表）
      const [allTableRows] = await db.execute(
        `SELECT TABLE_NAME as table_name 
         FROM information_schema.tables 
         WHERE table_schema = DATABASE() 
         AND table_name LIKE 'question_bank_%'
         AND table_name NOT IN ('question_bank_reviews', 'question_bank_tables')
         ORDER BY table_name`
      );

      for (const row of allTableRows) {
        const tableName = row.table_name;
        
        // 额外检查：排除审核表和管理表（以防万一）
        if (tableName === 'question_bank_reviews' || tableName === 'question_bank_tables') {
          continue;
        }
        
        // 如果表不在已注册列表中，尝试解析表名获取category和subject
        if (!allTables.has(tableName)) {
          // 从表名解析：question_bank_类别_科目
          const parts = tableName.replace('question_bank_', '').split('_');
          let category = '未分类';
          let subject = '未分类';
          
          // 尝试从表中读取category和subject（如果表中有数据）
          try {
            const [sampleRows] = await db.execute(
              `SELECT DISTINCT category, subject FROM \`${tableName}\` LIMIT 1`
            );
            if (sampleRows.length > 0) {
              category = sampleRows[0].category || category;
              subject = sampleRows[0].subject || subject;
            } else {
              // 如果表中没有数据，尝试从表名解析
              if (parts.length >= 2) {
                category = parts[0] || '未分类';
                subject = parts.slice(1).join('_') || '未分类';
              } else if (parts.length === 1) {
                category = parts[0] || '未分类';
                subject = '未分类';
              }
            }
          } catch (error) {
            // 如果读取失败，尝试从表名解析
            if (parts.length >= 2) {
              category = parts[0] || '未分类';
              subject = parts.slice(1).join('_') || '未分类';
            } else if (parts.length === 1) {
              category = parts[0] || '未分类';
              subject = '未分类';
            }
          }

          // 获取实际记录数
          let actualCount = 0;
          try {
            const [countResult] = await db.execute(
              `SELECT COUNT(*) as count FROM \`${tableName}\``
            );
            actualCount = countResult[0].count || 0;
          } catch (error) {
            console.warn(`获取表 ${tableName} 记录数失败:`, error.message);
          }

          // 添加到结果中
          allTables.set(tableName, {
            category: category,
            subject: subject,
            question_count: actualCount
          });

          // 如果表有数据，尝试注册到管理表
          if (actualCount > 0) {
            try {
              await db.execute(
                `INSERT INTO question_bank_tables (table_name, category, subject, question_count)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                   category = VALUES(category),
                   subject = VALUES(subject),
                   question_count = VALUES(question_count),
                   updated_at = NOW()`,
                [tableName, category, subject, actualCount]
              );
            } catch (error) {
              console.warn(`注册表 ${tableName} 到管理表失败:`, error.message);
            }
          }
        } else {
          // 表已注册，更新记录数
          try {
            const [countResult] = await db.execute(
              `SELECT COUNT(*) as count FROM \`${tableName}\``
            );
            const actualCount = countResult[0].count || 0;
            
            // 更新管理表中的记录数
            await db.execute(
              `UPDATE question_bank_tables SET question_count = ?, updated_at = NOW() WHERE table_name = ?`,
              [actualCount, tableName]
            );
            
            // 更新Map中的记录数
            const info = allTables.get(tableName);
            info.question_count = actualCount;
          } catch (error) {
            console.warn(`更新表 ${tableName} 记录数失败:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('扫描数据库表失败:', error);
    }

    // 转换为数组格式
    const result = [];
    for (const [tableName, info] of allTables) {
      // 验证表是否真实存在
      try {
        const [tableExists] = await db.execute(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = DATABASE() AND table_name = ?`,
          [tableName]
        );
        
        if (tableExists[0].count > 0) {
          result.push({
            table_name: tableName,
            category: info.category,
            subject: info.subject,
            question_count: info.question_count
          });
        } else {
          // 表不存在，从管理表中删除记录
          try {
            await db.execute(
              `DELETE FROM question_bank_tables WHERE table_name = ?`,
              [tableName]
            );
          } catch (e) {
            console.warn(`删除管理表记录失败 ${tableName}:`, e.message);
          }
        }
      } catch (error) {
        console.warn(`验证表 ${tableName} 失败:`, error.message);
      }
    }
    
    return result;
  }

  /**
   * 根据类别和科目获取表名（如果表不存在则创建）
   * @param {string} category - 类别
   * @param {string} subject - 科目
   * @param {object} [poolOpt] - 可选数据库连接池
   * @returns {Promise<string>} 表名
   */
  static async getTable(category, subject, poolOpt) {
    return await this.ensureTable(category, subject, poolOpt);
  }
}

module.exports = QuestionBankTableManager;

