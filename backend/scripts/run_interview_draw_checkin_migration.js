/**
 * 面试子抽号与签到字段迁移：exam_enrollments.draw_number, exam_sessions.check_in_at, face_verified_at
 * 从 backend 目录加载 .env，在项目根或 backend 下执行均可。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT) || 3306
};

async function runSql(conn, sql, desc) {
  try {
    await conn.query(sql);
    if (desc) console.log('  OK:', desc);
    return true;
  } catch (e) {
    if (desc) console.warn('  Skip:', desc, '-', e.message);
    return false;
  }
}

async function runMigration() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Running interview draw & check-in migration...');

    await runSql(
      connection,
      "ALTER TABLE exam_enrollments ADD COLUMN draw_number INT NULL COMMENT '抽签号' AFTER status",
      'exam_enrollments.draw_number'
    );
    await runSql(
      connection,
      "ALTER TABLE exam_sessions ADD COLUMN check_in_at DATETIME NULL COMMENT '签到时间' AFTER submitted_at",
      'exam_sessions.check_in_at'
    );
    await runSql(
      connection,
      "ALTER TABLE exam_sessions ADD COLUMN face_verified_at DATETIME NULL COMMENT '刷脸核验通过时间' AFTER check_in_at",
      'exam_sessions.face_verified_at'
    );

    console.log('Done.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runMigration();
