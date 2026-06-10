/**
 * users 表添加学历、岗位代码字段（考生管理列表显示与企业端同步）
 * 依赖：先执行 run_users_candidate_migration.js（需有 position 列）
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

const columns = [
  { name: 'education', sql: "ALTER TABLE users ADD COLUMN education VARCHAR(100) COMMENT '学历'" },
  { name: 'job_code', sql: "ALTER TABLE users ADD COLUMN job_code VARCHAR(50) COMMENT '岗位代码'" }
];

async function runMigration() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [DB_CONFIG.database]
    );
    const existing = new Set(cols.map(r => r.COLUMN_NAME));
    for (const col of columns) {
      if (existing.has(col.name)) {
        console.log('  Skip:', col.name, '(already exists)');
        continue;
      }
      try {
        await conn.query(col.sql);
        console.log('  OK:', col.name);
      } catch (e) {
        console.warn('  Error:', col.name, e.message);
      }
    }
    console.log('Migration done.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

runMigration();
