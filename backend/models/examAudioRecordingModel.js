const { pool } = require('../config/database');

/**
 * 面试音频录制模型
 * 用于保存考生在面试型考试中的语音回答文件信息
 */
class ExamAudioRecordingModel {
  /**
   * 确保表存在
   */
  static async initializeTable() {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS exam_audio_recordings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL COMMENT '考试会话ID',
        sub_question_id INT NULL COMMENT '对应的小题ID（exam_paper_sub_questions.id）',
        file_path VARCHAR(500) NOT NULL COMMENT '相对于backend根目录的文件路径',
        file_size BIGINT DEFAULT 0 COMMENT '文件大小（字节）',
        duration_seconds INT DEFAULT 0 COMMENT '录音时长（秒）',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_session_id (session_id),
        INDEX idx_sub_question_id (sub_question_id),
        CONSTRAINT fk_exam_audio_recordings_session
          FOREIGN KEY (session_id) REFERENCES exam_sessions(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='面试音频录制表'
    `);
  }

  static async create(data) {
    const {
      sessionId,
      subQuestionId = null,
      filePath,
      fileSize = 0,
      durationSeconds = 0
    } = data;

    await this.initializeTable();

    const [result] = await pool.execute(
      `INSERT INTO exam_audio_recordings
       (session_id, sub_question_id, file_path, file_size, duration_seconds)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, subQuestionId, filePath, fileSize, durationSeconds]
    );
    return result.insertId;
  }

  static async listBySession(sessionId) {
    await this.initializeTable();
    const [rows] = await pool.execute(
      `SELECT * FROM exam_audio_recordings
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC`,
      [sessionId]
    );
    return rows;
  }

  static async listByExamAndSubQuestion(examId, subQuestionId) {
    await this.initializeTable();
    const [rows] = await pool.execute(
      `SELECT r.*
       FROM exam_audio_recordings r
       JOIN exam_sessions s ON r.session_id = s.id
       WHERE s.exam_id = ? AND r.sub_question_id = ?
       ORDER BY r.created_at ASC, r.id ASC`,
      [examId, subQuestionId]
    );
    return rows;
  }
}

module.exports = ExamAudioRecordingModel;

