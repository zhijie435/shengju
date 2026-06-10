/**
 * 创建 exam_objective_answers 表（统一提交时客观题答案，按显示题号匹配阅卷）
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT, 10) || 3306
};

async function run() {
  let conn;
  try {
    conn = await mysql.createConnection({ ...DB_CONFIG, multipleStatements: true });
    const sqlPath = path.join(__dirname, '../database/migrate_exam_objective_answers.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await conn.query(sql);
    console.log('exam_objective_answers 表迁移完成');
  } catch (e) {
    console.error('迁移失败:', e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

run();
