const { pool } = require('../config/database');
const QuestionBankTableManager = require('./questionBankTableManager');

/**
 * 题库清理器 - 用于清空和清理题库数据
 */
class QuestionBankCleaner {
  /**
   * 获取所有题库表（包括空的）
   * @returns {Promise<Array>} 表信息数组
   */
  static async getAllQuestionBankTables() {
    try {
      // 从information_schema查询所有question_bank_开头的表
      const [tables] = await pool.execute(
        `SELECT table_name 
         FROM information_schema.tables 
         WHERE table_schema = DATABASE() 
         AND table_name LIKE 'question_bank_%'
         ORDER BY table_name`
      );
      
      const tableInfo = [];
      for (const table of tables) {
        const tableName = table.table_name;
        try {
          // 获取每个表的记录数
          const [countResult] = await pool.execute(
            `SELECT COUNT(*) as count FROM \`${tableName}\``
          );
          const count = countResult[0].count || 0;
          
          // 尝试从表中获取类别和科目信息
          let category = '未知';
          let subject = '未知';
          try {
            const [sample] = await pool.execute(
              `SELECT DISTINCT category, subject FROM \`${tableName}\` LIMIT 1`
            );
            if (sample.length > 0) {
              category = sample[0].category || '未知';
              subject = sample[0].subject || '未知';
            }
          } catch (e) {
            // 如果表为空，从表名解析
            const nameParts = tableName.replace('question_bank_', '').split('_');
            if (nameParts.length >= 2) {
              category = nameParts[0];
              subject = nameParts.slice(1).join('_');
            }
          }
          
          tableInfo.push({
            table_name: tableName,
            category: category,
            subject: subject,
            question_count: count
          });
        } catch (error) {
          console.warn(`获取表 ${tableName} 信息失败:`, error.message);
        }
      }
      
      return tableInfo;
    } catch (error) {
      console.error('获取题库表列表失败:', error);
      throw error;
    }
  }

  /**
   * 清空所有题库表的数据
   * @returns {Promise<Object>} 清理结果
   */
  static async clearAllQuestionData() {
    const tables = await this.getAllQuestionBankTables();
    const results = {
      cleared: 0,
      errors: [],
      details: []
    };

    for (const table of tables) {
      try {
        const tableName = table.table_name;
        // 清空表数据
        await pool.execute(`DELETE FROM \`${tableName}\``);
        // 重置AUTO_INCREMENT
        await pool.execute(`ALTER TABLE \`${tableName}\` AUTO_INCREMENT = 1`);
        
        results.cleared++;
        results.details.push({
          table: tableName,
          category: table.category,
          subject: table.subject,
          status: 'success',
          cleared_count: table.question_count
        });
      } catch (error) {
        results.errors.push({
          table: table.table_name,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * 删除空表（没有数据的表）
   * @returns {Promise<Object>} 删除结果
   */
  static async deleteEmptyTables() {
    const tables = await this.getAllQuestionBankTables();
    const results = {
      deleted: 0,
      errors: [],
      details: []
    };

    for (const table of tables) {
      if (table.question_count === 0) {
        try {
          const tableName = table.table_name;
          // 删除表
          await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
          
          // 从管理表中删除记录（如果存在）
          try {
            await pool.execute(
              `DELETE FROM question_bank_tables WHERE table_name = ?`,
              [tableName]
            );
          } catch (e) {
            // 管理表可能不存在，忽略错误
          }
          
          results.deleted++;
          results.details.push({
            table: tableName,
            category: table.category,
            subject: table.subject,
            status: 'deleted'
          });
        } catch (error) {
          results.errors.push({
            table: table.table_name,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  /**
   * 删除不关联的表（不在管理表中的表）
   * @returns {Promise<Object>} 删除结果
   */
  static async deleteUnlinkedTables() {
    // 确保管理表存在
    try {
      await pool.execute(`
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

    // 获取所有实际的表
    const [allTables] = await pool.execute(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = DATABASE() 
       AND table_name LIKE 'question_bank_%'
       ORDER BY table_name`
    );

    // 获取管理表中注册的表
    let managedTableNames = new Set();
    try {
      const [managedRows] = await pool.execute(
        'SELECT table_name FROM question_bank_tables'
      );
      managedRows.forEach(row => {
        managedTableNames.add(row.table_name);
      });
    } catch (error) {
      console.warn('查询管理表失败:', error.message);
    }

    const results = {
      deleted: 0,
      errors: [],
      details: []
    };

    // 删除不在管理表中的表
    for (const table of allTables) {
      const tableName = table.table_name;
      if (!managedTableNames.has(tableName)) {
        try {
          // 删除表
          await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
          
          results.deleted++;
          results.details.push({
            table: tableName,
            status: 'deleted',
            reason: '不在管理表中'
          });
        } catch (error) {
          results.errors.push({
            table: tableName,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  /**
   * 同步表信息到管理表（确保所有表都记录在管理表中）
   * @returns {Promise<Object>} 同步结果
   */
  static async syncTableInfo() {
    // 确保管理表存在
    try {
      await pool.execute(`
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

    const tables = await this.getAllQuestionBankTables();
    const results = {
      synced: 0,
      errors: []
    };

    for (const table of tables) {
      try {
        // 获取实际记录数
        const [countResult] = await pool.execute(
          `SELECT COUNT(*) as count FROM \`${table.table_name}\``
        );
        const count = countResult[0].count || 0;

        // 插入或更新管理表
        await pool.execute(
          `INSERT INTO question_bank_tables (table_name, category, subject, question_count)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE 
           category = VALUES(category),
           subject = VALUES(subject),
           question_count = VALUES(question_count),
           updated_at = NOW()`,
          [table.table_name, table.category, table.subject, count]
        );

        results.synced++;
      } catch (error) {
        results.errors.push({
          table: table.table_name,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * 清理并同步：清空所有数据、删除空表、删除不关联的表、同步表信息
   * @returns {Promise<Object>} 完整清理结果
   */
  static async cleanAndSync() {
    const results = {
      clearResult: null,
      deleteEmptyResult: null,
      deleteUnlinkedResult: null,
      syncResult: null
    };

    try {
      // 1. 删除不关联的表（不在管理表中的表）
      results.deleteUnlinkedResult = await this.deleteUnlinkedTables();
      
      // 2. 清空所有数据
      results.clearResult = await this.clearAllQuestionData();
      
      // 3. 删除空表
      results.deleteEmptyResult = await this.deleteEmptyTables();
      
      // 4. 同步表信息
      results.syncResult = await this.syncTableInfo();
      
      return results;
    } catch (error) {
      console.error('清理和同步失败:', error);
      throw error;
    }
  }
}

module.exports = QuestionBankCleaner;
