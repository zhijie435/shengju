const { pool } = require('../config/database');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');

// 初始化表（如果不存在）
async function initializeTables() {
  try {
    // 检查表是否存在
    const [tables] = await pool.execute(
      "SHOW TABLES LIKE 'grading_accounts'"
    );
    
    if (tables.length === 0) {
      console.log('阅卷系统表不存在，开始创建...');
      const connection = await pool.getConnection();
      try {
        // 1. 扩展 users 表 role 字段（如果还没有grader角色）
        try {
          await connection.query(`
            ALTER TABLE users MODIFY COLUMN role VARCHAR(20) DEFAULT 'user' 
            COMMENT '角色：admin-总管理，enterprise-企业，candidate-考生，grader-阅卷员，user-普通用户'
          `);
        } catch (err) {
          // 如果字段已存在或修改失败，忽略
          if (!err.message.includes('Duplicate') && !err.message.includes('doesn\'t exist')) {
            console.warn('修改users表role字段失败:', err.message);
          }
        }

        // 2. 创建 grading_accounts 表
        await connection.query(`
          CREATE TABLE IF NOT EXISTS grading_accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
            password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
            real_name VARCHAR(100) COMMENT '真实姓名',
            email VARCHAR(100) COMMENT '邮箱',
            phone VARCHAR(50) COMMENT '手机号',
            status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态：active-启用，inactive-禁用',
            created_by INT COMMENT '创建者ID（总管理员或企业管理员）',
            enterprise_id INT COMMENT '所属企业ID（可选，用于企业端）',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP NULL COMMENT '最后登录时间',
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (enterprise_id) REFERENCES enterprises(id) ON DELETE SET NULL,
            INDEX idx_username (username),
            INDEX idx_status (status),
            INDEX idx_created_by (created_by),
            INDEX idx_enterprise_id (enterprise_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='子阅卷账号表'
        `);

        // 3. 创建 grading_tasks 表
        await connection.query(`
          CREATE TABLE IF NOT EXISTS grading_tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            exam_id INT NOT NULL COMMENT '考试ID',
            grading_account_id INT NOT NULL COMMENT '子阅卷账号ID',
            task_type ENUM('content', 'question_type') NOT NULL COMMENT '任务类型：content-按内容，question_type-按题型',
            task_config JSON NOT NULL COMMENT '任务配置（JSON格式，存储具体分配的内容或题型）',
            status ENUM('pending', 'assigned', 'in_progress', 'completed') DEFAULT 'pending' COMMENT '状态：pending-待分配，assigned-已分配，in_progress-进行中，completed-已完成',
            assigned_at TIMESTAMP NULL COMMENT '分配时间',
            completed_at TIMESTAMP NULL COMMENT '完成时间',
            created_by INT COMMENT '创建者ID',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
            FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_exam_id (exam_id),
            INDEX idx_grading_account_id (grading_account_id),
            INDEX idx_status (status),
            INDEX idx_created_by (created_by)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阅卷任务分配表'
        `);

        // 4. 创建 grading_records 表
        await connection.query(`
          CREATE TABLE IF NOT EXISTS grading_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            task_id INT NOT NULL COMMENT '任务ID',
            answer_id INT NOT NULL COMMENT '答案ID',
            grading_account_id INT NOT NULL COMMENT '阅卷账号ID',
            score DECIMAL(10,2) NOT NULL COMMENT '得分',
            grading_comment TEXT COMMENT '阅卷评语',
            graded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '阅卷时间',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES grading_tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (answer_id) REFERENCES exam_answers(id) ON DELETE CASCADE,
            FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id) ON DELETE CASCADE,
            INDEX idx_task_id (task_id),
            INDEX idx_answer_id (answer_id),
            INDEX idx_grading_account_id (grading_account_id),
            INDEX idx_graded_at (graded_at),
            UNIQUE KEY uk_task_answer (task_id, answer_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阅卷记录表'
        `);

        console.log('✓ 阅卷系统表创建成功');
      } catch (err) {
        console.error('执行迁移SQL失败:', err.message);
        if (err.stack) {
          console.error('错误堆栈:', err.stack);
        }
        throw err;
      } finally {
        connection.release();
      }
    }
  } catch (error) {
    console.error('初始化阅卷系统表失败:', error.message);
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
    // 不抛出错误，允许系统继续运行，但会在API调用时返回错误
  }
}

class GradingAccountModel {
  // 根据用户名查找账号
  static async findByUsername(username) {
    const sql = 'SELECT * FROM grading_accounts WHERE username = ?';
    const [rows] = await pool.execute(sql, [username]);
    return rows[0] || null;
  }

  // 根据ID查找账号
  static async findById(id) {
    const sql = 'SELECT * FROM grading_accounts WHERE id = ?';
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
  }

  // 检查表是否存在
  static async checkTableExists() {
    try {
      const [rows] = await pool.execute(
        "SHOW TABLES LIKE 'grading_accounts'"
      );
      return rows.length > 0;
    } catch (e) {
      return false;
    }
  }

  // 获取所有账号（支持分页和筛选）
  static async findAll(options = {}) {
    let tableExists = await this.checkTableExists();
    if (!tableExists) {
      await initializeTables().catch(() => {});
      tableExists = await this.checkTableExists();
    }
    if (!tableExists) {
      // 表仍不存在则返回空列表，避免 500
      return { list: [], total: 0 };
    }

    const { page = 1, pageSize = 20, status, enterpriseId, search } = options;
    const limit = Math.max(0, parseInt(pageSize, 10) || 20);
    const offset = Math.max(0, (parseInt(page, 10) - 1) || 0) * limit;

    let sql = 'SELECT ga.* FROM grading_accounts ga WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (enterpriseId) {
      // 兼容历史数据：除本企业账号外，也展示已被本企业考试任务引用的旧账号（可能 enterprise_id 为空）
      sql += ` AND (
        ga.enterprise_id = ?
        OR ga.id IN (
          SELECT DISTINCT gt.grading_account_id
          FROM grading_tasks gt
          JOIN exams e ON e.id = gt.exam_id
          WHERE e.enterprise_id = ?
        )
      )`;
      params.push(enterpriseId, enterpriseId);
    }

    if (search) {
      sql += ' AND (username LIKE ? OR real_name LIKE ? OR email LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    sql += ' ORDER BY created_at DESC';
    // LIMIT/OFFSET 用整数拼接，避免 mysql2 对占位符报错
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    let rows = [];
    let total = 0;
    try {
      // 使用 query 避免 execute 对 LIMIT/OFFSET 占位符的兼容性问题
      const [rowsResult] = await pool.query(sql, params);
      rows = Array.isArray(rowsResult) ? rowsResult : [];

      let countSql = 'SELECT COUNT(*) as total FROM grading_accounts ga WHERE 1=1';
      const countParams = [];
      if (status) {
        countSql += ' AND status = ?';
        countParams.push(status);
      }
      if (enterpriseId) {
        countSql += ` AND (
          ga.enterprise_id = ?
          OR ga.id IN (
            SELECT DISTINCT gt.grading_account_id
            FROM grading_tasks gt
            JOIN exams e ON e.id = gt.exam_id
            WHERE e.enterprise_id = ?
          )
        )`;
        countParams.push(enterpriseId, enterpriseId);
      }
      if (search) {
        countSql += ' AND (username LIKE ? OR real_name LIKE ? OR email LIKE ?)';
        const like = `%${search}%`;
        countParams.push(like, like, like);
      }
      const [countRows] = await pool.query(countSql, countParams);
      total = countRows && countRows[0] ? Number(countRows[0].total) || 0 : 0;
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || (err.message && err.message.includes("doesn't exist"))) {
        return { list: [], total: 0 };
      }
      throw err;
    }

    return { list: rows, total };
  }

  // 创建账号
  static async create(accountData) {
    const { username, password, real_name, email, phone, created_by, enterprise_id } = accountData;

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 4);

    const sql = `
      INSERT INTO grading_accounts (username, password_hash, real_name, email, phone, created_by, enterprise_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `;

    const params = (by) => [
      username,
      passwordHash,
      real_name || null,
      email || null,
      phone || null,
      by,
      enterprise_id || null
    ];

    try {
      const [result] = await pool.execute(sql, params(created_by || null));
      return result.insertId;
    } catch (e) {
      /** created_by 外键若指向 users，而登录账号仅在 qms_users 中会 1452；降级为 NULL 仍可创建子账号 */
      const fk =
        e.errno === 1452 ||
        e.code === 'ER_NO_REFERENCED_ROW_2' ||
        (e.message && /foreign key constraint|Cannot add or update a child row/i.test(e.message));
      if (fk && (created_by || null) != null) {
        const [result2] = await pool.execute(sql, params(null));
        return result2.insertId;
      }
      throw e;
    }
  }

  // 更新账号信息
  static async update(id, accountData) {
    const { real_name, email, phone, status } = accountData;
    const updates = [];
    const params = [];

    if (real_name !== undefined) {
      updates.push('real_name = ?');
      params.push(real_name);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return false;
    }

    params.push(id);
    const sql = `UPDATE grading_accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await pool.execute(sql, params);
    return true;
  }

  // 更新密码
  static async updatePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, 4);
    const sql = 'UPDATE grading_accounts SET password_hash = ?, updated_at = NOW() WHERE id = ?';
    await pool.execute(sql, [passwordHash, id]);
  }

  // 更新最后登录时间
  static async updateLastLogin(id) {
    const sql = 'UPDATE grading_accounts SET last_login_at = NOW() WHERE id = ?';
    await pool.execute(sql, [id]);
  }

  // 验证密码
  static async verifyPassword(password, passwordHash) {
    return await bcrypt.compare(password, passwordHash);
  }

  // 删除账号
  static async delete(id) {
    const sql = 'DELETE FROM grading_accounts WHERE id = ?';
    await pool.execute(sql, [id]);
  }
}

module.exports = GradingAccountModel;
module.exports.initializeTables = initializeTables;
