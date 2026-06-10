const { pool } = require('../config/database');
const ExamEnrollmentModel = require('./examEnrollmentModel');

function parseJsonField(val, defaultValue = {}) {
  if (val == null) return defaultValue;
  if (typeof val === 'object') return val;
  try {
    const parsed = JSON.parse(val);
    return parsed && typeof parsed === 'object' ? parsed : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

class ExamSummaryModel {
  static async resolveCandidateUserProjection() {
    const userTbl = await ExamEnrollmentModel.getCandidateUserTableName();
    const uSafe = String(userTbl).replace(/`/g, '');
    let uCols = new Set();
    try {
      const [colRows] = await pool.execute(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [uSafe]
      );
      uCols = new Set((colRows || []).map((r) => String(r.c || '').toLowerCase()));
    } catch (_) {
      uCols = new Set();
    }

    const usernameExpr = uCols.has('username')
      ? 'u.username'
      : uCols.has('login')
        ? 'u.login AS username'
        : uCols.has('login_name')
          ? 'u.login_name AS username'
          : uCols.has('phone')
            ? 'u.phone AS username'
            : 'CAST(u.id AS CHAR) AS username';
    const realNameExpr = uCols.has('real_name')
      ? 'u.real_name'
      : uCols.has('name')
        ? 'u.name AS real_name'
        : uCols.has('username')
          ? 'u.username AS real_name'
          : 'CAST(u.id AS CHAR) AS real_name';
    const emailExpr = uCols.has('email') ? 'u.email' : 'NULL AS email';
    return { uSafe, usernameExpr, realNameExpr, emailExpr };
  }

  /**
   * 创建汇总数据
   */
  static async create(data) {
    const {
      sessionId,
      examId,
      userId,
      totalScore,
      maxScore,
      scoreRate,
      answerTimeSeconds,
      submittedAt,
      objectiveScore,
      subjectiveScore,
      questionTypeStats,
      difficultyStats,
      examPurposeStats,
      correctCount,
      wrongCount,
      unansweredCount,
      knowledgePoints
    } = data;

    const [result] = await pool.execute(
      `INSERT INTO exam_summaries (
        session_id, exam_id, user_id, total_score, max_score, score_rate,
        answer_time_seconds, submitted_at, objective_score, subjective_score,
        question_type_stats, difficulty_stats, exam_purpose_stats,
        correct_count, wrong_count, unanswered_count, knowledge_points
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        examId,
        userId,
        totalScore || 0,
        maxScore || 0,
        scoreRate || 0,
        answerTimeSeconds || 0,
        submittedAt || null,
        objectiveScore || 0,
        subjectiveScore || 0,
        questionTypeStats ? JSON.stringify(questionTypeStats) : null,
        difficultyStats ? JSON.stringify(difficultyStats) : null,
        examPurposeStats ? JSON.stringify(examPurposeStats) : null,
        correctCount || 0,
        wrongCount || 0,
        unansweredCount || 0,
        knowledgePoints ? JSON.stringify(knowledgePoints) : null
      ]
    );
    return result.insertId;
  }

  /**
   * 更新汇总数据
   */
  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = [
      'total_score', 'max_score', 'score_rate', 'answer_time_seconds', 'submitted_at',
      'objective_score', 'subjective_score', 'question_type_stats', 'difficulty_stats',
      'exam_purpose_stats', 'correct_count', 'wrong_count', 'unanswered_count', 'knowledge_points'
    ];

    for (const key of allowed) {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      let val = data[key] ?? data[camelKey];
      if (val !== undefined) {
        if (key.includes('_stats') || key === 'knowledge_points') {
          val = typeof val === 'object' ? JSON.stringify(val) : val;
        }
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) return false;
    values.push(id);
    await pool.execute(
      `UPDATE exam_summaries SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return true;
  }

  /**
   * 根据会话ID查找汇总数据
   */
  static async findBySessionId(sessionId) {
    const { uSafe, usernameExpr, realNameExpr } = await this.resolveCandidateUserProjection();
    const [rows] = await pool.execute(
      `SELECT s.*, ${usernameExpr}, ${realNameExpr}, e.name as exam_name
       FROM exam_summaries s
       LEFT JOIN \`${uSafe}\` u ON s.user_id = u.id
       JOIN exams e ON s.exam_id = e.id
       WHERE s.session_id = ?`,
      [sessionId]
    );
    const row = rows[0];
    if (!row) return null;
    row.question_type_stats = parseJsonField(row.question_type_stats, {});
    row.difficulty_stats = parseJsonField(row.difficulty_stats, {});
    row.exam_purpose_stats = parseJsonField(row.exam_purpose_stats, {});
    row.knowledge_points = parseJsonField(row.knowledge_points, {});
    return row;
  }

  /**
   * 根据考试ID查找所有考生的汇总数据
   */
  static async findByExamId(examId, options = {}) {
    const { uSafe, usernameExpr, realNameExpr, emailExpr } = await this.resolveCandidateUserProjection();
    const { page, pageSize } = options;
    let sql = `SELECT s.*, ${usernameExpr}, ${realNameExpr}, ${emailExpr}
       FROM exam_summaries s
       LEFT JOIN \`${uSafe}\` u ON s.user_id = u.id
       WHERE s.exam_id = ?
       ORDER BY s.total_score DESC, s.submitted_at DESC`;

    const params = [examId];

    if (page && pageSize) {
      const limit = Math.max(1, parseInt(pageSize, 10) || 20);
      const offset = Math.max(0, ((parseInt(page, 10) || 1) - 1) * limit);
      sql += ` LIMIT ${limit} OFFSET ${offset}`;
    }

    const [rows] = await pool.execute(sql, params);
    rows.forEach(row => {
      row.question_type_stats = parseJsonField(row.question_type_stats, {});
      row.difficulty_stats = parseJsonField(row.difficulty_stats, {});
      row.exam_purpose_stats = parseJsonField(row.exam_purpose_stats, {});
      row.knowledge_points = parseJsonField(row.knowledge_points, {});
    });
    return rows;
  }

  /**
   * 根据考试ID统计汇总数据数量
   */
  static async countByExamId(examId) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as total FROM exam_summaries WHERE exam_id = ?',
      [examId]
    );
    return rows[0]?.total || 0;
  }

  /**
   * 阶段三优化：考试统计 SQL 聚合（数据库层面计算，不全量加载到 Node 内存）
   */
  static async getStatistics(examId, passScore = 60) {
    const [rows] = await pool.execute(
      `SELECT
        COUNT(*)                                           AS total_count,
        ROUND(AVG(total_score), 2)                         AS avg_score,
        MAX(total_score)                                   AS max_score,
        MIN(total_score)                                   AS min_score,
        COUNT(CASE WHEN total_score >= ? THEN 1 END)       AS pass_count,
        ROUND(AVG(COALESCE(answer_rate, 0)), 2)            AS avg_answer_rate,
        ROUND(AVG(TIMESTAMPDIFF(MINUTE, started_at, submitted_at)), 1) AS avg_duration_min
       FROM exam_summaries es
       WHERE es.exam_id = ?`,
      [passScore, examId]
    );
    return rows[0] || { total_count: 0, avg_score: 0, max_score: 0, min_score: 0, pass_count: 0 };
  }

  /**
   * 根据ID查找汇总数据
   */
  static async findById(id) {
    const { uSafe, usernameExpr, realNameExpr } = await this.resolveCandidateUserProjection();
    const [rows] = await pool.execute(
      `SELECT s.*, ${usernameExpr}, ${realNameExpr}, e.name as exam_name
       FROM exam_summaries s
       LEFT JOIN \`${uSafe}\` u ON s.user_id = u.id
       JOIN exams e ON s.exam_id = e.id
       WHERE s.id = ?`,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    row.question_type_stats = parseJsonField(row.question_type_stats, {});
    row.difficulty_stats = parseJsonField(row.difficulty_stats, {});
    row.exam_purpose_stats = parseJsonField(row.exam_purpose_stats, {});
    row.knowledge_points = parseJsonField(row.knowledge_points, {});
    return row;
  }

  /**
   * 删除汇总数据
   */
  static async delete(id) {
    await pool.execute('DELETE FROM exam_summaries WHERE id = ?', [id]);
  }

  /**
   * 删除会话的汇总数据
   */
  static async deleteBySessionId(sessionId) {
    await pool.execute('DELETE FROM exam_summaries WHERE session_id = ?', [sessionId]);
  }
}

module.exports = ExamSummaryModel;
