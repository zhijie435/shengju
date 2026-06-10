/**
 * 面试提前录制/线上模式相关表与列迁移
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT, 10) || 3306
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
    console.log('Running interview prerecord/online migration...');

    await runSql(
      connection,
      `ALTER TABLE exams ADD COLUMN interview_prerecord_gate_open_at DATETIME NULL COMMENT '提前录制统一开放' AFTER interview_current_draw_number`,
      'exams.interview_prerecord_gate_open_at'
    );
    await runSql(
      connection,
      `ALTER TABLE exams ADD COLUMN interview_prerecord_confirm_pending TINYINT(1) NOT NULL DEFAULT 0 COMMENT '定时待确认' AFTER interview_prerecord_gate_open_at`,
      'exams.interview_prerecord_confirm_pending'
    );
    await runSql(
      connection,
      `ALTER TABLE exam_sessions ADD COLUMN interview_waiting_room_at DATETIME NULL COMMENT '候考室进入时间' AFTER submitted_at`,
      'exam_sessions.interview_waiting_room_at'
    );
    await runSql(
      connection,
      `ALTER TABLE exam_sessions ADD COLUMN interview_prerecord_video_status VARCHAR(32) NULL COMMENT '录像上传状态' AFTER interview_waiting_room_at`,
      'exam_sessions.interview_prerecord_video_status'
    );
    await runSql(
      connection,
      `CREATE TABLE IF NOT EXISTS interview_session_videos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        exam_id INT NOT NULL,
        session_id INT NOT NULL,
        kind VARCHAR(16) NOT NULL COMMENT 'front|side',
        file_path VARCHAR(512) NOT NULL,
        duration_seconds INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_interview_session_video (session_id, kind),
        KEY idx_exam_session (exam_id, session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      'interview_session_videos'
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
