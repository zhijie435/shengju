const { pool } = require('../config/database');
const crypto = require('crypto');
const { formatDateTimeLocal } = require('../utils/dateTimeHelper');
const { tableExists } = require('../utils/enterpriseSchema');
const UserModel = require('./userModel');

const _colsCache = new Map();
const COLS_TTL_MS = 60000;

/** @param {string} tableName 仅字母数字下划线 */
async function columnsOfTable(tableName) {
  const safe = String(tableName).replace(/[^a-zA-Z0-9_]/g, '');
  if (!safe) throw new Error('非法表名');
  const now = Date.now();
  const hit = _colsCache.get(safe);
  if (hit && now - hit.t < COLS_TTL_MS) return hit.set;
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [safe]
  );
  const set = new Set((rows || []).map((r) => String(r.c).toLowerCase()));
  _colsCache.set(safe, { set, t: now });
  return set;
}

function backtickIdent(name) {
  return '`' + String(name).replace(/`/g, '') + '`';
}

/** 考生账号表：与 UserModel 一致，合并库多为 qms_users；仅当无 qms_users 时用 users */
async function candidateUserTableName() {
  if (await tableExists('qms_users')) return 'qms_users';
  return 'users';
}

class ExamEnrollmentModel {
  /** 与 listByExam 一致：存在 qms_users 时用 qms_users，否则 users */
  static async getCandidateUserTableName() {
    return candidateUserTableName();
  }

  /**
   * 与 listByExam 一致：考生账号表（qms_users / users）及动态列，供 exam_sessions 与 u 别名 JOIN。
   * @returns {{ joinTableSql: string, userSelectSql: string }}
   */
  static async getExamSessionUserJoinFragments() {
    const userTbl = await candidateUserTableName();
    const uSafe = userTbl.replace(/`/g, '');
    const uQ = backtickIdent(uSafe);
    const uCols = await columnsOfTable(uSafe);
    const nameExpr = uCols.has('real_name')
      ? 'u.real_name'
      : uCols.has('name')
        ? 'u.name AS real_name'
        : 'u.username AS real_name';
    const selU = (col, as) => (uCols.has(col) ? `u.${backtickIdent(col)}` : `NULL AS ${as}`);
    const usernameExpr = uCols.has('username')
      ? 'u.username'
      : uCols.has('login')
        ? 'u.login AS username'
        : uCols.has('login_name')
          ? 'u.login_name AS username'
          : 'NULL AS username';
    const userSelectSql = [
      usernameExpr,
      nameExpr,
      selU('phone', 'phone'),
      selU('exam_number', 'exam_number'),
      selU('education', 'education'),
      selU('id_card', 'id_card')
    ].join(', ');
    return { joinTableSql: uQ, userSelectSql };
  }

  static generateInviteCode() {
    return crypto.randomBytes(8).toString('hex');
  }

  static async create(data) {
    const { examId, userId, inviteCode } = data;
    const code = inviteCode || this.generateInviteCode();
    const [result] = await pool.execute(
      `INSERT INTO exam_enrollments (exam_id, user_id, invite_code, status) VALUES (?, ?, ?, 'invited')`,
      [examId, userId, code]
    );
    return { id: result.insertId, inviteCode: code };
  }

  static async bulkCreate(examId, userIds) {
    if (!userIds || userIds.length === 0) return [];
    // 批量 INSERT：N 次 DB 往返 → 1 次
    const rows = userIds.map(userId => {
      const code = this.generateInviteCode();
      return [examId, userId, code, 'invited'];
    });
    const placeholders = rows.map(() => '(?, ?, ?, ?)').join(', ');
    const [result] = await pool.execute(
      `INSERT INTO exam_enrollments (exam_id, user_id, invite_code, status) VALUES ${placeholders}`,
      rows.flat()
    );
    // 从首个 insertId 推算各行的 id（InnoDB AUTO_INCREMENT 连续递增）
    const firstId = result.insertId;
    const results = userIds.map((userId, i) => ({
      id: firstId + i,
      userId,
      inviteCode: rows[i][2]
    }));
    return results;
  }

  static async findByExamAndUser(examId, userId) {
    const [rows] = await pool.execute('SELECT * FROM exam_enrollments WHERE exam_id = ? AND user_id = ?', [examId, userId]);
    return rows[0] || null;
  }

  /**
   * 同手机号多行：报名在子号、JWT 是主号时，用同号下所有 user_id 查本场报名，优先生效于 loginUserId 本行
   * （供考生端会话、邀请码等，与 exam-invitations/mine 一致）
   */
  static async findByExamForLoginUser(examId, loginUserId) {
    const idList = await UserModel.getAllIdsWithSamePhoneAsUser(loginUserId);
    if (!idList.length) return null;
    const ph = idList.map(() => '?').join(',');
    const eid = parseInt(examId, 10);
    const uid = Number(loginUserId);
    const [rows] = await pool.execute(
      `SELECT * FROM exam_enrollments WHERE exam_id = ? AND user_id IN (${ph})`,
      [eid, ...idList]
    );
    if (!rows || !rows.length) return null;
    const forSelf = rows.find((r) => Number(r.user_id) === Number(loginUserId));
    let en = forSelf || rows[0];
    /**
     * 账号合并后：副号 phone 已清空/inactive，但报名行仍 user_id=副号；同身份证合并列表仍能命中该行。
     * 会话创建始终用 JWT 的 user_id，若不把报名改挂主号，INSERT exam_sessions 易与外键/业务不一致导致 500。
     */
    if (en && Number(en.user_id) !== uid && idList.map(Number).includes(Number(en.user_id))) {
      const [canonRow] = await pool.execute(
        'SELECT id FROM exam_enrollments WHERE exam_id = ? AND user_id = ? LIMIT 1',
        [eid, uid]
      );
      if (!canonRow || !canonRow.length) {
        await pool.execute('UPDATE exam_enrollments SET user_id = ? WHERE id = ?', [uid, en.id]);
        en = { ...en, user_id: uid };
      }
    }
    return en;
  }

  static async findByInviteCode(inviteCode) {
    const [rows] = await pool.execute(
      `SELECT en.*, e.name as exam_name, e.start_time, e.end_time, e.duration_minutes, e.paper_id, e.enterprise_id
       FROM exam_enrollments en JOIN exams e ON en.exam_id = e.id
       WHERE en.invite_code = ? AND en.status IN ('invited', 'confirmed')`,
      [inviteCode]
    );
    return rows[0] || null;
  }

  /** 仅检查 exam_enrollments 表是否存在且可查（不依赖 users 的考生字段） */
  static async checkExamEnrollmentsTable(examId) {
    const [rows] = await pool.execute(
      'SELECT en.id FROM exam_enrollments en WHERE en.exam_id = ? LIMIT 1',
      [examId]
    );
    return rows;
  }

  static async listByExam(examId) {
    const userTbl = await candidateUserTableName();
    const uSafe = userTbl.replace(/`/g, '');
    const uQ = backtickIdent(uSafe);
    const uCols = await columnsOfTable(uSafe);

    const nameExpr = uCols.has('real_name')
      ? 'u.real_name'
      : uCols.has('name')
        ? 'u.name AS real_name'
        : 'u.username AS real_name';

    const selU = (col, as) => (uCols.has(col) ? `u.${backtickIdent(col)}` : `NULL AS ${as}`);

    const baseParts = [
      'en.*',
      'u.username',
      nameExpr,
      selU('email', 'email'),
      selU('phone', 'phone'),
      selU('exam_number', 'exam_number'),
      selU('position', 'position'),
      selU('id_card_image_path', 'id_card_image_path'),
      selU('education', 'education'),
      selU('job_code', 'job_code')
    ];

    let enCols;
    try {
      enCols = await columnsOfTable('exam_enrollments');
    } catch {
      enCols = new Set();
    }
    const orderDraw = enCols.has('draw_number') ? 'en.draw_number ASC, ' : '';

    const mapRow = (r, sessionNull) => ({
      ...r,
      session_id: sessionNull ? null : (r.session_id ?? null),
      check_in_at: sessionNull ? null : (r.check_in_at ?? null),
      face_verified_at: sessionNull ? null : (r.face_verified_at ?? null)
    });

    const noSessionParts = ['NULL AS session_id', 'NULL AS check_in_at', 'NULL AS face_verified_at'];

    const runSql = async (sql) => {
      const [rows] = await pool.execute(sql, [examId]);
      return rows;
    };

    const queryWithoutSession = async () => {
      const sql = `SELECT ${[...baseParts, ...noSessionParts].join(', ')}
        FROM exam_enrollments en
        JOIN ${uQ} u ON en.user_id = u.id
        WHERE en.exam_id = ?
        ORDER BY ${orderDraw}en.enrolled_at DESC`;
      const rows = await runSql(sql);
      return rows.map((r) => mapRow(r, true));
    };

    const queryWithSession = async () => {
      const sCols = await columnsOfTable('exam_sessions');
      const sessParts = [
        sCols.has('id') ? 's.id AS session_id' : 'NULL AS session_id',
        sCols.has('check_in_at') ? 's.check_in_at' : 'NULL AS check_in_at',
        sCols.has('face_verified_at') ? 's.face_verified_at' : 'NULL AS face_verified_at'
      ];
      const sql = `SELECT ${[...baseParts, ...sessParts].join(', ')}
        FROM exam_enrollments en
        JOIN ${uQ} u ON en.user_id = u.id
        LEFT JOIN exam_sessions s ON s.exam_id = en.exam_id AND s.user_id = en.user_id
        WHERE en.exam_id = ?
        ORDER BY ${orderDraw}en.enrolled_at DESC`;
      try {
        const rows = await runSql(sql);
        return rows.map((r) => mapRow(r, false));
      } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') return queryWithoutSession();
        throw err;
      }
    };

    try {
      if (!(await tableExists('exam_sessions'))) return queryWithoutSession();
      return queryWithSession();
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' && (err.message || '').includes('draw_number')) {
        const sql = `SELECT ${[...baseParts, ...noSessionParts].join(', ')}
          FROM exam_enrollments en
          JOIN ${uQ} u ON en.user_id = u.id
          WHERE en.exam_id = ?
          ORDER BY en.enrolled_at DESC`;
        const rows = await runSql(sql);
        return rows.map((r) => mapRow(r, true));
      }
      throw err;
    }
  }

  /** 若缺列则自动添加：管理员标记不参与抽签 */
  static async ensureEnrollmentExcludeFromDraw() {
    const cols = await columnsOfTable('exam_enrollments');
    if (cols.has('exclude_from_draw')) return;
    try {
      await pool.execute(
        `ALTER TABLE exam_enrollments
         ADD COLUMN exclude_from_draw TINYINT(1) NOT NULL DEFAULT 0 COMMENT '管理员标记不参与抽签'`
      );
    } catch (e) {
      const msg = String(e.message || '');
      if (e.code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) return;
      throw e;
    }
    _colsCache.delete('exam_enrollments');
  }

  static async findEnrollmentExamId(enrollmentId) {
    const [rows] = await pool.execute('SELECT id, exam_id FROM exam_enrollments WHERE id = ?', [enrollmentId]);
    return rows[0] || null;
  }

  static async updateUserId(enrollmentId, userId) {
    const [result] = await pool.execute('UPDATE exam_enrollments SET user_id = ? WHERE id = ?', [
      userId,
      enrollmentId
    ]);
    if (!result.affectedRows) {
      const err = new Error('报名记录不存在');
      err.statusCode = 404;
      throw err;
    }
  }

  static async findByExamAndUserId(examId, userId) {
    const [rows] = await pool.execute(
      'SELECT id FROM exam_enrollments WHERE exam_id = ? AND user_id = ? LIMIT 1',
      [examId, userId]
    );
    return rows[0] || null;
  }

  /** @param {boolean} excluded true=不参与抽签 */
  static async setExcludeFromDraw(enrollmentId, excluded) {
    await this.ensureEnrollmentExcludeFromDraw();
    const [result] = await pool.execute(
      'UPDATE exam_enrollments SET exclude_from_draw = ? WHERE id = ?',
      [excluded ? 1 : 0, enrollmentId]
    );
    if (!result.affectedRows) {
      const err = new Error('报名记录不存在');
      err.statusCode = 404;
      throw err;
    }
  }

  /** 按岗位随机抽签：本场报名均可参与（不要求签到）；标记 exclude_from_draw 者排除；按 position 分组组内随机 */
  static async runDrawByPosition(examId) {
    await this.ensureEnrollmentExcludeFromDraw();
    const userTbl = await candidateUserTableName();
    const enCols = await columnsOfTable('exam_enrollments');
    const exclClause = enCols.has('exclude_from_draw')
      ? ' AND (en.exclude_from_draw IS NULL OR en.exclude_from_draw = 0)'
      : '';
    const sqlPool = `SELECT en.id, en.user_id, COALESCE(u.position, '') as position
       FROM exam_enrollments en
       JOIN \`${userTbl}\` u ON en.user_id = u.id
       WHERE en.exam_id = ?${exclClause}`;
    await pool.execute('UPDATE exam_enrollments SET draw_number = NULL WHERE exam_id = ?', [examId]);
    const [rows] = await pool.execute(sqlPool, [examId]);
    if (rows.length === 0) return { count: 0 };
    const byPosition = new Map();
    for (const r of rows) {
      const pos = String(r.position || '').trim() || '未填写';
      if (!byPosition.has(pos)) byPosition.set(pos, []);
      byPosition.get(pos).push({ id: r.id });
    }
    const shuffled = [];
    for (const [, arr] of byPosition) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      shuffled.push(...arr);
    }
    let num = 1;
    for (const { id } of shuffled) {
      await pool.execute('UPDATE exam_enrollments SET draw_number = ? WHERE id = ?', [num++, id]);
    }
    return { count: shuffled.length };
  }

  static async listByUser(userId, filters = {}) {
    // 已发布或进行中的考试在考生端显示（published=已发布可见，ongoing=已开启考试）
    // 同手机号多账号时：报名可能在 cand_ 子号上，与 exam-invitations/mine 一样合并 en.user_id
    const idList = await UserModel.getAllIdsWithSamePhoneAsUser(userId);
    const ph = idList.map(() => '?').join(',');
    const examCols = await columnsOfTable('exams');
    const prcSel = examCols.has('public_room_code') ? 'e.public_room_code, ' : '';
    let sql = `SELECT en.*, e.name as exam_name, ${prcSel}e.start_time, e.end_time, e.status as exam_status, p.paper_name
       FROM exam_enrollments en
       JOIN exams e ON en.exam_id = e.id
       LEFT JOIN exam_papers p ON e.paper_id = p.id
       WHERE en.user_id IN (${ph}) AND e.status IN ('draft', 'published', 'ongoing')`;
    const params = [...idList];
    if (filters.status) {
      sql += ' AND en.status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY e.start_time DESC, en.id DESC';
    const [rows] = await pool.execute(sql, params);
    // 同场考试多行时保留一条：优先当前登录 userId 的报名
    const sorted = [...(rows || [])].sort((a, b) => {
      if (a.exam_id !== b.exam_id) return a.exam_id - b.exam_id;
      if (a.user_id === userId && b.user_id !== userId) return -1;
      if (b.user_id === userId && a.user_id !== userId) return 1;
      return (a.id || 0) - (b.id || 0);
    });
    const seen = new Set();
    const deduped = [];
    for (const r of sorted) {
      if (seen.has(r.exam_id)) continue;
      seen.add(r.exam_id);
      deduped.push(r);
    }
    deduped.forEach((r) => {
      r.start_time = formatDateTimeLocal(r.start_time);
      r.end_time = formatDateTimeLocal(r.end_time);
    });
    return deduped;
  }

  static async updateStatus(id, status) {
    const updates = { status };
    if (status === 'confirmed') updates.confirmed_at = new Date();
    await pool.execute(
      'UPDATE exam_enrollments SET status = ?, confirmed_at = COALESCE(?, confirmed_at) WHERE id = ?',
      [status, updates.confirmed_at, id]
    );
  }

  static async delete(id) {
    await pool.execute('DELETE FROM exam_enrollments WHERE id = ?', [id]);
  }
}

module.exports = ExamEnrollmentModel;
