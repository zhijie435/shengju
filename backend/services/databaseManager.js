const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// 主数据库配置
const MAIN_DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT) || 3306,
  charset: 'utf8mb4'
};

// 用户数据库初始化SQL模板
const USER_DB_INIT_SQL = `
-- 创建用户数据库表结构

-- 大题表
CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_html LONGTEXT NOT NULL COMMENT 'HTML格式的完整内容',
    content_text TEXT COMMENT '纯文本内容',
    images_base64 LONGTEXT COMMENT 'Base64编码的图片（JSON格式数组）',
    project_name VARCHAR(255) COMMENT '项目名称',
    total_score INT DEFAULT 0 COMMENT '总分',
    exam_time INT DEFAULT 0 COMMENT '考试时长（分钟）',
    page_size VARCHAR(50) DEFAULT 'A4' COMMENT '页面大小',
    notes TEXT COMMENT '备注信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大题内容表';

-- 小题表
CREATE TABLE IF NOT EXISTS sub_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL COMMENT '关联的大题ID',
    number VARCHAR(50) NOT NULL COMMENT '题号（如：1, 2, 3）',
    sub_number VARCHAR(50) COMMENT '子题号（如：(1), (2) 或 1.1, 1.2）',
    content_html LONGTEXT NOT NULL COMMENT 'HTML格式的小题内容',
    content_text TEXT COMMENT '纯文本内容',
    score INT DEFAULT 0 COMMENT '分值',
    type ENUM('parent', 'child') DEFAULT 'child' COMMENT '类型：parent-大题，child-小题',
    full_content LONGTEXT COMMENT '完整内容（包含题号）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    INDEX idx_question_id (question_id),
    INDEX idx_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小题表';

-- 试卷表（如果存在）
CREATE TABLE IF NOT EXISTS exam_papers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_name VARCHAR(255) NOT NULL COMMENT '试卷名称',
    project_name VARCHAR(255) COMMENT '项目名称',
    total_score INT DEFAULT 0 COMMENT '总分',
    exam_time INT DEFAULT 0 COMMENT '考试时长（分钟）',
    page_size VARCHAR(50) DEFAULT 'A4' COMMENT '页面大小',
    content_html LONGTEXT COMMENT 'HTML格式的完整内容',
    notes TEXT COMMENT '备注信息',
    preview_html LONGTEXT COMMENT '预览HTML',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷表';
`;

class DatabaseManager {
  // 创建用户数据库
  static async createUserDatabase(userId) {
    const dbName = `user_${userId}_db`;
    
    try {
      // 创建数据库连接（不指定数据库）
      const connection = await mysql.createConnection(MAIN_DB_CONFIG);
      
      // 创建数据库
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      
      // 切换到新数据库
      await connection.query(`USE \`${dbName}\``);
      
      // 执行初始化SQL
      const statements = USER_DB_INIT_SQL.split(';').filter(s => s.trim());
      for (const statement of statements) {
        if (statement.trim()) {
          await connection.query(statement);
        }
      }
      
      await connection.end();
      
      // 在主数据库中记录用户数据库映射
      const { pool } = require('../config/database');
      await pool.execute(
        'INSERT INTO user_databases (user_id, database_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE database_name = ?',
        [userId, dbName, dbName]
      );
      
      return dbName;
    } catch (error) {
      console.error(`创建用户数据库失败 (userId: ${userId}):`, error);
      throw error;
    }
  }

  // 获取用户数据库名称
  static async getUserDatabaseName(userId) {
    const { pool } = require('../config/database');
    const [rows] = await pool.execute(
      'SELECT database_name FROM user_databases WHERE user_id = ?',
      [userId]
    );
    
    if (rows.length > 0) {
      return rows[0].database_name;
    }
    
    // 如果不存在，创建数据库
    return await this.createUserDatabase(userId);
  }

  // 获取用户数据库连接
  static async getUserDatabaseConnection(userId) {
    const dbName = await this.getUserDatabaseName(userId);
    
    return mysql.createConnection({
      ...MAIN_DB_CONFIG,
      database: dbName
    });
  }

  // 删除用户数据库
  static async deleteUserDatabase(userId) {
    const dbName = await this.getUserDatabaseName(userId);
    
    if (!dbName) {
      return;
    }
    
    try {
      const connection = await mysql.createConnection(MAIN_DB_CONFIG);
      await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await connection.end();
      
      // 删除映射记录
      const { pool } = require('../config/database');
      await pool.execute('DELETE FROM user_databases WHERE user_id = ?', [userId]);
    } catch (error) {
      console.error(`删除用户数据库失败 (userId: ${userId}):`, error);
      throw error;
    }
  }

  // 检查数据库是否存在
  static async databaseExists(dbName) {
    try {
      const connection = await mysql.createConnection(MAIN_DB_CONFIG);
      const [rows] = await connection.query(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [dbName]
      );
      await connection.end();
      return rows.length > 0;
    } catch (error) {
      console.error('检查数据库存在性失败:', error);
      return false;
    }
  }
}

module.exports = DatabaseManager;
