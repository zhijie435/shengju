const { pool } = require('../config/database');

class ExamEvaluationReportModel {
  /**
   * 创建评估报告记录
   */
  static async create(data) {
    const {
      sessionId,
      examId,
      userId,
      reportContent,
      reportHtml,
      generationStatus = 'pending'
    } = data;

    const [result] = await pool.execute(
      `INSERT INTO exam_evaluation_reports (
        session_id, exam_id, user_id, report_content, report_html, generation_status
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        examId,
        userId,
        reportContent || null,
        reportHtml || null,
        generationStatus
      ]
    );
    return result.insertId;
  }

  /**
   * 更新评估报告
   */
  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = [
      'report_content', 'report_html', 'generation_status', 'generated_at', 'error_message'
    ];

    for (const key of allowed) {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      let val = data[key] ?? data[camelKey];
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) return false;
    values.push(id);
    await pool.execute(
      `UPDATE exam_evaluation_reports SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return true;
  }

  /**
   * 根据会话ID查找评估报告
   */
  static async findBySessionId(sessionId) {
    const [rows] = await pool.execute(
      `SELECT r.*, u.username, u.real_name, e.name as exam_name
       FROM exam_evaluation_reports r
       JOIN users u ON r.user_id = u.id
       JOIN exams e ON r.exam_id = e.id
       WHERE r.session_id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }

  /**
   * 根据考试ID查找所有评估报告
   */
  static async findByExamId(examId, options = {}) {
    const { page, pageSize, status } = options;
    let sql = `SELECT r.*, u.username, u.real_name, u.email
       FROM exam_evaluation_reports r
       JOIN users u ON r.user_id = u.id
       WHERE r.exam_id = ?`;

    const params = [examId];

    if (status) {
      sql += ' AND r.generation_status = ?';
      params.push(status);
    }

    sql += ' ORDER BY r.generated_at DESC, r.created_at DESC';

    if (page && pageSize) {
      const limit = Math.max(1, parseInt(pageSize, 10) || 20);
      const offset = Math.max(0, ((parseInt(page, 10) || 1) - 1) * limit);
      sql += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  /**
   * 根据ID查找评估报告
   */
  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT r.*, u.username, u.real_name, e.name as exam_name
       FROM exam_evaluation_reports r
       JOIN users u ON r.user_id = u.id
       JOIN exams e ON r.exam_id = e.id
       WHERE r.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * 更新生成状态
   */
  static async updateStatus(sessionId, status, errorMessage = null) {
    const fields = ['generation_status = ?'];
    const values = [status];

    if (status === 'completed') {
      fields.push('generated_at = CURRENT_TIMESTAMP');
    }

    if (errorMessage !== null) {
      fields.push('error_message = ?');
      values.push(errorMessage);
    }

    values.push(sessionId);
    await pool.execute(
      `UPDATE exam_evaluation_reports SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`,
      values
    );
  }

  /**
   * 删除评估报告
   */
  static async delete(id) {
    await pool.execute('DELETE FROM exam_evaluation_reports WHERE id = ?', [id]);
  }

  /**
   * 删除会话的评估报告
   */
  static async deleteBySessionId(sessionId) {
    await pool.execute('DELETE FROM exam_evaluation_reports WHERE session_id = ?', [sessionId]);
  }
}

module.exports = ExamEvaluationReportModel;
