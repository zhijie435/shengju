const { pool } = require('../config/database');
const ExamEnrollmentModel = require('./examEnrollmentModel');

class ExamMonitorEventModel {
  static async create(sessionId, eventType, metadata = {}) {
    const meta = JSON.stringify(metadata);
    const [result] = await pool.execute(
      'INSERT INTO exam_monitor_events (session_id, event_type, metadata) VALUES (?, ?, ?)',
      [sessionId, eventType, meta]
    );
    return result.insertId;
  }

  static async listBySession(sessionId) {
    const [rows] = await pool.execute(
      'SELECT * FROM exam_monitor_events WHERE session_id = ? ORDER BY occurred_at DESC',
      [sessionId]
    );
    return rows.map(r => {
      if (r.metadata) {
        try { r.metadata = JSON.parse(r.metadata); } catch (e) {}
      }
      return r;
    });
  }

  static async listByExam(examId) {
    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    const [rows] = await pool.execute(
      `SELECT e.*, s.user_id, ${userSelectSql}
       FROM exam_monitor_events e
       JOIN exam_sessions s ON e.session_id = s.id
       JOIN ${joinTableSql} u ON s.user_id = u.id
       WHERE s.exam_id = ? ORDER BY e.occurred_at DESC LIMIT 500`,
      [examId]
    );
    return rows;
  }
}

module.exports = ExamMonitorEventModel;
