const crypto = require('crypto');
const { pool } = require('../config/database');
const { formatDateTimeLocal } = require('../utils/dateTimeHelper');

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

class ExamModel {
  /** 为单场考试生成唯一公共考场码（列不存在时静默跳过） */
  static async ensurePublicRoomCode(examId) {
    const id = parseInt(examId, 10);
    if (!id || Number.isNaN(id)) return;
    let hasCol = false;
    try {
      const [c] = await pool.execute(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exams' AND COLUMN_NAME = 'public_room_code'`
      );
      hasCol = c[0] && Number(c[0].n) > 0;
    } catch (_) {
      return;
    }
    if (!hasCol) return;
    const [rows] = await pool.execute('SELECT id, public_room_code FROM exams WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) return;
    const existing = row.public_room_code != null ? String(row.public_room_code).trim() : '';
    if (existing) return;
    for (let i = 0; i < 40; i++) {
      const code = `sj${crypto.randomBytes(5).toString('hex')}`;
      try {
        await pool.execute('UPDATE exams SET public_room_code = ? WHERE id = ?', [code, id]);
        return;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') continue;
        throw e;
      }
    }
  }

  /**
   * 按公共考场码查考试（仅已发布/进行中）；列不存在时返回 null
   * @param {string} code
   */
  static async findByPublicRoomCode(code) {
    const raw = String(code || '').trim();
    if (!raw) return null;
    try {
      const [rows] = await pool.execute(
        `SELECT id FROM exams WHERE public_room_code = ? AND status IN ('published','ongoing') LIMIT 1`,
        [raw]
      );
      if (!rows[0]) return null;
      return await ExamModel.findById(rows[0].id);
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') return null;
      throw e;
    }
  }

  static async create(data) {
    const {
      enterpriseId, paperId, name, description, startTime, endTime, durationMinutes,
      monitorConfig, answerSystemConfig, interviewConfig, status = 'draft', createdBy
    } = data;
    const mc = monitorConfig ? JSON.stringify(monitorConfig) : null;
    const fullAscObj = answerSystemConfig && typeof answerSystemConfig === 'object'
      ? { ...answerSystemConfig }
      : (answerSystemConfig ? answerSystemConfig : null);
    if (interviewConfig && typeof fullAscObj === 'object') {
      fullAscObj.interviewConfig = interviewConfig;
    }
    const asc = fullAscObj ? JSON.stringify(fullAscObj) : null;
    try {
      const [result] = await pool.execute(
        `INSERT INTO exams (enterprise_id, paper_id, name, description, start_time, end_time, duration_minutes, monitor_config, answer_system_config, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [enterpriseId, paperId, name, description || null, startTime, endTime, durationMinutes || 90, mc, asc, status, createdBy || null]
      );
      return result.insertId;
    } catch (e) {
      if (/Unknown column 'answer_system_config'/.test(e.message || '')) {
        const [result] = await pool.execute(
          `INSERT INTO exams (enterprise_id, paper_id, name, description, start_time, end_time, duration_minutes, monitor_config, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [enterpriseId, paperId, name, description || null, startTime, endTime, durationMinutes || 90, mc, status, createdBy || null]
        );
        return result.insertId;
      }
      throw e;
    }
  }

  static async findById(id) {
    const sqlFull = `SELECT e.*,
              p.paper_name,
              p.preview_html,
              p.total_score as paper_total_score,
              p.exam_time as paper_exam_time,
              p.exam_type as exam_type
       FROM exams e LEFT JOIN exam_papers p ON e.paper_id = p.id WHERE e.id = ?`;
    const sqlFallback = `SELECT e.*,
              p.paper_name,
              p.preview_html,
              p.total_score as paper_total_score,
              p.exam_time as paper_exam_time
       FROM exams e LEFT JOIN exam_papers p ON e.paper_id = p.id WHERE e.id = ?`;
    let rows;
    try {
      [rows] = await pool.execute(sqlFull, [id]);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' && err.message && err.message.includes('exam_type')) {
        [rows] = await pool.execute(sqlFallback, [id]);
      } else {
        throw err;
      }
    }
    const row = rows[0];
    if (!row) return null;
    if (row.exam_type == null) row.exam_type = 'written';
    row.monitor_config = parseJsonField(row.monitor_config, {});
    row.answer_system_config = parseJsonField(row.answer_system_config, {});
    row.start_time = formatDateTimeLocal(row.start_time);
    row.end_time = formatDateTimeLocal(row.end_time);
    return row;
  }

  static async list(filters = {}) {
    const selectWithExamType = `SELECT e.*,
                        p.paper_name,
                        p.exam_type as exam_type,
                        ent.name as enterprise_name
         FROM exams e
         LEFT JOIN exam_papers p ON e.paper_id = p.id
         LEFT JOIN enterprises ent ON e.enterprise_id = ent.id
         WHERE 1=1`;
    const selectWithoutExamType = `SELECT e.*,
                        p.paper_name,
                        ent.name as enterprise_name
         FROM exams e
         LEFT JOIN exam_papers p ON e.paper_id = p.id
         LEFT JOIN enterprises ent ON e.enterprise_id = ent.id
         WHERE 1=1`;
    const params = [];
    const entIds =
      filters.enterpriseIds && Array.isArray(filters.enterpriseIds) && filters.enterpriseIds.length
        ? [...new Set(filters.enterpriseIds.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0))]
        : [];
    if (entIds.length > 1) {
      const ph = entIds.map(() => '?').join(',');
      entIds.forEach((id) => params.push(id));
      if (filters.status) params.push(filters.status);
      if (filters.name) params.push(`%${filters.name}%`);
      let suffix = ` AND e.enterprise_id IN (${ph})`;
      if (filters.status) suffix += ' AND e.status = ?';
      if (filters.name) suffix += ' AND e.name LIKE ?';
      suffix += ' ORDER BY e.start_time DESC';
      if (filters.page && filters.pageSize) {
        const limit = Math.max(1, parseInt(filters.pageSize, 10) || 20);
        const offset = Math.max(0, ((parseInt(filters.page, 10) || 1) - 1) * limit);
        suffix += ` LIMIT ${limit} OFFSET ${offset}`;
      }
      try {
        let sql = selectWithExamType + suffix;
        const [rows] = await pool.execute(sql, params);
        rows.forEach((r) => {
          if (r.exam_type == null) r.exam_type = 'written';
          r.monitor_config = parseJsonField(r.monitor_config, {});
          r.answer_system_config = parseJsonField(r.answer_system_config, {});
          r.start_time = formatDateTimeLocal(r.start_time);
          r.end_time = formatDateTimeLocal(r.end_time);
        });
        return rows;
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || msg.includes("doesn't exist") || msg.includes('不存在')) {
          return [];
        }
        if (e.code === 'ER_BAD_FIELD_ERROR' && e.message && e.message.includes('exam_type')) {
          const sql = selectWithoutExamType + suffix;
          const [rows] = await pool.execute(sql, params);
          rows.forEach((r) => {
            r.exam_type = 'written';
            r.monitor_config = parseJsonField(r.monitor_config, {});
            r.answer_system_config = parseJsonField(r.answer_system_config, {});
            r.start_time = formatDateTimeLocal(r.start_time);
            r.end_time = formatDateTimeLocal(r.end_time);
          });
          return rows;
        }
        console.error('ExamModel.list failed:', e.message || e);
        return [];
      }
    }
    if (filters.enterpriseId) params.push(filters.enterpriseId);
    if (filters.status) params.push(filters.status);
    if (filters.name) params.push(`%${filters.name}%`);
    let suffix = '';
    if (filters.enterpriseId) suffix += ' AND e.enterprise_id = ?';
    if (filters.status) suffix += ' AND e.status = ?';
    if (filters.name) suffix += ' AND e.name LIKE ?';
    suffix += ' ORDER BY e.start_time DESC';
    if (filters.page && filters.pageSize) {
      const limit = Math.max(1, parseInt(filters.pageSize, 10) || 20);
      const offset = Math.max(0, ((parseInt(filters.page, 10) || 1) - 1) * limit);
      suffix += ` LIMIT ${limit} OFFSET ${offset}`;
    }
    try {
      let sql = selectWithExamType + suffix;
      const [rows] = await pool.execute(sql, params);
      rows.forEach(r => {
        if (r.exam_type == null) r.exam_type = 'written';
        r.monitor_config = parseJsonField(r.monitor_config, {});
        r.answer_system_config = parseJsonField(r.answer_system_config, {});
        r.start_time = formatDateTimeLocal(r.start_time);
        r.end_time = formatDateTimeLocal(r.end_time);
      });
      return rows;
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || msg.includes("doesn't exist") || msg.includes('不存在')) {
        return [];
      }
      if (e.code === 'ER_BAD_FIELD_ERROR' && e.message && e.message.includes('exam_type')) {
        const sql = selectWithoutExamType + suffix;
        const [rows] = await pool.execute(sql, params);
        rows.forEach(r => {
          r.exam_type = 'written';
          r.monitor_config = parseJsonField(r.monitor_config, {});
          r.answer_system_config = parseJsonField(r.answer_system_config, {});
          r.start_time = formatDateTimeLocal(r.start_time);
          r.end_time = formatDateTimeLocal(r.end_time);
        });
        return rows;
      }
      console.error('ExamModel.list failed:', e.message || e);
      return [];
    }
  }

  static async count(filters = {}) {
    try {
      let sql = 'SELECT COUNT(*) as total FROM exams WHERE 1=1';
      const params = [];
      const entIds =
        filters.enterpriseIds && Array.isArray(filters.enterpriseIds) && filters.enterpriseIds.length
          ? [...new Set(filters.enterpriseIds.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0))]
          : [];
      if (entIds.length > 1) {
        const ph = entIds.map(() => '?').join(',');
        sql += ` AND enterprise_id IN (${ph})`;
        params.push(...entIds);
      } else if (filters.enterpriseId) {
        sql += ' AND enterprise_id = ?';
        params.push(filters.enterpriseId);
      }
      if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
      if (filters.name) { sql += ' AND name LIKE ?'; params.push(`%${filters.name}%`); }
      const [rows] = await pool.execute(sql, params);
      const r = rows[0];
      return (r && (r.total ?? r.TOTAL ?? Object.values(r)[0])) || 0;
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || msg.includes("doesn't exist") || msg.includes('不存在')) {
        return 0;
      }
      console.error('ExamModel.count failed:', e.message || e);
      return 0;
    }
  }

  static toMySQLDatetime(val) {
    if (val == null) return val;
    const s = String(val).trim();
    if (s.includes('T')) {
      try {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          return d.toISOString().slice(0, 19).replace('T', ' ');
        }
      } catch (_) {}
    }
    return val;
  }

  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['name', 'description', 'paper_id', 'start_time', 'end_time', 'duration_minutes', 'monitor_config', 'answer_system_config', 'status'];
    for (const key of allowed) {
      let val = data[key] ?? data[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase() + c.slice(1))];
      if (val !== undefined) {
        if (key === 'start_time' || key === 'end_time') val = ExamModel.toMySQLDatetime(val);
        if (key === 'paper_id') val = val == null || val === '' ? null : parseInt(val, 10);
        fields.push(`${key} = ?`);
        values.push(typeof val === 'object' && (key === 'monitor_config' || key === 'answer_system_config') ? JSON.stringify(val) : val);
      }
    }
    if (fields.length === 0) return;
    values.push(id);
    const sql = `UPDATE exams SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    try {
      await pool.execute(sql, values);
    } catch (e) {
      if (/Unknown column 'updated_at'/.test(e.message || '')) {
        const sqlFallback = `UPDATE exams SET ${fields.join(', ')} WHERE id = ?`;
        await pool.execute(sqlFallback, values);
      } else {
        throw e;
      }
    }
  }

  static async delete(id) {
    await pool.execute('DELETE FROM exams WHERE id = ?', [id]);
  }
}

module.exports = ExamModel;
