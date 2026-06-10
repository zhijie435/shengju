/**
 * 在 question_management_shared 中创建 exam_papers 及相关表（若不存在）
 * 用法: node scripts/run_exam_papers_migration.js
 */
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const { getConnectionInfo, MAIN_DB_NAME } = require('../config/database');

async function run() {
  const info = getConnectionInfo();
  const db = MAIN_DB_NAME || info.database || 'question_management_shared';
  const connection = await mysql.createConnection({
    ...info,
    database: db,
    multipleStatements: true
  });

  try {
    console.log(`运行试卷表迁移到数据库: ${db} ...`);
    const sqlPath = path.join(__dirname, '../database/migrate_exam_papers_shared.sql');
    const sql = await fs.readFile(sqlPath, 'utf8');
    await connection.query(sql);
    console.log('✓ 试卷表迁移完成。exam_papers、exam_paper_major_questions、exam_paper_sub_questions 已就绪。');
  } catch (e) {
    console.error('✗ 迁移失败:', e.message);
    throw e;
  } finally {
    await connection.end();
  }
}

run().catch(() => process.exit(1));
