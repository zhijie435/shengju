const { pool } = require('../config/database');
const bcrypt = require('bcrypt');
const { verifyPassword: verifyPwdUtils, hashPassword: hashPwdUtils } = require('../utils/password');
const {
  isExamTicketLikeUsername,
  stableCandidateUsername
} = require('../utils/candidateLoginUsername');

class UserModel {
  // qms_user_permissions 的用户ID列名缓存（user_id/userId/uid）
  static _permUserIdCol = null;
  static async getPermUserIdColumn() {
    if (this._permUserIdCol) return this._permUserIdCol;
    try {
      const [rows] = await pool.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'qms_user_permissions'
           AND COLUMN_NAME IN ('qms_user_id', 'user_id', 'userId', 'uid')`
      );
      const cols = (rows || []).map(r => r.COLUMN_NAME);
      // 优先 qms_user_id，其次 user_id，再其次 userId，再其次 uid
      this._permUserIdCol =
        cols.includes('qms_user_id') ? 'qms_user_id'
        : (cols.includes('user_id') ? 'user_id'
        : (cols.includes('userId') ? 'userId'
        : (cols.includes('uid') ? 'uid' : null)));
    } catch (e) {
      this._permUserIdCol = null;
    }
    return this._permUserIdCol;
  }

  // 根据用户名查找用户
  static async findByUsername(username) {
    const sql = 'SELECT * FROM qms_users WHERE username = ?';
    const [rows] = await pool.execute(sql, [username]);
    return rows[0] || null;
  }

  // 根据ID查找用户（兼容未迁移的数据库，只查基础字段）
  static async findById(id) {
    const sql = 'SELECT id, username, role, email, real_name, status, created_at, last_login_at FROM qms_users WHERE id = ?';
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
  }

  // 根据ID查找用户（含 id_card_image_path，用于扫脸核验等）
  static async findByIdWithIdCardImage(id) {
    try {
      const sql = 'SELECT id, username, role, email, real_name, id_card_image_path, status FROM qms_users WHERE id = ?';
      const [rows] = await pool.execute(sql, [id]);
      return rows[0] || null;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return await this.findById(id);
      throw err;
    }
  }

  /**
   * 更新用户身份证/人像图 URL 或相对路径。
   * 线上常见完整 OSS 带签名的 URL 超过 VARCHAR(1024)，先截断再写，避免整条补全失败连带岗位代码也写不进。
   */
  static async updateIdCardImagePath(userId, relativePath) {
    const raw = relativePath != null ? String(relativePath).trim() : '';
    if (!raw) {
      try {
        await pool.execute('UPDATE qms_users SET id_card_image_path = NULL WHERE id = ?', [userId]);
        return true;
      } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') return false;
        throw err;
      }
    }
    // id_card_image_path 仅存文件路径/URL，拒绝写入 data:image;base64 防止后续底图解析失败
    if (raw.startsWith('data:')) {
      console.warn('[UserModel.updateIdCardImagePath] reject data URI for user', userId);
      return false;
    }
    const maxLen = Math.min(
      parseInt(process.env.QMS_USERS_ID_CARD_IMAGE_PATH_MAX_LEN || '1020', 10) || 1020,
      65000
    );
    let val = raw.length > maxLen ? raw.slice(0, maxLen) : raw;
    if (raw.length > maxLen) {
      console.warn(
        '[UserModel.updateIdCardImagePath] truncated path for user',
        userId,
        'len',
        raw.length,
        '->',
        maxLen,
        '(set QMS_USERS_ID_CARD_IMAGE_PATH_MAX_LEN or ALTER COLUMN to TEXT)'
      );
    }
    try {
      const sql = 'UPDATE qms_users SET id_card_image_path = ? WHERE id = ?';
      await pool.execute(sql, [val, userId]);
      return true;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return false;
      /** VARCHAR 过短：再缩到 500 重试一次 */
      if (err.code === 'ER_DATA_TOO_LONG' && val.length > 500) {
        try {
          val = raw.slice(0, 500);
          await pool.execute('UPDATE qms_users SET id_card_image_path = ? WHERE id = ?', [val, userId]);
          return true;
        } catch (e2) {
          console.warn('[UserModel.updateIdCardImagePath] truncate retry failed:', e2.message);
          return false;
        }
      }
      throw err;
    }
  }

  /**
   * 同手机号在 qms_users 中可能有多行（主号 / cand_ 子号等），考试报名 `exam_enrollments.user_id` 可能落在其中任一行。
   * 与「只按当前 JWT 的 userId 查报名」联用时，应合并同一手机下全部 user id，避免主号登录时列表恒为空。
   * @param {number} userId
   * @returns {Promise<number[]>}
   */
  static async getAllIdsWithSamePhoneAsUser(userId) {
    if (userId == null || !Number.isFinite(Number(userId))) return [];
    const uid = Number(userId);
    try {
      const [prows] = await pool.execute(
        'SELECT phone, id_card FROM qms_users WHERE id = ? LIMIT 1',
        [uid]
      );
      const row = prows[0] || {};
      const phone = String(row.phone || '').trim();
      const idCard = String(row.id_card || '')
        .trim()
        .replace(/\s/g, '');
      const ids = new Set([uid]);
      if (phone) {
        const [irows] = await pool.execute('SELECT id FROM qms_users WHERE phone = ?', [phone]);
        for (const r of irows || []) {
          const n = Number(r.id);
          if (Number.isFinite(n) && n > 0) ids.add(n);
        }
      }
      /** 主号无手机、报名在 cand_ 且 cand_ 填了身份证时：仅靠手机合并不够，再按身份证合并 */
      if (idCard.length >= 15) {
        try {
          const [irows2] = await pool.execute(
            `SELECT id FROM qms_users WHERE TRIM(REPLACE(COALESCE(id_card, ''), ' ', '')) = ?`,
            [idCard]
          );
          for (const r of irows2 || []) {
            const n = Number(r.id);
            if (Number.isFinite(n) && n > 0) ids.add(n);
          }
        } catch (e2) {
          if (e2.code !== 'ER_BAD_FIELD_ERROR') throw e2;
        }
      }
      return [...ids];
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' || (e.message || '').includes('Unknown column')) {
        return [uid];
      }
      throw e;
    }
  }

  // 根据手机号查找（同号多行时：优先 role=user 的求职者主号，再 candidate，再其它）
  // 避免合并考试数据到主号后，手机登录仍命中最小编号的 cand_ 行、专业测评/报名仍为空
  static async findByPhone(phone) {
    if (!phone) return null;
    const p = String(phone).trim();
    const sql = `
      SELECT * FROM qms_users WHERE phone = ?
      ORDER BY
        CASE LOWER(TRIM(COALESCE(role, '')))
          WHEN 'user' THEN 0
          WHEN 'candidate' THEN 1
          WHEN 'jobseeker' THEN 1
          WHEN 'enterprise' THEN 2
          WHEN 'admin' THEN 2
          ELSE 3
        END,
        id ASC
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [p]);
    return rows[0] || null;
  }

  /** 邮箱登录（与手机号、用户名并列） */
  static async findByEmail(email) {
    if (!email) return null;
    const em = String(email).trim();
    if (!em) return null;
    try {
      const sql =
        'SELECT * FROM qms_users WHERE LOWER(TRIM(email)) = LOWER(?) AND TRIM(COALESCE(email,\'\')) <> \'\' LIMIT 1';
      const [rows] = await pool.execute(sql, [em]);
      return rows[0] || null;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return null;
      throw err;
    }
  }

  /** 注册后补写手机号（表曾降级插入未带 phone 列时，登录用手机号会失败） */
  static async updatePhoneSafe(userId, phone) {
    if (!userId || phone == null || String(phone).trim() === '') return false;
    try {
      await pool.execute('UPDATE qms_users SET phone = ? WHERE id = ?', [String(phone).trim(), userId]);
      return true;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return false;
      throw err;
    }
  }

  /** 规范化身份证号（去空格、统一末位 X） */
  static normalizeIdCard(idCard) {
    return String(idCard || '')
      .trim()
      .replace(/\s/g, '')
      .replace(/[^0-9Xx]/g, '')
      .toUpperCase();
  }

  /** 考生端默认密码：身份证后 6 位；无身份证时为 123456 */
  static idCardTailPassword(idCard) {
    const id = UserModel.normalizeIdCard(idCard);
    if (id.length < 6) return '123456';
    return id.slice(-6);
  }

  // bcrypt 并发限制（防止批量同步时阻塞事件循环）
  static _bcryptQueue = [];
  static _bcryptRunning = 0;
  static _bcryptMaxConcurrent = 4;

  /** 将考生端密码设为身份证后 6 位（名单导入、企业同步、登录兜底时调用） */
  static async syncPortalPasswordFromIdCard(userId, idCard) {
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) return false;
    const tail = UserModel.idCardTailPassword(idCard);
    // 并发限制：最多 4 个 bcrypt 同时运行
    while (UserModel._bcryptRunning >= UserModel._bcryptMaxConcurrent) {
      await new Promise(r => UserModel._bcryptQueue.push(r));
    }
    UserModel._bcryptRunning++;
    try {
      const hash = await hashPwdUtils(tail);
      await UserModel.updatePasswordHash(uid, hash);
      return true;
    } finally {
      UserModel._bcryptRunning--;
      const next = UserModel._bcryptQueue.shift();
      if (next) next();
    }
  }

  /**
   * 求职者/考生个人中心密码：先 bcrypt；未设置哈希时允许身份证后 6 位明文匹配并自动写入哈希。
   */
  static async verifyCandidatePortalPassword(user, plainPassword) {
    if (!user || plainPassword == null || String(plainPassword) === '') return false;
    const pwd = String(plainPassword).trim();
    const hash = user.password_hash;
    if (hash && typeof hash === 'string' && hash.length >= 10) {
      if (await UserModel.verifyPassword(pwd, hash)) return true;
    }
    const tail = UserModel.idCardTailPassword(user.id_card);
    if (pwd.toUpperCase() === String(tail).toUpperCase()) {
      try {
        await UserModel.syncPortalPasswordFromIdCard(user.id, user.id_card || '');
      } catch (e) {
        console.warn('[UserModel] verifyCandidatePortalPassword sync hash:', e.message);
      }
      return true;
    }
    return false;
  }

  // 根据身份证号查找（兼容库中未规范化存储）
  static async findByIdCard(idCard) {
    if (!idCard) return null;
    const norm = UserModel.normalizeIdCard(idCard);
    const raw = String(idCard).trim();
    try {
      if (norm.length >= 15) {
        const [rows] = await pool.execute(
          `SELECT * FROM qms_users
           WHERE UPPER(REPLACE(REPLACE(COALESCE(id_card, ''), ' ', ''), '-', '')) = ?
              OR TRIM(COALESCE(id_card, '')) = ?
              OR TRIM(COALESCE(id_card, '')) = ?
           LIMIT 1`,
          [norm, raw, norm]
        );
        if (rows && rows[0]) return rows[0];
      }
      const [rows2] = await pool.execute('SELECT * FROM qms_users WHERE id_card = ? LIMIT 1', [raw]);
      return rows2[0] || null;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return null;
      throw err;
    }
  }

  /**
   * 报名表 extra_json 中的手机/身份证反查 user_id（解决仅写在报名记录、qms_users 未填手机的情况）
   */
  static async findUsersByCoopBasicInfo(phoneDigits, idCardRaw) {
    const ph = String(phoneDigits || '').replace(/\D/g, '');
    const idc = UserModel.normalizeIdCard(idCardRaw);
    if (ph.length < 10 && idc.length < 15) return [];
    const conds = [];
    const params = [];
    if (ph.length >= 10) {
      const variants = Array.from(
        new Set([ph, ph.length === 11 && ph.startsWith('1') ? `86${ph}` : null].filter(Boolean))
      );
      for (const v of variants) {
        conds.push(
          `REPLACE(REPLACE(REPLACE(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(extra_json, '$.basicInfo.phone')), ''), ' ', ''), '-', ''), '+', '') = ?`
        );
        params.push(v);
      }
    }
    if (idc.length >= 15) {
      conds.push(
        `UPPER(REPLACE(REPLACE(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(extra_json, '$.basicInfo.idCardNumber')), ''), ' ', ''), '-', '')) = ?`
      );
      params.push(idc);
      conds.push(
        `UPPER(REPLACE(REPLACE(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(extra_json, '$.basicInfo.idNumber')), ''), ' ', ''), '-', '')) = ?`
      );
      params.push(idc);
    }
    if (!conds.length) return [];
    try {
      const [rows] = await pool.execute(
        `SELECT DISTINCT user_id FROM compat_cooperation_applications
         WHERE user_id IS NOT NULL AND user_id > 0 AND (${conds.join(' OR ')})
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 30`,
        params
      );
      const users = [];
      const seen = new Set();
      for (const r of rows || []) {
        const uid = Number(r.user_id);
        if (!Number.isFinite(uid) || uid <= 0 || seen.has(uid)) continue;
        seen.add(uid);
        const [urows] = await pool.execute('SELECT * FROM qms_users WHERE id = ? LIMIT 1', [uid]);
        if (urows && urows[0]) users.push(urows[0]);
      }
      return users;
    } catch (e) {
      if (e.code === 'ER_NO_SUCH_TABLE' || (e.message || '').includes("doesn't exist")) return [];
      console.warn('[UserModel] findUsersByCoopBasicInfo:', e.message);
      return [];
    }
  }

  // 根据准考证号查找
  static async findByExamNumber(examNumber) {
    if (!examNumber) return null;
    const sql = 'SELECT * FROM qms_users WHERE exam_number = ?';
    const [rows] = await pool.execute(sql, [String(examNumber).trim()]);
    return rows[0] || null;
  }

  // 创建用户（支持考生字段：phone, id_card, exam_number, position, education, job_code；无 education/job_code 列时自动降级）
  static async create(userData) {
    const { username, password, role = 'user', email, real_name, phone, id_card, exam_number, position, education, job_code } = userData;
    const passwordHash = await hashPwdUtils(password);
    let userId;
    try {
      const sql = `
        INSERT INTO qms_users (username, password_hash, role, email, real_name, phone, id_card, exam_number, position, education, job_code, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `;
      const [result] = await pool.execute(sql, [
        username,
        passwordHash,
        role,
        email || null,
        real_name || null,
        phone || null,
        id_card || null,
        exam_number || null,
        position || null,
        (education || '').trim() || null,
        (job_code || '').trim() || null
      ]);
      userId = result.insertId;
    } catch (err) {
      // 兼容：部分库表未迁移某些字段（education/job_code/exam_number/phone/id_card/position）
      // 1) 先降级去掉 education/job_code
      if (err.code === 'ER_BAD_FIELD_ERROR' && (err.message || '').match(/education|job_code/)) {
        const sqlLegacy = `
          INSERT INTO qms_users (username, password_hash, role, email, real_name, phone, id_card, exam_number, position, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `;
        const [result] = await pool.execute(sqlLegacy, [
          username,
          passwordHash,
          role,
          email || null,
          real_name || null,
          phone || null,
          id_card || null,
          exam_number || null,
          position || null
        ]);
        userId = result.insertId;
      } else if (err.code === 'ER_BAD_FIELD_ERROR' && (err.message || '').match(/exam_number|phone|id_card|position/)) {
        // 2) 再降级：只写最小字段，确保账号能创建（用于 sj_users -> qms_users 同步登录）
        const sqlMin = `
          INSERT INTO qms_users (username, password_hash, role, email, real_name, status)
          VALUES (?, ?, ?, ?, ?, 'active')
        `;
        const [result] = await pool.execute(sqlMin, [
          username,
          passwordHash,
          role,
          email || null,
          real_name || null
        ]);
        userId = result.insertId;
      } else {
        throw err;
      }
    }
    await this.createPermissions(userId, role === 'admin');
    // INSERT 曾因缺列降级为少字段时，用逐列 UPDATE 补全（列仍不存在则跳过）
    await this.mergeCandidateProfileFieldsSafe(userId, userData);
    return userId;
  }

  /**
   * 逐列 UPDATE 考生档案字段；列不存在（ER_BAD_FIELD_ERROR）则跳过该列。
   * 用于 INSERT 降级后补写 phone、exam_number 等，避免考生管理页大量空白。
   */
  static async mergeCandidateProfileFieldsSafe(userId, row) {
    if (!userId || !row || typeof row !== 'object') return;
    const phone = row.phone != null ? String(row.phone).replace(/\D/g, '') : '';
    const idCard = row.id_card != null ? String(row.id_card).trim() : '';
    const examNum = row.exam_number != null ? String(row.exam_number).trim() : '';
    const position = row.position != null ? String(row.position).trim() : '';
    const education = row.education != null ? String(row.education).trim() : '';
    const jobCode = row.job_code != null ? String(row.job_code).trim() : '';
    const email = row.email != null ? String(row.email).trim() : '';
    const pairs = [];
    if (phone) pairs.push(['phone', phone]);
    if (idCard) pairs.push(['id_card', idCard]);
    if (examNum) pairs.push(['exam_number', examNum]);
    if (position) pairs.push(['position', position]);
    if (education) pairs.push(['education', education]);
    if (jobCode) pairs.push(['job_code', jobCode]);
    if (email) pairs.push(['email', email]);
    for (const [col, val] of pairs) {
      try {
        await pool.execute(`UPDATE qms_users SET \`${col}\` = ? WHERE id = ?`, [val, userId]);
      } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      }
    }
  }

  // 安全按准考证号查（表无 exam_number 列时返回 null，不抛错）
  static async findByExamNumberSafe(examNumber) {
    if (!examNumber) return null;
    try {
      return await this.findByExamNumber(examNumber);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return null;
      throw err;
    }
  }

  /** 同一准考证只能绑定一名考生；重新分配考号时先解除他人占用 */
  static async releaseExamNumberFromOtherUsers(examNumber, keepUserId) {
    const exam = (examNumber || '').toString().trim();
    if (!exam || keepUserId == null) return;
    try {
      await pool.execute(
        `UPDATE qms_users SET exam_number = NULL
         WHERE exam_number = ? AND id <> ?
           AND LOWER(TRIM(COALESCE(role, ''))) IN ('user', 'candidate', 'jobseeker', '')`,
        [exam, keepUserId]
      );
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  }

  /** 按姓名查找考生账号（仅 candidate 类角色；重名时配合手机筛选） */
  static async findCandidatesByRealName(realName) {
    const nm = (realName || '').trim();
    if (!nm) return [];
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM qms_users
         WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('user', 'candidate', 'jobseeker', '')
           AND TRIM(COALESCE(real_name, '')) = ?
         ORDER BY id ASC`,
        [nm]
      );
      if (rows && rows.length) return rows;
      const [rows2] = await pool.execute(
        `SELECT * FROM qms_users
         WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('user', 'candidate', 'jobseeker', '')
           AND TRIM(COALESCE(real_name, '')) <> ''
         ORDER BY id ASC
         LIMIT 500`
      );
      return (rows2 || []).filter((u) =>
        UserModel.candidateNamesLikelySame(u.real_name || u.username, nm)
      );
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') return [];
      throw e;
    }
  }

  static pickCandidateUserByNameAndPhone(name, phoneStr, nameCandidates) {
    const list = nameCandidates || [];
    if (!list.length) return null;
    if (phoneStr && phoneStr.length >= 10) {
      const hit = list.find((u) => String(u.phone || '').replace(/\D/g, '') === phoneStr);
      if (hit) return hit;
    }
    return list.length === 1 ? list[0] : null;
  }

  static async findByIdCardSafe(idCard) {
    if (!idCard) return null;
    try {
      return await this.findByIdCard(idCard);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return null;
      throw err;
    }
  }

  static async findByPhoneSafe(phone) {
    if (!phone) return null;
    try {
      return await this.findByPhone(phone);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return null;
      throw err;
    }
  }

  // 仅插入基础字段（users 表无考生列时使用）
  static async createCandidateMinimal(userData) {
    const { username, password, role = 'candidate', email, real_name } = userData;
    const passwordHash = await hashPwdUtils(password);
    const sql = `
      INSERT INTO users (username, password_hash, role, email, real_name, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `;
    const [result] = await pool.execute(sql, [
      username,
      passwordHash,
      role,
      email || null,
      real_name || null
    ]);
    const userId = result.insertId;
    await this.createPermissions(userId, false);
    return userId;
  }

  /** 导入时姓名比对（避免仅因手机号相同就合并到他人账号） */
  static normalizeCandidateName(s) {
    return String(s || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[·•．.]/g, '');
  }

  static candidateNamesLikelySame(a, b) {
    const x = UserModel.normalizeCandidateName(a);
    const y = UserModel.normalizeCandidateName(b);
    if (!x || !y) return true;
    if (x === y) return true;
    if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return true;
    return false;
  }

  static formatBoundAccountHint(user) {
    const un = user?.username ? String(user.username) : '—';
    const rn = user?.real_name ? String(user.real_name).trim() : '';
    return rn ? `${rn}（登录名：${un}）` : `登录名：${un}`;
  }

  /** 同手机号下仅返回与导入姓名一致的考生账号（可能 0 或 1 条） */
  static async findCandidateByPhoneAndName(phone, realName) {
    if (!phone) return null;
    const p = String(phone).replace(/\D/g, '');
    if (p.length < 10) return null;
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM qms_users WHERE phone = ?
         AND LOWER(TRIM(COALESCE(role, ''))) IN ('user', 'candidate', 'jobseeker', '')
         ORDER BY id ASC`,
        [p]
      );
      const matched = (rows || []).filter((u) =>
        UserModel.candidateNamesLikelySame(u.real_name || u.username, realName)
      );
      if (matched.length === 1) return matched[0];
      if (matched.length > 1) return matched[0];
      return null;
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return null;
      throw err;
    }
  }

  // 创建或查找考生（用于导入）：以「姓名 + 手机/身份证」为身份锚点；准考证号仅作可变字段，不驱动登录名
  // options.matchByExamNumberOnly：兼容旧调用，等价于跳过姓名优先（不推荐）；默认先姓名+手机再准考证
  static async createCandidateOrFind(row, options = {}) {
    const { real_name, exam_number, id_card, phone, position, email, education, job_code, username: rowUsername } =
      row;
    const name = (real_name || '').trim();
    const examNum = (exam_number || '').toString().trim();
    const idCard = (id_card || '').toString().trim();
    const phoneStr = (phone || '').toString().replace(/\D/g, '');
    let explicitUsername = (rowUsername || '').trim();
    if (explicitUsername && isExamTicketLikeUsername(explicitUsername)) {
      explicitUsername = '';
    }
    if (!name) return { success: false, error: '姓名为空' };
    const skipNameFirst = options.matchByExamNumberOnly === true;
    const rosterImportLoose = options.rosterImportLoose === true;

    let user = null;
    let matchedBy = null;

    if (rosterImportLoose && idCard && String(idCard).replace(/\s/g, '').length >= 15) {
      const byIdLoose = await this.findByIdCardSafe(idCard);
      if (byIdLoose) {
        user = byIdLoose;
        matchedBy = 'id_card';
      }
    }

    if (explicitUsername) {
      const byU = await this.findByUsername(explicitUsername);
      if (byU) {
        if (!UserModel.candidateNamesLikelySame(byU.real_name || byU.username, name)) {
          return {
            success: false,
            error: `登录名「${explicitUsername}」已属于${UserModel.formatBoundAccountHint(byU)}，与本次姓名「${name}」不一致`
          };
        }
        if (examNum) await this.releaseExamNumberFromOtherUsers(examNum, byU.id);
        await this.mergeCandidateProfileFieldsSafe(byU.id, {
          phone: phoneStr,
          id_card: idCard,
          exam_number: examNum,
          position: (position || '').trim(),
          education: (education || '').trim(),
          job_code: (job_code || '').trim(),
          email: (email || '').trim()
        });
        if (name && byU.real_name !== name) {
          try {
            await pool.execute('UPDATE qms_users SET real_name = ? WHERE id = ?', [name, byU.id]);
          } catch (_) {}
        }
        return { success: true, userId: byU.id, isNew: false, matchedBy: 'username' };
      }
    }

    if (!skipNameFirst) {
      if (!user && phoneStr) {
        const byPh = await this.findCandidateByPhoneAndName(phoneStr, name);
        if (byPh) {
          user = byPh;
          matchedBy = 'phone';
        } else {
          const anyPhone = await this.findByPhoneSafe(phoneStr);
          if (
            anyPhone &&
            !UserModel.candidateNamesLikelySame(anyPhone.real_name || anyPhone.username, name) &&
            !rosterImportLoose
          ) {
            return {
              success: false,
              error: `手机号已被${UserModel.formatBoundAccountHint(anyPhone)}使用，与本次姓名「${name}」不一致。请为每位考生填写不同手机号，或在「添加考生」中手动绑定正确账号`
            };
          }
          if (
            rosterImportLoose &&
            anyPhone &&
            !UserModel.candidateNamesLikelySame(anyPhone.real_name || anyPhone.username, name) &&
            !user
          ) {
            /* 名单导入：姓名与手机号持有人不一致时，仍以身份证为准（user 可能已由 id_card 命中） */
          }
        }
      }
      if (!user && idCard) {
        const byId = await this.findByIdCardSafe(idCard);
        if (byId) {
          if (
            !UserModel.candidateNamesLikelySame(byId.real_name || byId.username, name) &&
            !rosterImportLoose
          ) {
            return {
              success: false,
              error: `身份证号已绑定${UserModel.formatBoundAccountHint(byId)}，与本次姓名「${name}」不一致，请核对表格`
            };
          }
          user = byId;
          matchedBy = 'id_card';
        }
      }
      if (!user) {
        const byNameList = await this.findCandidatesByRealName(name);
        const byName = this.pickCandidateUserByNameAndPhone(name, phoneStr, byNameList);
        if (byName) {
          user = byName;
          matchedBy = 'name';
        }
      }
    }

    if (!user && examNum) {
      const byExam = await this.findByExamNumberSafe(examNum);
      if (byExam) {
        if (!UserModel.candidateNamesLikelySame(byExam.real_name || byExam.username, name)) {
          return {
            success: false,
            error: `准考证号「${examNum}」已绑定${UserModel.formatBoundAccountHint(byExam)}，与本次姓名「${name}」不一致。请重新分配考号或先移除错绑考生后再导入`
          };
        }
        user = byExam;
        matchedBy = 'exam_number';
      }
    }

    if (user) {
      if (
        explicitUsername &&
        user.username &&
        String(user.username).trim() !== explicitUsername &&
        !isExamTicketLikeUsername(user.username)
      ) {
        return {
          success: false,
          error: `该考生已使用登录名「${user.username}」，与表格中的「${explicitUsername}」不一致`
        };
      }
      const updates = [];
      const params = [];
      if (examNum && user.exam_number !== examNum) {
        updates.push('exam_number = ?');
        params.push(examNum);
      }
      if (idCard && user.id_card !== idCard) {
        updates.push('id_card = ?');
        params.push(idCard);
      }
      if (phoneStr && user.phone !== phoneStr) {
        updates.push('phone = ?');
        params.push(phoneStr);
      }
      if (position && user.position !== position) {
        updates.push('position = ?');
        params.push(position);
      }
      if (email && user.email !== email) {
        updates.push('email = ?');
        params.push(email);
      }
      if (
        name &&
        UserModel.candidateNamesLikelySame(user.real_name, name) &&
        user.real_name !== name
      ) {
        updates.push('real_name = ?');
        params.push(name);
      }
      if (education != null && education !== '' && user.education !== education) {
        updates.push('education = ?');
        params.push(education);
      }
      if (job_code != null && job_code !== '' && user.job_code !== job_code) {
        updates.push('job_code = ?');
        params.push(job_code);
      }
      if (updates.length) {
        params.push(user.id);
        try {
          await pool.execute(`UPDATE qms_users SET ${updates.join(', ')} WHERE id = ?`, params);
        } catch (e) {
          if (e.code === 'ER_BAD_FIELD_ERROR') {
            /* 无该列时忽略 */
          } else throw e;
        }
      }
      if (examNum) await this.releaseExamNumberFromOtherUsers(examNum, user.id);
      await this.mergeCandidateProfileFieldsSafe(user.id, {
        phone: phoneStr,
        id_card: idCard,
        exam_number: examNum,
        position: (position || '').trim(),
        education: (education || '').trim(),
        job_code: (job_code || '').trim(),
        email: (email || '').trim()
      });
      const desiredUsername = stableCandidateUsername(name, phoneStr, explicitUsername);
      const curUn = user.username ? String(user.username).trim() : '';
      const shouldFixUsername =
        desiredUsername &&
        curUn !== desiredUsername &&
        (explicitUsername ||
          !curUn ||
          isExamTicketLikeUsername(curUn));
      if (shouldFixUsername) {
        const conflict = await this.findByUsername(desiredUsername);
        if (!conflict || Number(conflict.id) === Number(user.id)) {
          try {
            await pool.execute('UPDATE qms_users SET username = ? WHERE id = ?', [desiredUsername, user.id]);
          } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
          }
        }
      }
      if (idCard && String(idCard).replace(/\s/g, '').length >= 6) {
        try {
          await UserModel.syncPortalPasswordFromIdCard(user.id, idCard);
        } catch (pe) {
          console.warn('[UserModel] createCandidateOrFind sync password:', pe.message);
        }
      } else if (!user.id_card && phoneStr.length >= 10) {
        try {
          await UserModel.syncPortalPasswordFromIdCard(user.id, '');
        } catch (pe2) {
          console.warn('[UserModel] createCandidateOrFind default password:', pe2.message);
        }
      }
      return { success: true, userId: user.id, isNew: false, matchedBy };
    }
    // 未匹配到已有用户、即将新建时：须具备「手机 / 身份证 / 准考证号」之一，避免仅姓名就无限生成 cand_ 重复号
    // 紧急恢复：.env 设 ALLOW_CANDIDATE_NO_PHONE_ID=1
    const allowWeakCreate = process.env.ALLOW_CANDIDATE_NO_PHONE_ID === '1' || process.env.ALLOW_CANDIDATE_NO_PHONE_ID === 'true';
    const hasPhone = phoneStr.length >= 10;
    const hasId = idCard && String(idCard).replace(/\s/g, '').length >= 15;
    const hasExam = !!(examNum && String(examNum).trim() !== '');
    if (!allowWeakCreate && !hasPhone && !hasId && !hasExam) {
      return {
        success: false,
        error: '新考生须至少填写：手机号、身份证号或准考证号之一（不可仅凭姓名建号，防止重复账号）'
      };
    }
    let finalUsername =
      stableCandidateUsername(name, phoneStr, explicitUsername) ||
      `cand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let exists = await this.findByUsername(finalUsername);
    if (exists && explicitUsername) {
      return {
        success: false,
        error: `登录名「${explicitUsername}」已被其他账号占用，请更换或留空由系统按手机号/姓名生成稳定登录名`
      };
    }
    if (exists) {
      let i = 0;
      while (exists && i < 8) {
        i += 1;
        finalUsername = `${finalUsername}_${i}`;
        exists = await this.findByUsername(finalUsername);
      }
    }
    try {
      if (examNum) {
        await this.releaseExamNumberFromOtherUsers(examNum, 0);
      }
      const userId = await this.create({
        username: finalUsername,
        password: (idCard && idCard.length >= 6) ? idCard.slice(-6) : '123456',
        role: 'candidate',
        email: (email || '').trim() || null,
        real_name: name,
        phone: phoneStr || null,
        id_card: idCard || null,
        exam_number: examNum || null,
        position: (position || '').trim() || null,
        education: (education || '').trim() || null,
        job_code: (job_code || '').trim() || null
      });
      return { success: true, userId, isNew: true };
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' && (err.message || '').match(/phone|id_card|exam_number|position|education|job_code/)) {
        const userId = await this.createCandidateMinimal({
          username: finalUsername,
          password: (idCard && idCard.length >= 6) ? idCard.slice(-6) : '123456',
          role: 'candidate',
          email: (email || '').trim() || null,
          real_name: name
        });
        await this.mergeCandidateProfileFieldsSafe(userId, {
          phone: phoneStr,
          id_card: idCard,
          exam_number: examNum,
          position: (position || '').trim(),
          education: (education || '').trim(),
          job_code: (job_code || '').trim(),
          email: (email || '').trim()
        });
        return { success: true, userId, isNew: true };
      }
      throw err;
    }
  }

  // 创建用户权限
  static async createPermissions(userId, isAdmin = false) {
    try {
      const params = [
        userId,
        true, // 所有用户都可以贡献
        isAdmin, // 只有管理员可以编辑共享题库
        isAdmin, // 只有管理员可以管理用户
        isAdmin  // 只有管理员可以查看所有数据
      ];
      const col = await this.getPermUserIdColumn();
      if (!col) throw new Error('qms_user_permissions 缺少 user_id/userId/uid 列，无法写入权限');
      const sql = `
        INSERT INTO qms_user_permissions
        (${col}, can_contribute, can_edit_shared, can_manage_users, can_view_all_data)
        VALUES (?, ?, ?, ?, ?)
      `;
      await pool.execute(sql, params);
    } catch (err) {
      // 如果表不存在或已存在记录，忽略错误（兼容性处理）
      if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_DUP_ENTRY') {
        console.warn(`[UserModel] 创建用户权限失败（用户ID: ${userId}）:`, err.message);
        return;
      }
      // 其他错误重新抛出
      throw err;
    }
  }

  // 验证密码（自动识别 bcrypt 旧格式 / PBKDF2 新格式，不含懒迁移逻辑）
  static async verifyPassword(password, passwordHash) {
    if (password == null || passwordHash == null || typeof passwordHash !== 'string' || passwordHash.length < 10) {
      return false;
    }
    try {
      const { match } = await verifyPwdUtils(String(password), passwordHash);
      return match;
    } catch (e) {
      console.warn('[UserModel] verifyPassword:', e.message);
      return false;
    }
  }

  // 按用户ID更新密码哈希（供外部系统同步密码时使用）
  static async updatePasswordHash(userId, passwordHash) {
    if (!userId || !passwordHash) return;
    const sql = 'UPDATE qms_users SET password_hash = ? WHERE id = ?';
    await pool.execute(sql, [passwordHash, userId]);
  }

  // 更新最后登录时间（库表未迁移 last_login_at 时不应导致登录 500）
  static async updateLastLogin(userId) {
    try {
      const sql = 'UPDATE qms_users SET last_login_at = NOW() WHERE id = ?';
      await pool.execute(sql, [userId]);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return;
      throw err;
    }
  }

  // 获取用户权限（表不存在时降级为无权限记录，避免登录 500）
  static async getPermissions(userId) {
    try {
      const col = await this.getPermUserIdColumn();
      if (!col) return null;
      const sql = `SELECT * FROM qms_user_permissions WHERE ${col} = ?`;
      const [rows] = await pool.execute(sql, [userId]);
      return rows[0] || null;
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') return null;
      throw err;
    }
  }

  // 更新用户权限
  static async updatePermissions(userId, permissions) {
    const { can_contribute, can_edit_shared, can_manage_users, can_view_all_data } = permissions;
    
    const params = [
      can_contribute !== undefined ? can_contribute : true,
      can_edit_shared !== undefined ? can_edit_shared : false,
      can_manage_users !== undefined ? can_manage_users : false,
      can_view_all_data !== undefined ? can_view_all_data : false,
      userId
    ];
    const col = await this.getPermUserIdColumn();
    if (!col) return;
    const sql = `
      UPDATE qms_user_permissions
      SET can_contribute = ?, can_edit_shared = ?, can_manage_users = ?, can_view_all_data = ?, updated_at = NOW()
      WHERE ${col} = ?
    `;
    await pool.execute(sql, params);
  }

  // 获取所有用户（管理员）
  static async getAllUsers() {
    const col = await this.getPermUserIdColumn();
    const joinOn = col ? `p.${col} = u.id` : '1=0';
    const sql = `
      SELECT u.id, u.username, u.role, u.email, u.real_name, u.status, 
             u.created_at, u.last_login_at,
             p.can_contribute, p.can_edit_shared, p.can_manage_users, p.can_view_all_data
      FROM qms_users u
      LEFT JOIN qms_user_permissions p ON (${joinOn})
      ORDER BY u.created_at DESC
    `;
    const [rows] = await pool.execute(sql);
    return rows;
  }

  // 更新用户状态
  static async updateStatus(userId, status) {
    const sql = 'UPDATE qms_users SET status = ? WHERE id = ?';
    await pool.execute(sql, [status, userId]);
  }

  // 删除用户
  static async delete(userId) {
    // 注意：由于外键约束，删除用户会自动删除相关记录
    const sql = 'DELETE FROM qms_users WHERE id = ?';
    await pool.execute(sql, [userId]);
  }

  // 更新密码
  static async updatePassword(userId, newPassword) {
    const passwordHash = await hashPwdUtils(newPassword);
    const sql = 'UPDATE qms_users SET password_hash = ? WHERE id = ?';
    await pool.execute(sql, [passwordHash, userId]);
  }
}

module.exports = UserModel;
