/**
 * 面试顺序入场与工作人员端迁移：exams.interview_current_draw_number, exam_sessions.score_confirmed_at/score_confirmed_by
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
    if (e.code === 'ER_DUP_FIELDNAME' && desc) {
      console.warn('  Skip (already exists):', desc);
      return true;
    }
    if (desc) console.warn('  Skip:', desc, '-', e.message);
    return false;
  }
}

async function runMigration() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Running interview sequential & staff migration...');

    await runSql(
      connection,
      "ALTER TABLE exams ADD COLUMN interview_current_draw_number INT NULL COMMENT '当前允许进入考场的抽签号（顺序入场）'",
      'exams.interview_current_draw_number'
    );
    await runSql(
      connection,
      "ALTER TABLE exam_sessions ADD COLUMN score_confirmed_at TIMESTAMP NULL COMMENT '成绩签字确认时间' AFTER total_score",
      'exam_sessions.score_confirmed_at'
    );
    await runSql(
      connection,
      "ALTER TABLE exam_sessions ADD COLUMN score_confirmed_by INT NULL COMMENT '确认人user_id' AFTER score_confirmed_at",
      'exam_sessions.score_confirmed_by'
    );
    await runSql(
      connection,
      "ALTER TABLE exam_sessions ADD COLUMN room_entered_at TIMESTAMP NULL COMMENT '考生进入考场时间（顺序入场时用于允许开始答题）' AFTER started_at",
      'exam_sessions.room_entered_at'
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
