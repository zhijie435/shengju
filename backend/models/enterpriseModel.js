const { pool } = require('../config/database');
const { tableExists, sqlIdent, getEnterpriseColumnMap } = require('../utils/enterpriseSchema');

class EnterpriseModel {
  static async create(data) {
    const { name, contactName, contactPhone, contactEmail, address, userId, talentCompanyId } = data;
    const [result] = await pool.execute(
      `INSERT INTO enterprises (name, contact_name, contact_phone, contact_email, address, user_id, talent_company_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [name, contactName || null, contactPhone || null, contactEmail || null, address || null, userId || null, talentCompanyId != null ? talentCompanyId : null]
    );
    return result.insertId;
  }

  static async findById(id) {
    const [rows] = await pool.execute('SELECT * FROM enterprises WHERE id = ?', [id]);
    return rows[0] || null;
  }

  static async findByUserId(userId) {
    // 同一 user_id 多行时取最小 id，避免无 ORDER BY 抽到「空壳」新企业导致与合并后的主企业不一致
    const [rows] = await pool.execute(
      'SELECT * FROM enterprises WHERE user_id = ? ORDER BY id ASC LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  }

  /** 按人才网企业 ID 查找已绑定的笔试企业（同一 talent_company_id 全局仅应有一条） */
  static async findByTalentCompanyId(talentCompanyId) {
    const id = talentCompanyId != null ? parseInt(talentCompanyId, 10) : NaN;
    if (!id || !Number.isFinite(id) || id <= 0) return null;
    const [rows] = await pool.execute(
      'SELECT * FROM enterprises WHERE talent_company_id = ? ORDER BY id ASC LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  static async list(filters = {}) {
    const ec = await getEnterpriseColumnMap();
    let fromSql;
    if (await tableExists('qms_users')) {
      fromSql = 'enterprises e LEFT JOIN qms_users u ON e.user_id = u.id';
    } else if (await tableExists('users')) {
      fromSql = 'enterprises e LEFT JOIN users u ON e.user_id = u.id';
    } else {
      fromSql = 'enterprises e';
    }
    let sql =
      (fromSql.includes('JOIN')
        ? 'SELECT e.*, u.username FROM '
        : 'SELECT e.*, CAST(NULL AS CHAR) AS username FROM ') + fromSql + ' WHERE 1=1';
    const params = [];
    if (filters.status && ec.status) {
      sql += ` AND e.${sqlIdent(ec.status)} = ?`;
      params.push(filters.status);
    }
    if (filters.name && ec.name) {
      sql += ` AND e.${sqlIdent(ec.name)} LIKE ?`;
      params.push(`%${filters.name}%`);
    }
    const orderExpr = ec.created
      ? `e.${sqlIdent(ec.created)}`
      : ec.updated
        ? `e.${sqlIdent(ec.updated)}`
        : 'e.id';
    sql += ` ORDER BY ${orderExpr} DESC`;
    if (filters.page && filters.pageSize) {
      const limit = Math.max(1, parseInt(filters.pageSize, 10) || 20);
      const offset = Math.max(0, ((parseInt(filters.page, 10) || 1) - 1) * limit);
      sql += ` LIMIT ${limit} OFFSET ${offset}`;
    }
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['name', 'contact_name', 'contact_phone', 'contact_email', 'address', 'user_id', 'talent_company_id', 'status'];
    for (const key of allowed) {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const val = data[key] ?? data[camelKey];
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) return;
    values.push(id);
    await pool.execute(`UPDATE enterprises SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM enterprises WHERE id = ?', [id]);
  }

  /** 获取第一个已审核企业，若无则创建默认企业（供 admin 导入试卷时使用） */
  static async getFirstOrCreateDefault() {
    const [rows] = await pool.execute("SELECT id FROM enterprises WHERE status = 'approved' ORDER BY id LIMIT 1");
    if (rows[0]) return rows[0].id;
    const [r] = await pool.execute(
      "INSERT INTO enterprises (name, status) VALUES ('默认企业', 'approved')"
    );
    return r.insertId;
  }
}

module.exports = EnterpriseModel;
