/**
 * users 表添加 id_card_image_path 字段迁移
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

const COLUMN_NAME = 'id_card_image_path';
const COLUMN_SQL = "ALTER TABLE users ADD COLUMN id_card_image_path VARCHAR(512) COMMENT '身份证照片存储路径（相对路径，用于人脸核验）' AFTER id_card";

async function runMigration() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [DB_CONFIG.database]
    );
    const existing = new Set(cols.map(r => r.COLUMN_NAME));
    if (existing.has(COLUMN_NAME)) {
      console.log('Skip:', COLUMN_NAME, '(already exists)');
    } else {
      await conn.query(COLUMN_SQL);
      console.log('OK:', COLUMN_NAME);
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
