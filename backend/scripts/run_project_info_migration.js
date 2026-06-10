/**
 * exam_papers 表添加 project_info 字段迁移（指导语、结束语、评分要素等）
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT) || 3306
};

const COLUMN_NAME = 'project_info';

async function runMigration() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('数据库:', DB_CONFIG.database, '主机:', DB_CONFIG.host);
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exam_papers' AND COLUMN_NAME = ?",
      [DB_CONFIG.database, COLUMN_NAME]
    );
    if (cols && cols.length > 0) {
      console.log('exam_papers.project_info 列已存在，无需添加。');
    } else {
      await conn.query(`
        ALTER TABLE exam_papers
        ADD COLUMN project_info JSON DEFAULT NULL
        COMMENT '考试项目设置：指导语、结束语、评分要素、考官题本等'
      `);
      console.log('已成功添加 exam_papers.project_info 列。');
    }
    const [verify] = await conn.query("SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exam_papers' AND COLUMN_NAME = 'project_info'", [DB_CONFIG.database]);
    if (verify && verify.length > 0) {
      console.log('验证: project_info 列存在，类型:', verify[0].DATA_TYPE);
    } else {
      console.warn('验证: 未找到 project_info 列，请检查数据库。');
    }
    console.log('迁移执行完成。');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || (e.message && e.message.indexOf('Duplicate column') !== -1)) {
      console.log('exam_papers.project_info 列已存在（ALTER 报重复），视为成功。');
    } else {
      console.error('迁移失败:', e.message);
      process.exitCode = 1;
    }
  } finally {
    if (conn) await conn.end();
  }
}

runMigration();
