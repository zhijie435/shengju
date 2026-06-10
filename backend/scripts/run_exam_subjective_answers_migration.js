/**
 * 创建 exam_subjective_answers 表（统一提交时主观题答案，按显示题号同步到 exam_answers 后主观题列表展示）
 * 用法：在项目根目录执行 node backend/scripts/run_exam_subjective_answers_migration.js
 * 或在 backend 目录执行 node scripts/run_exam_subjective_answers_migration.js（会读取同目录 .env）
 */
const path = require('path');
const fs = require('fs');
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
} catch (_) {}

const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || process.env.DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT, 10) || 3306
};

async function run() {
  let conn;
  try {
    conn = await mysql.createConnection({ ...DB_CONFIG, multipleStatements: true });
    const sqlPath = path.join(__dirname, '../database/migrate_exam_subjective_answers.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await conn.query(sql);
    console.log('exam_subjective_answers 表迁移完成');
  } catch (e) {
    console.error('迁移失败:', e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

run();
