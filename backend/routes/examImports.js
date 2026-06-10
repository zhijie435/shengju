const express = require('express');
const router = express.Router();
const { pool, poolShengju } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeSjImportedRow } = require('../utils/sjImportedCandidateNormalize');
const { pickLoginUsernameFromRow } = require('../utils/candidateLoginUsername');

/** 检测 exam_import_batches 是否已执行 migrate_exam_imports_add_source（含 source_company_id / source_system） */
async function getExamImportBatchColumnFlags(conn) {
  try {
    const [rows] = await conn.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_import_batches'`
    );
    const set = new Set((rows || []).map((r) => r.COLUMN_NAME));
    return {
      sourceCompanyId: set.has('source_company_id'),
      sourceSystem: set.has('source_system')
    };
  } catch (e) {
    return { sourceCompanyId: false, sourceSystem: false };
  }
}

// 人才网批次：从 shengju 库的 sj_exam_imported_candidates 按 batch_id 聚合（表结构：batch_id, batch_name, real_name, exam_number, id_card 等）
async function fetchSjBatches() {
  if (!poolShengju) return [];
  try {
    const [rows] = await poolShengju.execute(
      `SELECT batch_id, batch_name, COUNT(*) AS candidate_count
       FROM sj_exam_imported_candidates
       GROUP BY batch_id, batch_name
       ORDER BY batch_id DESC`
    );
    return (rows || []).map(r => ({
      id: 'sj_' + String(r.batch_id),
      candidateBatchId: String(r.batch_id),
      batchName: r.batch_name || '批次' + r.batch_id,
      examTime: null,
      examLocation: null,
      candidateCount: Number(r.candidate_count) || 0,
      status: 'INIT',
      enterpriseName: null,
      importedExamId: null,
      importedAt: null,
      remark: null,
      createdAt: r.created_at || null,
      source: 'sj'
    }));
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') {
      return [];
    }
    console.warn('[exam-imports] fetchSjBatches (shengju) error:', e.message);
    return [];
  }
}

/** 与 talentSiteCompat 一致：企业端考试分配批次登记（用于限定 sj_ 批次仅本企业可见） */
let _compatExamAllocTableReady = false;
async function ensureCompatExamAllocationBatchesTable() {
  if (_compatExamAllocTableReady) return;
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS compat_exam_allocation_batches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        enterprise_id INT NOT NULL,
        batch_id VARCHAR(128) NOT NULL,
        batch_name VARCHAR(500) NULL,
        package_id VARCHAR(128) NULL,
        exam_time VARCHAR(100) NULL,
        exam_location VARCHAR(500) NULL,
        notes TEXT NULL,
        candidate_count INT NOT NULL DEFAULT 0,
        payload_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ent_batch (enterprise_id, batch_id),
        KEY idx_ent (enterprise_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='enterprise/tests.html 考试分配批次'
    `);
  } catch (e) {
    console.warn('[exam-imports] compat_exam_allocation_batches ensure:', e.message);
  }
  _compatExamAllocTableReady = true;
}

async function enterpriseHasSjBatchAccess(enterpriseId, batchIdStr) {
  if (enterpriseId == null || batchIdStr == null || String(batchIdStr).trim() === '') return false;
  await ensureCompatExamAllocationBatchesTable();
  try {
    const [rows] = await pool.execute(
      'SELECT 1 FROM compat_exam_allocation_batches WHERE enterprise_id = ? AND batch_id = ? LIMIT 1',
      [Number(enterpriseId), String(batchIdStr)]
    );
    return !!(rows && rows.length);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  }
}

/** 企业端：仅返回本企业在 compat 表登记过的 batch_id，并从 sj 表聚合计数 */
async function fetchSjBatchesForEnterprise(enterpriseId) {
  if (!poolShengju || enterpriseId == null) return [];
  await ensureCompatExamAllocationBatchesTable();
  let raw = [];
  try {
    const [r] = await pool.execute(
      `SELECT batch_id, batch_name, candidate_count, updated_at, created_at FROM compat_exam_allocation_batches
       WHERE enterprise_id = ? ORDER BY updated_at DESC, id DESC`,
      [Number(enterpriseId)]
    );
    raw = r || [];
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  }
  const seen = new Set();
  const compatRows = [];
  for (const row of raw) {
    const b = String(row.batch_id);
    if (seen.has(b)) continue;
    seen.add(b);
    compatRows.push(row);
  }
  if (compatRows.length === 0) return [];
  const ids = compatRows.map((x) => String(x.batch_id));
  const ph = ids.map(() => '?').join(',');
  let agg = [];
  try {
    const [a] = await poolShengju.execute(
      `SELECT batch_id, batch_name, COUNT(*) AS candidate_count
       FROM sj_exam_imported_candidates
       WHERE batch_id IN (${ph})
       GROUP BY batch_id, batch_name`,
      ids
    );
    agg = a || [];
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') {
      return compatRows.map((r) => ({
        id: 'sj_' + String(r.batch_id),
        candidateBatchId: String(r.batch_id),
        batchName: r.batch_name || '批次' + r.batch_id,
        examTime: null,
        examLocation: null,
        candidateCount: Number(r.candidate_count) || 0,
        status: 'INIT',
        enterpriseName: null,
        importedExamId: null,
        importedAt: null,
        remark: null,
        createdAt: r.updated_at || r.created_at || null,
        source: 'sj'
      }));
    }
    console.warn('[exam-imports] fetchSjBatchesForEnterprise sj agg:', e.message);
    return [];
  }
  const countMap = new Map();
  for (const row of agg) {
    countMap.set(String(row.batch_id), Number(row.candidate_count) || 0);
  }
  return compatRows.map((r) => {
    const bid = String(r.batch_id);
    const sjN = countMap.get(bid) || 0;
    const compatN = Number(r.candidate_count) || 0;
    return {
      id: 'sj_' + bid,
      candidateBatchId: bid,
      batchName: r.batch_name || '批次' + bid,
      examTime: null,
      examLocation: null,
      /** 企业端仅 save-batch 时人数在 compat；sj 表可能尚未写入，取二者较大值 */
      candidateCount: Math.max(sjN, compatN),
      status: 'INIT',
      enterpriseName: null,
      importedExamId: null,
      importedAt: null,
      remark: null,
      createdAt: r.updated_at || r.created_at || null,
      source: 'sj'
    };
  });
}

async function fetchCompatBatchPayload(enterpriseId, batchIdStr) {
  if (enterpriseId == null || batchIdStr == null || String(batchIdStr).trim() === '') return null;
  await ensureCompatExamAllocationBatchesTable();
  try {
    const [rows] = await pool.execute(
      `SELECT candidate_count, payload_json FROM compat_exam_allocation_batches
       WHERE enterprise_id = ? AND batch_id = ? LIMIT 1`,
      [Number(enterpriseId), String(batchIdStr)]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    let payload = {};
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : {};
    } catch (_) {}
    const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
    return {
      candidateCount: Number(row.candidate_count) || allocations.length || 0,
      allocations
    };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }
}

/** 管理员或未带 enterprise 维度时，按 batch_id 取最近一次同步的 payload */
async function fetchCompatBatchPayloadByBatchId(batchIdStr) {
  if (batchIdStr == null || String(batchIdStr).trim() === '') return null;
  await ensureCompatExamAllocationBatchesTable();
  try {
    const [rows] = await pool.execute(
      `SELECT candidate_count, payload_json FROM compat_exam_allocation_batches
       WHERE batch_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [String(batchIdStr)]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    let payload = {};
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : {};
    } catch (_) {}
    const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
    return {
      candidateCount: Number(row.candidate_count) || allocations.length || 0,
      allocations
    };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }
}

/** enterprise/tests.html save-batch 写入的 allocations → 与 sj 表一致的 API 明细结构 */
function compatAllocationsToApiCandidates(allocations) {
  const list = [];
  let idx = 0;
  for (const rec of allocations || []) {
    if (!rec) continue;
    const name = (rec.candidateName || rec.candidate_name || '').toString().trim();
    if (!name) continue;
    idx += 1;
    const extra = {};
    if (rec.photoUrl) {
      const pu = String(rec.photoUrl).trim();
      extra.photo_url = pu;
      // 导入循环只认 extra.id_card_front / id_card_back，与报名表 compat 附件字段对齐
      extra.id_card_front = pu;
    }
    if (rec.education != null && String(rec.education).trim()) extra.education = String(rec.education).trim();
    const jc = rec.job_code || rec.jobCode;
    if (jc != null && String(jc).trim()) extra.job_code = String(jc).trim();
    const examNo =
      rec.admitCardNumber ||
      rec.admit_card_number ||
      rec.examNumber ||
      rec.exam_number ||
      rec.exam_no ||
      rec.ticket_no ||
      rec.ticketNo ||
      '';
    const loginUsername = pickLoginUsernameFromRow(rec, {}, String(examNo || '').trim());
    if (loginUsername) extra.login_username = loginUsername;
    const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;
    list.push({
      id: rec.candidateId != null ? rec.candidateId : idx,
      examNo: examNo || null,
      loginUsername: loginUsername || null,
      name,
      idNumber:
        rec.idCard || rec.id_card || rec.idNumber || rec.id_number || rec.certificate_no || rec.certificateNo || null,
      mobile:
        rec.phone ||
        rec.mobile ||
        rec.candidatePhone ||
        rec.candidate_phone ||
        rec.tel ||
        rec.contactPhone ||
        rec.contact_phone ||
        (rec['手机号'] != null ? rec['手机号'] : '') ||
        (rec['联系电话'] != null ? rec['联系电话'] : '') ||
        null,
      email: rec.email || rec.mail || null,
      gender: rec.gender || null,
      positionName: rec.jobTitle || rec.job_title || rec.job || rec.position || rec.positionName || rec.position_name || null,
      extraInfo: extraJson,
      importStatus: 'PENDING',
      errorMsg: null,
      createdAt: null
    });
  }
  return list;
}

function compatAllocationsToImportCandidates(allocations) {
  return compatAllocationsToApiCandidates(allocations).map((c) => ({
    id: c.id,
    exam_no: c.examNo,
    name: c.name,
    login_username: c.loginUsername || '',
    id_number: c.idNumber,
    mobile: c.mobile,
    email: c.email,
    position_name: c.positionName,
    extra_info: c.extraInfo
  }));
}

/** 批次导入后：按姓名将已有报名改绑到本次解析出的正确 user_id（支持重新分配导入） */
async function relinkEnrollmentsByResolvedCandidates(ExamEnrollmentModel, UserModel, examId, existing, resolved) {
  let relinked = 0;
  for (const item of resolved) {
    if (!item.real_name || !item.userId) continue;
    const en = (existing || []).find((e) =>
      UserModel.candidateNamesLikelySame(e.real_name || e.username, item.real_name)
    );
    if (en && Number(en.user_id) !== Number(item.userId)) {
      await ExamEnrollmentModel.updateUserId(en.id, item.userId);
      relinked += 1;
    }
  }
  return relinked;
}

// 供企业端候选人系统调用：同步某个批次的考生到导入池（免鉴权，后续可按需增加 API Key）
router.post('/from-enterprise', async (req, res) => {
  try {
    const {
      batchId,
      batchName,
      examTime,
      examLocation,
      notes,
      enterpriseName,
      candidates,
      sourceCompanyId,
      candidateBatchCode
    } = req.body || {};

    const finalBatchId = candidateBatchCode || batchId;

    if (!finalBatchId || !batchName) {
      return res.status(400).json({ success: false, message: 'batchId/candidateBatchCode 与 batchName 为必填' });
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ success: false, message: 'candidates 必须是非空数组' });
    }

    const candidateBatchId = String(finalBatchId);
    const sourceCompanyIdInt = sourceCompanyId != null && String(sourceCompanyId).trim() !== ''
      ? parseInt(sourceCompanyId, 10)
      : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const batchCols = await getExamImportBatchColumnFlags(conn);
      const useSourceCols = batchCols.sourceCompanyId && batchCols.sourceSystem;

      // 如果已经存在同一个 candidate_batch_id 的批次，则覆盖重建（避免重复累加）
      const [existing] = await conn.execute(
        'SELECT id, status FROM exam_import_batches WHERE candidate_batch_id = ? LIMIT 1',
        [candidateBatchId]
      );

      let batchDbId;
      if (existing.length) {
        batchDbId = existing[0].id;
        if (useSourceCols) {
          await conn.execute(
            `UPDATE exam_import_batches
             SET batch_name = ?, exam_time = ?, exam_location = ?, candidate_count = ?, status = 'INIT',
                 remark = ?, enterprise_name = ?, source_company_id = ?, source_system = 'shengju_talent',
                 imported_exam_id = NULL, imported_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              String(batchName),
              examTime || null,
              examLocation || null,
              candidates.length,
              notes || null,
              enterpriseName || null,
              sourceCompanyIdInt,
              batchDbId
            ]
          );
        } else {
          await conn.execute(
            `UPDATE exam_import_batches
             SET batch_name = ?, exam_time = ?, exam_location = ?, candidate_count = ?, status = 'INIT',
                 remark = ?, enterprise_name = ?,
                 imported_exam_id = NULL, imported_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              String(batchName),
              examTime || null,
              examLocation || null,
              candidates.length,
              notes || null,
              enterpriseName || null,
              batchDbId
            ]
          );
        }
        await conn.execute('DELETE FROM exam_import_candidates WHERE import_batch_id = ?', [batchDbId]);
      } else {
        let ins;
        if (useSourceCols) {
          [ins] = await conn.execute(
            `INSERT INTO exam_import_batches
             (candidate_batch_id, batch_name, exam_time, exam_location, candidate_count, status,
              enterprise_name, source_company_id, source_system, remark, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'INIT', ?, ?, 'shengju_talent', ?, NOW(), NOW())`,
            [
              candidateBatchId,
              String(batchName),
              examTime || null,
              examLocation || null,
              candidates.length,
              enterpriseName || null,
              sourceCompanyIdInt,
              notes || null
            ]
          );
        } else {
          [ins] = await conn.execute(
            `INSERT INTO exam_import_batches
             (candidate_batch_id, batch_name, exam_time, exam_location, candidate_count, status,
              enterprise_name, remark, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'INIT', ?, ?, NOW(), NOW())`,
            [
              candidateBatchId,
              String(batchName),
              examTime || null,
              examLocation || null,
              candidates.length,
              enterpriseName || null,
              notes || null
            ]
          );
        }
        batchDbId = ins.insertId;
      }

      const rowsToInsert = [];
      for (const row of candidates) {
        if (!row) continue;
        const name = (row.real_name || row.name || '').trim();
        if (!name) continue;
        const extra = row.extra_info && typeof row.extra_info === 'object' ? { ...row.extra_info } : {};
        if (row.education != null) extra.education = String(row.education).trim();
        if (row.job_code != null) extra.job_code = String(row.job_code).trim();
        if (row.id_card_front != null) extra.id_card_front = String(row.id_card_front).trim();
        if (row.id_card_back != null) extra.id_card_back = String(row.id_card_back).trim();
        const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;
        rowsToInsert.push([
          batchDbId,
          row.exam_number ? String(row.exam_number).trim() : null,
          name,
          row.id_card ? String(row.id_card).trim() : null,
          row.phone ? String(row.phone).trim() : null,
          row.email ? String(row.email).trim() : null,
          row.gender ? String(row.gender).trim() : null,
          row.position ? String(row.position).trim() : null,
          extraJson
        ]);
      }

      if (rowsToInsert.length > 0) {
        await conn.query(
          `INSERT INTO exam_import_candidates
             (import_batch_id, exam_no, name, id_number, mobile, email, gender, position_name, extra_info, import_status, created_at)
           VALUES ?
          `,
          [rowsToInsert.map(v => [...v, 'PENDING', new Date()])]
        );
      }

      await conn.commit();
      return res.json({
        success: true,
        data: {
          importBatchId: batchDbId,
          candidateCount: rowsToInsert.length
        }
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('[exam-imports/from-enterprise] error:', e);
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        success: false,
        message:
          '主库缺少考生导入表。请在主库执行 backend/database/migrate_exam_imports.sql（创建 exam_import_batches / exam_import_candidates）后重试。'
      });
    }
    return res.status(500).json({ success: false, message: e.message || '同步导入批次失败' });
  }
});

// 调试：检测人才网 sj_* 表是否可读（免鉴权）
router.get('/sj-debug', async (req, res) => {
  const out = {
    mainDb: process.env.MAIN_DB_NAME || 'question_management_shared',
    shengjuDb: process.env.SHENGJU_DB_NAME || process.env.TALENT_NETWORK_DB || '(未配置)',
    poolShengjuConfigured: !!poolShengju,
    batches: null,
    candidates: null,
    error: null,
    hint: ''
  };
  if (!poolShengju) {
    out.hint = '请在 .env 中配置 SHENGJU_DB_NAME=shengju（人才网库名），与主库同 host/user/password，重启后端后生效。';
    return res.json(out);
  }
  try {
    const [batchRows] = await poolShengju.execute(
      'SELECT batch_id, batch_name, COUNT(*) AS n FROM sj_exam_imported_candidates GROUP BY batch_id, batch_name LIMIT 5'
    );
    out.batches = { count: batchRows.length, sample: batchRows[0] || null };
    const [candRows] = await poolShengju.execute('SELECT * FROM sj_exam_imported_candidates LIMIT 3');
    out.candidates = { count: candRows.length, columns: candRows[0] ? Object.keys(candRows[0]) : [], sample: candRows[0] || null };
    out.hint = '人才网库可读。按批次导入会从 sj_exam_imported_candidates 按 batch_id 聚合显示批次。';
    return res.json(out);
  } catch (e) {
    out.error = e.message || String(e);
    out.code = e.code;
    if (e.code === 'ER_NO_SUCH_TABLE') out.hint = 'sj_exam_imported_candidates 不在当前库，请确认 SHENGJU_DB_NAME 指向人才网库（如 shengju）。';
    else if (e.code === 'ER_BAD_FIELD_ERROR') out.hint = '表字段与代码预期不一致，请核对 batch_id、batch_name、real_name、exam_number、id_card 等列名。';
    return res.status(200).json(out);
  }
});

// 之后的接口均需登录鉴权
router.use(authenticate);
const EnterpriseModel = require('../models/enterpriseModel');
// 企业身份补充：支持人才网企业登录（token 中带 enterpriseId）
router.use(async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'enterprise') {
      if (req.user.enterpriseId) {
        req.enterpriseId = req.user.enterpriseId;
      } else {
        try {
          const ent = await EnterpriseModel.findByUserId(req.user.id);
          if (!ent || ent.status !== 'approved') {
            return res.status(403).json({ success: false, message: '企业未审核通过' });
          }
          req.enterpriseId = ent.id;
        } catch (dbErr) {
          console.warn('[exam-imports] enterprise lookup failed:', dbErr.message);
          return res.status(503).json({
            success: false,
            message: '企业信息暂不可用（数据库表或连接异常），请稍后重试或联系管理员'
          });
        }
      }
    }
    next();
  } catch (e) {
    console.error('[exam-imports] middleware error:', e.message);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

// 企业/管理员：获取待导入批次列表（管理员看全部；企业仅本企业主库批次 + 已在 compat 登记的 sj_ 批次）
router.get('/batches', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const { status = 'INIT' } = req.query;
    const qStatus = String(status || '').trim() || 'INIT';
    let sql = `SELECT id, candidate_batch_id, batch_name, exam_time, exam_location, candidate_count,
              status, enterprise_name, imported_exam_id, imported_at, remark, created_at
       FROM exam_import_batches
       WHERE status = ?`;
    const params = [qStatus];
    if (req.user.role === 'enterprise') {
      const batchCols = await getExamImportBatchColumnFlags(pool);
      if (!batchCols.sourceCompanyId) {
        sql += ' AND 1=0';
      } else {
        const enterpriseId = req.user.enterpriseId || req.enterpriseId;
        const ent = enterpriseId ? await EnterpriseModel.findById(enterpriseId) : null;
        if (!ent) {
          sql += ' AND 1=0';
        } else if (ent.talent_company_id != null && ent.talent_company_id !== '') {
          sql += ' AND source_company_id = ?';
          params.push(Number(ent.talent_company_id));
        } else {
          sql += ' AND (source_company_id IS NULL OR source_company_id = 0)';
        }
      }
    }
    sql += ' ORDER BY created_at DESC, id DESC';

    let rows = [];
    let listWarning = '';
    try {
      const [r] = await pool.execute(sql, params);
      rows = r || [];
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        rows = [];
        listWarning =
          '主库缺少 exam_import_batches 等表。请执行 backend/database/migrate_exam_imports.sql；若已执行过旧版脚本，请补执行 migrate_exam_imports_add_source.sql。';
      } else if (err.code === 'ER_BAD_FIELD_ERROR') {
        rows = [];
        console.warn('[exam-imports/batches] 表结构与查询不一致:', err.message);
        listWarning =
          '考生导入表结构过旧或与后端不一致。请按顺序执行 migrate_exam_imports.sql、migrate_exam_imports_add_source.sql 后重启后端。';
      } else {
        throw err;
      }
    }
    for (const r of rows) {
      if (Number(r.candidate_count) === 0) {
        try {
          const [cnt] = await pool.execute('SELECT COUNT(*) AS n FROM exam_import_candidates WHERE import_batch_id = ?', [r.id]);
          r.candidate_count = (cnt && cnt[0] && cnt[0].n) ? Number(cnt[0].n) : 0;
        } catch (_) {}
      }
    }
    const list = rows.map(r => ({
      id: r.id,
      candidateBatchId: r.candidate_batch_id,
      batchName: r.batch_name,
      examTime: r.exam_time,
      examLocation: r.exam_location,
      candidateCount: Number(r.candidate_count) || 0,
      status: r.status,
      enterpriseName: r.enterprise_name,
      importedExamId: r.imported_exam_id,
      importedAt: r.imported_at,
      remark: r.remark,
      createdAt: r.created_at
    }));
    try {
      const sjList =
        req.user.role === 'admin'
          ? await fetchSjBatches()
          : await fetchSjBatchesForEnterprise(req.user.enterpriseId || req.enterpriseId);
      list.push(...sjList);
      list.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') {
        console.warn('[exam-imports/batches] fetchSjBatches error:', e.message);
      }
    }
    const payload = { success: true, data: list };
    if (typeof listWarning === 'string' && listWarning) payload.warning = listWarning;
    return res.json(payload);
  } catch (e) {
    console.error('[exam-imports/batches] error:', e);
    if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') {
      return res.json({
        success: true,
        data: [],
        warning:
          '考生导入相关表未就绪或结构不匹配。请在主库执行 migrate_exam_imports.sql（及 migrate_exam_imports_add_source.sql），并配置人才网库 SHENGJU_DB_NAME 如需从人才网读批次。'
      });
    }
    return res.status(500).json({ success: false, message: e.message || '获取导入批次列表失败' });
  }
});

// 企业/管理员：删除待导入批次（仅 INIT 状态可删；企业端仅能删本企业批次）
router.delete('/batches/:id', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const rawId = req.params.id;
    if (typeof rawId === 'string' && rawId.startsWith('sj_')) {
      return res.status(400).json({ success: false, message: '人才网批次不支持在此删除，请在人才网侧操作' });
    }
    const id = parseInt(rawId, 10);
    if (!id || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的批次ID' });
    }
    const [rows] = await pool.execute(
      'SELECT id, status, source_company_id FROM exam_import_batches WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '批次不存在或已删除' });
    }
    const batch = rows[0];
    if (batch.status !== 'INIT') {
      return res.status(400).json({ success: false, message: '仅可删除未导入的批次（INIT 状态）' });
    }
    if (req.user.role === 'enterprise') {
      const enterpriseId = req.user.enterpriseId || req.enterpriseId;
      const ent = enterpriseId ? await EnterpriseModel.findById(enterpriseId) : null;
      if (!ent) {
        return res.status(403).json({ success: false, message: '仅能删除本企业上传的批次' });
      }
      const batchSc = batch.source_company_id == null ? null : Number(batch.source_company_id);
      const entTc = ent.talent_company_id == null || ent.talent_company_id === '' ? null : Number(ent.talent_company_id);
      if (entTc != null) {
        if (batchSc !== entTc) return res.status(403).json({ success: false, message: '仅能删除本企业上传的批次' });
      } else {
        if (batchSc != null && batchSc !== 0) return res.status(403).json({ success: false, message: '仅能删除本企业上传的批次' });
      }
    }
    await pool.execute('DELETE FROM exam_import_candidates WHERE import_batch_id = ?', [id]);
    await pool.execute('DELETE FROM exam_import_batches WHERE id = ?', [id]);
    return res.json({ success: true, message: '已删除该导入批次' });
  } catch (e) {
    console.error('[exam-imports/delete batch] error:', e);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

// 企业/管理员：查看某导入批次的考生明细（企业端仅能查看本企业批次）
router.get('/batches/:id/candidates', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const rawId = req.params.id;
    const isSjBatch = typeof rawId === 'string' && rawId.startsWith('sj_');
    const sjBatchIdStr = isSjBatch ? String(rawId).replace(/^sj_/, '').trim() : '';
    const importBatchId = isSjBatch ? null : parseInt(rawId, 10);
    if (isSjBatch) {
      if (!sjBatchIdStr) {
        return res.status(400).json({ success: false, message: '无效的批次' });
      }
      if (req.user.role === 'enterprise') {
        const enterpriseId = req.user.enterpriseId || req.enterpriseId;
        const allowed = await enterpriseHasSjBatchAccess(enterpriseId, sjBatchIdStr);
        if (!allowed) {
          return res.status(403).json({ success: false, message: '仅能查看本企业名下的考生批次' });
        }
      }
      let list = [];
      if (poolShengju) {
        try {
          const [rows] = await poolShengju.execute(
            'SELECT * FROM sj_exam_imported_candidates WHERE batch_id = ? ORDER BY id ASC',
            [sjBatchIdStr]
          );
          list = (rows || []).map((r, idx) => {
            const n = normalizeSjImportedRow(r);
            if (!n || !n.name) return null;
            return {
              id: n.id != null ? n.id : idx + 1,
              examNo: n.exam_no || null,
              name: n.name,
              idNumber: n.id_number || null,
              mobile: n.mobile || null,
              email: n.email || null,
              gender: r.gender || null,
              positionName: n.position_name || null,
              extraInfo: n.extra_info || null,
              importStatus: 'PENDING',
              errorMsg: null,
              createdAt: r.created_at || null
            };
          }).filter(Boolean);
        } catch (e) {
          if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        }
      }
      const named = list.filter((x) => x.name);
      if (!named.length) {
        let compat = null;
        if (req.user.role === 'enterprise') {
          const enterpriseId = req.user.enterpriseId || req.enterpriseId;
          compat = await fetchCompatBatchPayload(enterpriseId, sjBatchIdStr);
        } else {
          compat = await fetchCompatBatchPayloadByBatchId(sjBatchIdStr);
        }
        if (compat && compat.allocations.length) {
          list = compatAllocationsToApiCandidates(compat.allocations);
        }
      } else {
        list = named;
      }
      return res.json({ success: true, data: list });
    }

    if (!importBatchId || !Number.isFinite(importBatchId)) {
      return res.status(400).json({ success: false, message: '无效的批次ID' });
    }
    if (req.user.role === 'enterprise') {
      const enterpriseId = req.user.enterpriseId || req.enterpriseId;
      const ent = enterpriseId ? await EnterpriseModel.findById(enterpriseId) : null;
      if (ent) {
        if (ent.talent_company_id != null && ent.talent_company_id !== '') {
          const [batchCheck] = await pool.execute(
            'SELECT id FROM exam_import_batches WHERE id = ? AND source_company_id = ? LIMIT 1',
            [importBatchId, ent.talent_company_id]
          );
          if (!batchCheck.length) return res.status(403).json({ success: false, message: '仅能查看本企业上传的批次' });
        } else {
          const [batchCheck] = await pool.execute(
            'SELECT id FROM exam_import_batches WHERE id = ? AND (source_company_id IS NULL OR source_company_id = 0) LIMIT 1',
            [importBatchId]
          );
          if (!batchCheck.length) return res.status(403).json({ success: false, message: '仅能查看本企业上传的批次' });
        }
      } else {
        return res.status(403).json({ success: false, message: '企业信息不存在' });
      }
    }
    const [rows] = await pool.execute(
      `SELECT id, exam_no, name, id_number, mobile, email, gender, position_name,
              extra_info, import_status, error_msg, created_at
       FROM exam_import_candidates
       WHERE import_batch_id = ?
       ORDER BY id ASC`,
      [importBatchId]
    );
    const list = rows.map(r => ({
      id: r.id,
      examNo: r.exam_no,
      name: r.name,
      idNumber: r.id_number,
      mobile: r.mobile,
      email: r.email,
      gender: r.gender,
      positionName: r.position_name,
      extraInfo: r.extra_info,
      importStatus: r.import_status,
      errorMsg: r.error_msg,
      createdAt: r.created_at
    }));
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error('[exam-imports/batches/:id/candidates] error:', e);
    return res.status(500).json({ success: false, message: e.message || '获取导入批次考生失败' });
  }
});

// 企业/管理员：执行导入，将某导入批次的考生批量写入 exam_enrollments / users
router.post('/batches/:id/import', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const rawId = req.params.id;
    const isSjBatch = typeof rawId === 'string' && rawId.startsWith('sj_');
    const sjBatchIdStr = isSjBatch ? String(rawId).replace(/^sj_/, '').trim() : '';
    const importBatchId = isSjBatch ? null : parseInt(rawId, 10);
    const examId = parseInt(req.body.examId || req.query.examId, 10);
    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId 为必填' });
    }
    if (isSjBatch && !sjBatchIdStr) {
      return res.status(400).json({ success: false, message: '无效的批次' });
    }
    if (!isSjBatch && (!importBatchId || !Number.isFinite(importBatchId))) {
      return res.status(400).json({ success: false, message: '导入批次ID为必填' });
    }

    const ExamModel = require('../models/examModel');
    const EnterpriseModel = require('../models/enterpriseModel');
    const UserModel = require('../models/userModel');
    const ExamEnrollmentModel = require('../models/examEnrollmentModel');

    const exam = await ExamModel.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: '考试不存在' });
    }

    let ent = null;
    if (req.user.role === 'enterprise') {
      const enterpriseId = req.user.enterpriseId || req.enterpriseId;
      ent = enterpriseId ? await EnterpriseModel.findById(enterpriseId) : await EnterpriseModel.findByUserId(req.user.id);
      if (!ent || exam.enterprise_id !== ent.id) {
        return res.status(403).json({ success: false, message: '无权限导入该考试的考生' });
      }
    }

    if (isSjBatch && req.user.role === 'enterprise') {
      const enterpriseId = req.user.enterpriseId || req.enterpriseId;
      const allowed = await enterpriseHasSjBatchAccess(enterpriseId, sjBatchIdStr);
      if (!allowed) {
        return res.status(403).json({ success: false, message: '仅能导入本企业名下的考生批次' });
      }
    }

    let candidates = [];
    if (isSjBatch) {
      if (poolShengju) {
        try {
          const [rows] = await poolShengju.execute(
            'SELECT * FROM sj_exam_imported_candidates WHERE batch_id = ?',
            [sjBatchIdStr]
          );
          candidates = (rows || []).map((r) => normalizeSjImportedRow(r)).filter((x) => x && x.name);
        } catch (e) {
          if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        }
      }
      candidates = candidates.filter((c) => (c.name || '').trim());
      if (!candidates.length) {
        let compat = null;
        if (req.user.role === 'enterprise') {
          const enterpriseId = req.user.enterpriseId || req.enterpriseId;
          compat = await fetchCompatBatchPayload(enterpriseId, sjBatchIdStr);
        } else {
          compat = await fetchCompatBatchPayloadByBatchId(sjBatchIdStr);
        }
        if (compat && compat.allocations.length) {
          candidates = compatAllocationsToImportCandidates(compat.allocations);
        }
      }
    }
    if (!isSjBatch) {
      const [batchRows] = await pool.execute(
        'SELECT id, status, batch_name, source_company_id FROM exam_import_batches WHERE id = ? LIMIT 1',
        [importBatchId]
      );
      if (!batchRows.length) {
        return res.status(404).json({ success: false, message: '导入批次不存在' });
      }
      const batch = batchRows[0];
      if (batch.status === 'IMPORTED') {
        return res.status(400).json({ success: false, message: '该批次已导入，不可重复导入' });
      }
      const [candRows] = await pool.execute(
        `SELECT id, exam_no, name, id_number, mobile, email, gender, position_name, extra_info
         FROM exam_import_candidates WHERE import_batch_id = ?`,
        [importBatchId]
      );
      candidates = candRows || [];
    }

    if (!candidates.length) {
      return res.status(400).json({ success: false, message: '该导入批次下暂无考生' });
    }

    const results = { success: [], fail: [] };
    const userIds = [];
    const resolved = [];
    for (let i = 0; i < candidates.length; i++) {
      const row = candidates[i];
      const real_name = (row.name || '').trim();
      if (!real_name) {
        results.fail.push({ index: i + 1, reason: '姓名为空' });
        continue;
      }
      let extra = {};
      try {
        if (row.extra_info) extra = typeof row.extra_info === 'string' ? JSON.parse(row.extra_info) : row.extra_info;
      } catch (_) {}
      const education = extra.education != null ? String(extra.education).trim() : '';
      const job_code = extra.job_code != null ? String(extra.job_code).trim() : '';
      const id_card_front = extra.id_card_front != null ? String(extra.id_card_front).trim() : '';
      const id_card_back = extra.id_card_back != null ? String(extra.id_card_back).trim() : '';
      const id_card_image_url =
        id_card_front ||
        id_card_back ||
        (extra.photo_url != null ? String(extra.photo_url).trim() : '') ||
        (extra.photoUrl != null ? String(extra.photoUrl).trim() : '');
      const examNo = (row.exam_no || '').toString().trim();
      const loginUsername =
        (row.login_username || '').toString().trim() ||
        pickLoginUsernameFromRow(row, extra, examNo) ||
        (extra.login_username != null ? String(extra.login_username).trim() : '');
      const fromSjBatch = !!isSjBatch;
      try {
        const r = await UserModel.createCandidateOrFind({
          real_name,
          username: loginUsername,
          exam_number: examNo,
          id_card: row.id_number || '',
          phone: row.mobile || '',
          position: row.position_name || '',
          email: row.email || '',
          education: education || undefined,
          job_code: job_code || undefined
        }, {});
        if (!r.success) {
          results.fail.push({ index: i + 1, reason: r.error || '创建失败' });
          continue;
        }
        userIds.push(r.userId);
        resolved.push({ real_name, userId: r.userId });
        if (id_card_image_url) {
          try {
            const updated = await UserModel.updateIdCardImagePath(r.userId, id_card_image_url);
            if (!updated) {
              console.warn('[exam-imports] 身份证照写入失败(可能缺列)，userId=', r.userId, '请执行: node scripts/run_id_card_image_migration.js');
            }
          } catch (e) {
            console.warn('[exam-imports] 身份证照写入异常 userId=', r.userId, e.message);
          }
        }
        results.success.push({ index: i + 1, name: real_name, userId: r.userId, isNew: r.isNew });
      } catch (err) {
        results.fail.push({ index: i + 1, reason: err.message || '用户创建/查找失败' });
      }
    }

    const existing = await ExamEnrollmentModel.listByExam(examId);
    const existingIds = new Set(existing.map(e => e.user_id));
    const toAdd = [...new Set(userIds.filter(id => !existingIds.has(id)))];
    let added = 0;
    if (toAdd.length > 0) {
      const created = await ExamEnrollmentModel.bulkCreate(examId, toAdd);
      added = created.length;
    }
    let relinked = 0;
    if (resolved.length) {
      relinked = await relinkEnrollmentsByResolvedCandidates(
        ExamEnrollmentModel,
        UserModel,
        examId,
        existing,
        resolved
      );
    }

    // 更新导入批次状态与导入明细（仅笔试系统自己的批次表；sj_ 批次不写回）
    if (!isSjBatch) {
      try {
        await pool.execute(
          `UPDATE exam_import_batches
             SET status = 'IMPORTED', imported_exam_id = ?, imported_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [examId, importBatchId]
        );
        if (results.fail.length > 0) {
          const failIds = results.fail.map((f, idx) => candidates[idx]?.id).filter(Boolean);
          if (failIds.length > 0) {
            await pool.execute(
              `UPDATE exam_import_candidates
                 SET import_status = 'FAILED', error_msg = '导入失败（请查看详情）'
               WHERE id IN (${failIds.map(() => '?').join(',')})`,
              failIds
            );
          }
        }
        if (added > 0) {
          await pool.execute(
            `UPDATE exam_import_candidates SET import_status = 'SUCCESS' WHERE import_batch_id = ?`,
            [importBatchId]
          );
        }
      } catch (e) {
        console.warn('[exam-imports] 更新导入状态失败:', e.message);
      }
    }

    const effectiveBatchId = isSjBatch ? rawId : importBatchId;
    return res.json({
      success: true,
      data: {
        importBatchId: effectiveBatchId,
        examId,
        total: candidates.length,
        added,
        relinked,
        failed: results.fail.length,
        skipped: userIds.length - toAdd.length,
        details: results
      }
    });
  } catch (e) {
    console.error('[exam-imports/batches/:id/import] error:', e);
    return res.status(500).json({ success: false, message: e.message || '执行批次导入失败' });
  }
});

module.exports = router;

