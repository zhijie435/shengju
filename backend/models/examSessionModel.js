const { pool } = require('../config/database');

class ExamSessionModel {
  static async create(data) {
    const { examId, userId, enrollmentId } = data;
    const [result] = await pool.execute(
      `INSERT INTO exam_sessions (exam_id, user_id, enrollment_id, status) VALUES (?, ?, ?, 'pending')`,
      [examId, userId, enrollmentId || null]
    );
    return result.insertId;
  }

  // 阶段二优化：INSERT IGNORE + SELECT（防竞态，3次→2次 DB 往返）
  static async findOrCreate(examId, userId, enrollmentId) {
    await pool.execute(
      `INSERT IGNORE INTO exam_sessions (exam_id, user_id, enrollment_id, status) VALUES (?, ?, ?, 'pending')`,
      [examId, userId, enrollmentId || null]
    );
    const [rows] = await pool.execute('SELECT * FROM exam_sessions WHERE exam_id = ? AND user_id = ?', [examId, userId]);
    return rows[0] || null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT s.*, u.username, u.real_name, e.name as exam_name
       FROM exam_sessions s
       LEFT JOIN qms_users u ON s.user_id = u.id
       JOIN exams e ON s.exam_id = e.id
       WHERE s.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * 企业端本场会话列表：只返回「当前仍在报名名单内」的会话。
   * 避免名单已删/调整或历史脏数据导致 exam_sessions 残留行，在监控里多出「第 N+1 人」。
   */
  static async listByExam(examId) {
    const [rows] = await pool.execute(
      `SELECT s.*, u.username, u.real_name, u.email, en.draw_number
       FROM exam_sessions s
       INNER JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
       LEFT JOIN qms_users u ON s.user_id = u.id
       WHERE s.exam_id = ? ORDER BY COALESCE(en.draw_number, 9999) ASC, s.started_at DESC, s.created_at DESC`,
      [examId]
    );
    return rows;
  }

  static async start(id) {
    await pool.execute(
      `UPDATE exam_sessions SET status = 'ongoing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  }

  static async submit(id, status = 'submitted') {
    await pool.execute(
      `UPDATE exam_sessions SET status = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
  }

  static async incrementViolation(id) {
    const [r] = await pool.execute('UPDATE exam_sessions SET violation_count = violation_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    const [rows] = await pool.execute('SELECT violation_count FROM exam_sessions WHERE id = ?', [id]);
    return rows[0]?.violation_count ?? 0;
  }

  /** 考生进入考场（顺序入场时记录，用于考官端「开始答题」仅在有考生进入后可用） */
  static async enterRoom(id) {
    try {
      await pool.execute(
        `UPDATE exam_sessions SET room_entered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );
      return true;
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && (e.message || '').includes('room_entered_at')) return false;
      throw e;
    }
  }

  /** 提前录制：进入面试统一候考室（监考端展示） */
  static async enterInterviewWaitingRoom(id) {
    try {
      await pool.execute(
        `UPDATE exam_sessions SET interview_waiting_room_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );
      return true;
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && (e.message || '').includes('interview_waiting_room_at')) return false;
      throw e;
    }
  }

  /** 提前录制：录像上传状态 */
  static async setPrerecordVideoStatus(id, status) {
    const s = String(status || '').trim().slice(0, 32);
    if (!s) return false;
    try {
      await pool.execute(
        `UPDATE exam_sessions SET interview_prerecord_video_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [s, id]
      );
      return true;
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && (e.message || '').includes('interview_prerecord_video_status')) return false;
      throw e;
    }
  }

  /** 签到；若 faceVerified 为 true 则同时写入 face_verified_at */
  static async checkIn(id, { faceVerified = false } = {}) {
    const now = new Date();
    try {
      if (faceVerified) {
        await pool.execute(
          `UPDATE exam_sessions SET check_in_at = ?, face_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [now, now, id]
        );
      } else {
        await pool.execute(
          `UPDATE exam_sessions SET check_in_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [now, id]
        );
      }
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && (e.message || '').includes('check_in_at')) {
        await pool.execute(`UPDATE exam_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      }
      throw e;
    }
  }
}

module.exports = ExamSessionModel;
