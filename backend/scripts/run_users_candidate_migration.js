/**
 * users 表添加考生字段迁移
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
  { name: 'phone', sql: "ALTER TABLE users ADD COLUMN phone VARCHAR(20) COMMENT '手机号'" },
  { name: 'id_card', sql: "ALTER TABLE users ADD COLUMN id_card VARCHAR(20) COMMENT '身份证号'" },
  { name: 'exam_number', sql: "ALTER TABLE users ADD COLUMN exam_number VARCHAR(50) COMMENT '准考证号'" },
  { name: 'position', sql: "ALTER TABLE users ADD COLUMN position VARCHAR(100) COMMENT '岗位'" }
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
