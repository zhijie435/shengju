/**
 * 为 qms_users 补全考生/笔试所需列（准考证号、岗位代码、身份证等）
 * 生产环境若未执行过，会出现「考生管理里准考证/岗位一直空、诊断脚本报 Unknown column 'exam_number'」
 *
 * 用法：cd backend && node scripts/run_qms_users_exam_fields_migration.js
 * 使用 .env 中 MAIN_DB_NAME / DB 连接
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const DB = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'shengju',
  port: parseInt(process.env.DB_PORT, 10) || 3306
};

const TABLE = 'qms_users';

const COLUMNS = [
  { name: 'phone', sql: "ADD COLUMN phone VARCHAR(32) NULL COMMENT '手机'" },
  { name: 'id_card', sql: "ADD COLUMN id_card VARCHAR(32) NULL COMMENT '身份证'" },
  { name: 'exam_number', sql: "ADD COLUMN exam_number VARCHAR(64) NULL COMMENT '准考证号'" },
  { name: 'position', sql: "ADD COLUMN position VARCHAR(200) NULL COMMENT '岗位'" },
  { name: 'job_code', sql: "ADD COLUMN job_code VARCHAR(64) NULL COMMENT '岗位代码'" },
  { name: 'education', sql: "ADD COLUMN education VARCHAR(64) NULL COMMENT '学历'" },
  { name: 'id_card_image_path', sql: "ADD COLUMN id_card_image_path VARCHAR(1024) NULL COMMENT '身份证/人像图URL'" }
];

async function run() {
  let conn;
  try {
    conn = await mysql.createConnection(DB);
    const [rows] = await conn.query(
      'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [DB.database, TABLE]
    );
    const existing = new Set((rows || []).map((r) => String(r.c).toLowerCase()));
    for (const col of COLUMNS) {
      if (existing.has(col.name.toLowerCase())) {
        console.log('已有列:', col.name);
        continue;
      }
      try {
        await conn.query(`ALTER TABLE \`${TABLE}\` ${col.sql}`);
        console.log('已增加列:', col.name);
      } catch (e) {
        console.error('增加列失败', col.name, e.message);
      }
    }
    console.log('完成。请重启 Node 后再打开考生管理触发补全。');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

run();
