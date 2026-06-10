const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const ExamModel = require('../models/examModel');
const EnterpriseModel = require('../models/enterpriseModel');

// P1 优化：报名回填互斥锁（同一 examId 同时只允许一个回填任务）
const backfillLocks = new Map();
const UserModel = require('../models/userModel');
const { pool, poolShengju } = require('../config/database');
const { normalizeSjImportedRow } = require('../utils/sjImportedCandidateNormalize');
const { pickLoginUsernameFromRow } = require('../utils/candidateLoginUsername');
const { authenticate, requireRole } = require('../middleware/auth');

/** 从导入池 / sj 行 extra 根级字段取人像 URL（与 compatAllocations 的 photo_url、报名表 attachments 对齐） */
function pickIdCardUrlFromPoolExtra(extra) {
  if (!extra || typeof extra !== 'object') return '';
  const fromNested = pickIdCardImageUrlFromCoopExtra(extra);
  if (fromNested) return fromNested;
  const keys = [
    'id_card_front',
    'id_card_back',
    'photo_url',
    'photoUrl',
    'idPhoto',
    'id_photo_url',
    'idCardImageUrl',
    'facePhoto',
    'face_photo',
    '人像照',
    '身份证正面'
  ];
  for (const k of keys) {
    const s = extra[k] != null ? String(extra[k]).trim() : '';
    if (
      s.length > 8 &&
      !s.startsWith('blob:') &&
      !s.startsWith('data:')
    ) {
      return s;
    }
  }
  return '';
}

function mergePoolExtraIntoRowFields(poolRow, extra) {
  let exam_no = (poolRow.exam_no || '').toString().trim();
  let id_number = (poolRow.id_number || '').toString().trim();
  let mobile = (poolRow.mobile || '').toString().replace(/\D/g, '');
  let position_name = (poolRow.position_name || '').toString().trim();
  let job_code = extra.job_code != null ? String(extra.job_code).trim() : '';
  if (!job_code && extra.position_code != null) job_code = String(extra.position_code).trim();
  if (!job_code && extra.jobCode != null) job_code = String(extra.jobCode).trim();
  if (!job_code && extra['岗位代码'] != null) job_code = String(extra['岗位代码']).trim();
  if (!job_code && extra['职位代码'] != null) job_code = String(extra['职位代码']).trim();
  if (!job_code && poolRow && poolRow.job_code != null) job_code = String(poolRow.job_code).trim();
  if (!exam_no) {
    exam_no = String(
      extra.exam_number ||
        extra.exam_no ||
        extra.examNo ||
        extra.admit_card_number ||
        extra.admitCardNumber ||
        extra.examNumber ||
        extra.ticket_no ||
        extra.ticketNo ||
        extra.准考证号 ||
        extra.考号 ||
        ''
    ).trim();
  }
  if (!id_number) {
    id_number = String(
      extra.id_card || extra.id_number || extra.idNumber || extra.certificate_no || extra.身份证号 || ''
    ).trim();
  }
  if (!mobile) mobile = String(extra.mobile || extra.phone || extra.手机号 || extra.联系电话 || '').replace(/\D/g, '');
  if (!position_name) {
    position_name = String(
      extra.position_name ||
        extra.position ||
        extra.jobTitle ||
        extra.job_title ||
        extra.岗位 ||
        extra.报考岗位 ||
        ''
    ).trim();
  }
  return { exam_no, id_number, mobile, position_name, job_code };
}

async function mergePoolRowIntoUser(uid, poolRow) {
  let extra = {};
  try {
    if (poolRow.extra_info) {
      extra = typeof poolRow.extra_info === 'string' ? JSON.parse(poolRow.extra_info) : poolRow.extra_info;
    }
  } catch (_) {
    extra = {};
  }
  if (!extra || typeof extra !== 'object') extra = {};
  const merged = mergePoolExtraIntoRowFields(poolRow, extra);
  const education = extra.education != null ? String(extra.education).trim() : '';
  const job_code =
    merged.job_code ||
    (extra.job_code != null ? String(extra.job_code).trim() : '') ||
    (extra.position_code != null ? String(extra.position_code).trim() : '') ||
    (poolRow.job_code != null ? String(poolRow.job_code).trim() : '') ||
    (poolRow.position_code != null ? String(poolRow.position_code).trim() : '');
  await UserModel.mergeCandidateProfileFieldsSafe(uid, {
    phone: merged.mobile || (poolRow.mobile || '').toString().replace(/\D/g, ''),
    id_card: merged.id_number,
    exam_number: merged.exam_no,
    position: merged.position_name,
    email: (poolRow.email || '').toString().trim(),
    education,
    job_code
  });
  /** extra 内无图时：sj 表顶层 / 归一化行上的证件照 URL（此前 sj 补全只传 7 个字段会整列丢失） */
  const imgUrl = pickIdCardUrlFromPoolExtra(extra) || pickIdCardUrlFromPoolExtra(poolRow);
  if (imgUrl) {
    try {
      await UserModel.updateIdCardImagePath(uid, imgUrl);
    } catch (_) {
      /* 缺列等忽略 */
    }
  }
}

/** 主库 exam_import_candidates：仅当该考试曾从导入池导入且写入了 imported_exam_id */
async function backfillFromExamImportCandidates(eid, enrollments) {
  const [batches] = await pool.execute(
    `SELECT id FROM exam_import_batches
     WHERE imported_exam_id = ? AND status = 'IMPORTED'
     ORDER BY imported_at DESC, id DESC LIMIT 5`,
    [eid]
  );
  if (!batches || !batches.length) return;
  const batchIds = batches.map((b) => b.id);
  const ph = batchIds.map(() => '?').join(',');
  const [cands] = await pool.execute(
    `SELECT name, exam_no, id_number, mobile, email, position_name, extra_info
     FROM exam_import_candidates WHERE import_batch_id IN (${ph})`,
    batchIds
  );
  if (!cands || !cands.length) return;
  const byName = new Map();
  for (const c of cands) {
    const nm = (c.name || '').toString().trim();
    if (!nm) continue;
    const key = nm.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(c);
  }
  for (const en of enrollments) {
    const uid = en.user_id != null ? Number(en.user_id) : null;
    if (!uid || !Number.isFinite(uid)) continue;
    const nm = (en.real_name || '').toString().trim();
    if (!nm) continue;
    const poolList = byName.get(nm.toLowerCase());
    if (!poolList || !poolList.length) continue;
    let poolRow = poolList[0];
    const enExam = (en.exam_number || '').toString().trim();
    if (enExam) {
      const hit = poolList.find((r) => (r.exam_no || '').toString().trim() === enExam);
      if (hit) poolRow = hit;
    }
    try {
      await mergePoolRowIntoUser(uid, poolRow);
    } catch (_) {
      /* 忽略单行 */
    }
  }
}

/**
 * 企业端 compat_exam_allocation_batches.payload_json（考试分配）按姓名补全；覆盖 sj_ 导入未写 imported_exam_id 的情况。
 */
async function backfillFromCompatAllocationPayloads(eid, enrollments) {
  let exam;
  try {
    exam = await ExamModel.findById(eid);
  } catch {
    return;
  }
  if (!exam || exam.enterprise_id == null) return;
  const entId = Number(exam.enterprise_id);
  if (!Number.isFinite(entId) || entId <= 0) return;
  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT payload_json FROM compat_exam_allocation_batches
       WHERE enterprise_id = ? ORDER BY updated_at DESC, id DESC LIMIT 40`,
      [entId]
    );
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return;
    throw e;
  }
  if (!rows || !rows.length) return;
  const byName = new Map();
  for (const row of rows) {
    let payload = {};
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : {};
    } catch {
      continue;
    }
    const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
    for (const rec of allocations) {
      const name = (rec.candidateName || rec.candidate_name || '').toString().trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(rec);
    }
  }
  if (!byName.size) return;
  for (const en of enrollments) {
    const uid = en.user_id != null ? Number(en.user_id) : null;
    if (!uid || !Number.isFinite(uid)) continue;
    const nm = (en.real_name || '').toString().trim();
    if (!nm) continue;
    const recList = byName.get(nm.toLowerCase());
    if (!recList || !recList.length) continue;
    let rec = recList[0];
    const enPhone = normPhoneEnrollment(en.phone);
    if (recList.length > 1 && enPhone.length >= 10) {
      const pickPhone = (r) =>
        String(
          r.phone ||
            r.mobile ||
            r.candidatePhone ||
            r.candidate_phone ||
            r.tel ||
            r.contactPhone ||
            r.contact_phone ||
            (r['手机号'] != null ? r['手机号'] : '') ||
            (r['联系电话'] != null ? r['联系电话'] : '') ||
            ''
        ).replace(/\D/g, '');
      const byPh = recList.find((r) => pickPhone(r) === enPhone);
      if (byPh) rec = byPh;
    }
    const enExam = (en.exam_number || '').toString().trim();
    const admit = (r) =>
      String(
        r.admitCardNumber ||
          r.admit_card_number ||
          r.examNumber ||
          r.exam_number ||
          r.exam_no ||
          r.ticket_no ||
          r.ticketNo ||
          r.准考证号 ||
          r.考号 ||
          r['准考证号'] ||
          ''
      ).trim();
    if (enExam) {
      const hit = recList.find((r) => admit(r) === enExam);
      if (hit) rec = hit;
    }
    const phone = String(
      rec.phone ||
        rec.mobile ||
        rec.candidatePhone ||
        rec.candidate_phone ||
        rec.tel ||
        rec.contactPhone ||
        rec.contact_phone ||
        (rec['手机号'] != null ? rec['手机号'] : '') ||
        (rec['联系电话'] != null ? rec['联系电话'] : '') ||
        ''
    ).replace(/\D/g, '');
    const exam_number = admit(rec);
    const position = String(
      rec.jobTitle || rec.job_title || rec.job || rec.position || rec.positionName || rec.position_name || ''
    ).trim();
    const id_card = String(
      rec.idCard || rec.id_card || rec.idNumber || rec.id_number || rec.certificate_no || rec.certificateNo || ''
    ).trim();
    const email = String(rec.email || rec.mail || '').trim();
    let education = '';
    let job_code = '';
    if (rec.education != null) education = String(rec.education).trim();
    if (!education && rec.educationLevel != null) education = String(rec.educationLevel).trim();
    if (!education && rec.degree != null) education = String(rec.degree).trim();
    if (rec.job_code != null) job_code = String(rec.job_code).trim();
    if (rec.jobCode != null && !job_code) job_code = String(rec.jobCode).trim();
    if (rec.position_code != null && !job_code) job_code = String(rec.position_code).trim();
    if (rec.positionCode != null && !job_code) job_code = String(rec.positionCode).trim();
    if (rec['岗位代码'] != null && !job_code) job_code = String(rec['岗位代码']).trim();
    if (rec['职位代码'] != null && !job_code) job_code = String(rec['职位代码']).trim();
    try {
      await UserModel.mergeCandidateProfileFieldsSafe(uid, {
        phone,
        id_card,
        exam_number,
        position,
        email,
        education,
        job_code
      });
      const photoUrl = String(
        rec.photoUrl || rec.photo_url || rec.photo || rec.idCardFront || rec.id_card_front || ''
      ).trim();
      if (photoUrl.length > 8 && !photoUrl.startsWith('blob:')) {
        try {
          await UserModel.updateIdCardImagePath(uid, photoUrl);
        } catch (_) {
          /* 缺列等忽略 */
        }
      }
    } catch (_) {
      /* 忽略单行 */
    }
  }
}

/**
 * 从人才网库 sj_exam_imported_candidates 按企业 compat 批次补全（解决仅写入报名、未走导入池 imported_exam_id 时档案仍空）。
 */
async function backfillFromSjImportedCandidates(eid, enrollments) {
  // 同机仅配主库、未设 SHENGJU_DB_NAME 时 poolShengju 为空，但 sj_ 表往往在主库（如 shengju），需用 pool 查
  const sjPool = poolShengju || pool;
  if (!sjPool) return;
  let exam;
  try {
    exam = await ExamModel.findById(eid);
  } catch {
    return;
  }
  if (!exam || exam.enterprise_id == null) return;
  const entId = Number(exam.enterprise_id);
  if (!Number.isFinite(entId) || entId <= 0) return;
  let batchRows;
  try {
    [batchRows] = await pool.execute(
      `SELECT DISTINCT batch_id FROM compat_exam_allocation_batches
       WHERE enterprise_id = ? AND batch_id IS NOT NULL AND TRIM(COALESCE(batch_id,'')) <> ''`,
      [entId]
    );
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return;
    throw e;
  }
  let batchIds = (batchRows || [])
    .map((r) => String(r.batch_id).trim())
    .filter(Boolean);
  batchIds = [...new Set(batchIds)];
  // compat 里尚无批次时，从 sj_ 表按企业直接取 batch_id（同库、仅未配 SHENGJU 名时常缺 compat 行）
  if (!batchIds.length) {
    try {
      const [rEnt] = await sjPool.execute(
        `SELECT DISTINCT batch_id FROM sj_exam_imported_candidates
         WHERE enterprise_id = ? AND batch_id IS NOT NULL AND TRIM(COALESCE(batch_id,'')) <> ''`,
        [entId]
      );
      if (rEnt && rEnt.length) {
        batchIds = [...new Set(rEnt.map((x) => String(x.batch_id).trim()).filter(Boolean))];
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') {
        /* ignore */
      }
    }
  }
  if (!batchIds.length) return;

  const chunkSize = 40;
  const allSj = [];
  for (let i = 0; i < batchIds.length; i += chunkSize) {
    const chunk = batchIds.slice(i, i + chunkSize);
    const ph = chunk.map(() => '?').join(',');
    try {
      const [rows] = await sjPool.execute(
        `SELECT * FROM sj_exam_imported_candidates WHERE batch_id IN (${ph})`,
        chunk
      );
      if (rows && rows.length) allSj.push(...rows);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  }
  // compat 的 batch_id 与 sj_ 中实际 batch_id 不完全一致时，IN 查询 0 行，改按企业拉全量（有上限避免拖垮）
  if (!allSj.length) {
    try {
      const [rowsEnt] = await sjPool.execute(
        `SELECT * FROM sj_exam_imported_candidates WHERE enterprise_id = ? LIMIT 10000`,
        [entId]
      );
      if (rowsEnt && rowsEnt.length) {
        for (const r of rowsEnt) {
          allSj.push(r);
        }
        if (rowsEnt.length) {
          console.warn(
            `[exam-enrollments] sj 按 batch_id 未命中企业 ${entId} 的 compat 批次，已回退为按 enterprise_id 拉取 ${rowsEnt.length} 行`
          );
        }
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') {
        console.warn('[exam-enrollments] sj enterprise_id 全量回退失败:', e.message);
      }
    }
  }
  if (!allSj.length) return;

  const byName = new Map();
  const byNamePhone = new Map();
  const byPhoneOnly = new Map();
  for (const r of allSj) {
    const n = normalizeSjImportedRow(r);
    if (!n || !n.name) continue;
    const key = n.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(n);
    const ph = normPhoneEnrollment(n.mobile);
    if (ph.length >= 10) {
      const k2 = `${key}|${ph}`;
      if (!byNamePhone.has(k2)) byNamePhone.set(k2, []);
      byNamePhone.get(k2).push(n);
      if (!byPhoneOnly.has(ph)) byPhoneOnly.set(ph, []);
      byPhoneOnly.get(ph).push(n);
    }
  }
  if (!byName.size && !byPhoneOnly.size) return;

  for (const en of enrollments) {
    const uid = en.user_id != null ? Number(en.user_id) : null;
    if (!uid || !Number.isFinite(uid)) continue;
    const nm = (en.real_name || '').toString().trim();
    const enPhone = normPhoneEnrollment(en.phone);
    if (!nm && enPhone.length < 10) continue;
    const nameKey = nm ? nm.toLowerCase() : '';
    let poolList =
      nm && enPhone.length >= 10 && byNamePhone.has(`${nameKey}|${enPhone}`)
        ? byNamePhone.get(`${nameKey}|${enPhone}`)
        : null;
    if (!poolList || !poolList.length) poolList = nm ? byName.get(nameKey) : null;
    if (!poolList || !poolList.length) {
      if (enPhone.length >= 10 && byPhoneOnly.has(enPhone)) {
        const pl = byPhoneOnly.get(enPhone);
        if (pl.length === 1) {
          poolList = pl;
        } else {
          const hit = nm
            ? pl.find((x) => (x.name || '').toString().trim().toLowerCase() === nameKey)
            : null;
          if (hit) poolList = [hit];
          else if (!nm) poolList = [pl[0]];
          else poolList = null;
        }
      }
    }
    if (!poolList || !poolList.length) continue;
    let poolRow = poolList[0];
    const enExam = (en.exam_number || '').toString().trim();
    if (enExam) {
      const hit = poolList.find((r) => (r.exam_no || '').toString().trim() === enExam);
      if (hit) poolRow = hit;
    } else if (poolList.length > 1 && nm) {
      const byNm = poolList.find((r) => (r.name || '').toString().trim().toLowerCase() === nameKey);
      if (byNm) poolRow = byNm;
    }
    try {
      await mergePoolRowIntoUser(uid, poolRow);
    } catch (_) {
      /* 忽略单行 */
    }
  }
}

function normPhoneEnrollment(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function normNameEnrollment(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase();
}

/** 与 enterprise/tests.html 报名表一致：extra_json.attachments 内身份证/人像图 URL */
/**
 * 报名表 extra_json 中的岗位代码（与考生管理 qms_users.job_code 对齐）。
 * 优先 basicInfo：与求职者表单一致，避免根级旧字段覆盖企业端看到的「报考岗位代码」。
 */
function pickJobCodeFromCoopExtra(extra) {
  if (!extra || typeof extra !== 'object') return '';
  const basic = extra.basicInfo && typeof extra.basicInfo === 'object' ? extra.basicInfo : {};
  const fromBasic = String(
    basic.positionCode ||
      basic.position_code ||
      basic.job_code ||
      basic.jobCode ||
      ''
  ).trim();
  if (fromBasic) return fromBasic;
  return String(
    extra.job_code ||
      extra.position_code ||
      extra.jobCode ||
      extra.positionCode ||
      (extra['岗位代码'] != null ? extra['岗位代码'] : '') ||
      (extra['职位代码'] != null ? extra['职位代码'] : '') ||
      ''
  ).trim();
}

function pickIdCardImageUrlFromCoopExtra(extra) {
  if (!extra || typeof extra !== 'object') return '';
  const att = extra.attachments && typeof extra.attachments === 'object' ? extra.attachments : {};
  const keys = [
    att.id_card_front,
    att.id_card,
    att.idCardFront,
    att.id_card_back,
    att.idCardBack,
    att.photo
  ];
  for (const c of keys) {
    const s = c != null ? String(c).trim() : '';
    if (
      s.length > 8 &&
      !s.startsWith('blob:') &&
      !s.startsWith('data:')
    ) {
      return s;
    }
  }
  return '';
}

/**
 * 从人才网 compat_cooperation_applications.extra_json 补全 qms_users.id_card_image_path（企业端已提交身份证照时）。
 * 匹配：① 报名 user_id 与考生账号 id 相同 ② 手机号+姓名 ③ 仅姓名且唯一。
 */
async function backfillFromCompatCooperationApplications(eid, enrollments) {
  let exam;
  try {
    exam = await ExamModel.findById(eid);
  } catch {
    return false;
  }
  if (!exam || exam.enterprise_id == null) return false;
  const entId = Number(exam.enterprise_id);
  if (!Number.isFinite(entId) || entId <= 0) return false;
  if (!enrollments || !enrollments.length) return false;

  const targets = enrollments.filter((en) => {
    const p = en.id_card_image_path != null ? String(en.id_card_image_path).trim() : '';
    const jc = en.job_code != null ? String(en.job_code).trim() : '';
    return !p || !jc;
  });

  let coopRows;
  try {
    [coopRows] = await pool.execute(
      `SELECT a.user_id AS coop_user_id, a.extra_json, a.project_id,
              NULLIF(TRIM(COALESCE(p.job_code, '')), '') AS project_job_code
       FROM compat_cooperation_applications a
       LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
       LEFT JOIN compat_announcements an ON an.id = a.announcement_id
       WHERE (
         (a.enterprise_id IS NOT NULL AND CAST(a.enterprise_id AS UNSIGNED) = ?)
         OR (p.enterprise_id IS NOT NULL AND CAST(p.enterprise_id AS UNSIGNED) = ?)
         OR (an.enterprise_id IS NOT NULL AND CAST(an.enterprise_id AS UNSIGNED) = ?)
       )
       ORDER BY a.updated_at DESC
       LIMIT 5000`,
      [entId, entId, entId]
    );
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  }
  if (!coopRows || !coopRows.length) return false;

  const apps = [];
  for (const row of coopRows) {
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch {
      continue;
    }
    const url = pickIdCardImageUrlFromCoopExtra(extra);
    const fromExtra = pickJobCodeFromCoopExtra(extra);
    /** 公告/附加岗位在企业端维护的 canonical 代码在 compat_enterprise_projects.job_code，优先于报名表 JSON（避免 extra 里旧码覆盖「新建岗位」里的 02） */
    const pj = row.project_job_code != null ? String(row.project_job_code).trim() : '';
    const job_code = pj || fromExtra;
    /** 仅有岗位代码、或仅有证件图时也应参与匹配（旧逻辑要求必有 url 才入队，导致 job_code 永远不补） */
    if (!url && !job_code) continue;
    const basic = extra.basicInfo && typeof extra.basicInfo === 'object' ? extra.basicInfo : {};
    const coopUid = row.coop_user_id != null ? Number(row.coop_user_id) : null;
    apps.push({
      coopUserId: Number.isFinite(coopUid) && coopUid > 0 ? coopUid : null,
      phone: normPhoneEnrollment(
        basic.phone || basic.mobile || basic.tel || basic.contactPhone || basic.contact_phone || ''
      ),
      name: normNameEnrollment(basic.name || basic.realName || basic.real_name || ''),
      url,
      job_code,
      project_job_code: pj
    });
  }
  if (!apps.length) return false;

  function pickMatchedApp(uid, enPhone, enName) {
    for (const a of apps) {
      if (a.coopUserId != null && a.coopUserId === uid) return a;
    }
    if (enPhone && enName) {
      const hit = apps.find((a) => a.phone === enPhone && a.name === enName);
      if (hit) return hit;
    }
    return null;
  }

  let wrote = false;
  if (targets.length) {
    for (const en of targets) {
      const uid = en.user_id != null ? Number(en.user_id) : null;
      if (!uid || !Number.isFinite(uid)) continue;
      const enPhone = normPhoneEnrollment(en.phone);
      const enName = normNameEnrollment(en.real_name);
      const matched = pickMatchedApp(uid, enPhone, enName);
      if (!matched) continue;
      const noPic = !(en.id_card_image_path != null && String(en.id_card_image_path).trim());
      const noJob = !(en.job_code != null && String(en.job_code).trim());
      try {
        /** 先写岗位代码：避免证件 URL 超长抛错时整条 try 跳过，岗位代码也落不了库 */
        if (noJob && matched.job_code) {
          try {
            await UserModel.mergeCandidateProfileFieldsSafe(uid, { job_code: matched.job_code });
            wrote = true;
          } catch (eJ) {
            console.warn('[coop-backfill] job_code user', uid, eJ.message || eJ);
          }
        }
        if (noPic && matched.url) {
          try {
            const ok = await UserModel.updateIdCardImagePath(uid, matched.url);
            if (ok) wrote = true;
          } catch (eI) {
            console.warn('[coop-backfill] id_card_image_path user', uid, eI.message || eI);
          }
        }
      } catch (_) {
        /* 单行失败忽略 */
      }
    }
  }

  /** 已有 job_code 但与报考项目表 job_code 不一致时纠正（企业端「附加岗位」为准，报名表 extra 常为旧码） */
  for (const en of enrollments) {
    const uid = en.user_id != null ? Number(en.user_id) : null;
    if (!uid || !Number.isFinite(uid)) continue;
    const enPhone = normPhoneEnrollment(en.phone);
    const enName = normNameEnrollment(en.real_name);
    const matched = pickMatchedApp(uid, enPhone, enName);
    if (!matched) continue;
    const pj = matched.project_job_code != null ? String(matched.project_job_code).trim() : '';
    if (!pj) continue;
    const cur = en.job_code != null ? String(en.job_code).trim() : '';
    if (cur === pj) continue;
    try {
      await UserModel.mergeCandidateProfileFieldsSafe(uid, { job_code: pj });
      wrote = true;
    } catch (eJ) {
      console.warn('[coop-backfill] job_code realign user', uid, eJ.message || eJ);
    }
  }

  return wrote;
}

/**
 * 列表拉取前：对已报名用户尝试补全 qms_users（导入池 + 企业分配 payload + 人才网报名表身份证照）。
 * @param {string|number} examId
 * @param {object[]|undefined} enrollments 若已由外层 listByExam 拉取则传入，避免重复查询；缺省时内部再查一次。
 * @returns {Promise<boolean>} 是否建议外层再次 listByExam（曾存在待补全字段并已尝试写库）
 */
async function backfillEnrollmentUsersFromImportPool(examId, enrollments) {
  const eid = parseInt(examId, 10);
  if (!Number.isFinite(eid) || eid <= 0) return false;
  let rows = enrollments;
  if (!rows) {
    try {
      rows = await ExamEnrollmentModel.listByExam(examId);
    } catch {
      return false;
    }
  }
  if (!rows || !rows.length) return false;
  if (rows.length > 3000) return false;

  let shouldRefetch = false;

  /** 缺准考证/岗位代码/身份证照等任一字段时也跑 sj+导入池+分配补全（否则仅有「人像在 extra」时永远不触发） */
  const needFill = rows.some(
    (en) =>
      !(en.phone != null && String(en.phone).trim()) ||
      !(en.exam_number != null && String(en.exam_number).trim()) ||
      !(en.position != null && String(en.position).trim()) ||
      !(en.job_code != null && String(en.job_code).trim()) ||
      !(en.id_card_image_path != null && String(en.id_card_image_path).trim())
  );
  if (needFill) {
    try {
      await backfillFromExamImportCandidates(eid, rows);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('[exam-enrollments] backfillFromExamImportCandidates:', e.message || e);
      }
    }
    try {
      await backfillFromCompatAllocationPayloads(eid, rows);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('[exam-enrollments] backfillFromCompatAllocationPayloads:', e.message || e);
      }
    }
    try {
      await backfillFromSjImportedCandidates(eid, rows);
    } catch (e) {
      console.warn('[exam-enrollments] backfillFromSjImportedCandidates:', e.message || e);
    }
    shouldRefetch = true;
  }

  /** 报名表补全：缺证件图或缺岗位代码；或企业考试且名单非空时仍跑 coop（用项目表 job_code 纠正已写入但错误的岗位代码） */
  let examForCoop = null;
  try {
    examForCoop = await ExamModel.findById(eid);
  } catch (_) {
    examForCoop = null;
  }
  const entCoop =
    examForCoop &&
    examForCoop.enterprise_id != null &&
    String(examForCoop.enterprise_id).trim() !== '' &&
    Number(examForCoop.enterprise_id) > 0;
  const needCoopBackfill =
    rows.some((en) => {
      const p = en.id_card_image_path != null ? String(en.id_card_image_path).trim() : '';
      const jc = en.job_code != null ? String(en.job_code).trim() : '';
      return !p || !jc;
    }) ||
    !!entCoop;
  if (needCoopBackfill) {
    try {
      const w = await backfillFromCompatCooperationApplications(eid, rows);
      if (w) shouldRefetch = true;
    } catch (e) {
      console.warn('[exam-enrollments] backfillFromCompatCooperationApplications:', e.message || e);
    }
  }

  return shouldRefetch;
}

// 企业端测评管理同步批次考生到笔试系统（免鉴权，供跨域企业端调用；生产环境建议加 API Key 或由 3001 代理鉴权）
router.post('/sync-from-enterprise', async (req, res) => {
  try {
    const { examId, batchId, batchName, candidates } = req.body;
    if (!examId || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ success: false, message: 'examId 与 candidates 数组必填且非空' });
    }
    const exam = await ExamModel.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    const userIds = [];
    const resolved = [];
    const results = { success: [], fail: [] };
    for (let i = 0; i < candidates.length; i++) {
      const row = candidates[i];
      const real_name = (row.real_name || row.name || '').trim();
      if (!real_name) {
        results.fail.push({ index: i + 1, reason: '姓名为空' });
        continue;
      }
      try {
        const examNo = (row.exam_number || row.exam_no || '').toString().trim();
        let extraSync = null;
        try {
          if (row.extra_info) {
            extraSync = typeof row.extra_info === 'string' ? JSON.parse(row.extra_info) : row.extra_info;
          }
        } catch (_) {}
        const loginUsername =
          (row.username || row.login || row.login_name || row.login_username || '').toString().trim() ||
          pickLoginUsernameFromRow(row, extraSync, examNo);
        const r = await UserModel.createCandidateOrFind(
          {
            real_name,
            username: loginUsername,
            exam_number: examNo,
            id_card: row.id_card || '',
            phone: row.phone || '',
            position: row.position || '',
            email: row.email || '',
            education: row.education || row.degree || '',
            job_code: row.job_code || row.position_code || row.jobCode || ''
          },
          {}
        );
        if (!r.success) {
          results.fail.push({ index: i + 1, reason: r.error || '创建失败' });
          continue;
        }
        let idImg =
          row.id_card_image_url ||
          row.id_card_image_path ||
          row.idCardImageUrl ||
          (row.attachments && typeof row.attachments === 'object'
            ? pickIdCardImageUrlFromCoopExtra({ attachments: row.attachments })
            : '');
        idImg = idImg != null ? String(idImg).trim() : '';
        if (idImg) {
          try {
            await UserModel.updateIdCardImagePath(r.userId, idImg);
          } catch (eImg) {
            console.warn('[sync-from-enterprise] id_card_image_path:', eImg.message || eImg);
          }
        }
        userIds.push(r.userId);
        resolved.push({ real_name, userId: r.userId });
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
      for (const item of resolved) {
        const en = existing.find((e) =>
          UserModel.candidateNamesLikelySame(e.real_name || e.username, item.real_name)
        );
        if (en && Number(en.user_id) !== Number(item.userId)) {
          await ExamEnrollmentModel.updateUserId(en.id, item.userId);
          relinked += 1;
        }
      }
    }
    res.json({
      success: true,
      data: {
        batchId: batchId || null,
        batchName: batchName || null,
        total: candidates.length,
        added,
        relinked,
        skipped: userIds.length - toAdd.length,
        failed: results.fail.length,
        details: { success: results.success, fail: results.fail }
      }
    });
  } catch (e) {
    console.error('[sync-from-enterprise]', e);
    res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

router.use(authenticate);
// 企业身份补充：支持人才网企业登录（token 中带 enterpriseId）
router.use(async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'enterprise') {
      if (req.user.enterpriseId) {
        req.enterpriseId = req.user.enterpriseId;
      } else {
        const ent = await EnterpriseModel.findByUserId(req.user.id);
        if (!ent || ent.status !== 'approved') {
          return res.status(403).json({ success: false, message: '企业未审核通过' });
        }
        req.enterpriseId = ent.id;
      }
    }
    next();
  } catch (e) {
    console.error('ExamEnrollments middleware error:', e.message);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

const uploadDir = path.join(__dirname, '../uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.xlsx';
      cb(null, `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 Excel 文件 (.xlsx, .xls)'));
  }
});

// 企业端/管理员：面试考试按岗位抽签
router.post('/exam/:examId/draw', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if ((exam.exam_type || exam.examType) !== 'interview') {
      return res.status(400).json({ success: false, message: '仅面试考试支持抽签' });
    }
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const result = await ExamEnrollmentModel.runDrawByPosition(req.params.examId);
    const msg =
      result.count === 0
        ? '无参与抽签的考生（可能均被标记为不参与抽签，或本场暂无报名）。'
        : `已为 ${result.count} 名考生生成抽签号`;
    res.json({ success: true, message: msg, data: result });
  } catch (e) {
    const msg = e.message || '';
    const needMigration = e.code === 'ER_BAD_FIELD_ERROR' || /draw_number|Unknown column/.test(msg);
    const hint = needMigration
      ? '请先在项目根目录执行数据库迁移：node backend/scripts/run_interview_draw_checkin_migration.js（需配置 .env 中数据库连接）'
      : msg;
    res.status(500).json({ success: false, message: hint });
  }
});

// 企业端：按「姓名+手机」重新对齐本场所有考生的账号与准考证（修复重新分配考号后的错绑）
router.post('/exam/:examId/repair-identities', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const exam = await ExamModel.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    await backfillEnrollmentUsersFromImportPool(examId);
    const list = await ExamEnrollmentModel.listByExam(examId);
    let fixed = 0;
    let unchanged = 0;
    const errors = [];
    for (const en of list) {
      const real_name = (en.real_name || '').trim();
      if (!real_name) continue;
      const phone = String(en.phone || '').replace(/\D/g, '');
      const exam_number = (en.exam_number || '').toString().trim();
      try {
        const r = await UserModel.createCandidateOrFind(
          {
            real_name,
            username: '',
            exam_number,
            phone,
            id_card: en.id_card || '',
            position: en.position || '',
            email: en.email || '',
            education: en.education || '',
            job_code: en.job_code || ''
          },
          {}
        );
        if (!r.success) {
          errors.push({ name: real_name, reason: r.error || '处理失败' });
          continue;
        }
        if (Number(en.user_id) !== Number(r.userId)) {
          await ExamEnrollmentModel.updateUserId(en.id, r.userId);
          fixed += 1;
        } else {
          unchanged += 1;
        }
        const idCard = String(en.id_card || '').replace(/\s/g, '');
        if (idCard.length >= 6) {
          try {
            const hash = await bcrypt.hash(idCard.slice(-6), 10);
            await UserModel.updatePasswordHash(r.userId, hash);
          } catch (pe) {
            console.warn('[repair-identities] reset password:', real_name, pe.message);
          }
        }
      } catch (e) {
        errors.push({ name: real_name, reason: e.message || '异常' });
      }
    }
    res.json({
      success: true,
      message:
        errors.length === 0
          ? `已校正 ${fixed} 条报名绑定，${unchanged} 条无需变更（有身份证号者密码已同步为后6位）`
          : `已校正 ${fixed} 条，${unchanged} 条未变，${errors.length} 条失败（有身份证号者密码已同步为后6位）`,
      data: { total: list.length, fixed, unchanged, failed: errors.length, errors: errors.slice(0, 20) }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '校正失败' });
  }
});

// 企业端：获取某考试的报名列表
router.get('/exam/:examId', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const list = await ExamEnrollmentModel.listByExam(req.params.examId);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: list });
    // P1 优化：回填操作异步化 + 互斥锁，读接口不再阻塞在写操作
    const backfillLockKey = `backfill:${req.params.examId}`;
    if (!backfillLocks.has(backfillLockKey)) {
      const lockPromise = (async () => {
        try {
          await backfillEnrollmentUsersFromImportPool(req.params.examId, list);
        } catch (e) { /* 后台静默失败，不影响已返回的数据 */ }
        finally { backfillLocks.delete(backfillLockKey); }
      })();
      backfillLocks.set(backfillLockKey, lockPromise);
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 考生端：我的考试列表
router.get('/my', requireRole('candidate', 'user', 'admin'), async (req, res) => {
  try {
    const list = await ExamEnrollmentModel.listByUser(req.user.id, { status: req.query.status });
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 企业端：批量添加考生
router.post('/exam/:examId/bulk', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'userIds 必填且非空' });
    }
    const results = await ExamEnrollmentModel.bulkCreate(req.params.examId, userIds);
    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 企业端：单个添加考生
router.post('/exam/:examId', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId 必填' });
    const { id, inviteCode } = await ExamEnrollmentModel.create({ examId: req.params.examId, userId });
    res.json({ success: true, data: { id, inviteCode } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 企业端/管理员：标记是否参与抽签（未签到也可抽签；排除者不进抽签池）
router.patch('/:id/exclude-from-draw', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const { excluded } = req.body;
    if (typeof excluded !== 'boolean') {
      return res.status(400).json({ success: false, message: 'excluded 须为 true 或 false' });
    }
    const row = await ExamEnrollmentModel.findEnrollmentExamId(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: '报名不存在' });
    const exam = await ExamModel.findById(row.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }
    await ExamEnrollmentModel.setExcludeFromDraw(row.id, excluded);
    res.json({ success: true, message: excluded ? '已标记不参与抽签' : '已恢复参与抽签' });
  } catch (e) {
    const sc = Number(e.statusCode);
    const code = Number.isFinite(sc) && sc >= 400 && sc < 600 ? sc : 500;
    res.status(code).json({ success: false, message: e.message });
  }
});

// 企业端：将某登录名绑定到指定姓名（自动把原占用该登录名的其他考生改绑到其准考证号账号）
router.post('/exam/:examId/assign-login-to-name', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const loginUsername = String(req.body?.loginUsername || req.body?.username || '').trim();
    const realName = String(req.body?.realName || req.body?.real_name || '').trim();
    if (!loginUsername || !realName) {
      return res.status(400).json({ success: false, message: '请提供 loginUsername 与 realName（姓名）' });
    }
    const exam = await ExamModel.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }

    const list = await ExamEnrollmentModel.listByExam(examId);
    const targetEn = list.find((en) =>
      UserModel.candidateNamesLikelySame(en.real_name || en.username, realName)
    );
    if (!targetEn) {
      return res.status(404).json({
        success: false,
        message: `本场未找到姓名为「${realName}」的报名，请先在考生管理导入或添加该考生`
      });
    }

    let loginUser = await UserModel.findByUsername(loginUsername);
    if (!loginUser) {
      const r = await UserModel.createCandidateOrFind(
        {
          real_name: realName,
          username: loginUsername,
          exam_number: targetEn.exam_number || '',
          phone: targetEn.phone || '',
          id_card: targetEn.id_card || ''
        },
        {}
      );
      if (!r.success) return res.status(400).json({ success: false, message: r.error || '无法创建登录账号' });
      loginUser = await UserModel.findById(r.userId);
    }

    const holderEn = list.find((en) => Number(en.user_id) === Number(loginUser.id));
    const displaced = [];
    if (holderEn && Number(holderEn.id) !== Number(targetEn.id)) {
      const fallbackUsername =
        (holderEn.exam_number && String(holderEn.exam_number).trim()) ||
        `cand_${holderEn.id}_${Date.now().toString(36).slice(2, 6)}`;
      const r2 = await UserModel.createCandidateOrFind(
        {
          real_name: holderEn.real_name,
          username: fallbackUsername,
          exam_number: holderEn.exam_number || '',
          phone: '',
          id_card: holderEn.id_card || ''
        },
        {}
      );
      if (!r2.success) {
        return res.status(400).json({
          success: false,
          message: `登录名「${loginUsername}」当前绑定在「${holderEn.real_name}」名下，无法为其自动生成新账号：${r2.error}`
        });
      }
      await ExamEnrollmentModel.updateUserId(holderEn.id, r2.userId);
      displaced.push({
        enrollmentId: holderEn.id,
        name: holderEn.real_name,
        newUsername: fallbackUsername
      });
    }

    const dup = await ExamEnrollmentModel.findByExamAndUserId(examId, loginUser.id);
    if (dup && Number(dup.id) !== Number(targetEn.id)) {
      return res.status(400).json({ success: false, message: '目标登录名仍被本场其他报名占用，请刷新列表后重试' });
    }

    await ExamEnrollmentModel.updateUserId(targetEn.id, loginUser.id);
    res.json({
      success: true,
      message: `已将登录名「${loginUsername}」绑定到「${realName}」`,
      data: {
        targetEnrollmentId: targetEn.id,
        loginUsername: loginUser.username,
        realName,
        displaced
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '绑定失败' });
  }
});

// 企业端：修正某条报名绑定的登录账号（解决导入时手机合并错号）
router.post('/:id/rebind-login', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    const loginUsername = String(req.body?.loginUsername || req.body?.username || '').trim();
    const createIfMissing = req.body?.createIfMissing !== false;
    if (!loginUsername) {
      return res.status(400).json({ success: false, message: '请提供 loginUsername（目标登录名）' });
    }
    const userTbl = await ExamEnrollmentModel.getCandidateUserTableName();
    const [enRows] = await pool.execute(
      `SELECT en.id, en.exam_id, en.user_id, u.username, u.real_name, u.phone, u.exam_number, u.id_card
       FROM exam_enrollments en
       JOIN ${userTbl.replace(/`/g, '')} u ON en.user_id = u.id
       WHERE en.id = ? LIMIT 1`,
      [enrollmentId]
    );
    const enRow = enRows[0];
    if (!enRow) return res.status(404).json({ success: false, message: '报名不存在' });
    const exam = await ExamModel.findById(enRow.exam_id);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
    }

    let targetUser = await UserModel.findByUsername(loginUsername);
    if (!targetUser && createIfMissing) {
      const r = await UserModel.createCandidateOrFind(
        {
          real_name: enRow.real_name,
          username: loginUsername,
          exam_number: enRow.exam_number || '',
          id_card: enRow.id_card || '',
          phone: enRow.phone || ''
        },
        {}
      );
      if (!r.success) {
        return res.status(400).json({ success: false, message: r.error || '无法创建目标账号' });
      }
      targetUser = await UserModel.findById(r.userId);
    }
    if (!targetUser) {
      return res.status(404).json({ success: false, message: `登录名「${loginUsername}」不存在，可勾选自动创建或先在用户库建号` });
    }
    if (!UserModel.candidateNamesLikelySame(targetUser.real_name || targetUser.username, enRow.real_name)) {
      return res.status(400).json({
        success: false,
        message: `登录名「${loginUsername}」属于${UserModel.formatBoundAccountHint(targetUser)}，与本条姓名「${enRow.real_name}」不一致，请核对后再绑定`
      });
    }
    const dup = await ExamEnrollmentModel.findByExamAndUserId(enRow.exam_id, targetUser.id);
    if (dup && Number(dup.id) !== Number(enrollmentId)) {
      return res.status(400).json({
        success: false,
        message: `登录名「${loginUsername}」已绑定本场另一名考生，请先将该考生改绑到其他登录名后再操作`
      });
    }
    const oldUsername = enRow.username;
    await ExamEnrollmentModel.updateUserId(enrollmentId, targetUser.id);
    res.json({
      success: true,
      data: {
        enrollmentId,
        oldUsername,
        newUsername: targetUser.username,
        userId: targetUser.id
      },
      message: `已绑定登录名「${targetUser.username}」`
    });
  } catch (e) {
    const sc = Number(e.statusCode);
    res.status(Number.isFinite(sc) && sc >= 400 ? sc : 500).json({ success: false, message: e.message });
  }
});

// 企业端：移除考生
router.delete('/:id', requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    await ExamEnrollmentModel.delete(req.params.id);
    res.json({ success: true, message: '移除成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 下载考生导入模板
router.get('/template', requireRole('enterprise', 'admin'), (req, res) => {
  const wb = XLSX.utils.book_new();
  /** 岗位代码紧挨岗位，便于企业填报与核对 */
  const headers = ['姓名', '用户名', '准考证号', '身份证号', '电话', '岗位', '岗位代码', '学历', '邮箱'];
  const ws = XLSX.utils.aoa_to_sheet([
    headers,
    ['张三', 'zhangsan', '2024001', '110101199001011234', '13800138000', '软件工程师', 'DEV001', '本科', 'zhangsan@example.com'],
    ['李四', 'lisi', '2024002', '110101199002021234', '13900139000', '产品经理', 'PM001', '硕士', 'lisi@example.com']
  ]);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
    { wch: 10 },
    { wch: 24 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, '考生列表');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=candidate_import_template.xlsx');
  res.end(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'binary');
});

// 导入考生（multer 错误由下方中间件捕获后进入 handler，此时 req.file 可能为空）
router.post('/exam/:examId/import', requireRole('enterprise', 'admin'), (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: '文件大小不能超过 5MB' });
        }
        return res.status(400).json({ success: false, message: err.message || '文件上传失败' });
      }
      return res.status(400).json({ success: false, message: err.message || '仅支持 Excel 文件 (.xlsx, .xls)' });
    }
    next();
  });
}, async (req, res) => {
  let filePath = null;
  try {
    console.log(`[导入考生] 开始处理考试 ID: ${req.params.examId}, 用户: ${req.user.username} (${req.user.role})`);
    
    // 只检查 exam_enrollments 表是否存在（不查 users 的考生字段，避免未迁移时报错）
    try {
      await ExamEnrollmentModel.checkExamEnrollmentsTable(req.params.examId);
    } catch (tableErr) {
      console.error('[导入考生] 表检查失败:', tableErr);
      if (tableErr.code === 'ER_NO_SUCH_TABLE' || tableErr.message?.includes('doesn\'t exist')) {
        return res.status(500).json({ 
          success: false, 
          message: 'exam_enrollments 表不存在。请在业务库执行 backend/database/create_exam_enrollments_if_missing.sql，或运行：cd backend && node scripts/run_online_exam_migration.js',
          error: tableErr.message
        });
      }
      throw tableErr;
    }
    
    if (!req.file || !req.file.path) {
      console.error('[导入考生] 未检测到上传文件（请确认选择的是 .xlsx/.xls 文件并重试）');
      return res.status(400).json({ success: false, message: '请上传 Excel 文件（.xlsx 或 .xls）' });
    }
    filePath = req.file.path;
    console.log(`[导入考生] 文件已上传: ${filePath}`);
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) {
      console.error(`[导入考生] 考试不存在: ID=${req.params.examId}`);
      if (filePath) await fs.unlink(filePath).catch(() => {});
      return res.status(404).json({ success: false, message: '考试不存在' });
    }
    console.log(`[导入考生] 找到考试: ${exam.name} (ID: ${exam.id})`);
    
    if (req.user.role === 'enterprise') {
      const entId = req.enterpriseId ?? (await EnterpriseModel.findByUserId(req.user.id))?.id;
      if (exam.enterprise_id !== entId) {
        console.error(`[导入考生] 权限不足: 企业ID不匹配 (exam: ${exam.enterprise_id}, entId: ${entId})`);
        if (filePath) await fs.unlink(filePath).catch(() => {});
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }
    
    console.log(`[导入考生] 开始解析 Excel 文件...`);
    const wb = XLSX.readFile(filePath, { type: 'file', cellFormula: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      if (filePath) await fs.unlink(filePath).catch(() => {});
      return res.status(400).json({ success: false, message: 'Excel 文件无有效工作表' });
    }
    // 按实际有内容的单元格重算 !ref，避免部分 Excel 只保存很小范围导致只读到前几行
    const cellKeys = Object.keys(ws).filter(k => /^[A-Z]+\d+$/i.test(k));
    if (cellKeys.length > 0) {
      let maxR = 0;
      let maxC = 0;
      for (const k of cellKeys) {
        try {
          const d = XLSX.utils.decode_cell(k);
          if (d.r > maxR) maxR = d.r;
          if (d.c > maxC) maxC = d.c;
        } catch (_) {}
      }
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    console.log(`[导入考生] Excel 解析完成，共 ${rows.length} 行数据`);
    if (rows.length < 2) {
      if (filePath) await fs.unlink(filePath).catch(() => {});
      return res.status(400).json({ success: false, message: '文件至少需包含表头及一行数据' });
    }
    const header = rows[0].map(h => String(h || '').trim());
    const nameIdx = header.findIndex(h => /姓名|名字/.test(h));
    const examNumIdx = header.findIndex(h => /准考证|考号/.test(h));
    const idCardIdx = header.findIndex(h => /身份证|证件号/.test(h));
    const phoneIdx = header.findIndex(h => /电话|手机|联系方式/.test(h));
    const positionIdx = header.findIndex(h => /岗位(?!代码|编码|代号)|职位(?!代码|编码)/.test(String(h || '').trim()));
    const educationIdx = header.findIndex(h => /学历|学位/.test(h));
    /** 表头须命中其一；否则整列视为未提供（岗位代码列为空） */
    const jobCodeIdx = header.findIndex(h =>
      /岗位代码|职位代码|工号代码|岗位编码|职位编码|报考代码|报考岗位代码|岗位代号/.test(String(h || '').trim())
    );
    const emailIdx = header.findIndex(h => /邮箱|email/.test(h));
    const usernameIdx = header.findIndex(h => /用户名|登录名|登录账号|账号(?!\s*密码)/.test(String(h || '').trim()));
    if (nameIdx < 0) {
      if (filePath) await fs.unlink(filePath).catch(() => {});
      return res.status(400).json({ success: false, message: '模板必须包含「姓名」列' });
    }
    const col = (arr, idx) => (arr[idx] != null ? String(arr[idx]).trim() : '');
    const results = { success: [], fail: [] };
    const userIds = [];
    const resolved = [];
    console.log(`[导入考生] 开始处理 ${rows.length - 1} 行数据...`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c)) continue;
      const real_name = col(row, nameIdx);
      const exam_number = col(row, examNumIdx);
      const id_card = col(row, idCardIdx);
      const phone = col(row, phoneIdx);
      const position = col(row, positionIdx);
      const education = educationIdx >= 0 ? col(row, educationIdx) : '';
      const job_code = jobCodeIdx >= 0 ? col(row, jobCodeIdx) : '';
      const email = col(row, emailIdx);
      const username = usernameIdx >= 0 ? col(row, usernameIdx) : '';
      if (!real_name) {
        results.fail.push({ row: i + 1, reason: '姓名为空' });
        continue;
      }
      try {
        const r = await UserModel.createCandidateOrFind(
          {
            real_name,
            username,
            exam_number,
            id_card,
            phone,
            position,
            email,
            education,
            job_code
          },
          {}
        );
        if (!r.success) {
          console.error(`[导入考生] 第 ${i + 1} 行处理失败: ${r.error}`);
          results.fail.push({ row: i + 1, reason: r.error || '创建失败' });
          continue;
        }
        userIds.push(r.userId);
        resolved.push({ real_name, userId: r.userId });
        results.success.push({ row: i + 1, name: real_name, isNew: r.isNew });
      } catch (userErr) {
        console.error(`[导入考生] 第 ${i + 1} 行用户处理异常:`, userErr);
        console.error(`  错误堆栈:`, userErr.stack);
        results.fail.push({ row: i + 1, reason: userErr.message || '用户创建/查找失败' });
      }
    }
    console.log(`[导入考生] 用户处理完成: 成功 ${results.success.length} 人，失败 ${results.fail.length} 人`);
    // 若全部失败且原因是 users 表缺少考生字段，直接返回 500 并提示先执行迁移
    const hasUnknownColumnError = results.fail.some(
      f => f.reason && (f.reason.includes('Unknown column') || f.reason.includes('exam_number') || f.reason.includes('id_card') || f.reason.includes('phone') || f.reason.includes('position'))
    );
    if (results.success.length === 0 && results.fail.length > 0 && hasUnknownColumnError) {
      if (filePath) await fs.unlink(filePath).catch(() => {});
      return res.status(500).json({
        success: false,
        message: '用户表缺少考生字段（exam_number、phone 等），请先在 backend 目录执行：node scripts/run_users_candidate_migration.js',
        error: results.fail[0]?.reason
      });
    }
    let toAdd = [];
    let relinked = 0;
    try {
      console.log(`[导入考生] 查询现有报名记录...`);
      const existing = await ExamEnrollmentModel.listByExam(req.params.examId);
      console.log(`[导入考生] 现有报名记录: ${existing.length} 条`);
      const existingIds = new Set(existing.map(e => e.user_id));
      toAdd = [...new Set(userIds.filter(id => !existingIds.has(id)))];
      console.log(`[导入考生] 需要新增报名记录: ${toAdd.length} 条`);
      if (toAdd.length) {
        await ExamEnrollmentModel.bulkCreate(req.params.examId, toAdd);
        console.log(`[导入考生] 批量创建报名记录成功`);
      }
      if (resolved.length) {
        for (const item of resolved) {
          const en = existing.find((e) =>
            UserModel.candidateNamesLikelySame(e.real_name || e.username, item.real_name)
          );
          if (en && Number(en.user_id) !== Number(item.userId)) {
            await ExamEnrollmentModel.updateUserId(en.id, item.userId);
            relinked += 1;
          }
        }
        if (relinked) console.log(`[导入考生] 已按姓名改绑 ${relinked} 条报名到正确账号`);
      }
    } catch (enrollErr) {
      console.error('[导入考生] 批量创建报名记录失败:', enrollErr);
      console.error('  错误代码:', enrollErr.code);
      console.error('  错误消息:', enrollErr.message);
      console.error('  错误堆栈:', enrollErr.stack);
      if (filePath) await fs.unlink(filePath).catch(() => {});
      return res.status(500).json({ 
        success: false, 
        message: `创建报名记录失败: ${enrollErr.message}`,
        error: enrollErr.message,
        code: enrollErr.code
      });
    }
    await fs.unlink(filePath).catch(() => {});
    const uniqueCount = new Set(userIds).size;
    console.log(`[导入考生] 导入完成: 解析 ${results.success.length} 行，去重后 ${uniqueCount} 名考生，新增 ${toAdd.length} 人，跳过 ${results.success.length - toAdd.length} 人，失败 ${results.fail.length} 人`);
    res.json({
      success: true,
      data: {
        total: results.success.length,
        unique: uniqueCount,
        added: toAdd.length,
        relinked,
        skipped: results.success.length - toAdd.length,
        failed: results.fail.length,
        details: { success: results.success, fail: results.fail }
      }
    });
  } catch (e) {
    console.error('[导入考生] 导入过程发生异常:', e);
    console.error('  错误代码:', e.code);
    console.error('  错误消息:', e.message);
    console.error('  错误堆栈:', e.stack);
    if (filePath) {
      try { await fs.unlink(filePath); } catch (_) {}
    }
    // 用户表缺少考生字段时给出明确提示
    const isUsersTableMissingColumns = e.code === 'ER_BAD_FIELD_ERROR' && e.message && (
      e.message.includes('phone') || e.message.includes('id_card') || e.message.includes('exam_number') || e.message.includes('position')
    );
    if (isUsersTableMissingColumns) {
      return res.status(500).json({
        success: false,
        message: '用户表缺少考生字段。请先运行：node backend/scripts/run_users_candidate_migration.js',
        error: e.message
      });
    }
    res.status(500).json({ 
      success: false, 
      message: e.message || '导入失败',
      error: e.message,
      code: e.code,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

module.exports = router;
