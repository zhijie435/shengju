const { pool } = require('../config/database');
const ExamEnrollmentModel = require('./examEnrollmentModel');

class ExamVideoChunkModel {
  static async create(data) {
    const { sessionId, chunkType, filePath, fileSize = 0, durationSeconds = 0 } = data;
    const [result] = await pool.execute(
      `INSERT INTO exam_video_chunks (session_id, chunk_type, file_path, file_size, duration_seconds, start_time)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [sessionId, chunkType, filePath, fileSize, durationSeconds]
    );
    return result.insertId;
  }

  static async listBySession(sessionId) {
    const [rows] = await pool.execute(
      'SELECT * FROM exam_video_chunks WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );
    return rows;
  }

  /** 某会话各路监控最新一条（考生端预览侧摄等） */
  static async listLatestBySession(sessionId) {
    const [rows] = await pool.execute(
      'SELECT id, session_id, chunk_type, file_path, file_size, duration_seconds, created_at FROM exam_video_chunks WHERE session_id = ? ORDER BY created_at DESC',
      [sessionId]
    );
    const out = { camera: null, screen: null, side_camera: null };
    for (const row of rows) {
      const ct = String(row.chunk_type || '').toLowerCase().replace(/[^a-z_]/g, '');
      const typeKey = ct === 'side_camera' ? 'side_camera' : ct === 'screen' ? 'screen' : 'camera';
      if (out[typeKey] == null) {
        out[typeKey] = {
          id: row.id,
          file_path: row.file_path,
          created_at: row.created_at,
          chunk_type: row.chunk_type,
          duration_seconds: row.duration_seconds
        };
      }
    }
    return out;
  }

  /**
   * 按考试获取所有分片（用于监控存档导出）
   * 返回所有 chunk 记录，按 session、时间排序
   */
  static async listAllByExam(examId) {
    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    const [rows] = await pool.execute(
      `SELECT c.*, s.user_id, ${userSelectSql}
       FROM exam_video_chunks c
       JOIN exam_sessions s ON c.session_id = s.id
       JOIN ${joinTableSql} u ON s.user_id = u.id
       WHERE s.exam_id = ?
       ORDER BY s.id, c.chunk_type, c.created_at ASC`,
      [examId]
    );
    return rows;
  }

  /**
   * 按考试获取各会话每种类型的最新一条分片（阶段三优化：窗口函数替代全表拉取+JS排序）
   * MySQL 8+ ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)
   */
  static async listLatestByExam(examId) {
    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    const [rows] = await pool.execute(
      `SELECT c.*, s.user_id, ${userSelectSql}
       FROM (
         SELECT *,
           ROW_NUMBER() OVER (PARTITION BY session_id, chunk_type ORDER BY created_at DESC) AS rn
         FROM exam_video_chunks
         WHERE session_id IN (SELECT id FROM exam_sessions WHERE exam_id = ?)
       ) c
       JOIN exam_sessions s ON c.session_id = s.id
       JOIN ${joinTableSql} u ON s.user_id = u.id
       WHERE c.rn = 1
       ORDER BY c.session_id, c.chunk_type`,
      [examId]
    );
    const bySession = {};
    const types = ['camera', 'screen', 'side_camera'];
    for (const row of rows) {
      const sid = row.session_id;
      if (!bySession[sid]) {
        bySession[sid] = { session_id: sid, username: row.username, real_name: row.real_name };
        types.forEach(t => { bySession[sid][t] = null; });
      }
      const ct = (row.chunk_type || '').toLowerCase().replace(/[^a-z_]/g, '');
      const typeKey = ct === 'side_camera' ? 'side_camera' : ct === 'screen' ? 'screen' : 'camera';
      if (bySession[sid][typeKey] === null)
        bySession[sid][typeKey] = { id: row.id, file_path: row.file_path, created_at: row.created_at, chunk_type: row.chunk_type };
    }
    return Object.values(bySession);
  }
}

module.exports = ExamVideoChunkModel;
