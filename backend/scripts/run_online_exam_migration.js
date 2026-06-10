/**
 * 线上笔试系统数据库迁移（分步执行，单步失败不阻断后续）
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs').promises;

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT) || 3306,
  multipleStatements: true
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
    const basePath = path.join(__dirname, '../database');

    console.log('Running online exam migration...');

    await runSql(connection, "ALTER TABLE users MODIFY COLUMN role VARCHAR(20) DEFAULT 'user'", 'users.role');
    await runSql(connection, "ALTER TABLE users ADD COLUMN phone VARCHAR(20) COMMENT '手机号' AFTER email", 'users.phone');
    await runSql(connection, "ALTER TABLE users ADD COLUMN id_card VARCHAR(20) COMMENT '身份证号' AFTER phone", 'users.id_card');
    await runSql(connection, "ALTER TABLE users ADD COLUMN exam_number VARCHAR(50) COMMENT '准考证号' AFTER id_card", 'users.exam_number');
    await runSql(connection, "ALTER TABLE users ADD COLUMN position VARCHAR(100) COMMENT '岗位' AFTER exam_number", 'users.position');
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS enterprises (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        contact_name VARCHAR(100), contact_phone VARCHAR(50), contact_email VARCHAR(100), address VARCHAR(500),
        user_id INT, status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id), INDEX idx_status (status)
      )
    `, 'enterprises');
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS exams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        enterprise_id INT NOT NULL, paper_id INT NOT NULL, name VARCHAR(255) NOT NULL,
        description TEXT, start_time DATETIME NOT NULL, end_time DATETIME NOT NULL,
        duration_minutes INT DEFAULT 90, monitor_config JSON, status VARCHAR(20) DEFAULT 'draft',
        created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_enterprise_id (enterprise_id), INDEX idx_paper_id (paper_id), INDEX idx_status (status)
      )
    `, 'exams');
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS exam_enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY, exam_id INT NOT NULL, user_id INT NOT NULL,
        invite_code VARCHAR(50), status VARCHAR(20) DEFAULT 'invited',
        draw_number INT NULL COMMENT '抽签号',
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, confirmed_at TIMESTAMP NULL,
        UNIQUE KEY uk_exam_user (exam_id, user_id), INDEX idx_exam_id (exam_id)
      )
    `, 'exam_enrollments');
    await runSql(connection,
      "ALTER TABLE exam_enrollments ADD COLUMN draw_number INT NULL COMMENT '抽签号' AFTER status",
      'exam_enrollments.draw_number'
    );
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS exam_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY, exam_id INT NOT NULL, user_id INT NOT NULL, enrollment_id INT,
        status VARCHAR(20) DEFAULT 'pending', started_at TIMESTAMP NULL, submitted_at TIMESTAMP NULL,
        violation_count INT DEFAULT 0, total_score DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_exam_user_session (exam_id, user_id), INDEX idx_exam_id (exam_id)
      )
    `, 'exam_sessions');
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS exam_answers (
        id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NOT NULL, sub_question_id INT, question_number VARCHAR(50),
        answer_text TEXT, answer_data JSON, score DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_session_id (session_id)
      )
    `, 'exam_answers');
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS exam_monitor_events (
        id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NOT NULL, event_type VARCHAR(50), metadata JSON,
        occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_session_id (session_id)
      )
    `, 'exam_monitor_events');
    await runSql(connection, `
      CREATE TABLE IF NOT EXISTS exam_video_chunks (
        id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NOT NULL, chunk_type VARCHAR(20), file_path VARCHAR(500),
        file_size INT DEFAULT 0, duration_seconds DECIMAL(10,2) DEFAULT 0, start_time TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_session_id (session_id)
      )
    `, 'exam_video_chunks');
    await runSql(connection, `
      ALTER TABLE exams ADD COLUMN answer_system_config JSON
      COMMENT '答题系统配置' AFTER monitor_config
    `, 'exams.answer_system_config');
    await runSql(connection, `
      ALTER TABLE exam_video_chunks
      MODIFY COLUMN chunk_type ENUM('camera', 'screen', 'side_camera') NOT NULL
      COMMENT '类型：camera-正面摄像头，screen-屏幕共享，side_camera-侧面摄像头(手机)'
    `, 'exam_video_chunks.chunk_type side_camera');

    await runSql(
      connection,
      "ALTER TABLE exams ADD COLUMN public_room_code VARCHAR(24) NULL COMMENT '单场公共考场码（全员相同）' AFTER status",
      'exams.public_room_code'
    );
    await runSql(
      connection,
      'ALTER TABLE exams ADD UNIQUE INDEX uk_exams_public_room_code (public_room_code)',
      'uk_exams_public_room_code'
    );
    const crypto = require('crypto');
    const [examRows] = await connection.query(
      'SELECT id FROM exams WHERE public_room_code IS NULL OR public_room_code = ?',
      ['']
    );
    for (const row of examRows || []) {
      let updated = false;
      for (let i = 0; i < 40 && !updated; i++) {
        const code = `sj${crypto.randomBytes(5).toString('hex')}`;
        try {
          await connection.query('UPDATE exams SET public_room_code = ? WHERE id = ?', [code, row.id]);
          updated = true;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }

    console.log('Migration done.');
  } catch (error) {
    console.error('Migration error:', error.message);
    process.exitCode = 1;
    throw error;
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  runMigration().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
module.exports = runMigration;
