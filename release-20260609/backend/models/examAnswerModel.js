const { pool } = require('../config/database');

/** 缓存：exam_answers 是否已有 slot_submitted 列（未跑迁移的环境避免 SELECT/INSERT 500） */
let slotSubmittedColCache = null;

async function hasSlotSubmittedColumn() {
  if (slotSubmittedColCache !== null) return slotSubmittedColCache;
  try {
    const [rows] = await pool.execute(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answers' AND COLUMN_NAME = 'slot_submitted'
       LIMIT 1`
    );
    slotSubmittedColCache = !!(rows && rows.length);
  } catch {
    slotSubmittedColCache = false;
  }
  return slotSubmittedColCache;
}

class ExamAnswerModel {
  // P0 优化：INSERT ... ON DUPLICATE KEY UPDATE（取代 SELECT→UPDATE/INSERT），依赖 uk_session_subq 唯一索引
  static async upsert(sessionId, subQuestionId, questionNumber, answerText, answerData, slotSubmitted = false) {
    const hasSlot = await hasSlotSubmittedColumn();
    const ad = answerData ? JSON.stringify(answerData) : null;
    const hasSubId = subQuestionId != null && subQuestionId !== '';
    const slotVal = slotSubmitted === true ? 1 : 0;

    // 优先使用 INSERT ON DUPLICATE KEY UPDATE（一次 DB 往返），回退到旧逻辑
    try {
      if (hasSubId) {
        const [result] = await pool.execute(
          hasSlot
            ? `INSERT INTO exam_answers (session_id, sub_question_id, question_number, answer_text, answer_data, slot_submitted)
               VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE answer_text = VALUES(answer_text), answer_data = VALUES(answer_data),
               slot_submitted = VALUES(slot_submitted), updated_at = CURRENT_TIMESTAMP`
            : `INSERT INTO exam_answers (session_id, sub_question_id, question_number, answer_text, answer_data)
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE answer_text = VALUES(answer_text), answer_data = VALUES(answer_data),
               updated_at = CURRENT_TIMESTAMP`,
          hasSlot
            ? [sessionId, subQuestionId, questionNumber || null, answerText || null, ad, slotVal]
            : [sessionId, subQuestionId, questionNumber || null, answerText || null, ad]
        );
        return result.insertId;
      }
    } catch (e) {
      // uk_session_subq 不存在或冲突时回退到旧逻辑（SELECT + UPDATE/INSERT）
      if (e.code !== 'ER_DUP_ENTRY' && e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    // 回退：旧逻辑（无 uk_session_subq 索引时的兼容路径）
    const selectCols = hasSlot ? 'id, slot_submitted' : 'id';
    const [existing] = await pool.execute(
      hasSubId
        ? `SELECT ${selectCols} FROM exam_answers WHERE session_id = ? AND sub_question_id = ?`
        : `SELECT ${selectCols} FROM exam_answers WHERE session_id = ? AND sub_question_id IS NULL AND question_number = ?`,
      hasSubId ? [sessionId, subQuestionId] : [sessionId, questionNumber || '']
    );
    if (existing[0]) {
      const setSlot = hasSlot && slotSubmitted === true ? ', slot_submitted = 1' : '';
      await pool.execute(
        `UPDATE exam_answers SET answer_text = ?, answer_data = ?, updated_at = CURRENT_TIMESTAMP${setSlot} WHERE id = ?`,
        [answerText || null, ad, existing[0].id]
      );
      return existing[0].id;
    }
    if (hasSlot) {
      const [result] = await pool.execute(
        `INSERT INTO exam_answers (session_id, sub_question_id, question_number, answer_text, answer_data, slot_submitted)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, subQuestionId || null, questionNumber || null, answerText || null, ad, slotVal]
      );
      return result.insertId;
    }
    const [result] = await pool.execute(
      `INSERT INTO exam_answers (session_id, sub_question_id, question_number, answer_text, answer_data)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, subQuestionId || null, questionNumber || null, answerText || null, ad]
    );
    return result.insertId;
  }

  static async getBySession(sessionId) {
    const [rows] = await pool.execute(
      'SELECT * FROM exam_answers WHERE session_id = ? ORDER BY id',
      [sessionId]
    );
    return rows.map((r) => {
      if (r.answer_data) {
        try {
          r.answer_data = JSON.parse(r.answer_data);
        } catch (e) {
          /* keep string */
        }
      }
      return r;
    });
  }
}

module.exports = ExamAnswerModel;
