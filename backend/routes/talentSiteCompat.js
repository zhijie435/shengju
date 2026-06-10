/**
 * 圣举 legacy 静态站（user/enterprise）期望的旧版人才网 REST 路径。
 * 与当前笔试 API 同机部署时，在此做薄适配，避免「API端点不存在」导致整页无数据。
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');
const { pool, poolShengju } = require('../config/database');
const ExamPaperModel = require('../models/examPaperModel');
const EnterpriseModel = require('../models/enterpriseModel');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const UserModel = require('../models/userModel');
const { stableCandidateUsername } = require('../utils/candidateLoginUsername');
const { getEnterpriseColumnMap, sqlIdent } = require('../utils/enterpriseSchema');
const { requireAdminPortalPermission } = require('../utils/adminPortalPermissions');
const multer = require('multer');
const XLSX = require('xlsx');
const { cacheMiddleware } = require('../middleware/cache');
const xlsxEmbeddedImagesUtil = require('../utils/xlsxEmbeddedImages');
const extractRosterImagesFromXlsx =
  typeof xlsxEmbeddedImagesUtil.extractRosterImagesFromXlsx === 'function'
    ? xlsxEmbeddedImagesUtil.extractRosterImagesFromXlsx
    : async (buffer) => {
        const byCell =
          typeof xlsxEmbeddedImagesUtil.extractEmbeddedImagesFromXlsx === 'function'
            ? await xlsxEmbeddedImagesUtil.extractEmbeddedImagesFromXlsx(buffer)
            : new Map();
        return { byCell, byDispimgId: new Map(), mediaOrdered: [] };
      };

/** WPS 单元格 =DISPIMG("ID_…")；勿仅依赖 xlsxEmbeddedImages 导出，避免线上只更新了本文件时报错 */
function extractDispimgIdFromText(s) {
  if (typeof xlsxEmbeddedImagesUtil.extractDispimgIdFromText === 'function') {
    return xlsxEmbeddedImagesUtil.extractDispimgIdFromText(s);
  }
  const t = String(s ?? '').trim();
  if (!t) return '';
  const mDisp = t.match(/DISPIMG\s*\(\s*["']([^"']+)["']/i);
  if (mDisp && mDisp[1]) return String(mDisp[1]).trim();
  const mId = t.match(/(ID_[0-9A-F]{8,})/i);
  if (mId) return String(mId[1]).toUpperCase();
  return '';
}
const {
  bufferToDataUrl: rosterBufferToDataUrl,
  prepareRosterEmbeddedPhotoDataUrl,
  isLikelyInvalidRosterPhotoCellText,
  MAX_BINARY_BYTES: ROSTER_MAX_PHOTO_BYTES
} = require('../utils/rosterPhoto');

const rosterImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

/** 人才池「已加入」标记（内存缓存；持久化见 compat_talent_pool_users） */
const talentPoolJoinedUserIds = new Set();

let compatTalentPoolUsersTableReady = false;
async function ensureCompatTalentPoolUsersTable() {
  if (compatTalentPoolUsersTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_talent_pool_users (
      user_id INT PRIMARY KEY,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='求职者加入人才池（管理端列表）'
  `);
  compatTalentPoolUsersTableReady = true;
}

let compatVerificationTableReady = false;
async function ensureCompatEnterpriseVerificationRequestsTable() {
  if (compatVerificationTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_verification_requests (
      enterprise_id INT PRIMARY KEY,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      payload JSON NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业端提交认证材料，管理端 /admin/verifications 待审'
  `);
  compatVerificationTableReady = true;
}

/** 配置了 SHENGJU_DB_NAME 时双写认证待审表，避免管理端合并人才库而企业端只写主库导致列表永远为空 */
async function mirrorCompatVerificationToShengju(enterpriseId, payloadJson) {
  if (!poolShengju) return;
  try {
    await poolShengju.execute(`
      CREATE TABLE IF NOT EXISTS compat_enterprise_verification_requests (
        enterprise_id INT PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        payload JSON NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='与主库同步，供管理端 /admin/verifications 合并查询'
    `);
    await poolShengju.execute(
      `INSERT INTO compat_enterprise_verification_requests (enterprise_id, status, payload)
       VALUES (?, 'pending', ?)
       ON DUPLICATE KEY UPDATE status = 'pending', payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      [enterpriseId, payloadJson]
    );
  } catch (e) {
    console.warn('[talentSiteCompat] mirrorCompatVerificationToShengju:', e.message);
  }
}

let compatCompanyProfileTableReady = false;
async function ensureCompatEnterpriseCompanyProfileTable() {
  if (compatCompanyProfileTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_company_profile (
      enterprise_id INT PRIMARY KEY,
      company_status JSON NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业中心 companyStatus（表无 JSON 列时存此）'
  `);
  compatCompanyProfileTableReady = true;
}

let compatAiReportsTableReady = false;
async function ensureCompatEnterpriseAiReportsTable() {
  if (compatAiReportsTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_ai_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NOT NULL,
      template_id VARCHAR(128) NOT NULL DEFAULT '',
      template_name VARCHAR(500) NOT NULL DEFAULT '',
      content LONGTEXT NULL,
      form_data JSON NULL,
      company_snapshot JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ent_created (enterprise_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业中心 AI 报告列表（GET/POST/DELETE companies/me/ai-reports）'
  `);
  compatAiReportsTableReady = true;
}

/** legacy POST /projects、GET /projects、GET /talent-pool/projects 共用的岗位/项目表 */
let compatProjectsTableReady = false;

async function ensureCompatProjectsTable() {
  if (compatProjectsTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NULL,
      user_id INT NULL,
      name VARCHAR(500) NOT NULL,
      project_type VARCHAR(200) NULL,
      required_talent_type VARCHAR(200) NULL,
      description TEXT NULL,
      major_required TEXT NULL,
      status VARCHAR(50) DEFAULT 'recruiting',
      biz_type VARCHAR(50) NULL,
      job_code VARCHAR(100) NULL,
      show_department TINYINT(1) DEFAULT 0,
      min_age INT NULL,
      max_age INT NULL,
      required_gender VARCHAR(20) NULL,
      require_attachments LONGTEXT NULL,
      budget_min DECIMAL(14,2) NULL,
      budget_max DECIMAL(14,2) NULL,
      publish_date DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_enterprise (enterprise_id),
      INDEX idx_biz_type (biz_type),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 人才网项目/岗位兼容表'
  `);
  try {
    await pool.execute(
      "ALTER TABLE compat_enterprise_projects ADD COLUMN required_gender VARCHAR(20) NULL COMMENT '性别：男|女，空=不限' AFTER max_age"
    );
  } catch (e) {
    const msg = String(e.message || '');
    if (e.errno !== 1060 && !/Duplicate column name/i.test(msg)) {
      console.warn('[talentSiteCompat] ALTER required_gender:', msg);
    }
  }
  compatProjectsTableReady = true;
}

/** 岗位性别：兼容 camelCase/snake_case 与全角字符，避免写库或比较失败 */
function normalizeRequiredGenderDbValue(v) {
  if (v == null || v === '') return '';
  try {
    const s = String(v).trim().normalize('NFKC');
    if (s === '男' || s === '女') return s;
  } catch (_) {
    /* ignore */
  }
  return '';
}

/** 未传两字段时返回 undefined；传了则返回「男」「女」或 null（清空/无效） */
function readRequiredGenderFromRequestBody(b) {
  if (!b || typeof b !== 'object') return undefined;
  if (b.requiredGender === undefined && b.required_gender === undefined) return undefined;
  const raw = b.requiredGender !== undefined ? b.requiredGender : b.required_gender;
  return normalizeRequiredGenderDbValue(raw) || null;
}

/** 学历等级比较：岗位要求文案中含「本科」等时，考生学历须不低于该层级 */
const __EDU_RANK_MAP = {
  初中: 1,
  高中: 2,
  中专: 3,
  中技: 3,
  '中专/中技': 3,
  大专: 4,
  专科: 4,
  本科: 5,
  学士: 5,
  硕士: 6,
  硕士研究生: 6,
  研究生: 6,
  博士: 7
};

function __educationRankFromLabel(s) {
  if (!s || !String(s).trim()) return 0;
  const str = String(s).trim();
  const keys = Object.keys(__EDU_RANK_MAP).sort((a, b) => b.length - a.length);
  let best = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (str.indexOf(k) !== -1) best = Math.max(best, __EDU_RANK_MAP[k]);
  }
  return best;
}

function __assertApplicantMeetsProjectRules(projRow, formBody) {
  const form = formBody && typeof formBody === 'object' ? formBody : {};
  const basic = form.basicInfo && typeof form.basicInfo === 'object' ? form.basicInfo : {};
  const eduInfo = form.educationInfo && typeof form.educationInfo === 'object' ? form.educationInfo : {};
  const applicantEdu = eduInfo.fulltimeEducation != null ? String(eduInfo.fulltimeEducation).trim() : '';
  const reqEdu =
    projRow.required_talent_type != null && String(projRow.required_talent_type).trim() !== ''
      ? String(projRow.required_talent_type).trim()
      : '';
  if (reqEdu) {
    const need = __educationRankFromLabel(reqEdu);
    if (need > 0) {
      const have = __educationRankFromLabel(applicantEdu);
      if (have <= 0) {
        return { ok: false, message: '请填写与岗位一致的学历信息；当前学历不符合本岗位的学历要求' };
      }
      if (have < need) {
        return { ok: false, message: `本岗位学历要求为「${reqEdu}」及以上，您不符合报名条件` };
      }
    }
  }
  const rg = normalizeRequiredGenderDbValue(projRow.required_gender);
  if (rg && rg !== '不限' && rg !== 'any') {
    const g = basic.gender != null ? String(basic.gender).trim() : '';
    if (!g || g === '保密') {
      return { ok: false, message: '本岗位有性别要求，请如实选择性别后再报名' };
    }
    if (rg === '男' && g !== '男') {
      return { ok: false, message: '本岗位仅限男性报名' };
    }
    if (rg === '女' && g !== '女') {
      return { ok: false, message: '本岗位仅限女性报名' };
    }
  }
  const birth = basic.birthDate != null ? String(basic.birthDate).trim().slice(0, 10) : '';
  const minA = projRow.min_age != null ? Number(projRow.min_age) : null;
  const maxA = projRow.max_age != null ? Number(projRow.max_age) : null;
  if ((Number.isFinite(minA) || Number.isFinite(maxA)) && birth) {
    const d = new Date(birth);
    if (!Number.isNaN(d.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - d.getFullYear();
      const m = today.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
      if (Number.isFinite(minA) && age < minA) {
        return { ok: false, message: `本岗位要求年龄不少于 ${minA} 周岁` };
      }
      if (Number.isFinite(maxA) && age > maxA) {
        return { ok: false, message: `本岗位要求年龄不超过 ${maxA} 周岁` };
      }
    }
  } else if (Number.isFinite(minA) || Number.isFinite(maxA)) {
    return { ok: false, message: '本岗位设置了年龄要求，请填写出生年月' };
  }
  return { ok: true };
}

/** 与 enterprise/tests.html 中 PROJECT_APPLICANT_ID_OFFSET 一致：公告报名候选人的 API id = 500000 + 表主键 */
const PROJECT_COOP_APPLICATION_ID_OFFSET = 500000;

let compatCooperationApplicationsTableReady = false;

async function ensureCompatCooperationApplicationsTable() {
  if (compatCooperationApplicationsTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_cooperation_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NULL,
      announcement_id INT NULL,
      project_id INT NOT NULL,
      user_id INT NOT NULL,
      status VARCHAR(32) DEFAULT 'pending',
      extra_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ent (enterprise_id),
      INDEX idx_ann (announcement_id),
      INDEX idx_proj (project_id),
      INDEX idx_user (user_id),
      UNIQUE KEY uk_user_project (user_id, project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告/项目报名（求职者 POST /cooperations）'
  `);
  try {
    await pool.execute(
      "ALTER TABLE compat_cooperation_applications ADD COLUMN compat_notification_read_at TIMESTAMP NULL DEFAULT NULL COMMENT '消息中心：用户标记已读' AFTER extra_json"
    );
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[talentSiteCompat] compat_cooperation_applications.compat_notification_read_at:', e.message);
    }
  }
  compatCooperationApplicationsTableReady = true;
}

let enterprisePackagePapersTableReady = false;

async function ensureEnterprisePackagePapersTable() {
  if (enterprisePackagePapersTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS enterprise_package_papers (
      enterprise_id INT NOT NULL COMMENT '笔试系统企业ID',
      package_id VARCHAR(128) NOT NULL COMMENT '测评包ID（与人才网一致）',
      paper_id INT NOT NULL COMMENT '试卷ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (enterprise_id, package_id, paper_id),
      KEY idx_ent_pkg (enterprise_id, package_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业购买的测评包关联试卷'
  `);
  enterprisePackagePapersTableReady = true;
}

/** 从 purchases / sync 请求体解析笔试试卷 ID（如 package_id 为 paper_2）。勿把纯数字测评包 ID 当成 paper_id，否则会误关联到同名试卷主键。 */
function resolvePaperIdFromCompatBody(b) {
  if (!b || typeof b !== 'object') return null;
  const keys = ['paper_id', 'exam_paper_id', 'examPaperId', 'linked_paper_id', 'linkedPaperId'];
  for (const k of keys) {
    if (b[k] == null || String(b[k]).trim() === '') continue;
    const n = parseInt(String(b[k]), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const pkgId = b.package_id;
  if (pkgId == null || pkgId === '') return null;
  const s = String(pkgId).trim();
  const m = /^paper[_-]?(\d+)$/i.exec(s);
  if (m) return parseInt(m[1], 10);
  return null;
}

async function recordEnterprisePurchasedPaper(enterpriseId, b) {
  const eid = Number(enterpriseId);
  if (!Number.isFinite(eid) || eid <= 0) return;
  let paperId = resolvePaperIdFromCompatBody(b);
  // 仅传数字型测评包/目录 id、且未带 paper_id 时：若 exam_papers 存在同主键的试卷，则视为该试卷（与部分部署「包 id 即试卷 id」一致）
  if (!paperId && b && b.package_id != null && String(b.package_id).trim() !== '') {
    const s = String(b.package_id).trim();
    if (/^\d+$/.test(s)) {
      const cand = parseInt(s, 10);
      if (cand > 0) {
        try {
          const [rrows] = await pool.execute('SELECT id FROM exam_papers WHERE id = ? LIMIT 1', [cand]);
          const row = rrows && rrows[0];
          if (row && row.id) paperId = cand;
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
  if (!paperId) return;
  const pkgRaw =
    b.package_id != null && String(b.package_id).trim() !== ''
      ? String(b.package_id).trim()
      : `paper_${paperId}`;
  try {
    await ensureEnterprisePackagePapersTable();
    await pool.execute(
      `INSERT IGNORE INTO enterprise_package_papers (enterprise_id, package_id, paper_id) VALUES (?, ?, ?)`,
      [eid, pkgRaw, paperId]
    );
  } catch (err) {
    console.warn('[talentSiteCompat] enterprise_package_papers:', err.message);
  }
}

let compatExamAllocationBatchesReady = false;

async function ensureCompatExamAllocationBatchesTable() {
  if (compatExamAllocationBatchesReady) return;
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='enterprise/tests.html 考试分配批次（多机同步）'
  `);
  compatExamAllocationBatchesReady = true;
}

let compatAdmitPrintNotificationsReady = false;
/** 企业端确认考试分配后，为求职者端「消息」提供「可打印准考证」类通知 */
async function ensureCompatAdmitPrintNotificationsTable() {
  if (compatAdmitPrintNotificationsReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_admit_print_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '求职者 user id',
      enterprise_id INT NULL,
      batch_id VARCHAR(128) NULL,
      batch_name VARCHAR(500) NULL,
      title VARCHAR(255) NOT NULL DEFAULT '准考证可打印',
      content TEXT,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业分配考位/准考证后写入，求职者端通知栏展示'
  `);
  try {
    await pool.execute(
      'ALTER TABLE compat_admit_print_notifications ADD COLUMN payload_json LONGTEXT NULL COMMENT \'准考证结构化数据 admitCardData\''
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }
  compatAdmitPrintNotificationsReady = true;
}

/** 推送准考证时按身份证/手机号解析求职者 user_id */
async function resolveAdmitNotifyUserId(card, data) {
  let uid = card.userId != null ? parseInt(card.userId, 10) : NaN;
  if (uid && !Number.isNaN(uid)) return uid;
  const d = data && typeof data === 'object' ? data : {};
  const idc = normIdDigits(d.idCard || d.idNumber || card.idCard || card.idNumber || '');
  if (idc.length >= 15) {
    try {
      const u = await UserModel.findByIdCardSafe(idc);
      if (u && u.id) return Number(u.id);
    } catch (_) {
      /* ignore */
    }
  }
  const ph = normPhoneDigits(d.phone || card.phone || '');
  const nm = normRosterStr(d.candidateName || card.candidateName || '').toLowerCase();
  if (ph.length >= 11) {
    try {
      const u = await UserModel.findByPhoneSafe(ph);
      if (u && u.id) {
        if (!nm) return Number(u.id);
        const un = normRosterStr(u.real_name || u.name || u.username || '').toLowerCase();
        if (un && un === nm) return Number(u.id);
        if (!un) return Number(u.id);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

/** 名单导入/考试分配后：写入求职者个人中心可下载的准考证通知 */
async function writeJobseekerAdmitNotification({
  userId,
  enterpriseId,
  batchId,
  batchName,
  title,
  content,
  admitCardData,
  allowResend
}) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) return false;
  await ensureCompatAdmitPrintNotificationsTable();
  const payload =
    admitCardData && typeof admitCardData === 'object' ? JSON.stringify(admitCardData) : null;
  const hasCard = !!(admitCardData && admitCardData.admitCardNumber);
  const isInterviewNotice = !!(admitCardData && admitCardData.cardType === 'interview_notice');
  const batchKey = batchId != null ? String(batchId).slice(0, 128) : null;
  const defaultTitle = isInterviewNotice
    ? '面试通知书已发布'
    : hasCard
      ? '准考证已生成'
      : '考场信息已更新';
  const defaultContent = isInterviewNotice
    ? `您的面试通知书已生成${hasCard ? `，准考证号：${admitCardData.admitCardNumber}` : ''}。请进入个人中心「消息」查看并打印。`
    : hasCard
      ? `准考证号：${admitCardData.admitCardNumber}。请进入个人中心查看或下载准考证。`
      : '考务已更新您的考场信息，请进入个人中心查看。';
  if (batchKey && allowResend) {
    const [upd] = await pool.execute(
      `UPDATE compat_admit_print_notifications
       SET enterprise_id = ?, batch_name = ?, title = ?, content = ?, payload_json = ?, read_at = NULL
       WHERE user_id = ? AND batch_id = ?`,
      [
        enterpriseId != null ? Number(enterpriseId) : null,
        batchName != null ? String(batchName).slice(0, 500) : null,
        title || defaultTitle,
        content || defaultContent,
        payload,
        uid,
        batchKey
      ]
    );
    if (upd && upd.affectedRows > 0) return true;
  }
  if (batchKey) {
    const [dup] = await pool.execute(
      'SELECT id FROM compat_admit_print_notifications WHERE user_id = ? AND batch_id = ? LIMIT 1',
      [uid, batchKey]
    );
    if (dup && dup.length) return false;
  }
  await pool.execute(
    `INSERT INTO compat_admit_print_notifications (user_id, enterprise_id, batch_id, batch_name, title, content, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      enterpriseId != null ? Number(enterpriseId) : null,
      batchId != null ? String(batchId).slice(0, 128) : null,
      batchName != null ? String(batchName).slice(0, 500) : null,
      title || defaultTitle,
      content || defaultContent,
      payload
    ]
  );
  return true;
}

let compatExamScoreNotificationsReady = false;
/** 企业推送成绩后，求职者端「消息」展示成绩摘要（可含是否进入面试等） */
async function ensureCompatExamScoreNotificationsTable() {
  if (compatExamScoreNotificationsReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_exam_score_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '求职者 users.id',
      enterprise_id INT NOT NULL,
      exam_id INT NOT NULL,
      session_id INT NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '测评成绩已发布',
      content TEXT,
      payload_json LONGTEXT NULL COMMENT '结构化展示：总分、客观、主观、面试线等',
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_session_ent (session_id, enterprise_id),
      KEY idx_user_id (user_id),
      KEY idx_ent_exam (enterprise_id, exam_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业端发布成绩并通知考生'
  `);
  compatExamScoreNotificationsReady = true;
}

let compatEnterpriseExamScoreDisplayReady = false;
/** 企业配置：考生端成绩通知里展示哪些项、面试分数线等 */
async function ensureCompatEnterpriseExamScoreDisplayTable() {
  if (compatEnterpriseExamScoreDisplayReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_exam_score_display_options (
      enterprise_id INT PRIMARY KEY,
      payload_json LONGTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业端考生成绩通知展示项配置'
  `);
  compatEnterpriseExamScoreDisplayReady = true;
}

const DEFAULT_EXAM_SCORE_DISPLAY_OPTIONS = () => ({
  showTotal: true,
  showObjective: true,
  showSubjective: true,
  showScoreRate: true,
  showInterviewLine: false,
  interviewPassScore: null
});

function normalizeExamScoreDisplayOptions(raw) {
  const d = DEFAULT_EXAM_SCORE_DISPLAY_OPTIONS();
  if (!raw || typeof raw !== 'object') return d;
  return {
    showTotal: raw.showTotal !== false && raw.showTotal !== 0 && raw.showTotal !== '0',
    showObjective: raw.showObjective !== false && raw.showObjective !== 0 && raw.showObjective !== '0',
    showSubjective: raw.showSubjective !== false && raw.showSubjective !== 0 && raw.showSubjective !== '0',
    showScoreRate: raw.showScoreRate !== false && raw.showScoreRate !== 0 && raw.showScoreRate !== '0',
    showInterviewLine: raw.showInterviewLine === true || raw.showInterviewLine === 1 || raw.showInterviewLine === '1',
    interviewPassScore: (() => {
      if (raw.interviewPassScore == null || raw.interviewPassScore === '') return null;
      const n = Number(raw.interviewPassScore);
      return Number.isFinite(n) ? n : null;
    })()
  };
}

async function loadEnterpriseExamScoreDisplayOptions(enterpriseId) {
  await ensureCompatEnterpriseExamScoreDisplayTable();
  const eid = Number(enterpriseId);
  if (!Number.isFinite(eid) || eid <= 0) return DEFAULT_EXAM_SCORE_DISPLAY_OPTIONS();
  try {
    const [rows] = await pool.execute(
      'SELECT payload_json FROM compat_enterprise_exam_score_display_options WHERE enterprise_id = ? LIMIT 1',
      [eid]
    );
    if (!rows || !rows[0] || !rows[0].payload_json) return DEFAULT_EXAM_SCORE_DISPLAY_OPTIONS();
    const j = JSON.parse(rows[0].payload_json);
    return normalizeExamScoreDisplayOptions(j);
  } catch (_) {
    return DEFAULT_EXAM_SCORE_DISPLAY_OPTIONS();
  }
}

async function saveEnterpriseExamScoreDisplayOptions(enterpriseId, patch) {
  await ensureCompatEnterpriseExamScoreDisplayTable();
  const eid = Number(enterpriseId);
  if (!Number.isFinite(eid) || eid <= 0) return false;
  const cur = await loadEnterpriseExamScoreDisplayOptions(eid);
  const next = normalizeExamScoreDisplayOptions({ ...cur, ...patch });
  const s = JSON.stringify(next);
  await pool.execute(
    `INSERT INTO compat_enterprise_exam_score_display_options (enterprise_id, payload_json) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), updated_at = CURRENT_TIMESTAMP`,
    [eid, s]
  );
  return true;
}

let compatEnterpriseAssessmentFeeSettingsReady = false;

async function ensureCompatEnterpriseAssessmentFeeSettingsTable() {
  if (compatEnterpriseAssessmentFeeSettingsReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_assessment_fee_settings (
      enterprise_id INT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      amount_yuan DECIMAL(10,2) NOT NULL DEFAULT 0,
      pay_start_at DATETIME NULL,
      pay_end_at DATETIME NULL,
      wechat_qrcode_url LONGTEXT NULL,
      alipay_qrcode_url LONGTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业测评报名缴费设置（审核通过后考生扫码缴费）'
  `);
  compatEnterpriseAssessmentFeeSettingsReady = true;
}

let compatSystemSettingsReady = false;
async function ensureCompatSystemSettingsTable() {
  if (compatSystemSettingsReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_system_settings (
      id INT PRIMARY KEY DEFAULT 1,
      payload_json LONGTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理端系统设置（站点名、Logo、支付二维码等）'
  `);
  compatSystemSettingsReady = true;
}

async function loadCompatSystemSettingsPayload() {
  await ensureCompatSystemSettingsTable();
  try {
    const [rows] = await pool.execute('SELECT payload_json FROM compat_system_settings WHERE id = 1 LIMIT 1');
    if (!rows || !rows[0] || !rows[0].payload_json) return {};
    const j = JSON.parse(rows[0].payload_json);
    return j && typeof j === 'object' ? j : {};
  } catch (_) {
    return {};
  }
}

async function saveCompatSystemSettingsPayload(obj) {
  await ensureCompatSystemSettingsTable();
  const s = JSON.stringify(obj && typeof obj === 'object' ? obj : {});
  await pool.execute(
    `INSERT INTO compat_system_settings (id, payload_json) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), updated_at = CURRENT_TIMESTAMP`,
    [s]
  );
}

function deepMergeSettings(target, patch) {
  const out = target && typeof target === 'object' ? { ...target } : {};
  if (!patch || typeof patch !== 'object') return out;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] != null && !Array.isArray(out[k])) {
      out[k] = deepMergeSettings(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** 求职者端测评缴费展示用：与管理端 payment 配置一致，无配置则二维码为空 */
async function getPublicPaymentQrcodeUrlsForJobseeker() {
  const payload = await loadCompatSystemSettingsPayload();
  const payment = payload.payment || {};
  const jpm = payment.jobseekerPaymentMethods || {};
  const wq = (payment.wechat && payment.wechat.qrcode) || (payment.qrCodes && payment.qrCodes.wechat) || '';
  const aq = (payment.alipay && payment.alipay.qrcode) || (payment.qrCodes && payment.qrCodes.alipay) || '';
  const wxOk = jpm.wechat !== false && String(wq).trim() !== '';
  const aliOk = jpm.alipay !== false && String(aq).trim() !== '';
  return {
    wechatQrcodeUrl: wxOk ? String(wq) : '',
    alipayQrcodeUrl: aliOk ? String(aq) : ''
  };
}

function normalizeProductFeeBlock(raw) {
  if (!raw || typeof raw !== 'object') return { enabled: false, amountYuan: 0 };
  const amt = parseFloat(raw.amountYuan);
  return {
    enabled: raw.enabled === true || raw.enabled === 1 || raw.enabled === '1',
    amountYuan: Number.isFinite(amt) && amt >= 0 ? amt : 0
  };
}

function buildPublicSiteSettingsBody(payload) {
  const p = payload || {};
  const payment = p.payment || {};
  const jpm = payment.jobseekerPaymentMethods || {};
  const wq = (payment.wechat && payment.wechat.qrcode) || (payment.qrCodes && payment.qrCodes.wechat) || '';
  const aq = (payment.alipay && payment.alipay.qrcode) || (payment.qrCodes && payment.qrCodes.alipay) || '';
  const wxOk = jpm.wechat !== false && String(wq).trim() !== '';
  const aliOk = jpm.alipay !== false && String(aq).trim() !== '';
  const jpe = payment.jobseekerPaymentEnabled;
  const jobseekerPaymentEnabled =
    jpe === undefined || jpe === null ? true : !!(jpe === true || jpe === 1 || jpe === '1');
  return {
    siteName: p.siteName || '圣举人才网',
    siteLogo: p.siteLogo != null && p.siteLogo !== '' ? p.siteLogo : null,
    contactInfo: p.contactInfo && typeof p.contactInfo === 'object' ? p.contactInfo : {},
    /** 求职者端会员套餐（管理端「求职者管理 → 会员套餐管理」持久化到服务端后全站可见） */
    membershipPlans: Array.isArray(p.membershipPlans) ? p.membershipPlans : null,
    payment: {
      jobseekerPaymentEnabled,
      jobseekerPaymentMethods: {
        wechat: wxOk,
        alipay: aliOk
      },
      wechatQrcodeUrl: wxOk ? String(wq) : '',
      alipayQrcodeUrl: aliOk ? String(aq) : '',
      /** 与考生测评报名缴费同一套二维码；以下为测评包/会员单独定价 */
      assessmentPackageFee: normalizeProductFeeBlock(payment.assessmentPackageFee),
      enterpriseMembershipFee: normalizeProductFeeBlock(payment.enterpriseMembershipFee),
      jobseekerMembershipFee: normalizeProductFeeBlock(payment.jobseekerMembershipFee),
      /** 明示：三项收款与求职者端扫码缴费一致 */
      productFeesUseCandidatePaymentQr: true
    }
  };
}

let compatEnterpriseReviewersTableReady = false;
async function ensureCompatEnterpriseReviewersTable() {
  if (compatEnterpriseReviewersTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_reviewers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NOT NULL,
      username VARCHAR(128) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      allowed_project_ids LONGTEXT NULL COMMENT 'JSON 数组；NULL=可审全部岗位',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_reviewer_username (username),
      KEY idx_ent (enterprise_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业子审核账号'
  `);
  compatEnterpriseReviewersTableReady = true;
}

function toIsoDateTimeMaybe(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

/** 缴费时间窗：起止均为空表示不限制；仅填其一则只约束该端 */
function isInAssessmentFeePayWindow(payStartAt, payEndAt) {
  const now = Date.now();
  if (payStartAt != null && payStartAt !== '') {
    const t = new Date(payStartAt).getTime();
    if (Number.isFinite(t) && now < t) return false;
  }
  if (payEndAt != null && payEndAt !== '') {
    const t = new Date(payEndAt).getTime();
    if (Number.isFinite(t) && now > t) return false;
  }
  return true;
}

async function loadAssessmentFeeSettingsMap(enterpriseIds) {
  const map = new Map();
  const ids = [...new Set((enterpriseIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return map;
  await ensureCompatEnterpriseAssessmentFeeSettingsTable();
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT * FROM compat_enterprise_assessment_fee_settings WHERE enterprise_id IN (${ph})`,
    ids
  );
  for (const row of rows || []) {
    map.set(Number(row.enterprise_id), jsonSafeEnterpriseRow(row));
  }
  return map;
}

function hashOfCompat(alg, s) {
  return crypto.createHash(alg).update(String(s ?? ''), 'utf8').digest('hex');
}

/** 校验 sj_users 账号密码（与 auth/login 逻辑一致，供无 JWT 时同步笔试账号） */
async function verifySjCredentialsCompat(identifier, password) {
  const uname = String(identifier || '').trim();
  if (!uname || password == null || password === '') return false;
  try {
    let sj = null;
    try {
      const [rows] = await pool.execute(
        `SELECT id, username, phone, email, password_hash
         FROM sj_users
         WHERE username = ? OR phone = ? OR email = ?
         LIMIT 1`,
        [uname, uname, uname]
      );
      sj = rows && rows[0];
    } catch (e1) {
      if (e1.code === 'ER_BAD_FIELD_ERROR') {
        const [rows2] = await pool.execute(
          `SELECT id, username, phone, email, password
           FROM sj_users
           WHERE username = ? OR phone = ? OR email = ?
           LIMIT 1`,
          [uname, uname, uname]
        );
        sj = rows2 && rows2[0];
      } else if (e1.code === 'ER_NO_SUCH_TABLE') {
        return false;
      } else {
        throw e1;
      }
    }
    if (!sj) return false;
    const sjPwdHash = sj.password_hash || sj.password || '';
    let ok = false;
    if (typeof sjPwdHash === 'string' && sjPwdHash.startsWith('$2')) {
      ok = await bcrypt.compare(String(password), sjPwdHash);
    } else if (typeof sjPwdHash === 'string' && /^[a-f0-9]{32}$/i.test(sjPwdHash)) {
      ok = hashOfCompat('md5', password).toLowerCase() === sjPwdHash.toLowerCase();
    } else if (typeof sjPwdHash === 'string' && /^[a-f0-9]{40}$/i.test(sjPwdHash)) {
      ok = hashOfCompat('sha1', password).toLowerCase() === sjPwdHash.toLowerCase();
    } else if (typeof sjPwdHash === 'string' && /^[a-f0-9]{64}$/i.test(sjPwdHash)) {
      ok = hashOfCompat('sha256', password).toLowerCase() === sjPwdHash.toLowerCase();
    } else if (sjPwdHash) {
      ok = String(sjPwdHash) === String(password);
    }
    return ok;
  } catch (e) {
    console.warn('[talentSiteCompat] verifySjCredentialsCompat:', e.message);
    return false;
  }
}

function parseAttachedProjectIdsForCoop(raw) {
  if (!raw) return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(j)) return [];
    return j.map(Number).filter((n) => Number.isFinite(n));
  } catch (_) {
    return [];
  }
}

async function findAnnouncementMetaForProjectId(projectId) {
  await ensureCompatAnnouncementsTable();
  const pid = Number(projectId);
  const [anns] = await pool.execute(
    `SELECT id, enterprise_id, attached_project_ids FROM compat_announcements
     WHERE attached_project_ids IS NOT NULL AND TRIM(attached_project_ids) != ''`
  );
  for (const row of anns || []) {
    const ids = parseAttachedProjectIdsForCoop(row.attached_project_ids);
    if (ids.includes(pid)) {
      return {
        announcementId: row.id != null ? Number(row.id) : null,
        enterpriseId: row.enterprise_id != null ? Number(row.enterprise_id) : null
      };
    }
  }
  return { announcementId: null, enterpriseId: null };
}

/** 列表接口专用：去掉超大 base64、截断长文本，显著减小 JSON 体积与前端 parse 耗时 */
function slimExtraJsonForCandidateListResponse(extra) {
  if (!extra || typeof extra !== 'object') return {};
  const out = {};
  try {
    if (extra.basicInfo && typeof extra.basicInfo === 'object') out.basicInfo = extra.basicInfo;
    if (extra.educationInfo && typeof extra.educationInfo === 'object') out.educationInfo = extra.educationInfo;
    if (extra.reviewAudit && typeof extra.reviewAudit === 'object') out.reviewAudit = extra.reviewAudit;
    if (extra.assessmentFee && typeof extra.assessmentFee === 'object') out.assessmentFee = extra.assessmentFee;
    if (extra.enterpriseRosterMeta && typeof extra.enterpriseRosterMeta === 'object') {
      const r = extra.enterpriseRosterMeta;
      const pu = r.photoUrl != null ? String(r.photoUrl).trim() : '';
      out.enterpriseRosterMeta = {
        idCard: r.idCard != null ? String(r.idCard).slice(0, 32) : undefined,
        examRoomNumber: r.examRoomNumber != null ? Number(r.examRoomNumber) : undefined,
        photoUrl: pu.length > 1200 ? pu.slice(0, 1200) + '…' : pu || undefined,
        examTicketNumber: r.examTicketNumber != null ? String(r.examTicketNumber).slice(0, 64) : undefined,
        importedAt: r.importedAt || undefined
      };
    }
    if (extra.awards != null) {
      const a = String(extra.awards);
      out.awards = a.length > 2500 ? a.slice(0, 2500) + '…' : extra.awards;
    }
    if (extra.universityAwards != null) {
      const u = String(extra.universityAwards);
      out.universityAwards = u.length > 2500 ? u.slice(0, 2500) + '…' : extra.universityAwards;
    }
    if (extra.signature && typeof extra.signature === 'object') {
      const s = extra.signature;
      out.signature = { signDate: s.signDate || null };
      const img = s.imageUrl || s.image;
      if (typeof img === 'string' && img.indexOf('data:') !== 0 && img.length < 2000) {
        if (s.imageUrl) out.signature.imageUrl = s.imageUrl;
        else out.signature.image = s.image;
      }
    }
    const att = extra.attachments;
    if (att && typeof att === 'object') {
      out.attachments = {};
      for (const k of ['photo', 'id_card_front', 'id_card', 'id_card_back', 'education', 'certificate']) {
        const v = att[k];
        if (typeof v === 'string' && v.indexOf('data:') !== 0 && v.length < 2000) out.attachments[k] = v;
      }
      if (Array.isArray(att.education_certs)) {
        out.attachments.education_certs = att.education_certs
          .filter((x) => typeof x === 'string' && x.indexOf('data:') !== 0 && x.length < 2000)
          .slice(0, 8);
      }
    } else {
      out.attachments = {};
    }
    if (Array.isArray(extra.resumeTimeline)) {
      out.resumeTimeline = extra.resumeTimeline.slice(0, 40).map((it) => {
        if (!it || typeof it !== 'object') return it;
        let c = it.content != null ? String(it.content) : '';
        if (c.length > 700) c = c.slice(0, 700) + '…';
        return { ...it, content: c };
      });
    } else {
      out.resumeTimeline = [];
    }
    out.familyMembers = Array.isArray(extra.familyMembers) ? extra.familyMembers.slice(0, 24) : [];
  } catch (_) {
    return {};
  }
  return out;
}

/** 企业端列表/详情：附带求职者个人中心头像（qms_users.avatar_url），与报名表内寸照、证照不是同一存储 */
async function getQmsUserAvatarUrlMapByIds(userIds) {
  const unique = [
    ...new Set(
      (userIds || [])
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ];
  if (!unique.length) return new Map();
  try {
    const ph = unique.map(() => '?').join(',');
    const [r] = await pool.execute(
      `SELECT id, avatar_url FROM qms_users WHERE id IN (${ph})`,
      unique
    );
    const m = new Map();
    for (const row of r || []) {
      const u = row.avatar_url != null ? String(row.avatar_url).trim() : '';
      if (u) m.set(Number(row.id), u);
    }
    return m;
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') return new Map();
    throw e;
  }
}

function mapCooperationRowToCandidateApi(row, projectName, feeSettings, opts) {
  let extra = {};
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) : {};
  } catch (_) {
    extra = {};
  }
  const lite = opts && opts.lite === true;
  const basic = extra.basicInfo || {};
  const edu = extra.educationInfo || {};
  const applyDate = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '';
  const assessmentFee = extra.assessmentFee || {};
  const paid = !!assessmentFee.paid;
  const feeRefunded = !!assessmentFee.refunded;
  const feeRefundRequested = !!assessmentFee.refundRequested;
  const st = String(row.status || 'pending').toLowerCase();
  const approved = st === 'approved';
  const feeOn = feeSettings && Number(feeSettings.enabled) === 1;
  const requiresAssessmentFee =
    feeOn && approved && !paid && isInAssessmentFeePayWindow(feeSettings.pay_start_at, feeSettings.pay_end_at);
  const reviewAudit = extra.reviewAudit && typeof extra.reviewAudit === 'object' ? extra.reviewAudit : {};
  const reviewedAtStr = reviewAudit.reviewedAt ? String(reviewAudit.reviewedAt).slice(0, 10) : '';
  const updatedDay =
    row.updated_at && st !== 'pending'
      ? new Date(row.updated_at).toISOString().slice(0, 10)
      : '';
  const roster = extra.enterpriseRosterMeta && typeof extra.enterpriseRosterMeta === 'object' ? extra.enterpriseRosterMeta : {};
  const idNumberMerged =
    (basic.idCardNumber && String(basic.idCardNumber).trim()) ||
    (basic.idNumber && String(basic.idNumber).trim()) ||
    (roster.idCard && String(roster.idCard).trim()) ||
    '';
  const examRoomNum =
    roster.examRoomNumber != null && String(roster.examRoomNumber).trim() !== '' && !Number.isNaN(Number(roster.examRoomNumber))
      ? Number(roster.examRoomNumber)
      : null;
  const rosterPhoto =
    roster.photoUrl != null && String(roster.photoUrl).trim() !== '' ? String(roster.photoUrl).trim() : null;
  const importTicket =
    roster.examTicketNumber != null && String(roster.examTicketNumber).trim() !== ''
      ? String(roster.examTicketNumber).trim()
      : '';
  return {
    id: PROJECT_COOP_APPLICATION_ID_OFFSET + Number(row.id),
    _source: 'project',
    announcementId: row.announcement_id != null ? Number(row.announcement_id) : null,
    announcementTitle:
      row.announcement_title != null && String(row.announcement_title).trim()
        ? String(row.announcement_title).trim()
        : null,
    jobId: Number(row.project_id),
    userId: Number(row.user_id),
    /** 与 extra_json.attachments.photo 独立：来自个人中心 /users/avatar，供 enterprise/tests 准考证/列表展示 */
    profileAvatarUrl: opts && opts.profileAvatarUrl != null ? String(opts.profileAvatarUrl) : null,
    /** 列表展示：报名表或导入名单中的身份证号 */
    idNumber: idNumberMerged,
    /** 导入名单写入 extra.enterpriseRosterMeta.examRoomNumber */
    examRoomNumber: examRoomNum,
    /** 导入名单照片 URL（优先于 profileAvatarUrl 展示） */
    rosterPhotoUrl: rosterPhoto,
    /** 导入的准考证号（可与考试分配里准考证匹配） */
    importExamTicketNumber: importTicket,
    jobTitle: projectName || basic.appliedJobName || '',
    name: basic.name || '',
    phone: basic.phone || '',
    email: basic.email || '',
    applyDate,
    status: row.status || 'pending',
    education: edu.fulltimeEducation || '',
    experience: '',
    extraJson: lite ? slimExtraJsonForCandidateListResponse(extra) : extra,
    gender: basic.gender || null,
    reviewTime: reviewedAtStr || updatedDay,
    reviewer: reviewAudit.reviewer != null && String(reviewAudit.reviewer).trim() !== '' ? String(reviewAudit.reviewer) : '',
    assessmentFeePaid: paid,
    assessmentFeePaidAt: assessmentFee.paidAt || null,
    assessmentFeeAmount: feeOn && feeSettings.amount_yuan != null ? Number(feeSettings.amount_yuan) : null,
    requiresAssessmentFee,
    assessmentFeePayStart: feeOn ? toIsoDateTimeMaybe(feeSettings.pay_start_at) : null,
    assessmentFeePayEnd: feeOn ? toIsoDateTimeMaybe(feeSettings.pay_end_at) : null,
    assessmentFeeRefunded: feeRefunded,
    assessmentFeeRefundRequested: feeRefundRequested,
    assessmentFeeRefundRequestAt: assessmentFee.refundRequestAt || null,
    assessmentFeeRefundRequestReason: assessmentFee.refundRequestReason || null
  };
}

/** 与 GET /candidates 一致：任一层 enterprise_id 命中或项目创建人兜底 */
async function assertEnterpriseCanAccessCooperationRow(req, row) {
  const role = req.user.role;
  if (role === 'admin') return true;
  let enterpriseId = null;
  if (role === 'enterprise' || role === 'enterprise_reviewer') {
    enterpriseId = await getCompatManageEnterpriseDbId(req);
  }
  const eid = enterpriseId != null ? Number(enterpriseId) : NaN;
  if (!Number.isFinite(eid) || eid <= 0) return false;

  const reviewerOk = (projectId) => {
    if (role !== 'enterprise_reviewer') return true;
    const pid = projectId != null ? Number(projectId) : null;
    if (!Number.isFinite(pid) || pid <= 0) return false;
    const allowed = req.user.reviewerAllowedProjectIds;
    if (allowed === null) return true;
    return allowed.includes(pid);
  };

  if (row.enterprise_id != null && String(row.enterprise_id).trim() !== '' && Number(row.enterprise_id) === eid) {
    return reviewerOk(row.project_id);
  }
  if (row.project_id != null) {
    try {
      const [prows] = await pool.execute(
        'SELECT enterprise_id, user_id FROM compat_enterprise_projects WHERE id = ? LIMIT 1',
        [row.project_id]
      );
      const pr = prows && prows[0];
      if (pr) {
        if (pr.enterprise_id != null && String(pr.enterprise_id).trim() !== '' && Number(pr.enterprise_id) === eid) {
          return reviewerOk(row.project_id);
        }
        const pEntEmpty =
          pr.enterprise_id == null ||
          String(pr.enterprise_id).trim() === '' ||
          Number(pr.enterprise_id) === 0;
        if (pEntEmpty && role === 'enterprise' && Number(pr.user_id) === Number(req.user.id)) {
          return reviewerOk(row.project_id);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (row.announcement_id != null) {
    try {
      await ensureCompatAnnouncementsTable();
      const [arows] = await pool.execute(
        'SELECT enterprise_id FROM compat_announcements WHERE id = ? LIMIT 1',
        [row.announcement_id]
      );
      const ar = arows && arows[0];
      if (ar && ar.enterprise_id != null && String(ar.enterprise_id).trim() !== '' && Number(ar.enterprise_id) === eid) {
        return reviewerOk(row.project_id);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

function formatCompatProjectDate(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function mapCompatProjectRow(r) {
  const publishFromRow =
    formatCompatProjectDate(r.publish_date) || formatCompatProjectDate(r.created_at) || '';
  let requireAttachments = null;
  if (r.require_attachments != null) {
    if (Array.isArray(r.require_attachments)) {
      requireAttachments = r.require_attachments;
    } else if (typeof r.require_attachments === 'object') {
      requireAttachments = r.require_attachments;
    } else if (typeof r.require_attachments === 'string') {
      try {
        requireAttachments = JSON.parse(r.require_attachments);
      } catch (_) {
        requireAttachments = null;
      }
    }
  }
  return {
    id: r.id,
    name: r.name,
    company: r.enterprise_name || '企业',
    type: r.project_type,
    requiredTalentType: r.required_talent_type,
    status: r.status || 'recruiting',
    publishDate: publishFromRow,
    budgetMin: r.budget_min != null ? Number(r.budget_min) : null,
    budgetMax: r.budget_max != null ? Number(r.budget_max) : null,
    description: r.description || '',
    bizType: r.biz_type,
    jobCode: r.job_code || '',
    majorRequired: r.major_required || '',
    minAge: r.min_age,
    maxAge: r.max_age,
    requiredGender: normalizeRequiredGenderDbValue(r.required_gender) || '',
    showDepartment: !!r.show_department,
    requireAttachments,
    talentApplicants: 0,
    applicants: 0
  };
}

async function getUserMaxSubmittedScore(userId) {
  try {
    const [rows] = await pool.execute(
      `SELECT MAX(CAST(s.total_score AS DECIMAL(10,2))) AS m
       FROM exam_sessions s
       WHERE s.user_id = ?
         AND (s.status IN ('submitted','force_submitted','abnormal') OR s.submitted_at IS NOT NULL)`,
      [userId]
    );
    if (rows[0] && rows[0].m != null) return Number(rows[0].m);
  } catch (e) {
    /* 表不存在或非数值分 */
  }
  return 0;
}

function talentLevelFromScore(maxScore) {
  if (maxScore >= 95) return 'expert';
  if (maxScore >= 90) return 'advanced';
  if (maxScore >= 80) return 'intermediate';
  return 'primary';
}

/** notes 里若含「试卷 id=n:…visible_side…」类联调说明，不在列表/卡片中展示 */
function examPackageDescriptionFromNotes(notes) {
  if (notes == null || notes === '') return '';
  const kept = String(notes)
    .split(/\r?\n/)
    .filter((line) => !/^\s*试卷\s*id\s*=\s*\d+\s*[：:]/.test(line));
  return kept.join('\n').trim().slice(0, 500);
}

/**
 * GET /exam-packages
 * 求职者端：audience=jobseeker → visible_side=candidate 且已启用
 * 企业端：audience=enterprise → visible_side=enterprise
 */
router.get('/exam-packages', async (req, res) => {
  try {
    const audience = String(req.query.audience || '').toLowerCase();
    const filters = {
      page: 1,
      pageSize: 500,
      orderBy: 'updated_at',
      orderDir: 'DESC',
      isEnabled: 1
    };
    if (audience === 'enterprise' || audience === 'government') {
      filters.visibleSide = 'enterprise';
    } else {
      filters.visibleSide = 'candidate';
    }
    await ExamPaperModel.initializeTables();
    const papers = await ExamPaperModel.getExamPapers(filters);
    const data = (papers || []).map((p) => ({
      id: `paper_${p.id}`,
      name: p.paper_name || p.project_name || `试卷#${p.id}`,
      price: 0,
      description: examPackageDescriptionFromNotes(p.notes),
      category: 'ability',
      durationMinutes: p.exam_time != null ? Number(p.exam_time) : 30,
      duration: p.exam_time != null ? `${p.exam_time}分钟` : '30分钟',
      participants: '0人已测',
      rating: 4.5,
      visibleSide: p.visible_side,
      visible_side: p.visible_side,
      platform: audience === 'enterprise' ? 'enterprise' : 'jobseeker',
      platformName: audience === 'enterprise' ? '企业端' : '求职者端',
      image: null
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] exam-packages:', e.message);
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /assessments/results
 * 从笔试 exam_sessions 映射为求职者端测评记录列表
 */
router.get('/assessments/results', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.json({ success: true, data: [] });
  }
  const userId = req.user.id;
  try {
    const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();
    const sqlWithSummary = `
      SELECT s.id, s.exam_id, s.status, s.submitted_at,
             s.total_score AS session_total_score,
             COALESCE(esum.total_score, s.total_score) AS display_total_score,
             esum.objective_score, esum.subjective_score,
             esum.max_score AS summary_max_score,
             p.total_score AS paper_max_score,
             e.name AS exam_name,
             ent.name AS enterprise_name,
             ${userSelectSql}
      FROM exam_sessions s
      INNER JOIN exams e ON e.id = s.exam_id
      LEFT JOIN enterprises ent ON ent.id = e.enterprise_id
      LEFT JOIN exam_papers p ON p.id = e.paper_id
      LEFT JOIN exam_summaries esum ON esum.session_id = s.id
      LEFT JOIN ${joinTableSql} u ON u.id = s.user_id
      WHERE s.user_id = ?
      ORDER BY COALESCE(s.submitted_at, s.updated_at, s.created_at) DESC
      LIMIT 200`;
    const sqlNoSummary = `
      SELECT s.id, s.exam_id, s.status, s.submitted_at,
             s.total_score AS session_total_score,
             s.total_score AS display_total_score,
             NULL AS objective_score, NULL AS subjective_score,
             NULL AS summary_max_score,
             p.total_score AS paper_max_score,
             e.name AS exam_name,
             ent.name AS enterprise_name,
             ${userSelectSql}
      FROM exam_sessions s
      INNER JOIN exams e ON e.id = s.exam_id
      LEFT JOIN enterprises ent ON ent.id = e.enterprise_id
      LEFT JOIN exam_papers p ON p.id = e.paper_id
      LEFT JOIN ${joinTableSql} u ON u.id = s.user_id
      WHERE s.user_id = ?
      ORDER BY COALESCE(s.submitted_at, s.updated_at, s.created_at) DESC
      LIMIT 200`;
    let rows;
    try {
      [rows] = await pool.execute(sqlWithSummary, [userId]);
    } catch (e) {
      if (e.code === 'ER_NO_SUCH_TABLE' && (e.message || '').includes('exam_summaries')) {
        [rows] = await pool.execute(sqlNoSummary, [userId]);
      } else {
        throw e;
      }
    }
    const maskIdCard = (raw) => {
      const s = raw != null ? String(raw).replace(/\s/g, '') : '';
      if (s.length < 10) return s ? '***' : '—';
      return `${s.slice(0, 4)}**********${s.slice(-4)}`;
    };
    const data = (rows || []).map((r) => {
      const maxScore =
        r.summary_max_score != null && r.summary_max_score !== ''
          ? Number(r.summary_max_score)
          : r.paper_max_score != null && r.paper_max_score !== ''
            ? Number(r.paper_max_score)
            : null;
      const displayTotal =
        r.display_total_score != null && r.display_total_score !== '' ? Number(r.display_total_score) : null;
      const obj = r.objective_score != null && r.objective_score !== '' ? Number(r.objective_score) : null;
      const subj = r.subjective_score != null && r.subjective_score !== '' ? Number(r.subjective_score) : null;
      const submitted = r.status === 'submitted' || r.status === 'force_submitted';
      const resultText =
        submitted && displayTotal != null ? `${displayTotal}分` : String(r.status || '');
      return {
        id: r.id,
        sessionId: r.id,
        examId: r.exam_id,
        packageId: r.exam_id,
        packageName: r.exam_name || `考试 #${r.exam_id}`,
        completedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null,
        result: resultText,
        score: displayTotal,
        totalScore: displayTotal,
        sessionTotalScore: r.session_total_score != null ? Number(r.session_total_score) : null,
        maxScore,
        objectiveScore: obj,
        subjectiveScore: subj,
        status: r.status,
        enterpriseName: r.enterprise_name || '',
        candidateName: r.real_name || r.username || '',
        examNumber: r.exam_number || '',
        idCardMasked: maskIdCard(r.id_card),
        recommendedJobTypes: []
      };
    });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || (e.message && e.message.includes("doesn't exist"))) {
      return res.json({ success: true, data: [] });
    }
    console.warn('[talentSiteCompat] assessments/results:', e.message);
    return res.json({ success: true, data: [] });
  }
});

/**
 * POST /assessments/purchases
 * enterprise/tests.html 确认购买测评包；原 404 会触发「API端点不存在」告警
 */
router.post('/assessments/purchases', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '仅企业账号可记录购买' });
  }
  const b = req.body || {};
  let enterpriseId = null;
  if (role === 'admin' && b.enterprise_id != null && String(b.enterprise_id).trim() !== '') {
    const n = Number(b.enterprise_id);
    if (Number.isFinite(n) && n > 0) enterpriseId = n;
  } else if ((role === 'enterprise' || role === 'enterprise_reviewer') && req.enterpriseId != null) {
    enterpriseId = Number(req.enterpriseId);
  } else if (b.enterprise_id != null && String(b.enterprise_id).trim() !== '') {
    const n = Number(b.enterprise_id);
    if (Number.isFinite(n) && n > 0) enterpriseId = n;
  } else if (req.enterpriseId != null) {
    enterpriseId = Number(req.enterpriseId);
  }
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) {
    return res.status(400).json({ success: false, message: '无法确定笔试系统企业ID，请重新登录企业端' });
  }
  const pkgId = b.package_id != null ? b.package_id : null;
  await recordEnterprisePurchasedPaper(enterpriseId, b);
  return res.json({
    success: true,
    data: {
      id: `purchase_${Date.now()}`,
      enterprise_id: enterpriseId,
      package_id: pkgId,
      name: b.name || '',
      description: b.description || '',
      recordedAt: new Date().toISOString()
    },
    message: '已记录；若 package_id/paper_id 可解析为笔试试卷，已写入 enterprise_package_papers'
  });
});

/**
 * POST /exam/sync/package
 * tests.html 将已购测评包同步到笔试系统；原 404 导致「同步到笔试系统失败」
 */
router.post('/exam/sync/package', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const b = req.body || {};
  let enterpriseIdSync = null;
  if (role === 'admin' && b.enterprise_id != null && String(b.enterprise_id).trim() !== '') {
    const n = Number(b.enterprise_id);
    if (Number.isFinite(n) && n > 0) enterpriseIdSync = n;
  } else if ((role === 'enterprise' || role === 'enterprise_reviewer') && req.enterpriseId != null) {
    enterpriseIdSync = Number(req.enterpriseId);
  } else if (b.enterprise_id != null && String(b.enterprise_id).trim() !== '') {
    const n = Number(b.enterprise_id);
    if (Number.isFinite(n) && n > 0) enterpriseIdSync = n;
  } else if (req.enterpriseId != null) {
    enterpriseIdSync = Number(req.enterpriseId);
  }
  if (!Number.isFinite(enterpriseIdSync) || enterpriseIdSync <= 0) {
    return res.status(400).json({ success: false, message: '无法确定笔试系统企业ID，请重新登录企业端' });
  }
  await recordEnterprisePurchasedPaper(enterpriseIdSync, b);
  return res.json({
    success: true,
    data: {
      package_id: b.package_id,
      exam_session_id: null,
      exam_link: null,
      note: '兼容占位：未在笔试子系统创建真实考试，前端可继续用本地已购数据；可解析的测评包已关联 enterprise_package_papers'
    }
  });
});

/**
 * GET /candidates
 * 企业测评管理：公告/附加岗位报名来自 compat_cooperation_applications（求职者 POST /cooperations）
 */
async function getCompatCandidatesList(req, res) {
  if (req.isGuest) {
    return res.json({ success: true, data: [] });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin' && role !== 'enterprise_reviewer') {
    return res.json({ success: true, data: [] });
  }
  try {
    let enterpriseId = null;
    let scopeIds = [];
    if (role === 'admin') {
      enterpriseId = req.enterpriseId != null ? Number(req.enterpriseId) : null;
    } else if (role === 'enterprise' || role === 'enterprise_reviewer') {
      scopeIds = await collectCompatEnterpriseScopeIds(req);
      enterpriseId = scopeIds.length ? scopeIds[0] : null;
    }
    const candidatesOwnerFallback =
      role === 'enterprise' && scopeIds.length === 0 && req.user.id != null && Number(req.user.id) > 0;
    if (role === 'enterprise_reviewer' && scopeIds.length === 0) {
      return res.json({ success: true, data: [], message: '未绑定企业信息' });
    }
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    let annFilter = null;
    if (req.query.announcementId != null && String(req.query.announcementId).trim() !== '') {
      const n = parseInt(req.query.announcementId, 10);
      if (Number.isFinite(n) && n > 0) annFilter = n;
    }
    // resolved：项目/公告优先于报名行，避免 INSERT 时 a.enterprise_id 填错盖住 p.enterprise_id 上正确的企业
    let sql = `SELECT a.*, p.name AS project_name, an.title AS announcement_title,
      COALESCE(p.enterprise_id, an.enterprise_id, a.enterprise_id) AS resolved_enterprise_id
      FROM compat_cooperation_applications a
      LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
      LEFT JOIN compat_announcements an ON an.id = a.announcement_id
      WHERE 1=1`;
    const params = [];
    if (role !== 'admin') {
      if (candidatesOwnerFallback) {
        const ouid = Number(req.user.id);
        // user_id 为 INT 列，直接等值比较即可走索引
        sql += ` AND (
          (p.id IS NOT NULL AND p.user_id = ?)
          OR (an.id IS NOT NULL AND an.user_id IS NOT NULL AND an.user_id = ?)
        )`;
        params.push(ouid, ouid);
      } else {
        // enterprise_id 列类型为 INT，直接 IN 比较即可走 idx_ent 索引，无需 CAST
        const ph = scopeIds.map(() => '?').join(',');
        const inTriple = `(
          (a.enterprise_id IN (${ph}))
          OR (p.enterprise_id IN (${ph}))
          OR (an.enterprise_id IN (${ph}))
        )`;
        if (role === 'enterprise') {
          sql += ` AND (${inTriple} OR (p.id IS NOT NULL AND (p.enterprise_id IS NULL OR p.enterprise_id = 0) AND p.user_id = ?))`;
          params.push(...scopeIds, ...scopeIds, ...scopeIds, Number(req.user.id));
        } else {
          sql += ` AND ${inTriple}`;
          params.push(...scopeIds, ...scopeIds, ...scopeIds);
        }
      }
    }
    if (role === 'enterprise_reviewer') {
      const allowed = req.user.reviewerAllowedProjectIds;
      if (allowed !== null) {
        if (!allowed.length) {
          return res.json({ success: true, data: [] });
        }
        const ph = allowed.map(() => '?').join(',');
        sql += ` AND a.project_id IN (${ph})`;
        params.push(...allowed);
      }
    }
    if (annFilter != null) {
      sql += ' AND a.announcement_id = ?';
      params.push(annFilter);
    }
    // 支持真实服务端分页：?page=1&pageSize=100（默认 pageSize=200，最大 500）
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '200', 10) || 200, 1), 500);
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const offset = (page - 1) * pageSize;
    sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const [rows] = await pool.execute(sql, params);
    const entIds = [
      ...new Set(
        (rows || [])
          .map((r) => r.resolved_enterprise_id)
          .filter((id) => id != null && id !== '')
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ];
    if (role !== 'admin' && scopeIds.length) {
      for (const eN of scopeIds) {
        if (Number.isFinite(eN) && eN > 0 && !entIds.includes(eN)) entIds.push(eN);
      }
    }
    const feeMap = await loadAssessmentFeeSettingsMap(entIds);
    const uids = [
      ...new Set(
        (rows || [])
          .map((r) => r.user_id)
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ];
    const avMap = await getQmsUserAvatarUrlMapByIds(uids);
    // 默认精简列表 payload；调试或特殊客户端可传 ?full=1 取完整 extra_json
    const liteList = String(req.query.full || '').trim() !== '1';
    const data = (rows || []).map((r) => {
      const eid =
        r.resolved_enterprise_id != null && r.resolved_enterprise_id !== ''
          ? Number(r.resolved_enterprise_id)
          : null;
      const fs = eid && feeMap.has(eid) ? feeMap.get(eid) : null;
      return mapCooperationRowToCandidateApi(r, r.project_name, fs, {
        lite: liteList,
        profileAvatarUrl: avMap.get(Number(r.user_id)) || null
      });
    });
    return res.json({ success: true, data, page, pageSize, hasMore: rows.length === pageSize });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || (e.message && e.message.includes("doesn't exist"))) {
      return res.json({ success: true, data: [] });
    }
    console.warn('[talentSiteCompat] GET /candidates:', e.message);
    return res.json({ success: true, data: [] });
  }
}

/** 与 GET /candidates 同权限范围，供名单导入批量更新 extra_json（仅取必要列） */
async function fetchCooperationApplicationsForImport(req) {
  if (req.isGuest) return [];
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin' && role !== 'enterprise_reviewer') return [];
  try {
    let scopeIds = [];
    const candidatesOwnerFallback =
      role === 'enterprise' && req.user.id != null && Number(req.user.id) > 0;
    if (role === 'enterprise' || role === 'enterprise_reviewer') {
      scopeIds = await collectCompatEnterpriseScopeIds(req);
    }
    if (role === 'enterprise_reviewer' && scopeIds.length === 0) return [];
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    let sql = `SELECT a.id, a.user_id, a.extra_json, a.announcement_id,
      COALESCE(p.enterprise_id, an.enterprise_id, a.enterprise_id) AS resolved_enterprise_id
      FROM compat_cooperation_applications a
      LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
      LEFT JOIN compat_announcements an ON an.id = a.announcement_id
      WHERE 1=1`;
    const params = [];
    if (role !== 'admin') {
      if (candidatesOwnerFallback && scopeIds.length === 0) {
        const ouid = Number(req.user.id);
        sql += ` AND (
          (p.id IS NOT NULL AND p.user_id = ?)
          OR (an.id IS NOT NULL AND an.user_id IS NOT NULL AND an.user_id = ?)
        )`;
        params.push(ouid, ouid);
      } else {
        const ph = scopeIds.map(() => '?').join(',');
        // 列类型均为 INT，直接 IN 比较走索引
        const inTriple = `(
          (a.enterprise_id IN (${ph}))
          OR (p.enterprise_id IN (${ph}))
          OR (an.enterprise_id IN (${ph}))
        )`;
        if (role === 'enterprise') {
          sql += ` AND (${inTriple} OR (p.id IS NOT NULL AND (p.enterprise_id IS NULL OR p.enterprise_id = 0) AND p.user_id = ?))`;
          params.push(...scopeIds, ...scopeIds, ...scopeIds, Number(req.user.id));
        } else {
          sql += ` AND ${inTriple}`;
          params.push(...scopeIds, ...scopeIds, ...scopeIds);
        }
      }
    }
    if (role === 'enterprise_reviewer') {
      const allowed = req.user.reviewerAllowedProjectIds;
      if (allowed !== null) {
        if (!allowed.length) return [];
        const ph = allowed.map(() => '?').join(',');
        sql += ` AND a.project_id IN (${ph})`;
        params.push(...allowed);
      }
    }
    sql += ' ORDER BY a.created_at DESC LIMIT 3000';
    const [rows] = await pool.execute(sql, params);
    return rows || [];
  } catch (e) {
    console.warn('[talentSiteCompat] fetchCooperationApplicationsForImport:', e.message);
    return [];
  }
}

function normRosterStr(s) {
  return String(s ?? '').trim();
}
function normIdDigits(s) {
  return normRosterStr(s).replace(/\s/g, '').replace(/[^0-9Xx]/g, '').toUpperCase();
}
function normPhoneDigits(s) {
  return normRosterStr(s).replace(/\D/g, '');
}

/** Excel 单元格转字符串（优先用显示文本 w，避免长数字/准考证号被科学计数法或精度截断） */
function rosterCellToString(val, fieldKey) {
  if (val == null || val === '') return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (fieldKey === 'idCard' || fieldKey === 'examTicket' || fieldKey === 'phone') {
      const rounded = Math.round(val);
      if (Math.abs(val - rounded) < 1e-6) return String(rounded);
    }
    return String(val);
  }
  let s = String(val).trim();
  if (fieldKey === 'idCard' || fieldKey === 'examTicket' || fieldKey === 'phone') {
    if (/e[+-]?\d+$/i.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return String(Math.round(n));
    }
    s = s.replace(/,/g, '');
  }
  return s;
}

function readRosterSheetCell(sheet, rowIndex, colIndex, fieldKey) {
  if (!sheet || rowIndex == null || colIndex == null) return '';
  const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[addr];
  if (!cell) return '';
  if (cell.w != null && String(cell.w).trim() !== '') {
    return rosterCellToString(cell.w, fieldKey);
  }
  if (cell.v != null) return rosterCellToString(cell.v, fieldKey);
  return '';
}

const ROSTER_HEADER_MAP = {
  姓名: 'name',
  name: 'name',
  考生姓名: 'name',
  身份证号: 'idCard',
  身份证: 'idCard',
  id_card: 'idCard',
  idcard: 'idCard',
  手机号: 'phone',
  手机: 'phone',
  联系电话: 'phone',
  phone: 'phone',
  mobile: 'phone',
  准考证号: 'examTicket',
  准考证: 'examTicket',
  考号: 'examTicket',
  考试证号: 'examTicket',
  考生考号: 'examTicket',
  exam_number: 'examTicket',
  exam_ticket: 'examTicket',
  examticket: 'examTicket',
  admit_card: 'examTicket',
  ticket_no: 'examTicket',
  报考岗位: 'job',
  岗位名称: 'job',
  岗位: 'job',
  职位: 'job',
  job: 'job',
  性别: 'gender',
  gender: 'gender',
  报考单位: 'employerUnit',
  单位: 'employerUnit',
  employer: 'employerUnit',
  岗位代码: 'positionCode',
  职位代码: 'positionCode',
  position_code: 'positionCode',
  面试时间: 'examTime',
  考试开始时间: 'examTime',
  面试考点: 'examSiteName',
  考点名称: 'examSiteName',
  考点: 'examSiteName',
  招聘公告: 'announcementTitle',
  公告: 'announcementTitle',
  公告标题: 'announcementTitle',
  announcement: 'announcementTitle',
  announcementtitle: 'announcementTitle',
  头像照片url: 'photoUrl',
  头像照片: 'photoUrl',
  照片图片: 'photoUrl',
  头像照片图片: 'photoUrl',
  照片: 'photoUrl',
  照片url: 'photoUrl',
  photo_url: 'photoUrl',
  photo: 'photoUrl',
  avatar: 'photoUrl',
  第几考场: 'examRoom',
  在第几考场: 'examRoom',
  考场号: 'examRoom',
  考场: 'examRoom',
  面试考场: 'examRoom',
  room: 'examRoom',
  考试地点: 'examLocation',
  面试地点: 'examLocation',
  考点地址: 'examLocation',
  exam_location: 'examLocation',
  examlocation: 'examLocation'
};

function rosterHeaderToField(headerText) {
  const k = normRosterStr(headerText);
  if (!k) return null;
  if (ROSTER_HEADER_MAP[k] || ROSTER_HEADER_MAP[k.toLowerCase()]) {
    return ROSTER_HEADER_MAP[k] || ROSTER_HEADER_MAP[k.toLowerCase()];
  }
  const base = k.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
  if (ROSTER_HEADER_MAP[base] || ROSTER_HEADER_MAP[base.toLowerCase()]) {
    return ROSTER_HEADER_MAP[base] || ROSTER_HEADER_MAP[base.toLowerCase()];
  }
  const lower = base.toLowerCase();
  if (/照片|头像/.test(base) && !/考场|url|链接/.test(base)) return 'photoUrl';
  if (/考点地址|考场地址/.test(base)) return 'examLocation';
  if (/考试地点|面试地点/.test(base) && !/考点名称|面试考点/.test(base)) return 'examLocation';
  if (/面试考点|考点名称/.test(base) && !/地址/.test(base)) return 'examSiteName';
  if (/^性别/.test(base) || base === '性别') return 'gender';
  if (/报考单位|招录单位|用人单位/.test(base)) return 'employerUnit';
  if (/岗位代码|职位代码/.test(base)) return 'positionCode';
  if (/面试时间|考试开始/.test(base)) return 'examTime';
  if (/岗位名称|报考岗位|职位名称/.test(base)) return 'job';
  if (/考场/.test(base) && !/照片|地点|地址|url|链接/.test(base)) return 'examRoom';
  if (/准考证|考号/.test(base) && !/照片|头像/.test(base)) return 'examTicket';
  return null;
}

/** 自动识别表头行（兼容标题行、说明行在首行的情况） */
function findRosterHeaderRowIndex(rowsAoA) {
  for (let i = 0; i < Math.min(rowsAoA.length, 12); i++) {
    const cells = rowsAoA[i] || [];
    for (const h of cells) {
      if (rosterHeaderToField(normRosterStr(h)) === 'name') return i;
    }
    const joined = cells.map((c) => normRosterStr(c)).join('|');
    if (/姓名/.test(joined) && (/准考证|考号|身份证|照片|考场|手机/.test(joined) || cells.length >= 4)) {
      return i;
    }
  }
  return 0;
}

function normalizeRosterImportRow(raw) {
  const o = {};
  if (!raw || typeof raw !== 'object') return o;
  for (const [k0, v0] of Object.entries(raw)) {
    const key = rosterHeaderToField(k0);
    if (key) o[key] = normRosterStr(v0);
  }
  return o;
}

/** 表头行 + 数据行（保留 Excel 行号，便于匹配嵌入图片） */
function parseRosterSheetRows(sheet) {
  const rowsAoA = XLSX.utils.sheet_to_json(sheet || {}, { header: 1, defval: '', raw: false });
  if (!rowsAoA.length) return { headerCells: [], importRows: [], photoColIdx: -1 };
  const headerRowIdx = findRosterHeaderRowIndex(rowsAoA);
  const headerCells = (rowsAoA[headerRowIdx] || []).map((h) => normRosterStr(h));
  const importRows = [];
  for (let i = headerRowIdx + 1; i < rowsAoA.length; i++) {
    const line = rowsAoA[i];
    if (!line || line.every((c) => !normRosterStr(c))) continue;
    const obj = {};
    headerCells.forEach((h, c) => {
      if (!h) return;
      const fieldKey = rosterHeaderToField(h);
      obj[h] = readRosterSheetCell(sheet, i, c, fieldKey) || rosterCellToString(line[c], fieldKey);
    });
    const norm = normalizeRosterImportRow(obj);
    if (!norm.name && !norm.idCard && !norm.examTicket && !norm.phone) continue;
    const nmHint = normRosterStr(norm.name);
    if (/请删除|示例行|填写真实|模板/.test(nmHint)) continue;
    norm._sheetRow = i;
    importRows.push(norm);
  }
  const photoColIdx = headerCells.findIndex((h) => {
    const t = String(h || '').toLowerCase();
    return /照片|头像|photo|avatar/.test(t) && !/考场|url|链接|地址/.test(t);
  });
  return { headerCells, importRows, photoColIdx };
}

/** 名单导入嵌入图：写入 id-cards 目录，与考生管理「身份证照」同一套读图接口 */
async function saveRosterPhotoAsIdCard(buffer, ext, userId) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) throw new Error('用户ID无效');
  const dir = path.join(__dirname, '../uploads/id-cards');
  await fs.mkdir(dir, { recursive: true });
  const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(String(ext || '').toLowerCase())
    ? String(ext).toLowerCase().replace('jpeg', 'jpg')
    : 'jpg';
  const name = `id_${uid}_${Date.now()}.${safeExt}`;
  const abs = path.join(dir, name);
  await fs.writeFile(abs, buffer);
  return path.relative(path.join(__dirname, '..'), abs).replace(/\\/g, '/');
}

function readRosterCellDispimgId(sheet, rowIndex, colIndex) {
  if (!sheet || rowIndex == null || colIndex == null) return '';
  const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[addr];
  if (!cell) return '';
  const parts = [];
  if (cell.f != null) parts.push(String(cell.f));
  if (cell.w != null) parts.push(String(cell.w));
  if (cell.v != null) parts.push(String(cell.v));
  for (const p of parts) {
    const id = extractDispimgIdFromText(p);
    if (id) return id;
  }
  return '';
}

function lookupDispimgImage(byDispimgId, id) {
  if (!id || !byDispimgId || !byDispimgId.size) return null;
  if (byDispimgId.has(id)) return byDispimgId.get(id);
  const upper = String(id).toUpperCase();
  for (const [k, v] of byDispimgId) {
    if (String(k).toUpperCase() === upper) return v;
  }
  return null;
}

function pickEmbeddedImageForRow(imageByCell, row, photoColIdx) {
  if (row == null || !imageByCell || !imageByCell.size) return null;
  const tryRow = (r) => {
    if (photoColIdx >= 0) {
      const atCol = imageByCell.get(`${r}:${photoColIdx}`);
      if (atCol) return atCol;
    }
    const prefix = `${r}:`;
    for (const [key, val] of imageByCell) {
      if (key.startsWith(prefix)) return val;
    }
    return null;
  };
  return tryRow(row) || tryRow(row - 1) || tryRow(row + 1);
}

function rosterRowNeedsEmbeddedPhoto(imp) {
  if (!imp || imp._photoBuffer) return false;
  if (imp.photoUrl && /^https?:\/\//i.test(String(imp.photoUrl))) return false;
  if (imp.photoUrl && /^data:image\//i.test(String(imp.photoUrl))) return false;
  return true;
}

function attachEmbeddedPhotosToImportRows(importRows, imageByCell, photoColIdx, extras) {
  if (!importRows.length) return;
  extras = extras || {};
  const byDispimgId = extras.byDispimgId || new Map();
  const mediaOrdered = extras.mediaOrdered || [];
  const sheet = extras.sheet;

  for (const imp of importRows) {
    if (!rosterRowNeedsEmbeddedPhoto(imp)) continue;
    const row = imp._sheetRow;
    const img = pickEmbeddedImageForRow(imageByCell, row, photoColIdx);
    if (img) {
      imp._photoBuffer = img;
      imp._photoSource = 'cell_anchor';
    }
  }

  for (const imp of importRows) {
    if (!rosterRowNeedsEmbeddedPhoto(imp)) continue;
    let dispId = extractDispimgIdFromText(imp.photoUrl);
    if (!dispId && sheet != null && photoColIdx >= 0 && imp._sheetRow != null) {
      dispId = readRosterCellDispimgId(sheet, imp._sheetRow, photoColIdx);
    }
    if (!dispId) continue;
    const img = lookupDispimgImage(byDispimgId, dispId);
    if (img) {
      imp._photoBuffer = img;
      imp._photoSource = 'wps_dispimg';
    }
  }

  let needPhoto = importRows.filter((imp) => rosterRowNeedsEmbeddedPhoto(imp));
  if (!needPhoto.length) return;

  const usedKeys = new Set();
  for (const imp of importRows) {
    if (!imp._photoBuffer || imp._sheetRow == null) continue;
    if (photoColIdx >= 0) usedKeys.add(`${imp._sheetRow}:${photoColIdx}`);
    usedKeys.add(`${imp._sheetRow}:0`);
  }
  const orphans = [];
  if (imageByCell && imageByCell.size) {
    for (const [key, val] of imageByCell) {
      if (usedKeys.has(key)) continue;
      const row = parseInt(String(key).split(':')[0], 10);
      if (!Number.isFinite(row)) continue;
      orphans.push({ row, val, key });
    }
    orphans.sort((a, b) => a.row - b.row);
    for (let i = 0; i < needPhoto.length && i < orphans.length; i++) {
      needPhoto[i]._photoBuffer = orphans[i].val;
      needPhoto[i]._photoSource = 'orphan_cell';
    }
  }

  needPhoto = importRows.filter((imp) => rosterRowNeedsEmbeddedPhoto(imp));
  if (!needPhoto.length || !mediaOrdered.length) return;
  for (let i = 0; i < needPhoto.length && i < mediaOrdered.length; i++) {
    needPhoto[i]._photoBuffer = mediaOrdered[i];
    needPhoto[i]._photoSource = 'media_order';
  }
}

async function resolveAnnouncementForRoster(enterpriseId, { announcementId, title }) {
  await ensureCompatAnnouncementsTable();
  const eid = Number(enterpriseId);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  const idNum = announcementId != null ? parseInt(announcementId, 10) : NaN;
  if (Number.isFinite(idNum) && idNum > 0) {
    const [rows] = await pool.execute(
      `SELECT id, title, attached_project_ids, enterprise_id FROM compat_announcements WHERE id = ? LIMIT 1`,
      [idNum]
    );
    const row = rows && rows[0];
    if (!row) return null;
    const ent = row.enterprise_id != null ? Number(row.enterprise_id) : null;
    if (ent != null && ent > 0 && ent !== eid) return null;
    return row;
  }
  const t = normRosterStr(title);
  if (!t) return null;
  const [rows] = await pool.execute(
    `SELECT id, title, attached_project_ids, enterprise_id FROM compat_announcements
     WHERE enterprise_id = ? AND TRIM(title) = ? ORDER BY id DESC LIMIT 1`,
    [eid, t]
  );
  return rows && rows[0] ? rows[0] : null;
}

async function pickProjectIdForAnnouncement(enterpriseId, annRow) {
  const ids = parseAttachedProjectIds(annRow && annRow.attached_project_ids);
  if (ids.length) return ids[0];
  try {
    await ensureCompatProjectsTable();
    const [pr] = await pool.execute(
      `SELECT id FROM compat_enterprise_projects
       WHERE enterprise_id = ? AND LOWER(TRIM(COALESCE(biz_type, ''))) = 'announcement'
       ORDER BY id ASC LIMIT 1`,
      [Number(enterpriseId)]
    );
    if (pr && pr[0]) return Number(pr[0].id);
    const [pr2] = await pool.execute(
      'SELECT id FROM compat_enterprise_projects WHERE enterprise_id = ? ORDER BY id ASC LIMIT 1',
      [Number(enterpriseId)]
    );
    if (pr2 && pr2[0]) return Number(pr2[0].id);
  } catch (_) {
    /* ignore */
  }
  return null;
}

/** 公告下无关联项目时，创建一条占位项目以便写入报名记录 */
async function ensureAnnouncementProject(enterpriseId, annRow) {
  const eid = Number(enterpriseId);
  const annId = annRow && annRow.id != null ? Number(annRow.id) : null;
  if (!Number.isFinite(eid) || eid <= 0) return null;
  await ensureCompatProjectsTable();
  if (Number.isFinite(annId) && annId > 0) {
    const [byAnn] = await pool.execute(
      `SELECT id FROM compat_enterprise_projects
       WHERE enterprise_id = ? AND LOWER(TRIM(COALESCE(biz_type, ''))) = 'announcement'
       ORDER BY id ASC LIMIT 5`,
      [eid]
    );
    if (byAnn && byAnn[0]) return Number(byAnn[0].id);
  }
  const title = normRosterStr(annRow && annRow.title) || '招聘公告';
  try {
    const [ins] = await pool.execute(
      `INSERT INTO compat_enterprise_projects (enterprise_id, user_id, name, project_type, biz_type, status, description)
       VALUES (?, 0, ?, '招聘', 'announcement', 'active', ?)`,
      [eid, title.slice(0, 200), `名单导入自动创建：${title}`.slice(0, 500)]
    );
    return ins.insertId ? Number(ins.insertId) : null;
  } catch (e) {
    console.warn('[roster-import] ensureAnnouncementProject:', e.message);
    return await pickProjectIdForAnnouncement(eid, annRow);
  }
}

async function syncCandidatePasswordFromIdCard(userId, idCard) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return;
  try {
    await UserModel.syncPortalPasswordFromIdCard(uid, idCard);
  } catch (e) {
    console.warn('[roster] syncCandidatePasswordFromIdCard:', e.message);
  }
}

async function ensureCoopApplicationFromRoster(entId, annId, projectId, userId, imp) {
  await ensureCompatCooperationApplicationsTable();
  const [existing] = await pool.execute(
    'SELECT id, extra_json, announcement_id FROM compat_cooperation_applications WHERE user_id = ? AND project_id = ? LIMIT 1',
    [userId, projectId]
  );
  let extra = { basicInfo: {}, enterpriseRosterMeta: {} };
  if (existing && existing[0] && existing[0].extra_json) {
    try {
      extra = JSON.parse(existing[0].extra_json);
    } catch (_) {
      extra = { basicInfo: {}, enterpriseRosterMeta: {} };
    }
  }
  if (!extra.basicInfo || typeof extra.basicInfo !== 'object') extra.basicInfo = {};
  if (!extra.enterpriseRosterMeta || typeof extra.enterpriseRosterMeta !== 'object') {
    extra.enterpriseRosterMeta = {};
  }
  const rm = extra.enterpriseRosterMeta;
  const name = normRosterStr(imp.name);
  const idc = normRosterStr(imp.idCard).slice(0, 24);
  const ph = normPhoneDigits(imp.phone);
  if (name) extra.basicInfo.name = name;
  if (idc) {
    extra.basicInfo.idCardNumber = idc;
    extra.basicInfo.idNumber = idc;
    rm.idCard = idc;
  }
  if (ph) extra.basicInfo.phone = ph;
  if (imp.job) extra.basicInfo.appliedJobName = normRosterStr(imp.job).slice(0, 200);
  if (imp.examTicket) rm.examTicketNumber = normRosterStr(imp.examTicket).slice(0, 64);
  rm.announcementId = annId;
  rm.announcementTitle = normRosterStr(imp.announcementTitle || '');
  const payload = JSON.stringify(extra);
  if (existing && existing[0]) {
    await pool.execute(
      `UPDATE compat_cooperation_applications
       SET enterprise_id = ?, announcement_id = ?, status = 'approved', extra_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [entId, annId, payload, existing[0].id]
    );
    return { id: existing[0].id, userId, isNew: false };
  }
  const [ins] = await pool.execute(
    `INSERT INTO compat_cooperation_applications (enterprise_id, announcement_id, project_id, user_id, status, extra_json)
     VALUES (?, ?, ?, ?, 'approved', ?)`,
    [entId, annId, projectId, userId, payload]
  );
  return { id: ins.insertId, userId, isNew: true };
}

/** @returns {{ matcher?: object, error?: string }} */
async function createMatcherFromRosterRow(entId, annRow, imp) {
  const annId = Number(annRow.id);
  let projectId = await pickProjectIdForAnnouncement(entId, annRow);
  if (!projectId) projectId = await ensureAnnouncementProject(entId, annRow);
  if (!projectId) return { error: '无法关联招聘公告项目，请检查公告是否属于本企业' };
  const phone = normPhoneDigits(imp.phone);
  const idCard = normIdDigits(imp.idCard);
  const name = normRosterStr(imp.name);
  const ticket = normRosterStr(imp.examTicket || '');
  if (!name) return { error: '姓名为空' };
  if (idCard.length < 15 && phone.length < 10 && !ticket) {
    return { error: '请至少填写身份证号、手机号或准考证号之一' };
  }
  let r = await UserModel.createCandidateOrFind(
    {
      real_name: name,
      username: phone.length >= 10 ? phone : '',
      exam_number: ticket,
      id_card: idCard,
      phone,
      position: imp.job || ''
    },
    { rosterImportLoose: true }
  );
  if (!r.success && idCard.length >= 15) {
    const byId = await UserModel.findByIdCardSafe(idCard);
    if (byId) {
      try {
        if (name) {
          await pool.execute('UPDATE qms_users SET real_name = ? WHERE id = ?', [name, byId.id]);
        }
        await UserModel.mergeCandidateProfileFieldsSafe(byId.id, {
          phone,
          id_card: idCard,
          exam_number: ticket,
          position: (imp.job || '').trim()
        });
        r = { success: true, userId: byId.id, isNew: false, matchedBy: 'id_card_roster' };
      } catch (e) {
        return { error: e.message || '按身份证更新账号失败' };
      }
    }
  }
  if (!r.success) {
    return { error: r.error || '无法创建或匹配账号' };
  }
  if (phone.length >= 10) {
    try {
      await UserModel.updatePhoneSafe(r.userId, phone);
    } catch (_) {
      /* ignore */
    }
  }
  if (idCard.length >= 6) await syncCandidatePasswordFromIdCard(r.userId, idCard);
  const coop = await ensureCoopApplicationFromRoster(entId, annId, projectId, r.userId, imp);
  const ex = { basicInfo: { name, phone, idCardNumber: idCard }, enterpriseRosterMeta: {} };
  return {
    matcher: {
      id: coop.id,
      userId: r.userId,
      nm: name.toLowerCase(),
      idc: idCard,
      ph: phone,
      ticketSys: ticket,
      jobLine: normRosterStr(imp.job || ''),
      ex,
      _created: true
    }
  };
}

/** 名单导入：按身份证将已有账号挂到公告报名记录（不要求事先审核通过） */
async function matcherFromUserIdForRoster(entId, annRow, imp, userId) {
  const annId = Number(annRow.id);
  let projectId = await pickProjectIdForAnnouncement(entId, annRow);
  if (!projectId) projectId = await ensureAnnouncementProject(entId, annRow);
  if (!projectId) return { error: '无法关联招聘公告项目' };
  const phone = normPhoneDigits(imp.phone);
  const idCard = normIdDigits(imp.idCard);
  const name = normRosterStr(imp.name);
  const coop = await ensureCoopApplicationFromRoster(entId, annId, projectId, userId, imp);
  let ex = { basicInfo: { name, phone, idCardNumber: idCard }, enterpriseRosterMeta: {} };
  try {
    const [rows] = await pool.execute(
      'SELECT extra_json FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
      [coop.id]
    );
    if (rows[0] && rows[0].extra_json) ex = JSON.parse(rows[0].extra_json);
  } catch (_) {}
  return {
    matcher: {
      id: coop.id,
      userId,
      nm: name.toLowerCase(),
      idc: idCard,
      ph: phone,
      ticketSys: normRosterStr(imp.examTicket || ''),
      jobLine: normRosterStr(imp.job || ''),
      ex,
      _linked: true
    }
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

async function loadTicketToUserIdMap(enterpriseId, batchId) {
  const m = new Map();
  if (!enterpriseId || !batchId) return m;
  try {
    await ensureCompatExamAllocationBatchesTable();
    const [rows] = await pool.execute(
      `SELECT payload_json FROM compat_exam_allocation_batches WHERE enterprise_id = ? AND batch_id = ? LIMIT 1`,
      [Number(enterpriseId), String(batchId).trim()]
    );
    const row = rows && rows[0];
    if (!row || !row.payload_json) return m;
    const payload = JSON.parse(row.payload_json);
    const allocs = Array.isArray(payload.allocations) ? payload.allocations : [];
    for (const a of allocs) {
      const ticket = normRosterStr(a.admitCardNumber || a.examNumber || a.exam_number || '');
      const uid = parseInt(
        String(a.candidateUserId || a.userId || a.user_id || a.candidate_user_id || ''),
        10
      );
      if (ticket && Number.isFinite(uid) && uid > 0) m.set(ticket, uid);
    }
  } catch (_) {}
  return m;
}

router.get('/candidates', authenticate, getCompatCandidatesList);

/** 可选鉴权：地址栏直接打开也能看到全库报名条数；带企业 token 时多返回本企业命中数 */
router.get('/candidates/diagnose', optionalAuthenticate, async (req, res) => {
  const data = {
    ok: true,
    hint:
      '公告报名在表 compat_cooperation_applications；企业端列表按 COALESCE(报名行、项目、公告) 的 enterprise_id 过滤，且包含「项目 enterprise_id 为空但创建人为本企业主账号」的报名（与岗位列表规则一致）',
    note:
      '浏览器地址栏打开本页不会带登录 token。若 applicationsTotal>0 但企业列表仍为空，请带 Authorization: Bearer <企业token> 再访问本接口查看 applicationsForYourEnterprise，或在已登录的 tests.html 控制台执行 fetch。'
  };
  try {
    await ensureCompatCooperationApplicationsTable();
    const [[tot]] = await pool.execute('SELECT COUNT(*) AS n FROM compat_cooperation_applications');
    data.applicationsTotal = Number(tot && tot.n) || 0;
    if (!req.user || req.isGuest) {
      data.auth = 'anonymous';
    } else if (req.user.role === 'enterprise') {
      data.auth = 'enterprise';
      const eid = await getCompatManageEnterpriseDbId(req);
      if (eid != null) {
        await ensureCompatAnnouncementsTable();
        const eN = Number(eid);
        const [[m]] = await pool.execute(
          `SELECT COUNT(*) AS n FROM compat_cooperation_applications a
           LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
           LEFT JOIN compat_announcements an ON an.id = a.announcement_id
           WHERE (
             (a.enterprise_id IS NOT NULL AND CAST(a.enterprise_id AS UNSIGNED) = ?)
             OR (p.enterprise_id IS NOT NULL AND CAST(p.enterprise_id AS UNSIGNED) = ?)
             OR (an.enterprise_id IS NOT NULL AND CAST(an.enterprise_id AS UNSIGNED) = ?)
           )
           OR (p.id IS NOT NULL AND (p.enterprise_id IS NULL OR CAST(p.enterprise_id AS UNSIGNED) = 0) AND p.user_id = ?)`,
          [eN, eN, eN, req.user.id]
        );
        data.applicationsForYourEnterprise = Number(m && m.n) || 0;
        data.yourEnterpriseId = Number(eid);
      } else {
        data.applicationsForYourEnterprise = null;
        data.yourEnterpriseId = null;
        data.warn = '已登录但未解析到 enterpriseId（未绑定企业？）';
      }
    } else if (req.user.role === 'admin') {
      data.auth = 'admin';
      data.hintAdmin = '管理员 token 下不提供按企业过滤计数；请换企业账号带 token 访问本接口或查库。';
    } else {
      data.auth = req.user.role || 'user';
    }
  } catch (e) {
    data.error = e.message || String(e);
  }
  return res.json({ success: true, data });
});

async function getCompatCandidateById(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin' && role !== 'enterprise_reviewer') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const cid = parseInt(req.params.candidateId, 10);
  if (!Number.isFinite(cid) || cid < PROJECT_COOP_APPLICATION_ID_OFFSET) {
    return res.status(404).json({ success: false, message: '候选人不存在' });
  }
  const rawId = cid - PROJECT_COOP_APPLICATION_ID_OFFSET;
  try {
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute(
      `SELECT a.*, p.name AS project_name,
        COALESCE(a.enterprise_id, p.enterprise_id, an.enterprise_id) AS resolved_enterprise_id
       FROM compat_cooperation_applications a
       LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
       LEFT JOIN compat_announcements an ON an.id = a.announcement_id
       WHERE a.id = ? LIMIT 1`,
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '候选人不存在' });
    }
    const row = rows[0];
    if (!(await assertEnterpriseCanAccessCooperationRow(req, row))) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const eid =
      row.resolved_enterprise_id != null && row.resolved_enterprise_id !== ''
        ? Number(row.resolved_enterprise_id)
        : null;
    const feeMap = await loadAssessmentFeeSettingsMap(eid ? [eid] : []);
    const fs = eid && feeMap.has(eid) ? feeMap.get(eid) : null;
    const avMap = await getQmsUserAvatarUrlMapByIds([row.user_id]);
    const data = mapCooperationRowToCandidateApi(row, row.project_name, fs, {
      lite: false,
      profileAvatarUrl: avMap.get(Number(row.user_id)) || null
    });
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /candidates/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
}

async function putCompatCandidateById(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin' && role !== 'enterprise_reviewer') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const cid = parseInt(req.params.candidateId, 10);
  if (!Number.isFinite(cid) || cid < PROJECT_COOP_APPLICATION_ID_OFFSET) {
    return res.status(404).json({ success: false, message: '候选人不存在' });
  }
  const rawId = cid - PROJECT_COOP_APPLICATION_ID_OFFSET;
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1', [rawId]);
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '候选人不存在' });
    }
    const row = rows[0];
    if (!(await assertEnterpriseCanAccessCooperationRow(req, row))) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const st = (req.body && req.body.status) || 'pending';
    const allowed = new Set(['pending', 'approved', 'rejected', 'testing', 'completed']);
    const next = allowed.has(String(st)) ? String(st) : 'pending';
    let extraPut = {};
    try {
      extraPut = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extraPut = {};
    }
    if (!extraPut || typeof extraPut !== 'object') extraPut = {};
    const reviewerPut =
      req.body && req.body.reviewer != null ? String(req.body.reviewer).trim().slice(0, 200) : '';
    const returnReasonPut =
      req.body && req.body.returnReason != null ? String(req.body.returnReason).trim().slice(0, 2000) : '';
    const prevRaPut =
      extraPut.reviewAudit && typeof extraPut.reviewAudit === 'object' ? extraPut.reviewAudit : {};
    extraPut.reviewAudit = {
      ...prevRaPut,
      reviewer: reviewerPut || prevRaPut.reviewer || '',
      reviewedAt: new Date().toISOString(),
      status: next,
      returnReason: returnReasonPut || undefined
    };
    await pool.execute(
      'UPDATE compat_cooperation_applications SET status = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [next, JSON.stringify(extraPut), rawId]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /candidates/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
}

async function deleteCompatCandidateById(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role === 'enterprise_reviewer') {
    return res.status(403).json({ success: false, message: '子审核账号无权删除报名' });
  }
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const cid = parseInt(req.params.candidateId, 10);
  if (!Number.isFinite(cid) || cid < PROJECT_COOP_APPLICATION_ID_OFFSET) {
    return res.status(404).json({ success: false, message: '候选人不存在' });
  }
  const rawId = cid - PROJECT_COOP_APPLICATION_ID_OFFSET;
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1', [rawId]);
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '候选人不存在' });
    }
    const row = rows[0];
    if (!(await assertEnterpriseCanAccessCooperationRow(req, row))) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    await pool.execute('DELETE FROM compat_cooperation_applications WHERE id = ?', [rawId]);
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] DELETE /candidates/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
}

async function putCompatCandidateAssessmentFee(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role === 'enterprise_reviewer') {
    return res.status(403).json({ success: false, message: '子审核账号无权操作缴费确认' });
  }
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const cid = parseInt(req.params.candidateId, 10);
  if (!Number.isFinite(cid) || cid < PROJECT_COOP_APPLICATION_ID_OFFSET) {
    return res.status(404).json({ success: false, message: '候选人不存在' });
  }
  const rawId = cid - PROJECT_COOP_APPLICATION_ID_OFFSET;
  const paid = req.body && req.body.paid === true;
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1', [rawId]);
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '候选人不存在' });
    }
    const row = rows[0];
    if (!(await assertEnterpriseCanAccessCooperationRow(req, row))) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extra = {};
    }
    if (!extra || typeof extra !== 'object') extra = {};
    extra.assessmentFee = extra.assessmentFee || {};
    extra.assessmentFee.paid = paid;
    extra.assessmentFee.paidAt = paid ? new Date().toISOString() : null;
    extra.assessmentFee.confirmedBy = paid ? 'enterprise' : null;
    await pool.execute(
      'UPDATE compat_cooperation_applications SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(extra), rawId]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /candidates/:id/assessment-fee:', e.message);
    return res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
}

/** 企业端：对已缴费公告/项目报名办理退费（审核不通过）或退回待审（action=return） */
async function postCompatCandidateAssessmentRefund(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role === 'enterprise_reviewer') {
    return res.status(403).json({ success: false, message: '子审核账号无权操作退费' });
  }
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const cid = parseInt(req.params.candidateId, 10);
  if (!Number.isFinite(cid) || cid < PROJECT_COOP_APPLICATION_ID_OFFSET) {
    return res.status(404).json({ success: false, message: '候选人不存在' });
  }
  const rawId = cid - PROJECT_COOP_APPLICATION_ID_OFFSET;
  let action = String((req.body && req.body.action) || 'refund').toLowerCase();
  let reason =
    req.body && req.body.reason != null ? String(req.body.reason).trim().slice(0, 2000) : '';
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '候选人不存在' });
    }
    const row = rows[0];
    if (!(await assertEnterpriseCanAccessCooperationRow(req, row))) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extra = {};
    }
    if (!extra || typeof extra !== 'object') extra = {};
    const af = extra.assessmentFee || {};
    if (action === 'approve_refund_request' || action === 'agree_refund') {
      if (!af.refundRequested) {
        return res.status(400).json({ success: false, message: '考生未申请退费' });
      }
      if (!reason && af.refundRequestReason != null && String(af.refundRequestReason).trim() !== '') {
        reason = ('同意退费：' + String(af.refundRequestReason).trim()).slice(0, 2000);
      }
      action = 'refund';
    }
    if (!af.paid) {
      return res.status(400).json({ success: false, message: '该考生未标记为已缴费' });
    }
    const prevRa = extra.reviewAudit && typeof extra.reviewAudit === 'object' ? extra.reviewAudit : {};
    const reviewerIn =
      req.body && req.body.reviewer != null ? String(req.body.reviewer).trim().slice(0, 200) : '';

    if (action === 'return') {
      extra.assessmentFee = {
        ...af,
        paid: false,
        paidAt: null,
        returnedByEnterprise: true,
        returnedAt: new Date().toISOString(),
        returnReasonEnterprise: reason || undefined
      };
      extra.reviewAudit = {
        ...prevRa,
        reviewer: reviewerIn || prevRa.reviewer || '',
        reviewedAt: new Date().toISOString(),
        status: 'pending',
        returnReason: reason || '企业退回，请按要求补充或修改材料'
      };
      await pool.execute(
        'UPDATE compat_cooperation_applications SET status = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['pending', JSON.stringify(extra), rawId]
      );
      return res.json({ success: true, message: '已退回，考生需重新提交' });
    }

    extra.assessmentFee = {
      ...af,
      refunded: true,
      refundedAt: new Date().toISOString(),
      refundReason: reason || undefined,
      paid: false,
      paidAt: null,
      confirmedBy: null,
      refundRequested: false,
      refundRequestAt: null,
      refundRequestReason: null
    };
    extra.reviewAudit = {
      ...prevRa,
      reviewer: reviewerIn || prevRa.reviewer || '',
      reviewedAt: new Date().toISOString(),
      status: 'rejected',
      returnReason: reason || '测评费已退费，审核不通过'
    };
    await pool.execute(
      'UPDATE compat_cooperation_applications SET status = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['rejected', JSON.stringify(extra), rawId]
    );
    return res.json({ success: true, message: '已记录退费，状态为审核不通过' });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /candidates/:id/assessment-refund:', e.message);
    return res.status(500).json({ success: false, message: e.message || '操作失败' });
  }
}

router.put('/candidates/:candidateId/assessment-fee', authenticate, putCompatCandidateAssessmentFee);
router.post('/candidates/:candidateId/assessment-refund', authenticate, postCompatCandidateAssessmentRefund);
router.get('/candidates/:candidateId', authenticate, getCompatCandidateById);
router.put('/candidates/:candidateId', authenticate, putCompatCandidateById);
router.delete('/candidates/:candidateId', authenticate, deleteCompatCandidateById);

function pickFirstEnterpriseColumn(showRows, candidates) {
  const lowerToActual = new Map();
  for (const r of showRows || []) {
    lowerToActual.set(String(r.Field).toLowerCase(), r.Field);
  }
  for (const c of candidates) {
    const a = lowerToActual.get(String(c).toLowerCase());
    if (a) return a;
  }
  return null;
}

/** Express JSON 无法序列化 bigint，否则 PUT/GET /companies/me 会直接 500 */
function jsonSafeEnterpriseRow(row) {
  if (!row || typeof row !== 'object') return row;
  const o = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    o[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
}

/**
 * 同一「笔试企业编号」全局只能挂一条 enterprises：exam_enterprise_id 列 与 compat 表 company_status.examEnterpriseId 均参与校验，避免多企业抢同一考试端 id。
 */
async function assertExclusiveExamEnterpriseBinding(entRowId, examEnterpriseId) {
  const rid = Number(entRowId);
  const eid = Number(examEnterpriseId);
  if (!Number.isFinite(rid) || rid <= 0 || !Number.isFinite(eid) || eid <= 0) return;

  let showRows = [];
  try {
    const [r] = await pool.query('SHOW COLUMNS FROM enterprises');
    showRows = r || [];
  } catch (e) {
    showRows = [];
  }
  const col = pickFirstEnterpriseColumn(showRows, ['exam_enterprise_id', 'bind_exam_enterprise_id']);
  if (col) {
    const [rows] = await pool.execute(
      `SELECT id FROM enterprises WHERE ${sqlIdent(col)} = ? AND id != ? LIMIT 1`,
      [eid, rid]
    );
    if (rows && rows[0]) {
      const err = new Error(
        `笔试企业编号 ${eid} 已绑定至企业 id=${rows[0].id}。一个考试端企业编号只对应一家笔试企业，请先解绑其它企业或合并数据后再操作。`
      );
      err.code = 'EXAM_ENT_BIND_CONFLICT';
      throw err;
    }
  }
  try {
    await ensureCompatEnterpriseCompanyProfileTable();
    const [rows] = await pool.execute(
      `SELECT enterprise_id FROM compat_enterprise_company_profile
       WHERE enterprise_id != ?
         AND company_status IS NOT NULL
         AND JSON_EXTRACT(company_status, '$.examEnterpriseId') IS NOT NULL
         AND CAST(JSON_UNQUOTE(JSON_EXTRACT(company_status, '$.examEnterpriseId')) AS UNSIGNED) = ?
       LIMIT 1`,
      [rid, eid]
    );
    if (rows && rows[0]) {
      const err = new Error(
        `笔试企业编号 ${eid} 已绑定至企业 id=${rows[0].enterprise_id}（compat 档案）。一个考试端企业编号只对应一家笔试企业。`
      );
      err.code = 'EXAM_ENT_BIND_CONFLICT';
      throw err;
    }
  } catch (e) {
    if (e && e.code === 'EXAM_ENT_BIND_CONFLICT') throw e;
  }
}

/**
 * 企业主账号：解析 enterprises.id。
 * 顺序（重要）：① 用户表 enterprise_id（合并/修库后最可信）② Token 内 enterpriseId ③ enterprises.user_id（多行时 findByUserId 已 ORDER BY id ASC）
 * 此前若先走 findByUserId，可能与 JWT/用户表指向的「有数据的企业」不一致，表现为顶部公司名对、列表/缴费接口 403 或条数为 0。
 */
async function resolveEnterpriseIdForEnterpriseAccount(req) {
  const uid = req.user && req.user.id != null ? Number(req.user.id) : NaN;
  if (Number.isFinite(uid) && uid > 0) {
    for (const table of ['qms_users', 'users']) {
      try {
        const [rows] = await pool.execute(`SELECT enterprise_id FROM \`${table}\` WHERE id = ? LIMIT 1`, [uid]);
        const raw = rows && rows[0] ? rows[0].enterprise_id : null;
        const n = raw != null ? Number(raw) : NaN;
        if (Number.isFinite(n) && n > 0) {
          const ent = await EnterpriseModel.findById(n);
          if (ent) return n;
        }
      } catch (_) {
        /* 无表或无 enterprise_id 列 */
      }
    }
  }
  if (req.user && req.user.enterpriseId != null) {
    const n = Number(req.user.enterpriseId);
    if (Number.isFinite(n) && n > 0) {
      const ent = await EnterpriseModel.findById(n);
      if (ent) return n;
    }
  }
  if (req.enterpriseId != null) {
    const n = Number(req.enterpriseId);
    if (Number.isFinite(n) && n > 0) {
      const ent = await EnterpriseModel.findById(n);
      if (ent) return n;
    }
  }
  if (Number.isFinite(uid) && uid > 0) {
    const byOwner = await EnterpriseModel.findByUserId(uid);
    if (byOwner && byOwner.id != null) {
      const n = Number(byOwner.id);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * 按数字 id 命中 enterprises.id；否则按 talent_company_id（人才网公司 id 常写在此列）
 */
async function findEnterpriseByNumericIdOrTalentCompanyId(n) {
  const idNum = Number(n);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;
  let ent = await EnterpriseModel.findById(idNum);
  if (ent) return ent;
  ent = await EnterpriseModel.findByTalentCompanyId(idNum);
  return ent || null;
}

/**
 * company-center / 绑定笔试：解析 enterprises 行。须覆盖 JWT enterpriseId 为「人才网公司 id」、与笔试库主键不一致等情况。
 * 不在此处自动 INSERT enterprises：自动建企会生成新主键，与历史公告/考生/岗位等 enterprise_id 脱节，表现为「数据没了」且产生多企业。
 */
async function resolveEnterpriseForCompatUser(req) {
  // 请求级缓存：同一 req 对象内多次调用只执行一次 DB 查询链
  if (req._compatEnterpriseResolved !== undefined) return req._compatEnterpriseResolved;
  const result = await _resolveEnterpriseForCompatUserImpl(req);
  req._compatEnterpriseResolved = result;
  return result;
}

async function _resolveEnterpriseForCompatUserImpl(req) {
  if (req.user.role === 'enterprise_reviewer') {
    const raw = req.enterpriseId != null ? Number(req.enterpriseId) : null;
    if (!raw || !Number.isFinite(raw) || raw <= 0) {
      return { error: { status: 403, message: '未关联企业' } };
    }
    let ent = await findEnterpriseByNumericIdOrTalentCompanyId(raw);
    if (!ent) return { error: { status: 404, message: '企业不存在' } };
    return { enterpriseId: Number(ent.id), ent };
  }
  if (req.user.role === 'admin' && !req.user.enterpriseId) {
    return { error: { status: 403, message: '请使用企业账号操作' } };
  }
  let ent = null;
  let enterpriseId = null;
  // 1 JWT enterpriseId：可能是笔试 enterprises.id，也可能是人才网签票里的「公司 id」→ talent_company_id
  if (req.user.enterpriseId != null) {
    const e = await findEnterpriseByNumericIdOrTalentCompanyId(req.user.enterpriseId);
    if (e) {
      ent = e;
      enterpriseId = Number(e.id);
    }
  }
  // 2 用户表 enterprise_id / 其它解析
  if (!ent) {
    const eid = await resolveEnterpriseIdForEnterpriseAccount(req);
    if (eid && Number.isFinite(Number(eid)) && Number(eid) > 0) {
      const e = await findEnterpriseByNumericIdOrTalentCompanyId(eid);
      if (e) {
        ent = e;
        enterpriseId = Number(e.id);
      }
    }
  }
  // 3 enterprises.user_id
  if (!ent) {
    const e = await EnterpriseModel.findByUserId(req.user.id);
    if (e && e.id != null) {
      ent = e;
      enterpriseId = Number(e.id);
    }
  }
  // 4 JWT 的 userId 有时是人才公司 id（与 user_id 列未同步时）
  if (!ent && req.user.id != null) {
    const e = await EnterpriseModel.findByTalentCompanyId(req.user.id);
    if (e && e.id != null) {
      ent = e;
      enterpriseId = Number(e.id);
    }
  }
  if (!ent || enterpriseId == null || !Number.isFinite(Number(enterpriseId)) || enterpriseId <= 0) {
    return {
      error: {
        status: 403,
        message:
          '未关联企业：笔试库中无匹配的企业行。请在总管理端为已有企业补充 user_id 或 talent_company_id，勿反复「新建企业」（公告/考生等数据均挂在 enterprises.id，新主键会与历史数据脱节）。人才网同步请固定 talentCompanyId 以复用同一条企业。'
      }
    };
  }
  return { enterpriseId, ent };
}

/**
 * 企业端列表筛选用笔试库 enterprises.id（与 resolveEnterpriseForCompatUser 同源）。
 * 修复：JWT 里 enterpriseId 常为人才网公司 id，若仅用它去比 compat_enterprise_jobs.enterprise_id（实为笔试主键）会恒为空。
 */
async function getCompatManageEnterpriseDbId(req) {
  if (!req.user) return null;
  if (req.user.role === 'admin') {
    const n = req.enterpriseId != null ? Number(req.enterpriseId) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer') return null;
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) return null;
  const n = resolved.enterpriseId != null ? Number(resolved.enterpriseId) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 列表筛选用的企业 id 并集：解析主键 + JWT enterpriseId + user_id 对应企业行。
 * 兼容历史数据把 compat_* .enterprise_id 存成「人才网公司 id」、与笔试 enterprises.id 不一致时仍能查到（恢复旧版「单 JWT 数字能筛到」的行为）。
 */
async function collectCompatEnterpriseScopeIds(req) {
  // 请求级缓存，避免同一请求内多次调用重复查 DB
  if (req._compatEnterpriseScopeIds !== undefined) return req._compatEnterpriseScopeIds;
  const ids = new Set();
  if (!req.user) { req._compatEnterpriseScopeIds = []; return []; }
  if (req.user.role === 'admin') {
    const n = req.user.enterpriseId != null ? Number(req.user.enterpriseId) : NaN;
    if (Number.isFinite(n) && n > 0) ids.add(n);
    const result = [...ids];
    req._compatEnterpriseScopeIds = result;
    return result;
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer') {
    req._compatEnterpriseScopeIds = [];
    return [];
  }
  const resolved = await getCompatManageEnterpriseDbId(req);
  if (resolved != null && Number.isFinite(Number(resolved)) && Number(resolved) > 0) {
    ids.add(Number(resolved));
  }
  if (req.user.enterpriseId != null) {
    const raw = Number(req.user.enterpriseId);
    if (Number.isFinite(raw) && raw > 0) ids.add(raw);
  }
  try {
    if (req.user.id != null) {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (ent && ent.id != null) {
        const n = Number(ent.id);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
  } catch (_) {
    /* ignore */
  }
  const result = [...ids];
  req._compatEnterpriseScopeIds = result;
  return result;
}

/**
 * 写入笔试系统企业绑定 ID：优先 enterprises.exam_enterprise_id；无该列时写入 compat_enterprise_company_profile.company_status.examEnterpriseId
 */
async function persistExamEnterpriseBinding(entRowId, examEnterpriseId) {
  await assertExclusiveExamEnterpriseBinding(entRowId, examEnterpriseId);
  let showRows = [];
  try {
    const [r] = await pool.query('SHOW COLUMNS FROM enterprises');
    showRows = r || [];
  } catch (e) {
    showRows = [];
  }
  const col = pickFirstEnterpriseColumn(showRows, ['exam_enterprise_id', 'bind_exam_enterprise_id']);
  if (col) {
    await pool.execute(`UPDATE enterprises SET ${sqlIdent(col)} = ? WHERE id = ?`, [examEnterpriseId, entRowId]);
    return { ok: true, via: 'column' };
  }
  await ensureCompatEnterpriseCompanyProfileTable();
  const [rows] = await pool.execute(
    'SELECT company_status FROM compat_enterprise_company_profile WHERE enterprise_id = ? LIMIT 1',
    [entRowId]
  );
  let cs = {};
  if (rows && rows[0] && rows[0].company_status != null) {
    try {
      const raw = rows[0].company_status;
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) cs = { ...raw };
      else cs = JSON.parse(String(raw));
    } catch (_) {
      cs = {};
    }
  }
  if (!cs || typeof cs !== 'object') cs = {};
  cs.examEnterpriseId = examEnterpriseId;
  await pool.execute(
    `INSERT INTO compat_enterprise_company_profile (enterprise_id, company_status)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE company_status = VALUES(company_status)`,
    [entRowId, JSON.stringify(cs)]
  );
  return { ok: true, via: 'compat_profile' };
}

async function clearExamEnterpriseBinding(entRowId) {
  let showRows = [];
  try {
    const [r] = await pool.query('SHOW COLUMNS FROM enterprises');
    showRows = r || [];
  } catch (e) {
    showRows = [];
  }
  const col = pickFirstEnterpriseColumn(showRows, ['exam_enterprise_id', 'bind_exam_enterprise_id']);
  if (col) {
    try {
      await pool.execute(`UPDATE enterprises SET ${sqlIdent(col)} = NULL WHERE id = ?`, [entRowId]);
    } catch (e) {
      console.warn('[clearExamEnterpriseBinding] column:', e.message);
    }
  }
  await ensureCompatEnterpriseCompanyProfileTable();
  try {
    const [rows] = await pool.execute(
      'SELECT company_status FROM compat_enterprise_company_profile WHERE enterprise_id = ? LIMIT 1',
      [entRowId]
    );
    if (rows && rows[0] && rows[0].company_status != null) {
      const raw = rows[0].company_status;
      let cs = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : JSON.parse(String(raw));
      if (cs && typeof cs === 'object') {
        delete cs.examEnterpriseId;
        await pool.execute(
          'UPDATE compat_enterprise_company_profile SET company_status = ? WHERE enterprise_id = ?',
          [JSON.stringify(cs), entRowId]
        );
      }
    }
  } catch (e) {
    console.warn('[clearExamEnterpriseBinding] compat:', e.message);
  }
  return { ok: true };
}

/** 一键绑定时可选：同步 qms_users，与 POST /auth/sync-enterprise-to-exam 行为一致 */
async function linkEnterpriseExamAccount(enterpriseId, passwordPlain) {
  const entRow = await EnterpriseModel.findById(enterpriseId);
  if (!entRow) throw new Error('企业不存在');
  const password = String(passwordPlain || '').trim();
  if (password.length < 6) return { skipped: true };

  const phoneDigits = String(entRow.contact_phone || '').replace(/\D/g, '');
  const email = String(entRow.contact_email || '').trim();
  let loginUsername =
    phoneDigits.length >= 10 ? phoneDigits : email || `enterprise_${enterpriseId}`;
  loginUsername = String(loginUsername).trim();
  if (!loginUsername) throw new Error('企业未配置手机号或邮箱，无法生成笔试登录名');

  let qmsUser = await UserModel.findByUsername(loginUsername);
  if (!qmsUser && phoneDigits.length >= 10) {
    qmsUser = await UserModel.findByPhone(loginUsername);
  }
  if (qmsUser && qmsUser.role !== 'enterprise' && qmsUser.role !== 'admin') {
    throw new Error('该登录名已被非企业账号占用，请联系管理员处理');
  }
  const passwordHash = await bcrypt.hash(password, 4);
  if (qmsUser) {
    await UserModel.updatePasswordHash(qmsUser.id, passwordHash);
    try {
      await pool.execute(`UPDATE qms_users SET role = 'enterprise' WHERE id = ? AND role NOT IN ('admin')`, [
        qmsUser.id
      ]);
    } catch (_) {
      /* ignore */
    }
  } else {
    try {
      await UserModel.create({
        username: loginUsername,
        password,
        role: 'enterprise',
        email: email || null,
        real_name: entRow.name || null,
        phone: phoneDigits.length >= 10 ? phoneDigits : null
      });
    } catch (ce) {
      if (ce && (ce.code === 'ER_DUP_ENTRY' || String(ce.message || '').includes('Duplicate'))) {
        qmsUser = await UserModel.findByUsername(loginUsername);
        if (qmsUser) await UserModel.updatePasswordHash(qmsUser.id, passwordHash);
      } else {
        throw ce;
      }
    }
    if (!qmsUser) qmsUser = await UserModel.findByUsername(loginUsername);
  }
  if (qmsUser) {
    try {
      await pool.execute(`UPDATE enterprises SET user_id = ? WHERE id = ?`, [qmsUser.id, enterpriseId]);
    } catch (linkErr) {
      console.warn('[linkEnterpriseExamAccount] enterprises.user_id:', linkErr.message);
    }
  }
  return { skipped: false };
}

async function fetchCompatCompanyStatusObject(enterpriseId) {
  try {
    await ensureCompatEnterpriseCompanyProfileTable();
    const [rows] = await pool.execute(
      'SELECT company_status FROM compat_enterprise_company_profile WHERE enterprise_id = ? LIMIT 1',
      [enterpriseId]
    );
    if (!rows || !rows[0] || rows[0].company_status == null) return null;
    const raw = rows[0].company_status;
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : null;
      } catch (_) {
        return null;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * 同库部署：笔试侧企业与人才网 enterprises 同一主键，未绑定时自动写入 exam_enterprise_id = enterprises.id（一个企业仅一个编号）。
 */
async function ensureAutoExamEnterpriseBindingIfMissing(ent) {
  if (!ent || ent.id == null) return;
  const eid = Number(ent.id);
  if (!Number.isFinite(eid) || eid <= 0) return;
  try {
    const snapshot = await buildCompaniesMeResponseData(ent);
    const cur = snapshot.examEnterpriseId;
    if (cur != null && Number.isFinite(Number(cur)) && Number(cur) > 0) return;
    await persistExamEnterpriseBinding(eid, eid);
  } catch (e) {
    console.warn('[ensureAutoExamEnterpriseBindingIfMissing]', e.message);
  }
}

async function buildCompaniesMeResponseData(ent) {
  const entSafe = jsonSafeEnterpriseRow(ent);
  const name = entSafe.name || entSafe.company_name || '';
  const code = entSafe.unified_social_credit_code || entSafe.unifiedSocialCreditCode || '';
  let verificationStatus = (entSafe.verification_status || entSafe.verificationStatus || 'pending').toLowerCase();
  try {
    await ensureCompatEnterpriseVerificationRequestsTable();
    const [crows] = await pool.execute(
      'SELECT status FROM compat_enterprise_verification_requests WHERE enterprise_id = ? LIMIT 1',
      [entSafe.id]
    );
    if (crows && crows[0] && crows[0].status) {
      const cs = String(crows[0].status).toLowerCase();
      if (cs === 'pending' || cs === 'approved' || cs === 'rejected') verificationStatus = cs;
    }
  } catch (e) {
    /* ignore */
  }
  let companyStatus = null;
  const rawCs =
    entSafe.company_status ?? entSafe.companyStatus ?? entSafe.profile_json ?? entSafe.extra_profile;
  if (rawCs != null && rawCs !== '') {
    if (typeof rawCs === 'object') companyStatus = rawCs;
    else {
      try {
        const o = JSON.parse(String(rawCs));
        if (o && typeof o === 'object') companyStatus = o;
      } catch (_) {
        companyStatus = null;
      }
    }
  }
  if (!companyStatus) {
    companyStatus = await fetchCompatCompanyStatusObject(entSafe.id);
  }
  let examEnterpriseId = null;
  if (entSafe.exam_enterprise_id != null && Number.isFinite(Number(entSafe.exam_enterprise_id))) {
    examEnterpriseId = Number(entSafe.exam_enterprise_id);
  } else if (entSafe.examEnterpriseId != null && Number.isFinite(Number(entSafe.examEnterpriseId))) {
    examEnterpriseId = Number(entSafe.examEnterpriseId);
  }
  if (
    examEnterpriseId == null &&
    companyStatus &&
    typeof companyStatus === 'object' &&
    companyStatus.examEnterpriseId != null &&
    Number.isFinite(Number(companyStatus.examEnterpriseId))
  ) {
    examEnterpriseId = Number(companyStatus.examEnterpriseId);
  }
  if (examEnterpriseId == null && entSafe.talent_company_id != null) {
    const tc = Number(entSafe.talent_company_id);
    if (Number.isFinite(tc) && tc > 0) examEnterpriseId = tc;
  }
  const data = {
    ...entSafe,
    companyName: name,
    unifiedSocialCreditCode: code,
    verificationStatus,
    examEnterpriseId: examEnterpriseId != null && Number.isFinite(Number(examEnterpriseId)) ? Number(examEnterpriseId) : null
  };
  if (companyStatus && typeof companyStatus === 'object') {
    data.companyStatus = companyStatus;
  }
  return data;
}

/**
 * GET /companies/me
 * 静态站请求 /api/v1/companies/me；正式路由在 /api/enterprises/me
 */
router.get('/companies/me', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    let ent = null;
    if (req.user.role === 'enterprise' || req.user.enterpriseId) {
      const eid = await resolveEnterpriseIdForEnterpriseAccount(req);
      if (eid) ent = await findEnterpriseByNumericIdOrTalentCompanyId(eid);
    }
    if (!ent && req.user.enterpriseId) {
      ent = await findEnterpriseByNumericIdOrTalentCompanyId(req.user.enterpriseId);
    }
    if (!ent) {
      ent = await EnterpriseModel.findByUserId(req.user.id);
    }
    if (!ent) {
      ent = await EnterpriseModel.findByTalentCompanyId(req.user.id);
    }
    if (!ent) {
      return res.json({
        success: true,
        data: {
          companyName: (req.user.username || '').trim() || '未命名企业',
          unifiedSocialCreditCode: '',
          verificationStatus: 'pending'
        }
      });
    }
    await ensureAutoExamEnterpriseBindingIfMissing(ent);
    const entFresh = await EnterpriseModel.findById(ent.id);
    const entOut = entFresh || ent;
    return res.json({
      success: true,
      data: await buildCompaniesMeResponseData(entOut)
    });
  } catch (e) {
    console.warn('[talentSiteCompat] companies/me:', e.message);
    return res.json({
      success: true,
      data: {
        companyName: '',
        unifiedSocialCreditCode: '',
        verificationStatus: 'pending'
      }
    });
  }
});

/**
 * PUT /companies/me — company-center.html 保存基本信息与 companyStatus（此前仅 GET，前端 PUT 会 404）
 */
router.put('/companies/me', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  if (req.user.role === 'admin' && !req.user.enterpriseId) {
    return res.status(403).json({ success: false, message: '请使用企业账号更新资料' });
  }
  try {
    let ent = null;
    if (req.user.role === 'enterprise' || req.user.enterpriseId) {
      const eid = await resolveEnterpriseIdForEnterpriseAccount(req);
      if (eid) ent = await findEnterpriseByNumericIdOrTalentCompanyId(eid);
    }
    if (!ent && req.user.enterpriseId) {
      ent = await findEnterpriseByNumericIdOrTalentCompanyId(req.user.enterpriseId);
    }
    if (!ent) {
      ent = await EnterpriseModel.findByUserId(req.user.id);
    }
    if (!ent) {
      ent = await EnterpriseModel.findByTalentCompanyId(req.user.id);
    }
    if (!ent) {
      return res.status(404).json({ success: false, message: '未关联企业' });
    }
    const enterpriseId = Number(ent.id);
    const body = req.body || {};

    let showRows = [];
    try {
      const [r] = await pool.query('SHOW COLUMNS FROM enterprises');
      showRows = r || [];
    } catch (e) {
      showRows = [];
    }

    const updates = [];
    const values = [];

    const firstDefined = (keys) => {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) {
          return body[k];
        }
      }
      return undefined;
    };

    const trySet = (keys, colCandidates) => {
      const v = firstDefined(keys);
      if (v === undefined) return;
      const col = pickFirstEnterpriseColumn(showRows, colCandidates);
      if (!col) return;
      updates.push(`${sqlIdent(col)} = ?`);
      values.push(typeof v === 'string' ? String(v).trim() : v);
    };

    trySet(['companyName', 'company_name'], ['name', 'company_name', 'enterprise_name']);
    trySet(['contactPhone', 'contact_phone'], ['contact_phone', 'phone', 'mobile', 'tel']);
    trySet(['contactPerson', 'contact_name'], ['contact_name', 'contact', 'legal_person', 'liaison']);
    trySet(['address'], ['address', 'addr']);
    trySet(['industry'], ['industry', 'sector', 'business_scope']);
    trySet(['industryType', 'industry_type'], ['industry_type', 'biz_type', 'business_type']);
    // 勿映射到 employee_count：前端常为「50-100人」等描述，写入 INT 会触发 MySQL 严格模式报错
    trySet(['scale'], ['scale', 'company_scale', 'emp_scale', 'company_size']);
    trySet(
      ['unifiedSocialCreditCode', 'unified_social_credit_code'],
      ['unified_social_credit_code', 'credit_code', 'social_credit_code', 'uscc']
    );

    if (updates.length > 0) {
      values.push(enterpriseId);
      await pool.execute(`UPDATE enterprises SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'companyStatus')) {
      const statusCol = pickFirstEnterpriseColumn(showRows, [
        'company_status',
        'company_profile_json',
        'profile_json',
        'extra_profile',
        'talent_profile_json'
      ]);
      const payload =
        body.companyStatus && typeof body.companyStatus === 'object' ? body.companyStatus : {};
      if (statusCol) {
        await pool.execute(`UPDATE enterprises SET ${sqlIdent(statusCol)} = ? WHERE id = ?`, [
          JSON.stringify(payload),
          enterpriseId
        ]);
      } else {
        await ensureCompatEnterpriseCompanyProfileTable();
        const statusJson = JSON.stringify(payload);
        await pool.execute(
          `INSERT INTO compat_enterprise_company_profile (enterprise_id, company_status)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE company_status = VALUES(company_status)`,
          [enterpriseId, statusJson]
        );
      }
    }

    let fresh = await EnterpriseModel.findById(enterpriseId);
    if (!fresh) {
      fresh = { ...ent, id: enterpriseId };
    }
    return res.json({ success: true, data: await buildCompaniesMeResponseData(fresh) });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /companies/me:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/**
 * GET/PUT /companies/me/assessment-fee-settings — tests.html 审核管理「缴费设置」
 * 处理器挂到 router 上供 server.js 显式注册，避免仅 app.use('/api/v1', router) 时线上偶发 404。
 */
async function getCompatAssessmentFeeSettings(req, res) {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  try {
    await ensureCompatEnterpriseAssessmentFeeSettingsTable();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_enterprise_assessment_fee_settings WHERE enterprise_id = ? LIMIT 1',
      [resolved.enterpriseId]
    );
    const row = rows && rows[0] ? jsonSafeEnterpriseRow(rows[0]) : null;
    const pubPay = await getPublicPaymentQrcodeUrlsForJobseeker();
    const data = row
      ? {
          enabled: Number(row.enabled) === 1,
          amountYuan: row.amount_yuan != null ? Number(row.amount_yuan) : 0,
          payStartAt: toIsoDateTimeMaybe(row.pay_start_at),
          payEndAt: toIsoDateTimeMaybe(row.pay_end_at),
          wechatQrcodeUrl: pubPay.wechatQrcodeUrl,
          alipayQrcodeUrl: pubPay.alipayQrcodeUrl
        }
      : {
          enabled: false,
          amountYuan: 0,
          payStartAt: null,
          payEndAt: null,
          wechatQrcodeUrl: pubPay.wechatQrcodeUrl,
          alipayQrcodeUrl: pubPay.alipayQrcodeUrl
        };
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET assessment-fee-settings:', e.message);
    return res.status(500).json({ success: false, message: e.message || '读取失败' });
  }
}

async function putCompatAssessmentFeeSettings(req, res) {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  const b = req.body || {};
  const enabled = b.enabled === true || b.enabled === 1 || b.enabled === '1' ? 1 : 0;
  const amount = b.amountYuan != null ? Number(b.amountYuan) : 0;
  const payStartAt =
    b.payStartAt != null && String(b.payStartAt).trim() !== '' ? new Date(b.payStartAt) : null;
  const payEndAt = b.payEndAt != null && String(b.payEndAt).trim() !== '' ? new Date(b.payEndAt) : null;
  try {
    await ensureCompatEnterpriseAssessmentFeeSettingsTable();
    await pool.execute(
      `INSERT INTO compat_enterprise_assessment_fee_settings
        (enterprise_id, enabled, amount_yuan, pay_start_at, pay_end_at, wechat_qrcode_url, alipay_qrcode_url)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)
       ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        amount_yuan = VALUES(amount_yuan),
        pay_start_at = VALUES(pay_start_at),
        pay_end_at = VALUES(pay_end_at),
        wechat_qrcode_url = NULL,
        alipay_qrcode_url = NULL`,
      [
        resolved.enterpriseId,
        enabled,
        Number.isFinite(amount) && amount >= 0 ? amount : 0,
        payStartAt && Number.isFinite(payStartAt.getTime()) ? payStartAt : null,
        payEndAt && Number.isFinite(payEndAt.getTime()) ? payEndAt : null
      ]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT assessment-fee-settings:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
}

router.get('/companies/me/assessment-fee-settings', authenticate, requireRole('enterprise', 'admin'), getCompatAssessmentFeeSettings);
router.put('/companies/me/assessment-fee-settings', authenticate, requireRole('enterprise', 'admin'), putCompatAssessmentFeeSettings);

/**
 * POST /companies/create-exam-enterprise — company-center「一键创建并绑定」
 * 同库部署：笔试 enterprises.id 即当前企业 id，写入 exam_enterprise_id（或 compat 表 JSON）供 GET /companies/me 展示。
 * 导出为 postCreateExamEnterprise 供 server.js 顶层显式挂载，避免线上子 Router 未命中时 404。
 */
async function postCreateExamEnterprise(req, res) {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  const { enterpriseId } = resolved;
  try {
    const body = req.body || {};
    const pwd = body.password != null ? String(body.password).trim() : '';
    if (pwd && pwd.length > 0 && pwd.length < 6) {
      return res.status(400).json({ success: false, message: '若填写密码则至少 6 位' });
    }
    const examId = enterpriseId;
    await persistExamEnterpriseBinding(enterpriseId, examId);
    if (pwd.length >= 6) {
      try {
        await linkEnterpriseExamAccount(enterpriseId, pwd);
      } catch (e) {
        await clearExamEnterpriseBinding(enterpriseId);
        return res.status(409).json({
          success: false,
          message: e.message || '同步笔试登录账号失败，请检查企业资料中的手机/邮箱是否可用'
        });
      }
    }
    const fresh = await EnterpriseModel.findById(enterpriseId);
    return res.json({
      success: true,
      message: pwd
        ? '已绑定笔试企业并同步登录账号'
        : '已绑定笔试企业（编号与当前企业一致；可在测评管理页使用「同步到笔试系统」设置密码）',
      data: fresh ? await buildCompaniesMeResponseData(fresh) : {}
    });
  } catch (e) {
    if (e && e.code === 'EXAM_ENT_BIND_CONFLICT') {
      return res.status(409).json({ success: false, message: e.message || '该笔试企业编号已绑定其他企业' });
    }
    console.warn('[talentSiteCompat] POST /companies/create-exam-enterprise:', e.message);
    return res.status(500).json({ success: false, message: e.message || '创建绑定失败' });
  }
}
// enterprise_reviewer：resolveEnterpriseForCompatUser 已按 req.enterpriseId 解析，需允许子账号操作绑定
router.post(
  '/companies/create-exam-enterprise',
  authenticate,
  requireRole('enterprise', 'admin', 'enterprise_reviewer'),
  postCreateExamEnterprise
);

/** POST /companies/unbind-exam-enterprise — 取消笔试绑定 */
router.post('/companies/unbind-exam-enterprise', authenticate, requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  try {
    await clearExamEnterpriseBinding(resolved.enterpriseId);
    const fresh = await EnterpriseModel.findById(resolved.enterpriseId);
    return res.json({
      success: true,
      message: '已取消绑定',
      data: fresh ? await buildCompaniesMeResponseData(fresh) : {}
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /companies/unbind-exam-enterprise:', e.message);
    return res.status(500).json({ success: false, message: e.message || '操作失败' });
  }
});

/**
 * PUT /companies/exam-enterprise — 已改为仅「自动生成并保存」：忽略请求体，始终绑定为当前企业 id（同库单编号）。
 * 保留路由供旧前端调用时不报错。
 */
router.put('/companies/exam-enterprise', authenticate, requireRole('enterprise', 'admin', 'enterprise_reviewer'), async (req, res) => {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  const eid = Number(resolved.enterpriseId);
  if (!Number.isFinite(eid) || eid < 1) {
    return res.status(400).json({ success: false, message: '无效的企业上下文' });
  }
  try {
    await persistExamEnterpriseBinding(eid, eid);
    const fresh = await EnterpriseModel.findById(resolved.enterpriseId);
    return res.json({
      success: true,
      message: '已自动生成并绑定笔试系统企业编号（与本企业主键一致，无需手填）',
      data: fresh ? await buildCompaniesMeResponseData(fresh) : {}
    });
  } catch (e) {
    if (e && e.code === 'EXAM_ENT_BIND_CONFLICT') {
      return res.status(409).json({ success: false, message: e.message || '该笔试企业编号已绑定其他企业' });
    }
    console.warn('[talentSiteCompat] PUT /companies/exam-enterprise:', e.message);
    return res.status(500).json({ success: false, message: e.message || '绑定失败' });
  }
});

function escapeHtmlCompatReport(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCompatAiReportHtml(templateName, formData, snapshot) {
  const fd = formData && typeof formData === 'object' ? formData : {};
  const sn = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const companyName = sn.companyName || '贵公司';
  const industry = sn.industry || fd.industry || '未知';
  const scale =
    sn.scale || fd.companySize || (fd.employeeCount != null && fd.employeeCount !== '' ? `${fd.employeeCount}人` : '') || '未知';
  let html = `<h1>${escapeHtmlCompatReport(templateName)}</h1>`;
  html += `<p>生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>`;
  html += `<h2>一、企业概况</h2><p><strong>${escapeHtmlCompatReport(companyName)}</strong>，属于${escapeHtmlCompatReport(
    industry
  )}行业，规模为${escapeHtmlCompatReport(String(scale))}。</p>`;
  if (sn.address) html += `<p>地址：${escapeHtmlCompatReport(sn.address)}</p>`;
  const contact = [sn.contactPerson, sn.contactPhone].filter(Boolean).join(' ');
  if (contact) html += `<p>联系方式：${escapeHtmlCompatReport(contact)}</p>`;
  if (fd.establishmentDate) html += `<p>成立日期：${escapeHtmlCompatReport(fd.establishmentDate)}</p>`;
  if (fd.registeredCapital) html += `<p>注册资本：${escapeHtmlCompatReport(fd.registeredCapital)}</p>`;
  html += `<h2>二、填报数据摘要</h2><p>以下为基于模板与企业填报数据的摘要，详细分析可在页面中查看图表。</p>`;
  try {
    const keys = Object.keys(fd).filter((k) => k !== 'templateId').slice(0, 100);
    html += '<ul>';
    keys.forEach((k) => {
      const v = fd[k];
      if (v == null || v === '') return;
      const vs = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (vs.length > 800) return;
      html += `<li><strong>${escapeHtmlCompatReport(k)}</strong>：${escapeHtmlCompatReport(vs)}</li>`;
    });
    html += '</ul>';
  } catch (e) {
    html += '<p>（表单字段较多，已省略列表）</p>';
  }
  return html;
}

async function resolveCompatEnterpriseIdForMe(req) {
  if (req.user.role === 'admin' && (req.user.enterpriseId == null || req.user.enterpriseId === '')) {
    return null;
  }
  if (req.user.enterpriseId != null && req.user.enterpriseId !== '') {
    const e = await EnterpriseModel.findById(req.user.enterpriseId);
    if (e && e.id != null) return Number(e.id);
  }
  const e2 = await EnterpriseModel.findByUserId(req.user.id);
  return e2 && e2.id != null ? Number(e2.id) : null;
}

/**
 * GET /companies/me/ai-reports — company-center.html 已生成报告列表
 */
router.get('/companies/me/ai-reports', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const enterpriseId = await resolveCompatEnterpriseIdForMe(req);
    if (!enterpriseId) {
      return res.json({ success: true, data: { list: [] } });
    }
    await ensureCompatEnterpriseAiReportsTable();
    const [rows] = await pool.execute(
      `SELECT id, template_id AS templateId, template_name AS templateName, content,
              form_data AS formData, company_snapshot AS companySnapshot, created_at AS generatedAt
       FROM compat_enterprise_ai_reports WHERE enterprise_id = ? ORDER BY id DESC LIMIT 100`,
      [enterpriseId]
    );
    const list = (rows || []).map((r) => ({
      id: String(r.id),
      templateId: r.templateId || '',
      templateName: r.templateName || '',
      content: r.content || '',
      formData: r.formData != null && typeof r.formData === 'object' ? r.formData : {},
      companySnapshot: r.companySnapshot != null && typeof r.companySnapshot === 'object' ? r.companySnapshot : {},
      generatedAt: r.generatedAt
    }));
    return res.json({ success: true, data: { list } });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /companies/me/ai-reports:', e.message);
    return res.status(500).json({ success: false, message: e.message || '加载失败' });
  }
});

/**
 * POST /companies/me/ai-reports — 保存生成的报告（HTML 由服务端拼装，亦可扩展为接大模型）
 */
router.post('/companies/me/ai-reports', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const enterpriseId = await resolveCompatEnterpriseIdForMe(req);
    if (!enterpriseId) {
      return res.status(400).json({ success: false, message: '未关联企业' });
    }
    const body = req.body || {};
    const templateId = String(body.templateId || body.template_id || '').slice(0, 128);
    const templateName = String(
      body.templateName || body.template_name || (templateId ? `报告模板 ${templateId}` : 'AI分析报告')
    ).slice(0, 500);
    const formData =
      body.formData && typeof body.formData === 'object'
        ? body.formData
        : body.form_data && typeof body.form_data === 'object'
          ? body.form_data
          : {};
    const companySnapshot =
      body.companySnapshot && typeof body.companySnapshot === 'object'
        ? body.companySnapshot
        : body.company_snapshot && typeof body.company_snapshot === 'object'
          ? body.company_snapshot
          : {};
    const content =
      typeof body.content === 'string' && body.content.length > 0
        ? body.content
        : buildCompatAiReportHtml(templateName, formData, companySnapshot);
    await ensureCompatEnterpriseAiReportsTable();
    const [ins] = await pool.execute(
      `INSERT INTO compat_enterprise_ai_reports (enterprise_id, template_id, template_name, content, form_data, company_snapshot)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [enterpriseId, templateId, templateName, content, formData, companySnapshot]
    );
    const insertId = ins.insertId;
    const generatedAt = new Date().toISOString();
    return res.json({
      success: true,
      data: {
        id: String(insertId),
        templateId,
        templateName,
        content,
        formData,
        companySnapshot,
        generatedAt
      }
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /companies/me/ai-reports:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/**
 * DELETE /companies/me/ai-reports/:reportId
 */
router.delete('/companies/me/ai-reports/:reportId', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const enterpriseId = await resolveCompatEnterpriseIdForMe(req);
    if (!enterpriseId) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const rid = parseInt(req.params.reportId, 10);
    if (!rid || Number.isNaN(rid)) {
      return res.status(400).json({ success: false, message: '无效的报告ID' });
    }
    await ensureCompatEnterpriseAiReportsTable();
    const [del] = await pool.execute(
      'DELETE FROM compat_enterprise_ai_reports WHERE id = ? AND enterprise_id = ?',
      [rid, enterpriseId]
    );
    if (!del.affectedRows) {
      return res.status(404).json({ success: false, message: '报告不存在' });
    }
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] DELETE /companies/me/ai-reports:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

const ENTERPRISE_DOC_UPLOAD_DIR = path.join(__dirname, '../uploads/enterprise-verification');
// 单张解码后大小（Base64 传输体积约 ×1.37）；若 413 来自 Nginx，需调 client_max_body_size
const ENTERPRISE_DOC_MAX_BYTES = 20 * 1024 * 1024;

function parseBase64ImagePayload(base64Input) {
  if (!base64Input || typeof base64Input !== 'string') return null;
  const s = base64Input.trim();
  let mime = 'image/jpeg';
  let data = s.replace(/\s/g, '');
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(s.replace(/\s/g, ''));
  if (m) {
    mime = String(m[1]).toLowerCase().split(';')[0];
    data = m[2].replace(/\s/g, '');
  }
  const extMap = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  const ext = extMap[mime] || '.jpg';
  let buf;
  try {
    buf = Buffer.from(data, 'base64');
  } catch (e) {
    return null;
  }
  if (!buf || !buf.length) return null;
  return { buf, ext, mime };
}

/**
 * POST /companies/upload-document — company-center.html 营业执照/许可证/公司照片（JSON base64）
 * 若仍 413：反代需 client_max_body_size（如 50m），请求体未到 Node。
 */
router.post('/companies/upload-document', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  const allowedTypes = new Set(['business_license', 'hr_license', 'company_photo', 'announcement_nav_logo']);
  try {
    const body = req.body || {};
    const docType = String(body.type || '').trim();
    if (!allowedTypes.has(docType)) {
      return res.status(400).json({ success: false, message: '无效的上传类型' });
    }
    const parsed = parseBase64ImagePayload(body.base64);
    if (!parsed) {
      return res.status(400).json({ success: false, message: '图片数据无效' });
    }
    if (parsed.buf.length > ENTERPRISE_DOC_MAX_BYTES) {
      return res.status(400).json({ success: false, message: `单张图片不能超过 ${ENTERPRISE_DOC_MAX_BYTES / 1024 / 1024}MB` });
    }
    if (!parsed.mime.startsWith('image/')) {
      return res.status(400).json({ success: false, message: '仅支持图片格式' });
    }
    await fs.mkdir(ENTERPRISE_DOC_UPLOAD_DIR, { recursive: true });
    const safeType = docType.replace(/[^a-z_]/gi, '_');
    const fileName = `${req.user.id}_${safeType}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${parsed.ext}`;
    const absPath = path.join(ENTERPRISE_DOC_UPLOAD_DIR, fileName);
    await fs.writeFile(absPath, parsed.buf);
    const url = `/uploads/enterprise-verification/${fileName}`;
    return res.json({ success: true, data: { url } });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /companies/upload-document:', e.message);
    return res.status(500).json({ success: false, message: e.message || '上传失败' });
  }
});

/**
 * PUT /companies/verification — company-center.html「提交认证」
 * 此前后端无此路由，材料从未写入，管理端列表一直为空。
 */
router.put('/companies/verification', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  if (req.user.role === 'admin' && !req.user.enterpriseId) {
    return res.status(403).json({ success: false, message: '请使用企业账号提交认证' });
  }
  try {
    await ensureCompatEnterpriseVerificationRequestsTable();
    let enterpriseId = req.user.enterpriseId != null ? Number(req.user.enterpriseId) : null;
    if (!enterpriseId) {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      enterpriseId = ent && ent.id ? Number(ent.id) : null;
    }
    if (!enterpriseId) {
      return res.status(400).json({ success: false, message: '未关联企业，无法提交认证' });
    }
    const body = req.body || {};
    const payload = {
      industryType: body.industryType || body.industry_type || '',
      businessLicenseUrl: body.businessLicenseUrl || body.business_license_url || '',
      hrLicenseUrl: body.hrLicenseUrl || body.hr_license_url || '',
      companyPhotos: Array.isArray(body.companyPhotos) ? body.companyPhotos : body.company_photos || []
    };
    const payloadJson = JSON.stringify(payload);
    await pool.execute(
      `INSERT INTO compat_enterprise_verification_requests (enterprise_id, status, payload)
       VALUES (?, 'pending', ?)
       ON DUPLICATE KEY UPDATE status = 'pending', payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      [enterpriseId, payloadJson]
    );
    await mirrorCompatVerificationToShengju(enterpriseId, payloadJson);
    try {
      await pool.execute('UPDATE enterprises SET verification_status = ? WHERE id = ?', ['pending', enterpriseId]);
    } catch (e) {
      /* 无 verification_status 列则忽略 */
    }
    if (poolShengju) {
      try {
        await poolShengju.execute('UPDATE enterprises SET verification_status = ? WHERE id = ?', ['pending', enterpriseId]);
      } catch (e) {
        /* ignore */
      }
    }
    return res.json({ success: true, message: '认证材料已提交，请等待管理员审核' });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /companies/verification:', e.message);
    return res.status(500).json({ success: false, message: e.message || '提交失败' });
  }
});

/** GET /exam-allocations/batches（enterprise/tests.html 多机同步） */
router.get('/exam-allocations/batches', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const eid = await getCompatManageEnterpriseDbId(req);
  if (eid == null || !Number.isFinite(Number(eid)) || Number(eid) <= 0) {
    return res.json({ success: true, data: [] });
  }
  try {
    await ensureCompatExamAllocationBatchesTable();
    const [rows] = await pool.execute(
      `SELECT batch_id, batch_name, package_id, exam_time, exam_location, notes, candidate_count, created_at, updated_at
       FROM compat_exam_allocation_batches
       WHERE enterprise_id = ?
       ORDER BY updated_at DESC
       LIMIT 50`,
      [Number(eid)]
    );
    const data = (rows || []).map((r) => ({
      batchCode: r.batch_id,
      id: r.batch_id,
      batchName: r.batch_name || r.batch_id,
      createdAt: r.created_at,
      candidateCount: r.candidate_count || 0,
      examTime: r.exam_time || '',
      examLocation: r.exam_location || '',
      notes: r.notes || '',
      packageId: r.package_id || null
    }));
    return res.json({ success: true, data });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, data: [] });
    }
    console.warn('[talentSiteCompat] GET exam-allocations/batches:', e.message);
    return res.json({ success: true, data: [] });
  }
});

/** GET /exam-allocations/batch/:code（enterprise/tests.html 拉取单批分配明细） */
router.get('/exam-allocations/batch/:code', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const eid = await getCompatManageEnterpriseDbId(req);
  const code = String(req.params.code || '').trim();
  if (eid == null || !Number.isFinite(Number(eid)) || Number(eid) <= 0 || !code) {
    return res.json({ success: true, data: { batch: {}, allocations: [] } });
  }
  try {
    await ensureCompatExamAllocationBatchesTable();
    const [rows] = await pool.execute(
      `SELECT batch_id, batch_name, package_id, exam_time, exam_location, notes, candidate_count, payload_json, created_at
       FROM compat_exam_allocation_batches
       WHERE enterprise_id = ? AND batch_id = ?
       LIMIT 1`,
      [Number(eid), code]
    );
    const row = rows && rows[0];
    if (!row) {
      return res.json({ success: true, data: { batch: {}, allocations: [] } });
    }
    let payload = {};
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : {};
    } catch (_) {
      payload = {};
    }
    const batch = {
      batchCode: row.batch_id,
      batchName: row.batch_name || row.batch_id,
      examTime: row.exam_time || '',
      examLocation: row.exam_location || '',
      notes: row.notes || '',
      packageId: row.package_id || null,
      createdAt: row.created_at
    };
    const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
    return res.json({ success: true, data: { batch, allocations } });
  } catch (e) {
    console.warn('[talentSiteCompat] GET exam-allocations/batch:', e.message);
    return res.json({ success: true, data: { batch: {}, allocations: [] } });
  }
});

/**
 * GET /exam-allocations/batches-with-allocations
 * 一次请求返回全部批次 + 每批的 allocations，替代前端逐批串行拉取（N+1 → 1 次 IN 查询）。
 * 返回：{ success, data: [{ batch: {...}, allocations: [...] }] }
 */
router.get('/exam-allocations/batches-with-allocations', authenticate, async (req, res) => {
  if (req.isGuest) return res.status(401).json({ success: false, message: '未登录' });
  const eid = await getCompatManageEnterpriseDbId(req);
  if (eid == null || !Number.isFinite(Number(eid)) || Number(eid) <= 0) {
    return res.json({ success: true, data: [] });
  }
  try {
    await ensureCompatExamAllocationBatchesTable();
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const [rows] = await pool.execute(
      `SELECT batch_id, batch_name, package_id, exam_time, exam_location, notes,
              candidate_count, payload_json, created_at, updated_at
       FROM compat_exam_allocation_batches
       WHERE enterprise_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [Number(eid), limit]
    );
    const data = (rows || []).map((r) => {
      let allocations = [];
      try {
        const payload = r.payload_json ? JSON.parse(r.payload_json) : {};
        allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
      } catch (_) {}
      return {
        batch: {
          batchCode: r.batch_id,
          id: r.batch_id,
          batchName: r.batch_name || r.batch_id,
          packageId: r.package_id || null,
          examTime: r.exam_time || '',
          examLocation: r.exam_location || '',
          notes: r.notes || '',
          candidateCount: r.candidate_count || 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        },
        allocations
      };
    });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
    console.warn('[talentSiteCompat] GET exam-allocations/batches-with-allocations:', e.message);
    return res.json({ success: true, data: [] });
  }
});

/** DELETE /exam-allocations/batch/:code（tests.html 删除当前批次；此前未实现导致仅删本地、刷新后又从库拉回） */
router.delete('/exam-allocations/batch/:code', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const eid = await getCompatManageEnterpriseDbId(req);
  const code = String(req.params.code || '').trim();
  if (eid == null || !Number.isFinite(Number(eid)) || Number(eid) <= 0 || !code) {
    return res.status(400).json({ success: false, message: '缺少批次标识' });
  }
  try {
    await ensureCompatExamAllocationBatchesTable();
    const [result] = await pool.execute(
      'DELETE FROM compat_exam_allocation_batches WHERE enterprise_id = ? AND batch_id = ?',
      [Number(eid), code]
    );
    const affected = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    return res.json({ success: true, data: { deleted: affected } });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, data: { deleted: 0 } });
    }
    console.warn('[talentSiteCompat] DELETE exam-allocations/batch:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

/** POST /exam-allocations/save-batch（enterprise/tests.html 保存批次并多机同步） */
router.post('/exam-allocations/save-batch', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const eid = await getCompatManageEnterpriseDbId(req);
  if (eid == null || !Number.isFinite(Number(eid)) || Number(eid) <= 0) {
    return res.status(403).json({ success: false, message: '仅企业账号可同步考试分配（未解析到笔试库 enterprises.id）' });
  }
  const b = req.body || {};
  const batchId = String(b.batchId || '').trim();
  if (!batchId) {
    return res.status(400).json({ success: false, message: '缺少 batchId' });
  }
  const allocations = Array.isArray(b.allocations) ? b.allocations : [];
  const candidateCount = allocations.length;
  const payloadJson = JSON.stringify({
    batchId: b.batchId,
    batchName: b.batchName,
    packageId: b.packageId,
    allocations
  });
  try {
    await ensureCompatExamAllocationBatchesTable();
    await pool.execute(
      `INSERT INTO compat_exam_allocation_batches
        (enterprise_id, batch_id, batch_name, package_id, exam_time, exam_location, notes, candidate_count, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        batch_name = VALUES(batch_name),
        package_id = VALUES(package_id),
        exam_time = VALUES(exam_time),
        exam_location = VALUES(exam_location),
        notes = VALUES(notes),
        candidate_count = VALUES(candidate_count),
        payload_json = VALUES(payload_json)`,
      [
        Number(eid),
        batchId,
        (b.batchName && String(b.batchName)) || batchId,
        b.packageId != null ? String(b.packageId) : null,
        b.examTime != null ? String(b.examTime) : null,
        b.examLocation != null ? String(b.examLocation) : null,
        b.notes != null ? String(b.notes) : null,
        candidateCount,
        payloadJson
      ]
    );
    try {
      await ensureCompatAdmitPrintNotificationsTable();
      const entNum = Number(eid);
      const seenU = new Set();
      const bname = b.batchName != null ? String(b.batchName) : batchId;
      for (const a of allocations) {
        let uid = parseInt(
          String(
            a.candidateUserId != null
              ? a.candidateUserId
              : a.userId != null
                ? a.userId
                : a.candidate_user_id != null
                  ? a.candidate_user_id
                  : ''
          ),
          10
        );
        if (!Number.isFinite(uid) || uid <= 0) {
          const cidRaw = a.candidateId != null ? parseInt(String(a.candidateId), 10) : NaN;
          if (Number.isFinite(cidRaw) && cidRaw >= PROJECT_COOP_APPLICATION_ID_OFFSET) {
            const coopId = cidRaw - PROJECT_COOP_APPLICATION_ID_OFFSET;
            try {
              const [cr] = await pool.execute(
                'SELECT user_id FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
                [coopId]
              );
              if (cr && cr[0] && cr[0].user_id) uid = parseInt(String(cr[0].user_id), 10);
            } catch (_) {
              /* 忽略单条解析 */
            }
          }
        }
        if (!Number.isFinite(uid) || uid <= 0) continue;
        if (seenU.has(uid)) continue;
        seenU.add(uid);
        const an =
          a.admitCardNumber != null
            ? String(a.admitCardNumber).trim()
            : a.admit_card_number != null
              ? String(a.admit_card_number).trim()
              : a.examNumber != null
                ? String(a.examNumber).trim()
                : '';
        const admitCardData = {
          candidateName:
            a.candidateName != null
              ? String(a.candidateName).trim()
              : a.name != null
                ? String(a.name).trim()
                : '',
          admitCardNumber: an,
          siteNumber: a.siteNumber != null ? a.siteNumber : '',
          siteName: a.siteName != null ? String(a.siteName).trim() : '',
          roomNumber: a.roomNumber != null ? a.roomNumber : '',
          seatNumber: a.seatNumber != null ? a.seatNumber : '',
          examTime: a.examTime != null ? String(a.examTime) : b.examTime != null ? String(b.examTime) : '',
          examLocation:
            a.examLocation != null ? String(a.examLocation) : b.examLocation != null ? String(b.examLocation) : '',
          notes: a.notes != null ? String(a.notes) : b.notes != null ? String(b.notes) : '',
          job: a.jobTitle != null ? String(a.jobTitle).trim() : a.job != null ? String(a.job).trim() : '',
          photoUrl: a.photoUrl != null ? String(a.photoUrl) : ''
        };
        await writeJobseekerAdmitNotification({
          userId: uid,
          enterpriseId: entNum,
          batchId,
          batchName: bname,
          title: '准考证已生成',
          content: an
            ? `您的准考证已生成，准考证号：${an}。请进入个人中心「消息」下载或打印准考证。`
            : '考务已为您安排考场座位，请进入个人中心「消息」查看或打印准考证。',
          admitCardData
        });
      }
    } catch (eN) {
      if (eN && eN.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('[talentSiteCompat] save-batch 写入准考证通知失败（批次已存库）:', eN.message);
      }
    }
    return res.json({
      success: true,
      data: { batchId, candidateCount },
      message: '已保存'
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST exam-allocations/save-batch:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/** POST /candidates/admit-cards（enterprise/tests.html 推送准考证到求职者个人中心） */
router.post('/candidates/admit-cards', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const b = req.body || {};
  const cards = Array.isArray(b.cards) ? b.cards : [];
  const allowResend = b.allowResend === true;
  let entId = null;
  try {
    if (req.user.role === 'enterprise' || req.user.role === 'enterprise_reviewer') {
      entId = await getCompatManageEnterpriseDbId(req);
    }
  } catch (_) {
    entId = null;
  }
  let written = 0;
  let skippedNoUser = 0;
  for (const c of cards) {
    const data = c.admitCardData && typeof c.admitCardData === 'object' ? c.admitCardData : null;
    const uid = await resolveAdmitNotifyUserId(c, data);
    if (!uid) {
      skippedNoUser += 1;
      continue;
    }
    const num =
      (data && data.admitCardNumber) ||
      c.admitCardNumber ||
      (data && data.examNumber) ||
      '';
    const isIv = !!(data && data.cardType === 'interview_notice');
    try {
      const ok = await writeJobseekerAdmitNotification({
        userId: uid,
        enterpriseId: entId,
        batchId: c.batchId || b.batchId || null,
        batchName: c.batchName || c.jobName || b.batchName || null,
        title: c.title || (isIv ? '面试通知书已发布' : '准考证已生成'),
        content:
          c.content ||
          (isIv
            ? num
              ? `您的面试通知书已生成，准考证号：${num}。请进入个人中心「消息」查看并打印。`
              : '您的面试通知书已生成，请进入个人中心「消息」查看并打印。'
            : num
              ? `准考证号：${num}。请进入个人中心查看或下载。`
              : ''),
        admitCardData: data || { admitCardNumber: num, candidateName: c.candidateName || '' },
        allowResend
      });
      if (ok) written += 1;
    } catch (e) {
      console.warn('[admit-cards] write notify:', e.message);
    }
  }
  const msg =
    written > 0
      ? `已写入求职者通知 ${written} 条${skippedNoUser > 0 ? `，${skippedNoUser} 人未匹配到求职者账号（请确认身份证号/手机号与注册信息一致）` : ''}`
      : skippedNoUser > 0
        ? `未写入通知：${skippedNoUser} 人未匹配到求职者账号（请确认身份证号/手机号已在人才网注册）`
        : '未写入有效通知';
  return res.json({
    success: true,
    data: { count: cards.length, written, skippedNoUser },
    message: msg
  });
});

/** GET /candidates/roster-import/template — 企业端名单导入 Excel 模板 */
router.get('/candidates/roster-import/template', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  try {
    const aoa = [
      [
        '招聘公告（必填，作通知书标题）',
        '姓名（必填）',
        '性别（选填）',
        '身份证号（必填）',
        '手机号（选填）',
        '准考证号（选填）',
        '报考单位（选填）',
        '岗位名称（选填）',
        '岗位代码（选填）',
        '照片图片（选填，本行单元格内插入图片）',
        '第几考场（选填，对应通知书「候考室」）'
      ],
      [
        '金昌市2024年事业单位公开招聘工作人员',
        '（请删除本行后填写）',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 36 },
      { wch: 12 },
      { wch: 8 },
      { wch: 22 },
      { wch: 14 },
      { wch: 16 },
      { wch: 28 },
      { wch: 18 },
      { wch: 10 },
      { wch: 14 },
      { wch: 12 }
    ];
    const noteWs = XLSX.utils.aoa_to_sheet([
      ['填写说明（与「面试通知书」左侧表格字段一致）'],
      ['1. 必填：招聘公告标题、姓名、身份证号'],
      ['2. 照片：在「照片图片」列对应考生行的单元格内插入图片（WPS 用「嵌入单元格」）'],
      ['3. 模板不含：考生须知、考试时间、考点地址——请在企业端「步骤4」批量设置后预览/打印'],
      ['4. 第几考场：导入后显示为通知书「候考室」；考点名称可在分配考点步骤设置']
    ]);
    noteWs['!cols'] = [{ wch: 72 }];
    XLSX.utils.book_append_sheet(wb, ws, '名单模板');
    XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="enterprise-roster-import-template.xlsx"'
    );
    return res.send(Buffer.from(buf));
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || '生成模板失败' });
  }
});

function rosterPhotoBufferToDataUrl(buffer, ext) {
  return rosterBufferToDataUrl(buffer, ext);
}

/**
 * POST /interview-admit/roster-parse
 * 仅解析面试名单 Excel（含嵌入照片），不写库、不匹配系统报名记录。
 * multipart: file=Excel（与名单导入模板列一致）
 */
router.post('/interview-admit/roster-parse', authenticate, rosterImportUpload.single('file'), async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ success: false, message: '请上传 Excel 文件（表单字段名 file）' });
  }
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find((n) => /名单|模板|roster/i.test(n)) || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const { importRows, photoColIdx } = parseRosterSheetRows(sheet);
    let imageByCell = new Map();
    let byDispimgId = new Map();
    let mediaOrdered = [];
    try {
      const extracted = await extractRosterImagesFromXlsx(req.file.buffer);
      imageByCell = extracted.byCell || new Map();
      byDispimgId = extracted.byDispimgId || new Map();
      mediaOrdered = extracted.mediaOrdered || [];
    } catch (imgErr) {
      console.warn('[interview-admit/roster-parse] extract images:', imgErr.message);
    }
    attachEmbeddedPhotosToImportRows(importRows, imageByCell, photoColIdx, {
      sheet,
      byDispimgId,
      mediaOrdered
    });

    const candidates = [];
    const warnings = [];
    let skippedNoName = 0;
    let truncatedPhotos = 0;
    let compressedPhotos = 0;

    for (let i = 0; i < importRows.length; i++) {
      const imp = importRows[i];
      const name = normRosterStr(imp.name || '');
      if (!name) {
        skippedNoName += 1;
        continue;
      }
      let photoDataUrl = '';
      if (imp._photoBuffer && imp._photoBuffer.data) {
        const prepared = await prepareRosterEmbeddedPhotoDataUrl(imp._photoBuffer, name);
        photoDataUrl = prepared.photoDataUrl || '';
        if (prepared.warning) {
          if (!photoDataUrl) truncatedPhotos += 1;
          else if (prepared.compressed) compressedPhotos += 1;
          warnings.push(prepared.warning);
        } else if (prepared.compressed) {
          compressedPhotos += 1;
        }
      } else if (imp.photoUrl && isLikelyInvalidRosterPhotoCellText(imp.photoUrl)) {
        warnings.push(`「${name}」照片列无效（请在「照片图片」单元格内插入图片，勿填 WPS 公式或本地路径）`);
      } else if (imp.photoUrl && /^data:image\//i.test(String(imp.photoUrl))) {
        const raw = normRosterStr(imp.photoUrl);
        photoDataUrl = raw.length > ROSTER_MAX_PHOTO_BYTES ? '' : raw;
        if (!photoDataUrl && raw.length > ROSTER_MAX_PHOTO_BYTES) {
          truncatedPhotos += 1;
          warnings.push(`「${name}」照片 data URL 过大，已省略（请改用单元格插入图片）`);
        }
      } else if (imp.photoUrl && /^https?:\/\//i.test(String(imp.photoUrl))) {
        photoDataUrl = normRosterStr(imp.photoUrl).slice(0, 2000);
      }

      const examRoomRaw = normRosterStr(imp.examRoom || '');
      const rowNum = imp._sheetRow != null ? imp._sheetRow + 1 : i + 2;
      if (!examRoomRaw) {
        warnings.push(`第 ${rowNum} 行「${name}」未填考场，将归入「未指定考场」`);
      }

      const photoSource = imp._photoSource || (photoDataUrl ? 'embedded' : 'none');
      candidates.push({
        name,
        gender: normRosterStr(imp.gender || '').slice(0, 8),
        idCard: normRosterStr(imp.idCard || '').slice(0, 24),
        phone: normPhoneDigits(imp.phone || ''),
        examTicket: normRosterStr(imp.examTicket || '').slice(0, 64),
        employerUnit: normRosterStr(imp.employerUnit || '').slice(0, 128),
        job: normRosterStr(imp.job || '').slice(0, 128),
        positionCode: normRosterStr(imp.positionCode || '').slice(0, 32),
        examRoom: examRoomRaw,
        examTime: normRosterStr(imp.examTime || '').slice(0, 128),
        examSiteName: normRosterStr(imp.examSiteName || '').slice(0, 128),
        examLocation: normRosterStr(imp.examLocation || '').slice(0, 256),
        announcementTitle: normRosterStr(imp.announcementTitle || '').slice(0, 200),
        photoDataUrl,
        photoSource
      });
    }

    if (skippedNoName > 0) {
      warnings.push(`已跳过 ${skippedNoName} 行（姓名为空）`);
    }
    if (!candidates.length) {
      return res.status(400).json({
        success: false,
        message: '未解析到有效考生行，请检查模板与必填列（至少姓名）'
      });
    }

    const roomSet = new Set(
      candidates.map((c) => (c.examRoom ? String(c.examRoom) : '未指定考场'))
    );
    const noTicket = candidates.filter((c) => !c.examTicket).length;
    if (noTicket > 0) {
      warnings.push(
        `${noTicket} 人未识别到准考证号（请确认表头为「准考证号」或「考号」，且非合并单元格）`
      );
    }
    const noPhoto = candidates.filter((c) => !c.photoDataUrl).length;
    const photosAttached = candidates.length - noPhoto;
    if (noPhoto > 0) {
      const wpsHint =
        byDispimgId.size > 0
          ? '（已检测到 WPS 嵌入图但未匹配到行，请确认照片在该考生行的「照片图片」列）'
          : '（请在「照片图片」列用「插入→图片→嵌入单元格」，勿只填链接或本地路径；WPS 用户勿用浮动图片）';
      warnings.push(`${noPhoto} 人未识别到照片${wpsHint}`);
    }

    return res.json({
      success: true,
      data: {
        candidates,
        warnings,
        importRowCount: importRows.length,
        candidateCount: candidates.length,
        roomCount: roomSet.size,
        photosAttached,
        photoExtractStats: {
          drawingCells: imageByCell.size,
          wpsDispimgIds: byDispimgId.size,
          mediaFiles: mediaOrdered.length
        },
        truncatedPhotos: truncatedPhotos > 0 ? truncatedPhotos : undefined,
        compressedPhotos: compressedPhotos > 0 ? compressedPhotos : undefined
      },
      message: `已解析 ${candidates.length} 人，${roomSet.size} 个考场${
        compressedPhotos > 0 ? `（${compressedPhotos} 张照片已自动压缩）` : ''
      }`
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /interview-admit/roster-parse:', e.message);
    return res.status(500).json({ success: false, message: e.message || '解析失败' });
  }
});

/**
 * POST /candidates/sync-portal-passwords
 * 按公告报名/名单中的身份证号，批量把求职者账号密码设为「身份证后 6 位」（解决历史导入未写 password_hash）
 * body: { announcementId?: number }
 */
router.post('/candidates/sync-portal-passwords', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const annId = parseInt(String((req.body && req.body.announcementId) || ''), 10);
  try {
    const eidManage = await getCompatManageEnterpriseDbId(req);
    await ensureCompatCooperationApplicationsTable();
    let sql = `SELECT a.user_id, a.extra_json FROM compat_cooperation_applications a
      LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
      LEFT JOIN compat_announcements an ON an.id = a.announcement_id
      WHERE a.user_id IS NOT NULL AND a.user_id > 0`;
    const params = [];
    if (Number.isFinite(annId) && annId > 0) {
      sql += ' AND a.announcement_id = ?';
      params.push(annId);
    } else if (eidManage != null) {
      const eN = Number(eidManage);
      sql += ` AND (
        (a.enterprise_id IS NOT NULL AND CAST(a.enterprise_id AS UNSIGNED) = ?)
        OR (p.enterprise_id IS NOT NULL AND CAST(p.enterprise_id AS UNSIGNED) = ?)
        OR (an.enterprise_id IS NOT NULL AND CAST(an.enterprise_id AS UNSIGNED) = ?)
      )`;
      params.push(eN, eN, eN);
    }
    sql += ' ORDER BY COALESCE(a.updated_at, a.created_at) DESC LIMIT 5000';
    const [rows] = await pool.execute(sql, params);
    let synced = 0;
    let skipped = 0;
    const seen = new Set();
    for (const r of rows || []) {
      const uid = Number(r.user_id);
      if (!Number.isFinite(uid) || uid <= 0 || seen.has(uid)) continue;
      seen.add(uid);
      let ex = {};
      try {
        ex = r.extra_json ? JSON.parse(r.extra_json) : {};
      } catch (_) {
        skipped += 1;
        continue;
      }
      const b = ex.basicInfo && typeof ex.basicInfo === 'object' ? ex.basicInfo : {};
      const rm = ex.enterpriseRosterMeta && typeof ex.enterpriseRosterMeta === 'object' ? ex.enterpriseRosterMeta : {};
      const idc = normIdDigits(b.idCardNumber || b.idNumber || rm.idCard || '');
      const ph = normPhoneDigits(b.phone || '');
      try {
        if (idc.length >= 15) {
          await UserModel.syncPortalPasswordFromIdCard(uid, idc);
          if (ph.length >= 10) await UserModel.updatePhoneSafe(uid, ph);
          const un = stableCandidateUsername(b.name || '', ph, ph.length >= 10 ? ph : '');
          if (un) {
            const conflict = await UserModel.findByUsername(un);
            if (!conflict || Number(conflict.id) === uid) {
              try {
                await pool.execute('UPDATE qms_users SET username = ? WHERE id = ?', [un, uid]);
              } catch (_) {
                /* ignore dup */
              }
            }
          }
          synced += 1;
        } else if (ph.length >= 10) {
          await UserModel.syncPortalPasswordFromIdCard(uid, '');
          await UserModel.updatePhoneSafe(uid, ph);
          synced += 1;
        } else {
          skipped += 1;
        }
      } catch (e1) {
        skipped += 1;
        console.warn('[sync-portal-passwords] uid', uid, e1.message);
      }
    }
    return res.json({
      success: true,
      data: { synced, skipped, total: seen.size },
      message: `已为 ${synced} 个账号设置登录密码（身份证后6位，无身份证为123456）。请考生用手机号登录个人中心。`
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /candidates/sync-portal-passwords:', e.message);
    return res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

/**
 * POST /candidates/roster-import
 * multipart: file=Excel；meta=JSON 字符串：{ batchId?, randomRoomAssign?, roomCount? }
 * batchId 与考试分配批次一致时，可按「准考证号」与分配 payload 匹配到 user_id 再落库。
 */
router.post('/candidates/roster-import', authenticate, rosterImportUpload.single('file'), async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'enterprise_reviewer' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ success: false, message: '请上传 Excel 文件（表单字段名 file）' });
  }
  let meta = {};
  try {
    meta = req.body && req.body.meta ? JSON.parse(String(req.body.meta)) : {};
  } catch (_) {
    meta = {};
  }
  const batchId = meta.batchId != null ? String(meta.batchId).trim() : '';
  const randomRoomAssign = !!meta.randomRoomAssign;
  let roomCount = parseInt(String(meta.roomCount != null ? meta.roomCount : '8'), 10);
  if (!Number.isFinite(roomCount) || roomCount < 1) roomCount = 8;
  if (roomCount > 99) roomCount = 99;
  const defaultAnnouncementId = meta.announcementId != null ? parseInt(meta.announcementId, 10) : NaN;
  const pushJobseekerNotify = meta.pushJobseekerNotify !== false;

  try {
    const eidManage = await getCompatManageEnterpriseDbId(req);
    const ticketMap = await loadTicketToUserIdMap(eidManage, batchId);
    const apps = await fetchCooperationApplicationsForImport(req);
    const parseEx = (s) => {
      try {
        return s ? JSON.parse(s) : {};
      } catch (_) {
        return {};
      }
    };
    const matchers = (apps || []).map((row) => {
      const ex = parseEx(row.extra_json);
      const b = ex.basicInfo && typeof ex.basicInfo === 'object' ? ex.basicInfo : {};
      const nm = normRosterStr(b.name || '').toLowerCase();
      const idc = normIdDigits(b.idCardNumber || b.idNumber || '');
      const ph = normPhoneDigits(b.phone || '');
      let ticketSys = normRosterStr(b.examNumber || '');
      const r0 = ex.enterpriseRosterMeta && typeof ex.enterpriseRosterMeta === 'object' ? ex.enterpriseRosterMeta : {};
      if (r0.examTicketNumber) ticketSys = normRosterStr(r0.examTicketNumber);
      const jobLine = normRosterStr(b.appliedJobName || '');
      const annId =
        row.announcement_id != null
          ? Number(row.announcement_id)
          : ex.enterpriseRosterMeta && ex.enterpriseRosterMeta.announcementId != null
            ? Number(ex.enterpriseRosterMeta.announcementId)
            : null;
      return { id: row.id, userId: row.user_id, nm, idc, ph, ticketSys, jobLine, ex, annId };
    });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find((n) => /名单|模板|roster/i.test(n)) || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const { importRows, photoColIdx } = parseRosterSheetRows(sheet);
    let imageByCell = new Map();
    let byDispimgId = new Map();
    let mediaOrdered = [];
    try {
      const extracted = await extractRosterImagesFromXlsx(req.file.buffer);
      imageByCell = extracted.byCell || new Map();
      byDispimgId = extracted.byDispimgId || new Map();
      mediaOrdered = extracted.mediaOrdered || [];
    } catch (imgErr) {
      console.warn('[roster-import] extract images:', imgErr.message);
    }
    attachEmbeddedPhotosToImportRows(importRows, imageByCell, photoColIdx, {
      sheet,
      byDispimgId,
      mediaOrdered
    });

    const findMatcher = (imp) => {
      const ticket = normRosterStr(imp.examTicket || '');
      if (ticket && ticketMap.has(ticket)) {
        const uid = ticketMap.get(ticket);
        const m = matchers.find((x) => Number(x.userId) === Number(uid));
        if (m) return m;
      }
      if (ticket) {
        const m = matchers.find((x) => x.ticketSys && normRosterStr(x.ticketSys) === ticket);
        if (m) return m;
      }
      const idc = normIdDigits(imp.idCard || '');
      const nm = normRosterStr(imp.name || '').toLowerCase();
      if (idc) {
        const mId = matchers.find((x) => x.idc === idc);
        if (mId) return mId;
      }
      if (idc && nm) {
        const m = matchers.find((x) => x.idc === idc && x.nm === nm);
        if (m) return m;
      }
      const ph = normPhoneDigits(imp.phone || '');
      if (ph.length >= 6 && nm) {
        const m = matchers.find(
          (x) => x.ph && ph.length >= 6 && (x.ph.endsWith(ph.slice(-11)) || x.ph === ph) && x.nm === nm
        );
        if (m) return m;
      }
      if (ph.length >= 10 && !nm) {
        const m = matchers.find((x) => x.ph === ph || x.ph.endsWith(ph.slice(-11)));
        if (m) return m;
      }
      return null;
    };

    async function resolveMatcherForImportRow(imp) {
      let m = findMatcher(imp);
      if (m) return { m };
      const idc = normIdDigits(imp.idCard || '');
      if (idc.length >= 15) {
        const u = await UserModel.findByIdCardSafe(idc);
        if (u) {
          const annTitle = normRosterStr(imp.announcementTitle || '');
          let annRow = await resolveAnnouncementForRoster(eidManage, {
            announcementId: annTitle ? null : defaultAnnouncementId,
            title: annTitle || null
          });
          if (!annRow && Number.isFinite(defaultAnnouncementId) && defaultAnnouncementId > 0) {
            annRow = await resolveAnnouncementForRoster(eidManage, {
              announcementId: defaultAnnouncementId,
              title: null
            });
          }
          if (annRow) {
            const linked = await matcherFromUserIdForRoster(eidManage, annRow, imp, u.id);
            if (linked.matcher) return { m: linked.matcher };
            if (linked.error) return { error: linked.error };
          }
        }
      }
      const annTitle = normRosterStr(imp.announcementTitle || '');
      let annRow = await resolveAnnouncementForRoster(eidManage, {
        announcementId: annTitle ? null : defaultAnnouncementId,
        title: annTitle || null
      });
      if (!annRow && !annTitle && Number.isFinite(defaultAnnouncementId) && defaultAnnouncementId > 0) {
        annRow = await resolveAnnouncementForRoster(eidManage, {
          announcementId: defaultAnnouncementId,
          title: null
        });
      }
      if (!annRow) {
        return {
          error:
            !annTitle && !(defaultAnnouncementId > 0)
              ? '未填写招聘公告且未在导入弹窗选择默认公告'
              : `未找到招聘公告「${annTitle || defaultAnnouncementId}」`
        };
      }
      imp.announcementTitle = annRow.title || annTitle;
      const created = await createMatcherFromRosterRow(eidManage, annRow, imp);
      if (created.matcher) return { m: created.matcher };
      return { error: created.error || '无法创建或更新该考生' };
    }

    const pairs = [];
    const unmatched = [];
    let created = 0;
    for (const imp of importRows) {
      const resolved = await resolveMatcherForImportRow(imp);
      const m = resolved.m;
      if (!m) {
        unmatched.push({
          name: imp.name || '',
          idCard: imp.idCard || '',
          examTicket: imp.examTicket || '',
          announcementTitle: imp.announcementTitle || '',
          reason: resolved.error || '无法匹配或创建'
        });
        continue;
      }
      if (m._created) created += 1;
      pairs.push({ imp, m });
    }

    const jobKey = (imp, m) => normRosterStr(imp.job || m.jobLine || '_');

    if (randomRoomAssign && pairs.length) {
      const byJob = new Map();
      for (const p of pairs) {
        const k = jobKey(p.imp, p.m);
        if (!byJob.has(k)) byJob.set(k, []);
        byJob.get(k).push(p);
      }
      for (const [, arr] of byJob) {
        shuffleInPlace(arr);
        arr.forEach((p, i) => {
          if (!p.imp.examRoom || !String(p.imp.examRoom).trim()) {
            p._room = 1 + (i % roomCount);
          }
        });
      }
    }

    const nowIso = new Date().toISOString();
    let updated = 0;
    const errors = [];
    for (const { imp, m } of pairs) {
      let roomNum = null;
      if (imp.examRoom && String(imp.examRoom).trim() !== '') {
        const n = parseInt(String(imp.examRoom).replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > 0) roomNum = n;
      } else if (randomRoomAssign && m._room != null) {
        roomNum = m._room;
      }
      try {
        const annTitleRow = normRosterStr(imp.announcementTitle || '');
        const annRowForRow = await resolveAnnouncementForRoster(eidManage, {
          announcementId: annTitleRow ? null : defaultAnnouncementId,
          title: annTitleRow || null
        });
        const annRowUse =
          annRowForRow ||
          (Number.isFinite(defaultAnnouncementId) && defaultAnnouncementId > 0
            ? await resolveAnnouncementForRoster(eidManage, { announcementId: defaultAnnouncementId, title: null })
            : null);
        let notifyUserId = m.userId ? Number(m.userId) : null;
        if (imp.idCard) {
          const idcNorm = normIdDigits(imp.idCard);
          if (idcNorm.length >= 15) {
            if (!notifyUserId) {
              const uById = await UserModel.findByIdCardSafe(idcNorm);
              if (uById) notifyUserId = Number(uById.id);
            }
            if (notifyUserId) await syncCandidatePasswordFromIdCard(notifyUserId, idcNorm);
          }
        }
        if (notifyUserId && !m.userId) {
          try {
            await pool.execute(
              'UPDATE compat_cooperation_applications SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = 0)',
              [notifyUserId, m.id]
            );
            m.userId = notifyUserId;
          } catch (_) {
            m.userId = notifyUserId;
          }
        }
        const next = { ...m.ex };
        const rm = { ...(next.enterpriseRosterMeta && typeof next.enterpriseRosterMeta === 'object' ? next.enterpriseRosterMeta : {}) };
        if (annRowUse) {
          rm.announcementId = Number(annRowUse.id);
          rm.announcementTitle = String(annRowUse.title || '').trim();
          imp.announcementTitle = rm.announcementTitle;
        }
        if (imp.idCard) rm.idCard = normRosterStr(imp.idCard).slice(0, 24);
        if (imp.examTicket) rm.examTicketNumber = normRosterStr(imp.examTicket).slice(0, 64);
        if (imp._photoBuffer && imp._photoBuffer.data && m.userId) {
          try {
            const rel = await saveRosterPhotoAsIdCard(imp._photoBuffer.data, imp._photoBuffer.ext, m.userId);
            rm.photoUrl = rel;
            try {
              await UserModel.updateIdCardImagePath(m.userId, rel);
            } catch (ue) {
              console.warn('[roster-import] updateIdCardImagePath:', ue.message);
            }
          } catch (pe) {
            errors.push({ id: m.id, message: `照片保存失败: ${pe.message || pe}` });
          }
        } else if (imp.photoUrl) {
          const pu = normRosterStr(imp.photoUrl);
          if (/^https?:\/\//i.test(pu)) {
            rm.photoUrl = pu.slice(0, 2000);
          }
        }
        if (roomNum != null) rm.examRoomNumber = roomNum;
        rm.importedAt = nowIso;
        next.enterpriseRosterMeta = rm;
        if (!next.basicInfo || typeof next.basicInfo !== 'object') next.basicInfo = {};
        if (imp.idCard) {
          next.basicInfo.idCardNumber = normRosterStr(imp.idCard).slice(0, 24);
          next.basicInfo.idNumber = next.basicInfo.idCardNumber;
        }
        if (imp.examTicket) next.basicInfo.examNumber = normRosterStr(imp.examTicket).slice(0, 64);
        if (imp.phone) next.basicInfo.phone = normPhoneDigits(imp.phone);
        if (annRowUse) {
          await pool.execute(
            `UPDATE compat_cooperation_applications
             SET extra_json = ?, announcement_id = ?, status = 'approved', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [JSON.stringify(next), Number(annRowUse.id), m.id]
          );
        } else {
          await pool.execute(
            'UPDATE compat_cooperation_applications SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(next), m.id]
          );
        }
        m.ex = next;
        updated += 1;
        if (pushJobseekerNotify && (m.userId || notifyUserId)) {
          try {
            const uidNotify = Number(m.userId || notifyUserId);
            const admitCardData = {
              candidateName: normRosterStr(imp.name || m.ex?.basicInfo?.name || ''),
              admitCardNumber: normRosterStr(imp.examTicket || rm.examTicketNumber || ''),
              roomNumber: roomNum != null ? roomNum : rm.examRoomNumber,
              siteName: '',
              siteNumber: '',
              seatNumber: '',
              examTime: '',
              examLocation: '',
              job: normRosterStr(imp.job || m.jobLine || ''),
              photoUrl: rm.photoUrl || ''
            };
            const annKey = annRowUse && annRowUse.id != null ? String(annRowUse.id) : '0';
            await writeJobseekerAdmitNotification({
              userId: uidNotify,
              enterpriseId: eidManage,
              batchId: batchId || `roster_import_ann_${annKey}`,
              batchName: annRowUse ? annRowUse.title : '名单导入',
              title: admitCardData.admitCardNumber ? '准考证信息已更新' : '考务信息已同步',
              content: admitCardData.admitCardNumber
                ? `您的准考证号：${admitCardData.admitCardNumber}。请使用手机号 + 身份证后6位登录个人中心「消息」查看。`
                : '企业已同步您的考务信息。请使用名单中的手机号 + 身份证后6位登录个人中心「消息」查看。',
              admitCardData,
              allowResend: true
            });
          } catch (nErr) {
            console.warn('[roster-import] jobseeker notify:', nErr.message);
          }
        }
      } catch (e2) {
        errors.push({ id: m.id, message: e2.message || String(e2) });
      }
    }

    let primaryAnnId = Number.isFinite(defaultAnnouncementId) && defaultAnnouncementId > 0 ? defaultAnnouncementId : null;
    if (!primaryAnnId && pairs.length) {
      const t0 = normRosterStr(pairs[0].imp.announcementTitle || '');
      const ar0 = t0 ? await resolveAnnouncementForRoster(eidManage, { title: t0 }) : null;
      if (ar0) primaryAnnId = Number(ar0.id);
    }
    const loginPath = primaryAnnId
      ? `/exam-student/login?announcementId=${primaryAnnId}`
      : '/exam-student/login';
    const jobseekerLoginPath = primaryAnnId
      ? `/user/login.html?announcementId=${primaryAnnId}&redirect=${encodeURIComponent('/user/profile.html#messages')}`
      : '/user/login.html?redirect=' + encodeURIComponent('/user/profile.html#messages');

    return res.json({
      success: true,
      data: {
        importRowCount: importRows.length,
        matched: pairs.length,
        created,
        updated,
        unmatchedCount: unmatched.length,
        unmatchedSample: unmatched.slice(0, 30),
        errors,
        announcementId: primaryAnnId,
        candidateLoginPath: loginPath,
        candidateLoginHint: '仅参加在线笔试/面试的考生使用 exam-student；求职者查看准考证请登录求职者个人中心',
        jobseekerLoginPath,
        jobseekerProfilePath: primaryAnnId
          ? `/user/profile.html?announcementId=${primaryAnnId}#messages`
          : '/user/profile.html#messages',
        jobseekerNotifyHint: pushJobseekerNotify
          ? '已尝试向成功写入的求职者推送「消息」通知（个人中心）'
          : '未推送求职者通知'
      },
      message:
        updated > 0
          ? `已处理 ${updated} 条（新建 ${created} 条）；准考证号已写入报名记录，求职者请在个人中心「消息」查看`
          : pairs.length
            ? '已匹配但未写入（请检查异常 errors）'
            : unmatched.length
              ? `未匹配 ${unmatched.length} 人：请核对 Excel 中姓名、身份证号与「审核通过考生」一致，招聘公告标题与下拉选项一致（勿保留模板示例行「张三」）`
              : '未匹配到任何报名记录，请核对姓名/身份证/准考证与招聘公告'
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /candidates/roster-import:', e.message);
    return res.status(500).json({ success: false, message: e.message || '导入失败' });
  }
});

/**
 * POST /auth/sync-enterprise-to-exam
 * enterprise/tests.html：将企业账号同步到笔试系统 qms_users，便于手机号/密码登录企业端
 */
router.post('/auth/sync-enterprise-to-exam', optionalAuthenticate, async (req, res) => {
  try {
    const b = req.body || {};
    const password = String(b.password || '').trim();
    if (!password) {
      return res.status(400).json({ success: false, message: '请提供密码' });
    }

    let enterpriseId = null;
    let trustedSession = false;

    if (req.user && req.user.role === 'enterprise') {
      trustedSession = true;
      const e = req.enterpriseId != null ? Number(req.enterpriseId) : NaN;
      if (Number.isFinite(e) && e > 0) {
        enterpriseId = e;
      } else {
        try {
          const ent = await EnterpriseModel.findByUserId(req.user.id);
          enterpriseId = ent ? ent.id : null;
        } catch (_) {
          enterpriseId = null;
        }
      }
    }

    const identifier = String(b.identifier || '').trim();

    if (!trustedSession) {
      if (!identifier) {
        return res.status(401).json({ success: false, message: '未提供认证token' });
      }
      let verified = await verifySjCredentialsCompat(identifier, password);
      if (!verified) {
        let u = await UserModel.findByUsername(identifier);
        const unorm = identifier.replace(/\D/g, '');
        if (!u && /^\d{10,15}$/.test(unorm)) {
          u = await UserModel.findByPhone(unorm);
          if (!u && unorm.length === 11 && unorm.startsWith('1')) {
            u = await UserModel.findByPhone('86' + unorm);
          }
        }
        if (u && u.role === 'enterprise') {
          verified = await UserModel.verifyPassword(password, u.password_hash);
        }
      }
      if (!verified) {
        return res.status(200).json({ success: false, message: '手机号/邮箱或密码不正确' });
      }
      if (!enterpriseId) {
        const norm = identifier.replace(/\D/g, '');
        try {
          const [erows] = await pool.execute(
            `SELECT id FROM enterprises
             WHERE (contact_email IS NOT NULL AND contact_email = ?)
                OR (contact_phone IS NOT NULL AND (contact_phone = ? OR contact_phone LIKE ?))
             LIMIT 1`,
            [identifier, identifier, norm.length >= 6 ? `%${norm}%` : identifier]
          );
          if (erows && erows[0]) enterpriseId = erows[0].id;
        } catch (lookupErr) {
          console.warn('[talentSiteCompat] sync-enterprise enterprise lookup:', lookupErr.message);
        }
      }
      if (!enterpriseId) {
        return res.status(200).json({
          success: false,
          message: '未找到与账号绑定的笔试企业，请确认企业资料中的手机/邮箱与登录账号一致'
        });
      }
    }

    if (!enterpriseId) {
      return res.status(400).json({ success: false, message: '无法确定企业，请重新登录后重试' });
    }

    const entRow = await EnterpriseModel.findById(enterpriseId);
    if (!entRow) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    const phoneDigits = String(entRow.contact_phone || '').replace(/\D/g, '');
    const email = String(entRow.contact_email || '').trim();
    let loginUsername =
      phoneDigits.length >= 10 ? phoneDigits : (email || (identifier ? identifier : '') || `enterprise_${enterpriseId}`);
    loginUsername = String(loginUsername).trim();
    if (!loginUsername) {
      return res.status(400).json({ success: false, message: '企业未配置手机号或邮箱，无法生成笔试登录名' });
    }

    let qmsUser = await UserModel.findByUsername(loginUsername);
    if (!qmsUser && phoneDigits.length >= 10) {
      qmsUser = await UserModel.findByPhone(loginUsername);
    }
    if (qmsUser && qmsUser.role !== 'enterprise' && qmsUser.role !== 'admin') {
      return res.status(409).json({
        success: false,
        message: '该登录名已被非企业账号占用，请联系管理员处理'
      });
    }

    const passwordHash = await bcrypt.hash(password, 4);
    if (qmsUser) {
      await UserModel.updatePasswordHash(qmsUser.id, passwordHash);
      try {
        await pool.execute(`UPDATE qms_users SET role = 'enterprise' WHERE id = ? AND role NOT IN ('admin')`, [qmsUser.id]);
      } catch (_) {
        /* 忽略 */
      }
    } else {
      try {
        await UserModel.create({
          username: loginUsername,
          password,
          role: 'enterprise',
          email: email || null,
          real_name: entRow.name || null,
          phone: phoneDigits.length >= 10 ? phoneDigits : null
        });
      } catch (ce) {
        if (ce && (ce.code === 'ER_DUP_ENTRY' || String(ce.message || '').includes('Duplicate'))) {
          qmsUser = await UserModel.findByUsername(loginUsername);
          if (qmsUser) await UserModel.updatePasswordHash(qmsUser.id, passwordHash);
        } else {
          throw ce;
        }
      }
      if (!qmsUser) qmsUser = await UserModel.findByUsername(loginUsername);
    }

    if (qmsUser) {
      try {
        await pool.execute(`UPDATE enterprises SET user_id = ? WHERE id = ?`, [qmsUser.id, enterpriseId]);
      } catch (linkErr) {
        console.warn('[talentSiteCompat] enterprises.user_id update:', linkErr.message);
      }
    }

    return res.json({
      success: true,
      message: '已同步到笔试系统，可使用本账号（手机号/邮箱）与密码在笔试系统企业端登录。'
    });
  } catch (e) {
    console.warn('[talentSiteCompat] sync-enterprise-to-exam:', e.message);
    return res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

/** 人才池状态（user/talent-pool.html） */
router.get('/talent-pool/status', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    const maxScore = await getUserMaxSubmittedScore(req.user.id);
    let joined = talentPoolJoinedUserIds.has(req.user.id);
    if (!joined) {
      try {
        await ensureCompatTalentPoolUsersTable();
        const [[r]] = await pool.execute(
          'SELECT 1 AS o FROM compat_talent_pool_users WHERE user_id = ? LIMIT 1',
          [req.user.id]
        );
        joined = !!(r && r.o);
      } catch (_) {
        /* ignore */
      }
    }
    return res.json({
      success: true,
      data: {
        status: joined ? 'active' : 'eligible',
        level: talentLevelFromScore(maxScore),
        maxScore,
        resumeCompleteness: 0,
        workYears: 0
      }
    });
  } catch (e) {
    return res.json({
      success: true,
      data: { status: 'eligible', level: 'primary', maxScore: 0, resumeCompleteness: 0, workYears: 0 }
    });
  }
});

router.post('/talent-pool/join', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    const maxScore = await getUserMaxSubmittedScore(req.user.id);
    if (maxScore < 80) {
      return res.status(400).json({ success: false, message: '需至少一次测评达到80分以上才能加入人才池' });
    }
    talentPoolJoinedUserIds.add(req.user.id);
    await ensureCompatTalentPoolUsersTable();
    await pool.execute(
      `INSERT INTO compat_talent_pool_users (user_id) VALUES (?)
       ON DUPLICATE KEY UPDATE joined_at = joined_at`,
      [req.user.id]
    );
    return res.json({ success: true, message: '已加入人才池' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || '加入失败' });
  }
});

/**
 * GET /talent-pool/list — 管理端人才池列表；数据来自 compat_talent_pool_users + qms_users
 */
async function getCompatTalentPoolList(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    await ensureCompatTalentPoolUsersTable();
    const [rows] = await pool.execute(
      `SELECT u.id AS userId, u.username, u.real_name AS name, u.email, u.phone, t.joined_at AS joinedAt
       FROM compat_talent_pool_users t
       INNER JOIN qms_users u ON u.id = t.user_id
       ORDER BY t.joined_at DESC
       LIMIT 500`
    );
    const data = (rows || []).map((r) => ({
      userId: r.userId,
      id: r.userId,
      username: r.username || '',
      name: r.real_name || r.username || '',
      email: r.email || '',
      phone: r.phone || '',
      joinedAt: r.joinedAt,
      status: 'active',
      skills: []
    }));
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /talent-pool/list:', e.message);
    return res.json({ success: true, data: [] });
  }
}
router.get('/talent-pool/list', authenticate, getCompatTalentPoolList);

/**
 * GET /projects
 * 求职者端人才池「可承接项目」：仅返回人才池业务项目，不含公告附加岗位（biz_type=announcement）
 */
/** 部署自检：浏览器打开 GET /api/v1/compat-build-marker 应返回 JSON；若仍 404 说明 /api 未指到本仓库后端或未重启 */
router.get('/compat-build-marker', (req, res) => {
  res.json({
    ok: true,
    module: 'talentSiteCompat',
    postProjects: typeof postCompatProject === 'function',
    getCompatProjectsList: typeof getCompatProjectsList === 'function',
    jobsPublicQuery: 'view=public',
    listQueriesNoEnterpriseJoin: false,
    demoSeedEnv: String(process.env.COMPAT_SEED_DEMO_JOBS || '') === '1',
    time: new Date().toISOString()
  });
});

/** 公开项目列表：排除公告附加岗位 announcement，其余均在管理端/求职者端可见（避免 biz_type 写法不一致导致整表为空） */
async function getCompatProjectsList(req, res) {
  try {
    await ensureCompatProjectsTable();
    const [rows] = await queryCompatProjectsRows(
      `WHERE LOWER(TRIM(COALESCE(p.biz_type, ''))) <> 'announcement'
       ORDER BY p.created_at DESC
       LIMIT 200`
    );
    const data = (rows || []).map(mapCompatProjectRow);
    res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /projects:', e.message);
    res.json({ success: true, data: [] });
  }
}
router.get('/projects', getCompatProjectsList);

/**
 * POST /projects
 * 企业端发布项目（talent.html）或公告附加岗位（tests.html，bizType=announcement）
 * 导出为 postCompatProject 供 server.js 顶层显式挂载，避免线上子路由未命中时 404
 */
async function postCompatProject(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  let enterpriseId = null;
  if (role === 'enterprise') {
    const resolved = await resolveEnterpriseForCompatUser(req);
    if (resolved.error) {
      return res
        .status(resolved.error.status || 403)
        .json({ success: false, message: resolved.error.message || '未关联企业' });
    }
    enterpriseId = resolved.enterpriseId;
  } else {
    enterpriseId = req.enterpriseId;
  }
  if (role === 'enterprise' && (!enterpriseId || !Number.isFinite(Number(enterpriseId)))) {
    return res.status(400).json({ success: false, message: '未绑定企业信息' });
  }

  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: '岗位名称不能为空' });
  }

  let requireAttachmentsJson = null;
  if (b.requireAttachments != null) {
    try {
      requireAttachmentsJson = JSON.stringify(b.requireAttachments);
    } catch (_) {
      requireAttachmentsJson = null;
    }
  }

  const showDept = b.showDepartment === true || b.showDepartment === 1 || b.showDepartment === 'true' || b.showDepartment === '1';
  const minAge = b.minAge != null && b.minAge !== '' ? parseInt(b.minAge, 10) : null;
  const maxAge = b.maxAge != null && b.maxAge !== '' ? parseInt(b.maxAge, 10) : null;
  const requiredGenderVal = readRequiredGenderFromRequestBody(b) ?? null;

  try {
    await ensureCompatProjectsTable();
    const [result] = await pool.execute(
      `INSERT INTO compat_enterprise_projects (
        enterprise_id, user_id, name, project_type, required_talent_type, description, major_required,
        status, biz_type, job_code, show_department, min_age, max_age, required_gender, require_attachments,
        budget_min, budget_max, publish_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enterpriseId || null,
        req.user.id,
        name,
        b.type || null,
        b.requiredTalentType || null,
        b.description || null,
        b.majorRequired || null,
        b.status || 'recruiting',
        b.bizType || null,
        b.jobCode || null,
        showDept ? 1 : 0,
        Number.isFinite(minAge) ? minAge : null,
        Number.isFinite(maxAge) ? maxAge : null,
        requiredGenderVal,
        requireAttachmentsJson,
        b.budgetMin != null && b.budgetMin !== '' ? Number(b.budgetMin) : null,
        b.budgetMax != null && b.budgetMax !== '' ? Number(b.budgetMax) : null,
        b.publishDate ? String(b.publishDate).slice(0, 10) : null
      ]
    );
    return res.json({
      success: true,
      data: {
        id: result.insertId,
        name,
        jobCode: b.jobCode || '',
        showDepartment: showDept
      }
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /projects:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
}

router.post('/projects', authenticate, postCompatProject);

/**
 * GET /talent-pool/projects
 * 企业端 talent.html「我的项目」：仅本企业且 biz_type=talent_pool
 */
router.get('/talent-pool/projects', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.json({ success: true, data: [] });
  }
  let enterpriseId = req.enterpriseId;
  if (!enterpriseId && role === 'enterprise') {
    const ent = await EnterpriseModel.findByUserId(req.user.id);
    enterpriseId = ent && ent.id;
  }
  if (role === 'enterprise' && !enterpriseId) {
    return res.json({ success: true, data: [], message: '未绑定企业信息' });
  }

  try {
    await ensureCompatProjectsTable();
    // 与 GET /projects 一致：仅排除 announcement，避免漏掉历史数据
    let after = `WHERE LOWER(TRIM(COALESCE(p.biz_type, ''))) <> 'announcement'`;
    const params = [];
    if (role !== 'admin') {
      after += ' AND (p.enterprise_id = ? OR (p.enterprise_id IS NULL AND p.user_id = ?))';
      params.push(enterpriseId, req.user.id);
    }
    after += ' ORDER BY p.created_at DESC LIMIT 200';
    const [rows] = await queryCompatProjectsRows(after, params);
    const data = (rows || []).map(mapCompatProjectRow);
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /talent-pool/projects:', e.message);
    return res.json({ success: true, data: [] });
  }
});

/**
 * GET /cooperations
 * enterprise/talent.html「合作管理」；前端只展示 isFromTalentPool 为 true 的项
 */
async function getCompatCooperations(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  return res.json({ success: true, data: [] });
}
router.get('/cooperations', authenticate, getCompatCooperations);

/** 求职者：查看自己的一条公告/项目报名（用于回填修改） */
router.get('/cooperations/my-application/:id', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const rawId = parseInt(req.params.id, 10);
  if (!Number.isFinite(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute(
      `SELECT id, user_id, project_id, announcement_id, status, extra_json
       FROM compat_cooperation_applications WHERE id = ? LIMIT 1`,
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    const row = rows[0];
    if (Number(row.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: '无权查看' });
    }
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extra = {};
    }
    return res.json({
      success: true,
      data: {
        id: Number(row.id),
        projectId: Number(row.project_id),
        announcementId: row.announcement_id != null ? Number(row.announcement_id) : null,
        status: normalizeCooperationStatus(row.status),
        extraJson: extra
      }
    });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /cooperations/my-application/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '读取失败' });
  }
});

/** 求职者：修改并重新提交待审核状态的公告报名（与 POST /cooperations 结构一致） */
router.put('/cooperations/my-application/:id', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const rawId = parseInt(req.params.id, 10);
  if (!Number.isFinite(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    const row = rows[0];
    if (Number(row.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: '无权修改' });
    }
    const st = normalizeCooperationStatus(row.status);
    let extraOld = {};
    try {
      extraOld = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extraOld = {};
    }
    const afOld = extraOld.assessmentFee && typeof extraOld.assessmentFee === 'object' ? extraOld.assessmentFee : {};
    if (st === 'rejected' && afOld.refunded) {
      return res.status(400).json({
        success: false,
        message: '该报名已办理退费，请从招聘公告进入按新报名提交'
      });
    }
    if (st !== 'pending' && st !== 'rejected') {
      return res.status(400).json({ success: false, message: '当前状态不可修改报名表，请联系企业或重新报名' });
    }
    const b = req.body || {};
    const form = b.form && typeof b.form === 'object' ? b.form : {};
    const attachmentsIn = b.attachments && typeof b.attachments === 'object' ? b.attachments : {};
    const merged = { ...extraOld, ...form };
    merged.attachments = { ...(extraOld.attachments || {}), ...attachmentsIn };
    if (merged.reviewAudit && typeof merged.reviewAudit === 'object') {
      const ra = { ...merged.reviewAudit };
      delete ra.returnReason;
      merged.reviewAudit = {
        ...ra,
        status: 'pending',
        resubmittedAt: new Date().toISOString()
      };
    }
    const [prows] = await pool.execute('SELECT * FROM compat_enterprise_projects WHERE id = ? LIMIT 1', [
      row.project_id
    ]);
    if (prows && prows[0]) {
      const ruleCheck = __assertApplicantMeetsProjectRules(prows[0], merged);
      if (!ruleCheck.ok) {
        return res.status(400).json({ success: false, message: ruleCheck.message });
      }
    }
    if (st === 'rejected') {
      await pool.execute(
        'UPDATE compat_cooperation_applications SET status = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['pending', JSON.stringify(merged), rawId]
      );
    } else {
      await pool.execute(
        'UPDATE compat_cooperation_applications SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(merged), rawId]
      );
    }
    return res.json({ success: true, message: '已保存修改' });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /cooperations/my-application/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/** 求职者公告/附加岗位报名：写入 compat_cooperation_applications，企业端 GET /candidates 可见 */
router.post('/cooperations', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const b = req.body || {};
  const projectId = Number(b.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return res.status(400).json({ success: false, message: 'projectId 无效' });
  }
  try {
    await ensureCompatProjectsTable();
    await ensureCompatCooperationApplicationsTable();
    const [prows] = await pool.execute('SELECT * FROM compat_enterprise_projects WHERE id = ? LIMIT 1', [
      projectId
    ]);
    if (!prows || !prows.length) {
      return res.status(404).json({ success: false, message: '岗位/项目不存在' });
    }
    const proj = prows[0];
    const formForRules = b.form && typeof b.form === 'object' ? b.form : {};
    const ruleCheck = __assertApplicantMeetsProjectRules(proj, formForRules);
    if (!ruleCheck.ok) {
      return res.status(400).json({ success: false, message: ruleCheck.message });
    }
    const meta = await findAnnouncementMetaForProjectId(projectId);
    let enterpriseId =
      proj.enterprise_id != null && proj.enterprise_id !== '' ? Number(proj.enterprise_id) : null;
    if (enterpriseId == null && meta.enterpriseId != null) {
      enterpriseId = Number(meta.enterpriseId);
    }
    if (enterpriseId == null && meta.announcementId != null) {
      await ensureCompatAnnouncementsTable();
      const [ar] = await pool.execute(
        'SELECT enterprise_id FROM compat_announcements WHERE id = ? LIMIT 1',
        [meta.announcementId]
      );
      if (ar && ar[0] && ar[0].enterprise_id != null && ar[0].enterprise_id !== '') {
        enterpriseId = Number(ar[0].enterprise_id);
      }
    }
    const announcementId = meta.announcementId;
    if (announcementId != null) {
      await ensureCompatAnnouncementsTable();
      const [anrows] = await pool.execute(
        'SELECT id, status, expiry_date, publish_date FROM compat_announcements WHERE id = ? LIMIT 1',
        [announcementId]
      );
      if (!anrows || !anrows.length) {
        return res.status(404).json({ success: false, message: '公告不存在' });
      }
      if (isCompatAnnouncementSignupClosed(anrows[0])) {
        return res.status(400).json({ success: false, message: '公告报名已截止，不可再提交申请' });
      }
    }
    if (enterpriseId != null && Number.isFinite(Number(enterpriseId))) {
      const eidNum = Number(enterpriseId);
      const [dupRows] = await pool.execute(
        `SELECT a.id, a.status, a.extra_json FROM compat_cooperation_applications a
         LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
         LEFT JOIN compat_announcements an ON an.id = a.announcement_id
         WHERE a.user_id = ?
           AND (
             (a.enterprise_id IS NOT NULL AND CAST(a.enterprise_id AS UNSIGNED) = ?)
             OR (p.enterprise_id IS NOT NULL AND CAST(p.enterprise_id AS UNSIGNED) = ?)
             OR (an.enterprise_id IS NOT NULL AND CAST(an.enterprise_id AS UNSIGNED) = ?)
           )`,
        [req.user.id, eidNum, eidNum, eidNum]
      );
      let blocked = false;
      for (const dr of dupRows || []) {
        const dst = normalizeCooperationStatus(dr.status);
        let ex = {};
        try {
          ex = dr.extra_json ? JSON.parse(dr.extra_json) : {};
        } catch (_) {
          ex = {};
        }
        const af = ex.assessmentFee && typeof ex.assessmentFee === 'object' ? ex.assessmentFee : {};
        if (dst === 'rejected' && af.refunded === true) continue;
        if (dst === 'withdrawn') continue;
        blocked = true;
        break;
      }
      if (blocked) {
        return res.status(400).json({
          success: false,
          message: '您已在该企业报名，每位考生仅限报考一个岗位'
        });
      }
    }
    const form = b.form && typeof b.form === 'object' ? b.form : {};
    const attachments = b.attachments && typeof b.attachments === 'object' ? b.attachments : {};
    const extraPayload = { ...form, attachments };
    await pool.execute(
      `INSERT INTO compat_cooperation_applications (enterprise_id, announcement_id, project_id, user_id, status, extra_json)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [enterpriseId, announcementId, projectId, req.user.id, JSON.stringify(extraPayload)]
    );
    return res.json({ success: true, message: '申请已提交' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: '已申请过' });
    }
    console.warn('[talentSiteCompat] POST /cooperations:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/** 求职者确认已完成测评报名缴费（扫码后点击；写入 extra_json.assessmentFee） */
router.post('/cooperations/:id/assessment-fee/confirm-paid', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const rawId = parseInt(req.params.id, 10);
  if (!Number.isFinite(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  try {
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute(
      `SELECT a.*,
        COALESCE(a.enterprise_id, p.enterprise_id, an.enterprise_id) AS resolved_enterprise_id
       FROM compat_cooperation_applications a
       LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
       LEFT JOIN compat_announcements an ON an.id = a.announcement_id
       WHERE a.id = ? LIMIT 1`,
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    const row = rows[0];
    if (Number(row.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const st = String(row.status || '').toLowerCase();
    if (st !== 'approved') {
      return res.status(400).json({ success: false, message: '仅审核通过后方可确认缴费' });
    }
    const eid =
      row.resolved_enterprise_id != null && row.resolved_enterprise_id !== ''
        ? Number(row.resolved_enterprise_id)
        : null;
    const feeMap = await loadAssessmentFeeSettingsMap(eid ? [eid] : []);
    const fee = eid && feeMap.has(eid) ? feeMap.get(eid) : null;
    if (!fee || Number(fee.enabled) !== 1) {
      return res.status(400).json({ success: false, message: '当前未开启测评缴费' });
    }
    if (!isInAssessmentFeePayWindow(fee.pay_start_at, fee.pay_end_at)) {
      return res.status(400).json({ success: false, message: '不在缴费开放时间内' });
    }
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extra = {};
    }
    if (!extra || typeof extra !== 'object') extra = {};
    extra.assessmentFee = extra.assessmentFee || {};
    if (extra.assessmentFee.paid) {
      return res.json({ success: true, message: '已标记为已缴费' });
    }
    extra.assessmentFee.paid = true;
    extra.assessmentFee.paidAt = new Date().toISOString();
    extra.assessmentFee.confirmedBy = 'jobseeker';
    await pool.execute(
      'UPDATE compat_cooperation_applications SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(extra), rawId]
    );
    return res.json({ success: true, message: '已记录缴费完成' });
  } catch (e) {
    console.warn('[talentSiteCompat] POST cooperations assessment-fee confirm:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/** 求职者：已缴费状态下申请退费（由企业审核后在企业端执行实际退费流程） */
router.post('/cooperations/:id/assessment-fee/refund-request', authenticate, async (req, res) => {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const rawId = parseInt(req.params.id, 10);
  if (!Number.isFinite(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  const reason =
    req.body && req.body.reason != null ? String(req.body.reason).trim().slice(0, 2000) : '';
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    const row = rows[0];
    if (Number(row.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extra = {};
    }
    if (!extra || typeof extra !== 'object') extra = {};
    extra.assessmentFee = extra.assessmentFee || {};
    if (!extra.assessmentFee.paid) {
      return res.status(400).json({ success: false, message: '当前无需申请退费（未标记已缴费）' });
    }
    if (extra.assessmentFee.refunded) {
      return res.status(400).json({ success: false, message: '该报名已办理退费' });
    }
    if (extra.assessmentFee.refundRequested) {
      return res.json({ success: true, message: '已提交过退费申请，请等待企业处理' });
    }
    extra.assessmentFee.refundRequested = true;
    extra.assessmentFee.refundRequestAt = new Date().toISOString();
    extra.assessmentFee.refundRequestReason = reason || undefined;
    await pool.execute(
      'UPDATE compat_cooperation_applications SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(extra), rawId]
    );
    return res.json({ success: true, message: '退费申请已提交' });
  } catch (e) {
    console.warn('[talentSiteCompat] POST cooperations refund-request:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/** 企业端审核公告报名：与 tests.html PUT /cooperations/:paId 对应（paId 为表主键，非 500000 偏移） */
router.put('/cooperations/:id', authenticate, async (req, res) => {
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin' && role !== 'enterprise_reviewer') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const rawId = parseInt(req.params.id, 10);
  if (!Number.isFinite(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  try {
    await ensureCompatCooperationApplicationsTable();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
      [rawId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    const row = rows[0];
    if (!(await assertEnterpriseCanAccessCooperationRow(req, row))) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    const st = (req.body && req.body.status) || 'pending';
    const allowed = new Set(['pending', 'approved', 'rejected', 'testing', 'completed']);
    const next = allowed.has(String(st)) ? String(st) : 'pending';
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(row.extra_json) : {};
    } catch (_) {
      extra = {};
    }
    if (!extra || typeof extra !== 'object') extra = {};
    const reviewerIn =
      req.body && req.body.reviewer != null ? String(req.body.reviewer).trim().slice(0, 200) : '';
    const returnReasonIn =
      req.body && req.body.returnReason != null ? String(req.body.returnReason).trim().slice(0, 2000) : '';
    const prevRa = extra.reviewAudit && typeof extra.reviewAudit === 'object' ? extra.reviewAudit : {};
    extra.reviewAudit = {
      ...prevRa,
      reviewer: reviewerIn || prevRa.reviewer || '',
      reviewedAt: new Date().toISOString(),
      status: next,
      returnReason: returnReasonIn || undefined
    };
    await pool.execute(
      'UPDATE compat_cooperation_applications SET status = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [next, JSON.stringify(extra), rawId]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /cooperations/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
});

/** 企业端 tests.html「岗位统计」：/jobs CRUD，独立表 compat_enterprise_projects（项目/人才池） */
let compatJobsTableReady = false;

async function ensureCompatJobsTable() {
  if (compatJobsTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NULL,
      user_id INT NULL,
      title VARCHAR(500) NOT NULL,
      department VARCHAR(200) NULL,
      description TEXT NULL,
      job_status VARCHAR(50) DEFAULT 'draft',
      require_attachments LONGTEXT NULL,
      deadline_date DATE NULL,
      publish_date DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ent (enterprise_id),
      INDEX idx_status (job_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 企业招聘岗位兼容表'
  `);
  compatJobsTableReady = true;
}

/**
 * 兼容层部分列表曾单表查询；公告已尽量 LEFT JOIN enterprises 填充 enterprise_name，失败时回退单表。
 */
function compatListSqlTail(fragment) {
  const t = String(fragment || '').trim();
  return t ? ` ${t}` : '';
}

async function queryCompatJobsRows(sqlAfterJ, params = []) {
  return pool.execute(
    `SELECT j.*, '' AS enterprise_name FROM compat_enterprise_jobs j${compatListSqlTail(sqlAfterJ)}`,
    params
  );
}

async function queryCompatProjectsRows(sqlAfterP, params = []) {
  try {
    const ec = await getEnterpriseColumnMap();
    const nameExpr = ec.name ? `e.${sqlIdent(ec.name)}` : 'CAST(e.id AS CHAR)';
    return await pool.execute(
      `SELECT p.*, COALESCE(${nameExpr}, '') AS enterprise_name
       FROM compat_enterprise_projects p
       LEFT JOIN enterprises e ON e.id = p.enterprise_id${compatListSqlTail(sqlAfterP)}`,
      params
    );
  } catch (e) {
    console.warn('[talentSiteCompat] queryCompatProjectsRows JOIN 失败，回退无 JOIN:', e.message);
    return pool.execute(
      `SELECT p.*, '' AS enterprise_name FROM compat_enterprise_projects p${compatListSqlTail(sqlAfterP)}`,
      params
    );
  }
}

async function queryCompatAnnouncementsRows(sqlAfterA, params = []) {
  try {
    const ec = await getEnterpriseColumnMap();
    const nameExpr = ec.name ? `e.${sqlIdent(ec.name)}` : 'CAST(e.id AS CHAR)';
    return await pool.execute(
      `SELECT a.*, COALESCE(${nameExpr}, '') AS enterprise_name
       FROM compat_announcements a
       LEFT JOIN enterprises e ON e.id = a.enterprise_id${compatListSqlTail(sqlAfterA)}`,
      params
    );
  } catch (e) {
    console.warn('[talentSiteCompat] queryCompatAnnouncementsRows JOIN 失败，回退无 JOIN:', e.message);
    return pool.execute(
      `SELECT a.*, '' AS enterprise_name FROM compat_announcements a${compatListSqlTail(sqlAfterA)}`,
      params
    );
  }
}

function mapCompatJobRow(r) {
  let requireAttachments = null;
  if (r.require_attachments != null && r.require_attachments !== '') {
    try {
      requireAttachments =
        typeof r.require_attachments === 'string'
          ? JSON.parse(r.require_attachments)
          : r.require_attachments;
    } catch (_) {
      requireAttachments = null;
    }
  }
  const st = (r.job_status || 'draft').toLowerCase();
  const createdIso = r.created_at ? new Date(r.created_at).toISOString() : '';
  const pub = r.publish_date ? formatCompatProjectDate(r.publish_date) : '';
  return {
    id: r.id,
    title: r.title,
    department: r.department || '',
    description: r.description || '',
    status: st,
    requireAttachments,
    deadline: r.deadline_date ? formatCompatProjectDate(r.deadline_date) : '',
    deadlineDate: r.deadline_date ? formatCompatProjectDate(r.deadline_date) : '',
    publishedAt: pub || createdIso.slice(0, 10),
    createdAt: createdIso,
    companyName: r.enterprise_name || '',
    salaryRange: '面议',
    location: '',
    requirement: r.description || ''
  };
}

function normalizeJobStatus(s) {
  if (s == null || s === '') return 'draft';
  const x = String(s).trim().toLowerCase();
  if (x === 'published' || x === '已发布') return 'published';
  if (x === 'closed' || x === '已关闭') return 'closed';
  if (x === 'draft' || x === '草稿' || x === '待发布') return 'draft';
  return 'draft';
}

/** 求职者端公开列表：人才池项目合成岗位 id，避免与 compat_enterprise_jobs 自增 id 冲突 */
const COMPAT_PROJECT_AS_JOB_ID_BASE = 500000000;

function mapCompatProjectRowToSyntheticJob(r) {
  let requireAttachments = null;
  if (r.require_attachments != null && r.require_attachments !== '') {
    try {
      requireAttachments =
        typeof r.require_attachments === 'string'
          ? JSON.parse(r.require_attachments)
          : r.require_attachments;
    } catch (_) {
      requireAttachments = null;
    }
  }
  const createdIso = r.created_at ? new Date(r.created_at).toISOString() : '';
  const pub = r.publish_date ? formatCompatProjectDate(r.publish_date) : '';
  const pst = String(r.status || '').trim().toLowerCase();
  let jobApiStatus = 'published';
  if (pst === 'closed' || pst === '已关闭' || pst === 'cancelled') jobApiStatus = 'closed';
  else if (pst === 'draft' || pst === '草稿') jobApiStatus = 'draft';
  let salaryRange = '面议';
  if (r.budget_min != null || r.budget_max != null) {
    const a = r.budget_min != null ? Number(r.budget_min) : null;
    const b = r.budget_max != null ? Number(r.budget_max) : null;
    if (Number.isFinite(a) && Number.isFinite(b)) salaryRange = `${a}-${b}元`;
    else if (Number.isFinite(a)) salaryRange = `${a}元起`;
    else if (Number.isFinite(b)) salaryRange = `最高${b}元`;
  }
  return {
    id: COMPAT_PROJECT_AS_JOB_ID_BASE + Number(r.id),
    title: r.name,
    department: r.project_type || r.required_talent_type || '',
    description: r.description || '',
    status: jobApiStatus,
    requireAttachments,
    deadline: '',
    deadlineDate: '',
    publishedAt: pub || createdIso.slice(0, 10),
    createdAt: createdIso,
    companyName: r.enterprise_name || '',
    salaryRange,
    location: '',
    requirement: r.description || '',
    projectType: r.project_type || '',
    requiredTalentType: r.required_talent_type || '',
    majorRequired: r.major_required || '',
    jobCode: r.job_code || '',
    showDepartment: !!(r.show_department === 1 || r.show_department === true),
    minAge: r.min_age != null ? Number(r.min_age) : null,
    maxAge: r.max_age != null ? Number(r.max_age) : null,
    requiredGender: normalizeRequiredGenderDbValue(r.required_gender) || '',
    rawProjectId: Number(r.id)
  };
}

/** 空库时插入演示岗位（需环境变量 COMPAT_SEED_DEMO_JOBS=1，重启后生效） */
async function maybeSeedDemoCompatJobsIfConfigured() {
  if (String(process.env.COMPAT_SEED_DEMO_JOBS || '').trim() !== '1') return;
  try {
    await ensureCompatJobsTable();
    const [cnt] = await pool.execute('SELECT COUNT(*) AS n FROM compat_enterprise_jobs');
    const n = cnt && cnt[0] ? Number(cnt[0].n) : 0;
    if (n > 0) return;
    const rows = [
      ['【演示】行政文员', '综合部', '系统演示数据。企业端「测评管理→岗位管理」发布真实岗位后可删除。'],
      ['【演示】机械设计助理', '技术部', '仅用于空库验证求职者端列表；不需要时可删表或关 COMPAT_SEED_DEMO_JOBS。'],
      ['【演示】电气工程师', '工程部', '若仍无数据，请确认已重启 PM2 且 GET /api/v1/compat-build-marker 为最新。']
    ];
    for (let i = 0; i < rows.length; i++) {
      const [title, department, description] = rows[i];
      await pool.execute(
        `INSERT INTO compat_enterprise_jobs (enterprise_id, user_id, title, department, description, job_status, publish_date)
         VALUES (NULL, NULL, ?, ?, ?, 'published', CURDATE())`,
        [title, department, description]
      );
    }
    console.info('[talentSiteCompat] COMPAT_SEED_DEMO_JOBS: inserted', rows.length, 'demo jobs');
  } catch (e) {
    console.warn('[talentSiteCompat] demo job seed failed:', e.message);
  }
}

/**
 * POST/PUT/DELETE /jobs：解析企业/管理员身份（与 auth 中间件 enterprise promotion 一致；避免仅因 users.role 未标 enterprise 或旧部署未含 promotion 时误报「无权限」）
 */
async function resolveCompatJobsManageContext(req) {
  if (!req.user || req.isGuest) {
    return { ok: false, status: 401, message: '未登录', role: null, enterpriseId: null };
  }
  if (req.loginPortal === 'jobseeker') {
    return {
      ok: false,
      status: 403,
      message: '当前为求职者登录会话，请退出后使用「政企登录」管理岗位',
      role: null,
      enterpriseId: null
    };
  }
  let role = req.user.role;

  if (role === 'admin') {
    return {
      ok: true,
      status: 200,
      message: '',
      role: 'admin',
      enterpriseId: req.enterpriseId != null ? Number(req.enterpriseId) : null
    };
  }

  if (role === 'enterprise' || role === 'enterprise_reviewer') {
    const enterpriseId = await getCompatManageEnterpriseDbId(req);
    if (enterpriseId == null || !Number.isFinite(Number(enterpriseId)) || enterpriseId <= 0) {
      return { ok: false, status: 400, message: '未绑定企业信息', role, enterpriseId: null };
    }
    return { ok: true, status: 200, message: '', role, enterpriseId };
  }

  try {
    const ent = await EnterpriseModel.findByUserId(req.user.id);
    if (ent && ent.id != null) {
      return { ok: true, status: 200, message: '', role: 'enterprise', enterpriseId: ent.id };
    }
  } catch (e) {
    console.warn('[talentSiteCompat] resolveCompatJobsManageContext:', e.message);
  }

  return { ok: false, status: 403, message: '无权限', role, enterpriseId: req.enterpriseId != null ? Number(req.enterpriseId) : null };
}

function compatJobRowWritableByEnterpriseUser(row, enterpriseId, reqUserId) {
  if (!row) return false;
  const eid = enterpriseId != null ? Number(enterpriseId) : null;
  const rowEid = row.enterprise_id != null ? Number(row.enterprise_id) : null;
  const rowUid = row.user_id != null ? Number(row.user_id) : null;
  const uid = reqUserId != null ? Number(reqUserId) : null;
  const sameEnt = eid != null && rowEid != null && rowEid === eid;
  const sameUser = uid != null && rowUid != null && rowUid === uid;
  return sameEnt || sameUser;
}

function compatProjectRowWritableByEnterpriseUser(row, enterpriseId, reqUserId) {
  return compatJobRowWritableByEnterpriseUser(row, enterpriseId, reqUserId);
}

/** 企业端岗位列表：公告附加岗位（compat_enterprise_projects.biz_type=announcement）与 /jobs 使用同一套查看/编辑 UI，合成 id = 500000000 + projectId */
function normalizeProjectStatusFromJobPut(st) {
  const x = String(st || '').trim().toLowerCase();
  if (x === 'published' || x === '已发布') return 'recruiting';
  if (x === 'closed' || x === '已关闭') return 'closed';
  if (x === 'draft' || x === '草稿' || x === '待发布') return 'draft';
  return 'recruiting';
}

async function getCompatJobs(req, res) {
  try {
    await ensureCompatJobsTable();
    const role = req.user && req.user.role;
    /** 求职者首页/岗位推荐须带 view=public，否则企业账号登录后仍带 token 会走管理分支，只查本企业岗位（未绑定企业时恒为空且 pageSize=20） */
    const forcePublic =
      String(req.query.view || '').toLowerCase() === 'public' ||
      String(req.query.public || '') === '1';
    const portal = req.loginPortal;
    const manage =
      !forcePublic &&
      portal !== 'jobseeker' &&
      portal !== 'guest' &&
      (role === 'enterprise' || role === 'admin' || role === 'enterprise_reviewer');

    if (manage && !req.isGuest) {
      let scopeIds = [];
      if (role === 'enterprise' || role === 'enterprise_reviewer') {
        scopeIds = await collectCompatEnterpriseScopeIds(req);
      }
      const uid = req.user.id != null ? Number(req.user.id) : NaN;
      const uidOk = Number.isFinite(uid) && uid > 0;
      /** 无任何可解析企业 id 时仍按创建人拉历史岗位/公告岗（enterprise_id 常为空） */
      const jobsByOwnerOnly =
        (role === 'enterprise' || role === 'enterprise_reviewer') && scopeIds.length === 0 && uidOk;
      if ((role === 'enterprise' || role === 'enterprise_reviewer') && scopeIds.length === 0 && !uidOk) {
        return res.json({
          success: true,
          data: [],
          total: 0,
          page: 1,
          pageSize: 0,
          message: '未绑定企业信息'
        });
      }
      let rows;
      if (role === 'admin') {
        const [r] = await queryCompatJobsRows('ORDER BY j.created_at DESC LIMIT 500');
        rows = r;
      } else if (jobsByOwnerOnly) {
        const [r] = await queryCompatJobsRows(
          'WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT 500',
          [uid]
        );
        rows = r;
      } else {
        const ph = scopeIds.map(() => '?').join(',');
        const [r] = await queryCompatJobsRows(
          `WHERE j.enterprise_id IN (${ph}) OR j.user_id = ? ORDER BY j.created_at DESC LIMIT 500`,
          [...scopeIds, uid]
        );
        rows = r;
      }
      let data = (rows || []).map(mapCompatJobRow);
      try {
        await ensureCompatProjectsTable();
        let annAfter = `WHERE LOWER(TRIM(COALESCE(p.biz_type,''))) = 'announcement'`;
        const annParams = [];
        if (role !== 'admin') {
          if (jobsByOwnerOnly) {
            annAfter += ' AND p.user_id = ?';
            annParams.push(uid);
          } else {
            const phA = scopeIds.map(() => '?').join(',');
            annAfter += ` AND (p.enterprise_id IN (${phA}) OR p.user_id = ?)`;
            annParams.push(...scopeIds, uid);
          }
        }
        annAfter += ' ORDER BY p.created_at DESC LIMIT 200';
        const [annRows] = await queryCompatProjectsRows(annAfter, annParams);
        const annJobs = (annRows || []).map(mapCompatProjectRowToSyntheticJob);
        data = [...data, ...annJobs].sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime();
          const tb = new Date(b.createdAt || 0).getTime();
          return tb - ta;
        });
      } catch (e) {
        console.warn('[talentSiteCompat] GET /jobs merge announcement projects:', e.message);
      }
      return res.json({ success: true, data, total: data.length, page: 1, pageSize: data.length });
    }

    // 求职者 / 未登录：默认仅 compat_enterprise_jobs 中「已发布」岗位。
    // 人才池「我的项目」在 compat_enterprise_projects，过去曾合并进本列表导致与 enterprise/talent.html 重复曝光；
    // 若需恢复旧行为，设环境变量 COMPAT_PUBLIC_JOBS_INCLUDE_TALENT_POOL_PROJECTS=1 后重启。
    await maybeSeedDemoCompatJobsIfConfigured();
    const [rows] = await queryCompatJobsRows(
      `WHERE (
         LOWER(TRIM(COALESCE(j.job_status,''))) = 'published'
         OR TRIM(COALESCE(j.job_status,'')) IN ('已发布','发布中','进行中','招聘中')
       )
       ORDER BY j.created_at DESC LIMIT 200`
    );
    let data = (rows || []).map(mapCompatJobRow);
    const includeTalentPoolProjects =
      String(process.env.COMPAT_PUBLIC_JOBS_INCLUDE_TALENT_POOL_PROJECTS || '').trim() === '1';
    if (includeTalentPoolProjects) {
      try {
        await ensureCompatProjectsTable();
        const [pRows] = await queryCompatProjectsRows(
          `WHERE (
               p.biz_type IS NULL OR TRIM(p.biz_type) = ''
               OR LOWER(TRIM(p.biz_type)) NOT IN ('announcement')
             )
             AND LOWER(TRIM(COALESCE(p.status,''))) NOT IN (
               'closed','completed','offline','draft','cancelled',
               '已关闭','已结束','已下架','草稿'
             )
           ORDER BY p.created_at DESC
           LIMIT 200`
        );
        const fromProjects = (pRows || []).map(mapCompatProjectRowToSyntheticJob);
        data = [...data, ...fromProjects].sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime();
          const tb = new Date(b.createdAt || 0).getTime();
          return tb - ta;
        });
      } catch (e) {
        console.warn('[talentSiteCompat] GET /jobs merge projects:', e.message);
      }
    }
    const payload = {
      success: true,
      data,
      total: data.length,
      page: 1,
      pageSize: data.length,
      meta: {
        public: !!forcePublic
      }
    };
    if (forcePublic && data.length === 0) {
      payload.meta.hint =
        '库中暂无已发布岗位。请在企业端「测评管理→岗位管理」发布为已发布，或设环境变量 COMPAT_SEED_DEMO_JOBS=1 后重启以插入演示数据。';
    }
    return res.json(payload);
  } catch (e) {
    console.warn('[talentSiteCompat] GET /jobs:', e.stack || e.message);
    return res.json({
      success: true,
      data: [],
      total: 0,
      page: 1,
      pageSize: 0,
      message: '岗位列表查询异常，请检查数据库连接与表 compat_enterprise_jobs',
      meta: { error: true }
    });
  }
}

async function postCompatJob(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const ctx = await resolveCompatJobsManageContext(req);
  if (!ctx.ok) {
    return res.status(ctx.status).json({ success: false, message: ctx.message });
  }
  let enterpriseId = ctx.enterpriseId;
  const b = req.body || {};
  const title = (b.title || '').trim();
  if (!title) {
    return res.status(400).json({ success: false, message: '岗位名称不能为空' });
  }
  const jobStatus = normalizeJobStatus(b.status);
  let reqAttachJson = null;
  if (b.requireAttachments != null) {
    try {
      reqAttachJson = JSON.stringify(b.requireAttachments);
    } catch (_) {
      reqAttachJson = null;
    }
  }
  const deadline =
    b.deadline != null && b.deadline !== ''
      ? String(b.deadline).slice(0, 10)
      : null;
  const publishDate = jobStatus === 'published' ? new Date().toISOString().slice(0, 10) : null;

  try {
    await ensureCompatJobsTable();
    const [result] = await pool.execute(
      `INSERT INTO compat_enterprise_jobs (
        enterprise_id, user_id, title, department, description, job_status, require_attachments, deadline_date, publish_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enterpriseId || null,
        req.user.id,
        title,
        b.department || null,
        b.description || null,
        jobStatus,
        reqAttachJson,
        deadline,
        publishDate
      ]
    );
    return res.json({ success: true, data: { id: result.insertId } });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /jobs:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
}

async function putCompatJob(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const ctx = await resolveCompatJobsManageContext(req);
  if (!ctx.ok) {
    return res.status(ctx.status).json({ success: false, message: ctx.message });
  }
  const role = ctx.role;
  const enterpriseId = ctx.enterpriseId;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: '无效的岗位 ID' });
  }

  if (id >= COMPAT_PROJECT_AS_JOB_ID_BASE) {
    const pid = id - COMPAT_PROJECT_AS_JOB_ID_BASE;
    try {
      await ensureCompatProjectsTable();
      const [prows] = await pool.execute('SELECT * FROM compat_enterprise_projects WHERE id = ?', [pid]);
      if (!prows || !prows.length) {
        return res.status(404).json({ success: false, message: '岗位不存在' });
      }
      const prow = prows[0];
      if (role !== 'admin') {
        if (!compatProjectRowWritableByEnterpriseUser(prow, enterpriseId, req.user.id)) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      const b = req.body || {};
      const name = b.title != null ? String(b.title).trim() : prow.name;
      if (!name) {
        return res.status(400).json({ success: false, message: '岗位名称不能为空' });
      }
      const projectType = b.department !== undefined ? b.department : prow.project_type;
      const requiredTalentType =
        b.requiredTalentType !== undefined ? b.requiredTalentType : prow.required_talent_type;
      const description = b.description !== undefined ? b.description : prow.description;
      const majorRequired =
        b.majorRequired !== undefined ? String(b.majorRequired).trim() : prow.major_required;
      const jobCode = b.jobCode !== undefined ? String(b.jobCode).trim().slice(0, 100) : prow.job_code;
      const showDept =
        b.showDepartment !== undefined
          ? b.showDepartment === true || b.showDepartment === 1 || b.showDepartment === 'true' || b.showDepartment === '1'
          : prow.show_department === 1 || prow.show_department === true;
      let minAge = null;
      if (b.minAge !== undefined) {
        const v = parseInt(b.minAge, 10);
        minAge = Number.isFinite(v) ? v : null;
      } else if (prow.min_age != null) {
        minAge = Number(prow.min_age);
      }
      let maxAge = null;
      if (b.maxAge !== undefined) {
        const v = parseInt(b.maxAge, 10);
        maxAge = Number.isFinite(v) ? v : null;
      } else if (prow.max_age != null) {
        maxAge = Number(prow.max_age);
      }
      let requiredGenderUpd = prow.required_gender;
      if (b.requiredGender !== undefined || b.required_gender !== undefined) {
        requiredGenderUpd = readRequiredGenderFromRequestBody(b) ?? null;
      }
      const projStatus =
        b.status !== undefined ? normalizeProjectStatusFromJobPut(b.status) : prow.status || 'recruiting';
      let reqAttachJson = prow.require_attachments;
      if (b.requireAttachments !== undefined) {
        try {
          reqAttachJson =
            b.requireAttachments == null ? null : JSON.stringify(b.requireAttachments);
        } catch (_) {
          reqAttachJson = prow.require_attachments;
        }
      }
      await pool.execute(
        `UPDATE compat_enterprise_projects SET name=?, project_type=?, required_talent_type=?, description=?, status=?, require_attachments=?, major_required=?, job_code=?, show_department=?, min_age=?, max_age=?, required_gender=? WHERE id=?`,
        [
          name,
          projectType || null,
          requiredTalentType || null,
          description || null,
          projStatus,
          reqAttachJson,
          majorRequired || null,
          jobCode || null,
          showDept ? 1 : 0,
          Number.isFinite(minAge) ? minAge : null,
          Number.isFinite(maxAge) ? maxAge : null,
          requiredGenderUpd || null,
          pid
        ]
      );
      return res.json({ success: true });
    } catch (e) {
      console.warn('[talentSiteCompat] PUT /jobs/:id (announcement project):', e.message);
      return res.status(500).json({ success: false, message: e.message || '更新失败' });
    }
  }

  try {
    await ensureCompatJobsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_enterprise_jobs WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '岗位不存在' });
    }
    const row = rows[0];
    if (role !== 'admin') {
      if (!compatJobRowWritableByEnterpriseUser(row, enterpriseId, req.user.id)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    const b = req.body || {};
    const title = b.title != null ? String(b.title).trim() : row.title;
    if (!title) {
      return res.status(400).json({ success: false, message: '岗位名称不能为空' });
    }
    const jobStatus =
      b.status !== undefined ? normalizeJobStatus(b.status) : row.job_status || 'draft';
    let reqAttachJson = row.require_attachments;
    if (b.requireAttachments !== undefined) {
      try {
        reqAttachJson =
          b.requireAttachments == null ? null : JSON.stringify(b.requireAttachments);
      } catch (_) {
        reqAttachJson = row.require_attachments;
      }
    }
    const department = b.department !== undefined ? b.department : row.department;
    const description = b.description !== undefined ? b.description : row.description;
    const deadline =
      b.deadline !== undefined
        ? b.deadline
          ? String(b.deadline).slice(0, 10)
          : null
        : row.deadline_date;
    let publishDate = row.publish_date;
    if (jobStatus === 'published' && !publishDate) {
      publishDate = new Date().toISOString().slice(0, 10);
    }

    await pool.execute(
      `UPDATE compat_enterprise_jobs SET title=?, department=?, description=?, job_status=?, require_attachments=?, deadline_date=?, publish_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [title, department, description, jobStatus, reqAttachJson, deadline, publishDate, id]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /jobs/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
}

async function deleteCompatJob(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const ctx = await resolveCompatJobsManageContext(req);
  if (!ctx.ok) {
    return res.status(ctx.status).json({ success: false, message: ctx.message });
  }
  const role = ctx.role;
  const enterpriseId = ctx.enterpriseId;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: '无效的岗位 ID' });
  }

  if (id >= COMPAT_PROJECT_AS_JOB_ID_BASE) {
    const pid = id - COMPAT_PROJECT_AS_JOB_ID_BASE;
    try {
      await ensureCompatProjectsTable();
      const [prows] = await pool.execute('SELECT * FROM compat_enterprise_projects WHERE id = ?', [pid]);
      if (!prows || !prows.length) {
        return res.status(404).json({ success: false, message: '岗位不存在' });
      }
      const prow = prows[0];
      if (role !== 'admin') {
        if (!compatProjectRowWritableByEnterpriseUser(prow, enterpriseId, req.user.id)) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      await pool.execute(
        `UPDATE compat_enterprise_projects SET status = 'closed' WHERE id = ?`,
        [pid]
      );
      return res.json({ success: true });
    } catch (e) {
      console.warn('[talentSiteCompat] DELETE /jobs/:id (announcement project):', e.message);
      return res.status(500).json({ success: false, message: e.message || '删除失败' });
    }
  }

  try {
    await ensureCompatJobsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_enterprise_jobs WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '岗位不存在' });
    }
    const row = rows[0];
    if (role !== 'admin') {
      if (!compatJobRowWritableByEnterpriseUser(row, enterpriseId, req.user.id)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }
    await pool.execute('DELETE FROM compat_enterprise_jobs WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] DELETE /jobs/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
}

/** GET /jobs/:id — 详情；人才池项目合成 id 为 500000000 + projectId */
async function getCompatJobById(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: '无效的岗位 ID' });
  }
  const role = req.user && req.user.role;
  const manage = !req.isGuest && (role === 'enterprise' || role === 'admin');

  try {
    if (id >= COMPAT_PROJECT_AS_JOB_ID_BASE) {
      const pid = id - COMPAT_PROJECT_AS_JOB_ID_BASE;
      await ensureCompatProjectsTable();
      const [rows] = await pool.execute('SELECT * FROM compat_enterprise_projects WHERE id = ?', [pid]);
      if (!rows.length) {
        return res.status(404).json({ success: false, message: '岗位不存在' });
      }
      const row = rows[0];
      if (!manage) {
        const st = String(row.status || '').trim().toLowerCase();
        if (
          ['closed', 'completed', 'offline', 'draft', 'cancelled', '已关闭', '已结束', '已下架', '草稿'].includes(
            st
          )
        ) {
          // 已从公告附加列表移除或岗位已关闭时，已报名考生仍需拉取岗位信息以修改资料/重新提交
          let allowApplicantRead = false;
          const rlow = req.user && req.user.role != null ? String(req.user.role).toLowerCase() : '';
          const isJobseekerLike = rlow === 'user' || rlow === 'candidate' || rlow === 'jobseeker';
          if (req.user && !req.isGuest && isJobseekerLike) {
            try {
              await ensureCompatCooperationApplicationsTable();
              const [ar] = await pool.execute(
                'SELECT id FROM compat_cooperation_applications WHERE user_id = ? AND project_id = ? LIMIT 1',
                [Number(req.user.id), pid]
              );
              allowApplicantRead = !!(ar && ar[0]);
            } catch (_) {
              allowApplicantRead = false;
            }
          }
          if (!allowApplicantRead) {
            return res.status(404).json({ success: false, message: '岗位不存在' });
          }
        }
      }
      const data = mapCompatProjectRowToSyntheticJob(row);
      return res.json({ success: true, data });
    }

    await ensureCompatJobsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_enterprise_jobs WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '岗位不存在' });
    }
    const row = rows[0];
    const js = String(row.job_status || '').trim().toLowerCase();
    const isPublished =
      js === 'published' ||
      ['已发布', '发布中', '进行中', '招聘中'].includes(String(row.job_status || '').trim());
    if (!isPublished && !manage) {
      return res.status(404).json({ success: false, message: '岗位不存在' });
    }
    const data = mapCompatJobRow(row);
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /jobs/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
}

router.get('/jobs', cacheMiddleware(30), optionalAuthenticate, getCompatJobs);
router.post('/jobs', authenticate, postCompatJob);
router.put('/jobs/:id', authenticate, putCompatJob);
router.delete('/jobs/:id', authenticate, deleteCompatJob);

/** 求职者 profile.html：旧版人才网路径，正式 users 在 /api/users */
let compatJobseekerResumeTableReady = false;

async function ensureCompatJobseekerResumeTable() {
  if (compatJobseekerResumeTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_jobseeker_resume (
      user_id INT PRIMARY KEY,
      payload LONGTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='求职者简历 JSON 兼容表'
  `);
  compatJobseekerResumeTableReady = true;
}

/** 阶段二优化：单次 SELECT 所有列（原先 5 次 DB → 1 次），列不存在时回退 */
async function selectQmsUserRowForProfile(userId) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, email, real_name, phone, role, education,
              gender, birth_date, location, avatar_url
       FROM qms_users WHERE id = ? LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  } catch (e) {
    // 兼容旧库缺少列：回退到基础查询
    if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    const [rows] = await pool.execute(
      'SELECT id, username, email, real_name, phone, role, education FROM qms_users WHERE id = ? LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  }
}

function mapQmsUserToProfilePayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    realName: row.real_name,
    real_name: row.real_name,
    email: row.email || '',
    phone: row.phone || '',
    gender: row.gender || null,
    birth_date: row.birth_date || null,
    birthDate: row.birth_date || null,
    location: row.location || null,
    education: row.education || null,
    avatarUrl: row.avatar_url || null
  };
}

async function getCompatUserProfile(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    const row = await selectQmsUserRowForProfile(req.user.id);
    if (!row) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const data = mapQmsUserToProfilePayload(row);
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /users/profile:', e.message);
    return res.status(500).json({ success: false, message: e.message || '加载失败' });
  }
}

async function putCompatUserProfile(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const b = req.body || {};
  const jd = b.jobseekerData || {};
  const realName = b.realName != null ? b.realName : jd.real_name;
  const phone = jd.phone != null ? jd.phone : b.phone;
  const email = b.email != null ? b.email : undefined;
  const gender = jd.gender != null ? jd.gender : b.gender;
  const birth_date = jd.birth_date != null ? jd.birth_date : b.birthDate;
  const location = jd.location != null ? jd.location : b.location;
  const education = jd.education != null ? jd.education : b.education;
  const username = b.username !== undefined ? b.username : undefined;

  /** 按列更新：某一列在库里不存在时跳过，避免「一条 SQL 含不存在列」导致整次保存失败、性别与城市落库失败 */
  const allowedCols = new Set([
    'real_name',
    'phone',
    'email',
    'gender',
    'birth_date',
    'location',
    'education',
    'username'
  ]);
  const pairs = [];
  if (realName !== undefined && realName !== null) pairs.push(['real_name', realName]);
  if (phone !== undefined && phone !== null) pairs.push(['phone', phone]);
  if (email !== undefined && email !== null) pairs.push(['email', email]);
  if (gender !== undefined && gender !== null && String(gender).trim() !== '') pairs.push(['gender', String(gender).trim()]);
  if (birth_date !== undefined && birth_date !== null && String(birth_date).trim() !== '') {
    pairs.push(['birth_date', String(birth_date).slice(0, 10)]);
  }
  if (location !== undefined && location !== null) pairs.push(['location', String(location)]);
  if (education !== undefined && education !== null) pairs.push(['education', education]);
  if (username !== undefined && username !== null && String(username).trim() !== '') {
    pairs.push(['username', String(username).trim()]);
  }

  if (!pairs.length) {
    return res.json({ success: true });
  }

  // 阶段二优化：逐字段 UPDATE → 单条 UPDATE（7 次 DB 往返 → 1 次）
  const setClauses = pairs.map(([col]) => `\`${col}\` = ?`).join(', ');
  const values = pairs.map(([, val]) => val);
  values.push(req.user.id);
  try {
    await pool.execute(
      `UPDATE qms_users SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
      values
    );
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      console.warn('[talentSiteCompat] PUT /users/profile 字段不存在，回退逐列更新');
      for (const [col, val] of pairs) {
        try { await pool.execute(`UPDATE qms_users SET \`${col}\` = ? WHERE id = ?`, [val, req.user.id]); }
        catch (e2) { if (e2.code !== 'ER_BAD_FIELD_ERROR') throw e2; }
      }
    } else {
      console.warn('[talentSiteCompat] PUT /users/profile:', e.message);
      return res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
  return res.json({ success: true });
}

async function postCompatUserAvatar(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  return res.json({ success: true, message: '兼容层未持久化头像文件', data: {} });
}

async function getCompatUserResume(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    await ensureCompatJobseekerResumeTable();
    const [rows] = await pool.execute(
      'SELECT payload FROM compat_jobseeker_resume WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    if (!rows.length || !rows[0].payload) {
      return res.json({ success: true, data: null });
    }
    let data;
    try {
      data = JSON.parse(rows[0].payload);
    } catch (_) {
      data = null;
    }
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /users/resume:', e.message);
    return res.json({ success: true, data: null });
  }
}

async function putCompatUserResume(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    await ensureCompatJobseekerResumeTable();
    const incoming = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    let existing = {};
    try {
      const [rows] = await pool.execute(
        'SELECT payload FROM compat_jobseeker_resume WHERE user_id = ? LIMIT 1',
        [req.user.id]
      );
      if (rows[0] && rows[0].payload) {
        const prev = JSON.parse(rows[0].payload);
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) existing = prev;
      }
    } catch (_) {
      existing = {};
    }
    const merged = { ...existing, ...incoming };
    const payload = JSON.stringify(merged);
    await pool.execute(
      `INSERT INTO compat_jobseeker_resume (user_id, payload) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, payload]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /users/resume:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
}

async function postCompatResumeGenerate(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const b = req.body || {};
  let tid = b.templateId != null ? Number(b.templateId) : 0;
  const noTemplateHtml =
    '<div class="resume-placeholder p-6 text-gray-700"><p>未找到启用的简历模板。请在管理端「简历模板」中添加并启用模板后重试。</p></div>';
  try {
    await ensureCompatTemplateTables();
    await seedDefaultResumeTemplatesIfEmpty();
    let rows;
    if (tid && Number.isFinite(tid) && tid > 0) {
      [rows] = await pool.execute(
        `SELECT * FROM compat_resume_templates WHERE id = ? AND status = 1 LIMIT 1`,
        [tid]
      );
    }
    if (!rows || !rows[0]) {
      [rows] = await pool.execute(
        `SELECT * FROM compat_resume_templates WHERE status = 1 ORDER BY sort_order ASC, id ASC LIMIT 1`
      );
    }
    const r = rows && rows[0];
    if (!r) {
      return res.json({
        success: true,
        data: {
          templateId: tid || 0,
          templateName: '简历',
          categoryName: '通用',
          content: noTemplateHtml
        }
      });
    }
    const raw = r.content != null ? String(r.content).trim() : '';
    const html =
      raw ||
      '<div class="resume-placeholder p-6 text-gray-700"><p>该模板尚未填写 HTML 内容，请在管理端「简历模板」中编辑保存。</p></div>';
    return res.json({
      success: true,
      data: {
        templateId: r.id,
        templateName: r.name || '简历',
        categoryName: resumeCategoryZh(r.category) || '通用',
        content: html
      }
    });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /users/resume/generate:', e.message || e);
    return res.status(500).json({ success: false, message: e.message || '生成失败' });
  }
}

/** 兼容英文状态与中文界面状态，避免分支匹配不到导致通知永远为空 */
function normalizeCooperationStatus(raw) {
  const zh = String(raw != null ? raw : '').trim();
  if (zh === '待审核' || zh === '待处理') return 'pending';
  if (zh === '已通过') return 'approved';
  if (zh === '已拒绝' || zh === '审核不通过') return 'rejected';
  if (zh === '测评中') return 'testing';
  if (zh === '已完成') return 'completed';
  if (zh === '已撤回') return 'withdrawn';
  const s = zh.toLowerCase();
  if (['pending', 'approved', 'rejected', 'testing', 'completed', 'withdrawn'].includes(s)) return s;
  return 'pending';
}

// 阶段二优化：消息列表服务端 30s 缓存（与前端轮询频率匹配，LRU 上限 5000 防泄漏）
const notificationListCache = new Map();
const NOTIF_CACHE_TTL = 30 * 1000;
const NOTIF_CACHE_MAX = 5000;
function notifCacheSet(key, value) {
  if (notificationListCache.size >= NOTIF_CACHE_MAX) {
    const first = notificationListCache.keys().next().value;
    notificationListCache.delete(first);
  }
  notificationListCache.set(key, value);
}

async function getCompatNotifications(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const userId = Number(req.user.id);

  // 阶段二优化：30s 缓存（前端每 30s 轮询一次，缓存命中率 >90%）
  const cacheKey = `notif:${userId}`;
  const cached = notificationListCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < NOTIF_CACHE_TTL) {
    res.set('X-Cache', 'HIT');
    return res.json(cached.data);
  }

  let mergedUserIds = [userId];
  try {
    const merged = await UserModel.getAllIdsWithSamePhoneAsUser(userId);
    if (merged && merged.length) mergedUserIds = merged;
  } catch (_) {
    /* ignore */
  }
  mergedUserIds = [...new Set(mergedUserIds.filter((n) => Number.isFinite(n) && n > 0))];
  const uidPh = mergedUserIds.map(() => '?').join(',');
  const list = [];
  try {
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute(
      `SELECT a.id, a.status, a.created_at, a.updated_at, a.project_id, a.announcement_id, a.extra_json,
              a.compat_notification_read_at,
              p.name AS project_name,
              COALESCE(a.enterprise_id, p.enterprise_id, an.enterprise_id) AS resolved_enterprise_id
       FROM compat_cooperation_applications a
       LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
       LEFT JOIN compat_announcements an ON an.id = a.announcement_id
       WHERE a.user_id IN (${uidPh})
       ORDER BY COALESCE(a.updated_at, a.created_at) DESC
       LIMIT 100`,
      mergedUserIds
    );
    const feeEids = [
      ...new Set(
        (rows || [])
          .map((r) => r.resolved_enterprise_id)
          .filter((id) => id != null && id !== '')
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ];
    const feeMap = await loadAssessmentFeeSettingsMap(feeEids);
    // 阶段二优化：批量预加载公告标题（WHERE IN 批量查询，消除 N+1）
    const annIds = [...new Set((rows || []).map((r) => r.announcement_id).filter(Boolean))];
    const annTitleMap = new Map();
    if (annIds.length > 0) {
      try {
        await ensureCompatAnnouncementsTable();
        const ph2 = annIds.map(() => '?').join(',');
        const [annRows] = await pool.execute(
          `SELECT id, title FROM compat_announcements WHERE id IN (${ph2})`,
          annIds
        );
        for (const ar of annRows || []) {
          annTitleMap.set(ar.id, ar.title || '招聘公告');
        }
      } catch (_) { /* ignore */ }
    }
    async function announcementTitle(aid) {
      if (aid == null) return '招聘公告';
      return annTitleMap.get(aid) || '招聘公告';
    }
    const baseId = 1000000;
    for (let i = 0; i < (rows || []).length; i++) {
      const r = rows[i];
      const st = normalizeCooperationStatus(r.status);
      const jobName = r.project_name || `岗位#${r.project_id}`;
      const ann = await announcementTitle(r.announcement_id);
      const t = r.updated_at || r.created_at;
      const createTime = t ? new Date(t).toISOString() : new Date().toISOString();
      const nid = baseId + Number(r.id);
      // 审核通过不在消息中心推送；准考证在企业完成分配/设计后由 compat_admit_print_notifications 推送
      if (st === 'approved') {
        /* 不在此处生成 application_approved 通知 */
      } else if (st === 'rejected') {
        let extraRj = {};
        try {
          extraRj = r.extra_json ? JSON.parse(r.extra_json) : {};
        } catch (_) {
          extraRj = {};
        }
        const afRj = extraRj.assessmentFee && typeof extraRj.assessmentFee === 'object' ? extraRj.assessmentFee : {};
        const raRj = extraRj.reviewAudit && typeof extraRj.reviewAudit === 'object' ? extraRj.reviewAudit : {};
        const rr =
          raRj.returnReason != null && String(raRj.returnReason).trim() !== ''
            ? String(raRj.returnReason).trim()
            : '';
        const refunded = !!afRj.refunded;
        list.push({
          id: nid,
          type: refunded ? 'assessment_fee_refunded' : 'application_rejected',
          title: refunded ? '测评费已退费' : '报名未通过',
          content: refunded
            ? `您在「${ann}」报名的「${jobName}」测评费已处理完毕，可按新报名重新提交。${rr ? '说明：' + rr : ''}`
            : `您在「${ann}」报名的「${jobName}」未通过审核。${rr ? '原因：' + rr : ''}`,
          createTime: r.updated_at ? new Date(r.updated_at).toISOString() : createTime,
          isRead: !!r.compat_notification_read_at,
          jobId: r.project_id,
          jobName,
          companyName: ann,
          announcementId: r.announcement_id != null ? Number(r.announcement_id) : null,
          cooperationApplicationId: Number(r.id),
          returnReason: rr || undefined
        });
      } else if (st === 'withdrawn') {
        list.push({
          id: nid,
          type: 'notice',
          title: '报名已撤回',
          content: `您已撤回「${ann}」下的「${jobName}」报名。`,
          createTime,
          isRead: true,
          jobId: r.project_id,
          jobName,
          companyName: ann,
          announcementId: r.announcement_id != null ? Number(r.announcement_id) : null,
          cooperationApplicationId: Number(r.id)
        });
      } else if (st === 'pending' || st === 'testing' || st === 'completed') {
        let extraP = {};
        try {
          extraP = r.extra_json ? JSON.parse(r.extra_json) : {};
        } catch (_) {
          extraP = {};
        }
        const raP = extraP.reviewAudit && typeof extraP.reviewAudit === 'object' ? extraP.reviewAudit : {};
        const returnReason =
          raP.returnReason != null && String(raP.returnReason).trim() !== ''
            ? String(raP.returnReason).trim()
            : '';
        if (st === 'pending' && returnReason) {
          list.push({
            id: nid,
            type: 'application_returned',
            title: '报名表退回修改',
            content: `「${ann}」-「${jobName}」需修改后重新提交。原因：${returnReason}`,
            createTime: r.updated_at ? new Date(r.updated_at).toISOString() : createTime,
            isRead: !!r.compat_notification_read_at,
            jobId: r.project_id,
            jobName,
            companyName: ann,
            announcementId: r.announcement_id != null ? Number(r.announcement_id) : null,
            cooperationApplicationId: Number(r.id),
            returnReason
          });
        } else {
          list.push({
            id: nid,
            type: 'notice',
            title: st === 'pending' ? '报名已提交' : '报名状态更新',
            content:
              st === 'pending'
                ? `您已提交「${ann}」下的「${jobName}」报名，请等待企业审核。`
                : `「${ann}」-「${jobName}」状态：${st}`,
            createTime: r.created_at ? new Date(r.created_at).toISOString() : createTime,
            isRead: st !== 'pending',
            jobId: r.project_id,
            jobName,
            companyName: ann,
            announcementId: r.announcement_id != null ? Number(r.announcement_id) : null,
            cooperationApplicationId: Number(r.id)
          });
        }
      } else {
        list.push({
          id: nid,
          type: 'notice',
          title: '报名通知',
          content: `「${ann}」-「${jobName}」状态：${String(r.status || '').trim() || st}`,
          createTime: r.created_at ? new Date(r.created_at).toISOString() : createTime,
          isRead: true,
          jobId: r.project_id,
          jobName,
          companyName: ann,
          announcementId: r.announcement_id != null ? Number(r.announcement_id) : null,
          cooperationApplicationId: Number(r.id)
        });
      }
    }
  } catch (e) {
    console.warn('[talentSiteCompat] GET /notifications:', e.message);
  }
  // 笔试/专业测评：企业首次「发布」考试时写入的邀请（exams 路由 INSERT exam_invitation_notifications）
  // 与上方报名通知同源不同表；此前未合并，求职者「消息」里只有审核通过、看不到笔试发布。
  try {
    const [examNotifs] = await pool.execute(
      `SELECT n.id, n.exam_id, n.exam_name, n.created_at, n.read_at
       FROM exam_invitation_notifications n
       WHERE n.user_id IN (${uidPh})
       ORDER BY n.created_at DESC
       LIMIT 50`,
      mergedUserIds
    );
    const examNidBase = 5000000;
    for (const n of examNotifs || []) {
      const ename =
        n.exam_name != null && String(n.exam_name).trim() !== '' ? String(n.exam_name).trim() : '专业测评';
      const createTime = n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString();
      list.push({
        id: examNidBase + Number(n.id),
        type: 'exam_invitation',
        title: '专业测评（笔试）已发布',
        content: `企业已发布考试「${ename}」。请从左侧进入「专业测评」查看；考生端请使用与报名时一致的手机号登录。`,
        createTime,
        isRead: !!n.read_at,
        jobName: ename,
        companyName: '考试系统',
        examId: n.exam_id != null ? Number(n.exam_id) : null
      });
    }
  } catch (e) {
    if (e && e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('[talentSiteCompat] exam_invitation_notifications merge:', e.message);
    }
  }
  // 企业端考试分配/准考证已生成后写入 compat_admit_print_notifications
  try {
    await ensureCompatAdmitPrintNotificationsTable();
    const [admitN] = await pool.execute(
      `SELECT id, batch_id, batch_name, title, content, payload_json, read_at, created_at
       FROM compat_admit_print_notifications
       WHERE user_id IN (${uidPh})
       ORDER BY created_at DESC
       LIMIT 30`,
      mergedUserIds
    );
    const admitNidBase = 8000000;
    for (const n of admitN || []) {
      const createTime = n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString();
      let admitCardData = null;
      if (n.payload_json) {
        try {
          admitCardData = JSON.parse(n.payload_json);
        } catch (_) {
          admitCardData = null;
        }
      }
      const row = {
        id: admitNidBase + Number(n.id),
        type: admitCardData && admitCardData.admitCardNumber ? 'admit_card' : 'admit_print_ready',
        title: n.title && String(n.title).trim() ? String(n.title).trim() : '打印准考证/考场已安排',
        content: n.content && String(n.content).trim() ? String(n.content).trim() : '已生成准考证，请进入个人中心查看。',
        createTime,
        isRead: !!n.read_at,
        companyName: '圣举人才',
        jobName: n.batch_name && String(n.batch_name).trim() ? String(n.batch_name).trim() : n.batch_id || '考试批次',
        batchId: n.batch_id
      };
      if (admitCardData) row.admitCardData = admitCardData;
      list.push(row);
    }
  } catch (e) {
    if (e && e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('[talentSiteCompat] compat_admit_print_notifications merge:', e.message);
    }
  }
  // 企业推送的测评成绩通知（与列表最终成绩同源）
  try {
    await ensureCompatExamScoreNotificationsTable();
    const [scoreN] = await pool.execute(
      `SELECT id, enterprise_id, exam_id, session_id, title, content, payload_json, read_at, created_at
       FROM compat_exam_score_notifications
       WHERE user_id IN (${uidPh})
       ORDER BY created_at DESC
       LIMIT 80`,
      mergedUserIds
    );
    const scoreNidBase = 9000000;
    for (const n of scoreN || []) {
      const createTime = n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString();
      let payload = null;
      try {
        payload = n.payload_json ? JSON.parse(n.payload_json) : null;
      } catch (_) {
        payload = null;
      }
      list.push({
        id: scoreNidBase + Number(n.id),
        type: 'exam_score_released',
        title: n.title && String(n.title).trim() ? String(n.title).trim() : '测评成绩已发布',
        content: n.content && String(n.content).trim() ? String(n.content).trim() : '您的测评成绩已发布，请查看详情。',
        createTime,
        isRead: !!n.read_at,
        companyName: '圣举人才',
        examId: n.exam_id != null ? Number(n.exam_id) : null,
        sessionId: n.session_id != null ? Number(n.session_id) : null,
        enterpriseId: n.enterprise_id != null ? Number(n.enterprise_id) : null,
        payload
      });
    }
  } catch (e) {
    if (e && e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('[talentSiteCompat] compat_exam_score_notifications merge:', e.message);
    }
  }
  list.sort((a, b) => {
    const ta = new Date(a.createTime || 0).getTime();
    const tb = new Date(b.createTime || 0).getTime();
    return tb - ta;
  });
  const result = { success: true, data: list };
  // 阶段二优化：缓存 30s
  notifCacheSet(cacheKey, { data: result, ts: Date.now() });
  return res.json(result);
}

async function putCompatNotificationsReadAll(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const userId = Number(req.user.id);
  const safeRun = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      if (e && e.code !== 'ER_NO_SUCH_TABLE') {
        console.warn(`[talentSiteCompat] PUT /notifications/read-all (${label}):`, e.message || e);
      }
    }
  };
  await safeRun('exam_invitation_notifications', async () => {
    await pool.execute(
      'UPDATE exam_invitation_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [userId]
    );
  });
  await safeRun('compat_admit_print_notifications', async () => {
    await ensureCompatAdmitPrintNotificationsTable();
    await pool.execute(
      'UPDATE compat_admit_print_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [userId]
    );
  });
  await safeRun('compat_exam_score_notifications', async () => {
    await ensureCompatExamScoreNotificationsTable();
    await pool.execute(
      'UPDATE compat_exam_score_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [userId]
    );
  });
  await safeRun('compat_cooperation_applications', async () => {
    await ensureCompatCooperationApplicationsTable();
    await pool.execute(
      'UPDATE compat_cooperation_applications SET compat_notification_read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND compat_notification_read_at IS NULL',
      [userId]
    );
  });
  return res.json({ success: true });
}

async function putCompatNotificationRead(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const userId = Number(req.user.id);
  const fullId = parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(fullId) || fullId <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  const safeRun = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e && e.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('[talentSiteCompat] PUT /notifications/:id/read:', e.message || e);
      }
      return null;
    }
  };
  try {
    if (fullId >= 9000000) {
      await ensureCompatExamScoreNotificationsTable();
      const sid = fullId - 9000000;
      await safeRun(() =>
        pool.execute(
          'UPDATE compat_exam_score_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
          [sid, userId]
        )
      );
    } else if (fullId >= 8000000) {
      await ensureCompatAdmitPrintNotificationsTable();
      const sid = fullId - 8000000;
      await safeRun(() =>
        pool.execute(
          'UPDATE compat_admit_print_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
          [sid, userId]
        )
      );
    } else if (fullId >= 5000000) {
      const sid = fullId - 5000000;
      const exTuple = await safeRun(() =>
        pool.execute(
          'UPDATE exam_invitation_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
          [sid, userId]
        )
      );
      const exHeader = exTuple && exTuple[0];
      const affected = exHeader && typeof exHeader.affectedRows === 'number' ? exHeader.affectedRows : 0;
      if (!affected) {
        await ensureCompatCooperationApplicationsTable();
        const coopId = fullId - 1000000;
        await safeRun(() =>
          pool.execute(
            'UPDATE compat_cooperation_applications SET compat_notification_read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
            [coopId, userId]
          )
        );
      }
    } else if (fullId >= 1000000) {
      await ensureCompatCooperationApplicationsTable();
      const coopId = fullId - 1000000;
      await safeRun(() =>
        pool.execute(
          'UPDATE compat_cooperation_applications SET compat_notification_read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
          [coopId, userId]
        )
      );
    }
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /notifications/:id/read outer:', e.message || e);
  }
  return res.json({ success: true });
}

async function getCompatJobApplicationsMy(req, res) {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const wantFullExtraJson =
    String((req.query && req.query.full) || '') === '1' ||
    String((req.query && req.query.extraJson) || '').toLowerCase() === 'full';
  const userId = Number(req.user.id);
  try {
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute(
      `SELECT a.id, a.status, a.created_at, a.project_id, a.announcement_id, a.extra_json,
              p.name AS project_name,
              COALESCE(a.enterprise_id, p.enterprise_id, an.enterprise_id) AS resolved_enterprise_id
       FROM compat_cooperation_applications a
       LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
       LEFT JOIN compat_announcements an ON an.id = a.announcement_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [userId]
    );
    const feeEids = [
      ...new Set(
        (rows || [])
          .map((r) => r.resolved_enterprise_id)
          .filter((id) => id != null && id !== '')
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ];
    const feeMap = await loadAssessmentFeeSettingsMap(feeEids);
    const pubQr = await getPublicPaymentQrcodeUrlsForJobseeker();
    const annIds = [
      ...new Set(
        (rows || [])
          .map((r) => r.announcement_id)
          .filter((id) => id != null && id !== '')
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ];
    const annTitleMap = new Map();
    if (annIds.length > 0) {
      try {
        const ph = annIds.map(() => '?').join(',');
        const [arows] = await pool.execute(`SELECT id, title FROM compat_announcements WHERE id IN (${ph})`, annIds);
        for (const ar of arows || []) {
          annTitleMap.set(Number(ar.id), ar.title != null ? String(ar.title) : '');
        }
      } catch (eAnn) {
        console.warn('[talentSiteCompat] GET /jobs/applications/my batch ann titles:', eAnn.message);
      }
    }
    const data = [];
    for (const r of rows || []) {
      const companyName =
        r.announcement_id != null && annTitleMap.has(Number(r.announcement_id))
          ? annTitleMap.get(Number(r.announcement_id))
          : '';
      const eid =
        r.resolved_enterprise_id != null && r.resolved_enterprise_id !== ''
          ? Number(r.resolved_enterprise_id)
          : null;
      const feeRow = eid && feeMap.has(eid) ? feeMap.get(eid) : null;
      let extra = {};
      try {
        extra = r.extra_json ? JSON.parse(r.extra_json) : {};
      } catch (_) {
        extra = {};
      }
      const af = extra.assessmentFee || {};
      const paid = !!af.paid;
      const st = normalizeCooperationStatus(r.status);
      const feeOn = feeRow && Number(feeRow.enabled) === 1;
      const requiresAssessmentFee =
        feeOn && st === 'approved' && !paid && isInAssessmentFeePayWindow(feeRow.pay_start_at, feeRow.pay_end_at);
      const ra = extra.reviewAudit && typeof extra.reviewAudit === 'object' ? extra.reviewAudit : {};
      data.push({
        cooperationApplicationId: Number(r.id),
        announcementId: r.announcement_id != null ? Number(r.announcement_id) : null,
        jobId: Number(r.project_id),
        jobName: r.project_name || `岗位#${r.project_id}`,
        companyName,
        applyDate: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
        status: st,
        returnReason: ra.returnReason != null && String(ra.returnReason).trim() !== '' ? String(ra.returnReason) : null,
        _source: 'announcement',
        extraJson: wantFullExtraJson ? extra : slimExtraJsonForCandidateListResponse(extra),
        assessmentFeePaid: paid,
        assessmentFeePaidAt: af.paidAt || null,
        requiresAssessmentFee,
        assessmentFeeAmount: feeOn && feeRow.amount_yuan != null ? Number(feeRow.amount_yuan) : null,
        assessmentFeePayStart: feeOn ? toIsoDateTimeMaybe(feeRow.pay_start_at) : null,
        assessmentFeePayEnd: feeOn ? toIsoDateTimeMaybe(feeRow.pay_end_at) : null,
        assessmentFeeRefunded: !!af.refunded,
        assessmentFeeRefundRequested: !!af.refundRequested,
        assessmentFeeRefundRequestAt: af.refundRequestAt || null,
        assessmentFeeRefundRequestReason: af.refundRequestReason || null,
        wechatQrcodeUrl: requiresAssessmentFee ? pubQr.wechatQrcodeUrl : '',
        alipayQrcodeUrl: requiresAssessmentFee ? pubQr.alipayQrcodeUrl : ''
      });
    }
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /jobs/applications/my:', e.message);
    return res.json({ success: true, data: [] });
  }
}

/** 从公告 extra_json 解析考生端顶栏/页脚配置（与政企端「考生顶栏」保存结构一致） */
function buildCandidateNavBrandingApiPayload(extra) {
  const ex = extra && typeof extra === 'object' ? extra : {};
  const b = ex.candidateNavBranding || {};
  const title = (b.title || '').trim();
  const logo = (b.logo || '').trim();
  const navUserName = (b.navUserName || '').trim();
  const navUserAvatar = (b.navUserAvatar || '').trim();
  const navKeys = [
    'index',
    'assessment',
    'recommendation',
    'announcements',
    'talentPool',
    'payment',
    'profile'
  ];
  const navDefaults = Object.fromEntries(navKeys.map((k) => [k, true]));
  const navItems = { ...navDefaults };
  if (b.navItems && typeof b.navItems === 'object') {
    navKeys.forEach((k) => {
      if (typeof b.navItems[k] === 'boolean') navItems[k] = b.navItems[k];
    });
  }
  const hasNavHide = navKeys.some((k) => navItems[k] === false);
  const showFooter = b.showFooter !== false;
  const footerKeys = ['about', 'jobseeker', 'help', 'contact', 'copyright'];
  const footerDefaults = Object.fromEntries(footerKeys.map((k) => [k, true]));
  const footerItems = { ...footerDefaults };
  if (b.footerItems && typeof b.footerItems === 'object') {
    footerKeys.forEach((k) => {
      if (typeof b.footerItems[k] === 'boolean') footerItems[k] = b.footerItems[k];
    });
  }
  const hasFooterHide = b.showFooter === false || footerKeys.some((k) => footerItems[k] === false);
  const publisherLabel = (b.publisherLabel || '').trim();
  const onlyShowThisAnnouncement = b.onlyShowThisAnnouncement === true;
  const admitCardTemplate =
    b.admitCardTemplate === 'interview_official' ? 'interview_official' : 'standard';
  const hasAny =
    !!title ||
    !!logo ||
    !!navUserName ||
    !!navUserAvatar ||
    hasNavHide ||
    hasFooterHide ||
    !!publisherLabel ||
    onlyShowThisAnnouncement ||
    admitCardTemplate === 'interview_official';
  if (!hasAny) return null;
  return {
    title: title || null,
    logo: logo || null,
    navItems,
    navUserName: navUserName || null,
    navUserAvatar: navUserAvatar || null,
    showFooter,
    footerItems,
    publisherLabel: publisherLabel || null,
    onlyShowThisAnnouncement,
    admitCardTemplate
  };
}

/**
 * 公开：按公告 ID 返回该企业为该公告配置的考生顶栏/页脚（无需登录，仅对已上架且可见的公告）
 */
async function getPublicAnnouncementNavbarBranding(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: '无效的公告 ID' });
  }
  try {
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute(
      'SELECT id, status, expiry_date, publish_date, extra_json FROM compat_announcements WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '公告不存在' });
    }
    const row = rows[0];
    if (!isAnnouncementPubliclyVisible(row)) {
      return res.status(404).json({ success: false, message: '公告不存在或已下架' });
    }
    let extra = {};
    try {
      const raw = row.extra_json;
      extra = raw && typeof raw === 'object' ? raw : JSON.parse(String(raw || '{}'));
    } catch (_) {
      extra = {};
    }
    const payload = buildCandidateNavBrandingApiPayload(extra);
    if (payload) payload.announcementId = id;
    return res.json({ success: true, data: payload });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /announcements/:id/navbar-branding:', e.message);
    return res.json({ success: true, data: null });
  }
}

/**
 * 求职者顶栏品牌：仅当存在公告报名（compat_cooperation_applications.announcement_id 非空）时，
 * 返回该公告 extraJson.candidateNavBranding。纯岗位推荐报名无 announcement_id，返回 null → 使用全站默认。
 */
async function getCompatAnnouncementNavbarBranding(req, res) {
  if (req.isGuest || !req.user) {
    return res.json({ success: true, data: null });
  }
  const portal = req.loginPortal || 'jobseeker';
  if (portal === 'enterprise' || portal === 'grader') {
    return res.json({ success: true, data: null });
  }
  const role = String(req.user.role || '').toLowerCase();
  if (role === 'enterprise' || role === 'admin') {
    return res.json({ success: true, data: null });
  }
  let userIds = [Number(req.user.id)];
  try {
    const merged = await UserModel.getAllIdsWithSamePhoneAsUser(req.user.id);
    if (merged && merged.length) userIds = merged;
  } catch (_) {
    /* ignore */
  }
  userIds = [...new Set(userIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (!userIds.length) {
    return res.json({ success: true, data: null });
  }
  const preferAnnId = parseInt(String(req.query.announcementId || '').trim(), 10);
  try {
    await ensureCompatCooperationApplicationsTable();
    await ensureCompatAnnouncementsTable();
    const uidPh = userIds.map(() => '?').join(',');
    let rows;
    if (Number.isFinite(preferAnnId) && preferAnnId > 0) {
      [rows] = await pool.execute(
        `SELECT an.id AS announcement_id, an.extra_json AS announcement_extra
         FROM compat_cooperation_applications a
         INNER JOIN compat_announcements an ON an.id = a.announcement_id
         WHERE a.user_id IN (${uidPh}) AND a.announcement_id = ?
         ORDER BY COALESCE(a.updated_at, a.created_at) DESC
         LIMIT 1`,
        [...userIds, preferAnnId]
      );
    }
    if (!rows || !rows.length) {
      [rows] = await pool.execute(
        `SELECT an.id AS announcement_id, an.extra_json AS announcement_extra
         FROM compat_cooperation_applications a
         INNER JOIN compat_announcements an ON an.id = a.announcement_id
         WHERE a.user_id IN (${uidPh}) AND a.announcement_id IS NOT NULL
         ORDER BY COALESCE(a.updated_at, a.created_at) DESC
         LIMIT 1`,
        userIds
      );
    }
    if (!rows || !rows.length) {
      return res.json({ success: true, data: null });
    }
    const rawEx = rows[0].announcement_extra;
    let extra = {};
    try {
      extra = rawEx && typeof rawEx === 'object' ? rawEx : JSON.parse(String(rawEx || '{}'));
    } catch (_) {
      extra = {};
    }
    const payload = buildCandidateNavBrandingApiPayload(extra);
    if (payload && rows[0].announcement_id != null) {
      payload.announcementId = Number(rows[0].announcement_id);
    }
    return res.json({ success: true, data: payload });
  } catch (e) {
    console.warn('[talentSiteCompat] GET announcement-navbar-branding:', e.message);
    return res.json({ success: true, data: null });
  }
}

router.get('/users/announcement-navbar-branding', optionalAuthenticate, getCompatAnnouncementNavbarBranding);
router.get('/users/profile', authenticate, getCompatUserProfile);
router.put('/users/profile', authenticate, putCompatUserProfile);
router.post('/users/avatar', authenticate, postCompatUserAvatar);
router.get('/users/resume', authenticate, getCompatUserResume);
router.put('/users/resume', authenticate, putCompatUserResume);
router.post('/users/resume/generate', authenticate, postCompatResumeGenerate);

// ===== 模板公开接口（求职者端 / 企业端展示用）=====
let compatTemplateTablesReady = false;
async function ensureCompatTemplateTables() {
  if (compatTemplateTablesReady) return;
  // 与 adminCompat.js 中的表保持一致；不存在时创建，避免返回空导致“模板不显示”
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_report_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      platform VARCHAR(50) NOT NULL DEFAULT 'enterprise',
      type VARCHAR(50) NOT NULL DEFAULT 'development',
      industry VARCHAR(100) DEFAULT '',
      description TEXT NULL,
      content MEDIUMTEXT NULL,
      fields LONGTEXT NULL,
      charts LONGTEXT NULL,
      status TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_platform (platform),
      INDEX idx_type (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 管理端报告模板'
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_resume_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      content MEDIUMTEXT NULL,
      status TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 管理端简历模板'
  `);
  try {
    await pool.execute(
      `ALTER TABLE compat_resume_templates ADD COLUMN category VARCHAR(50) NULL COMMENT 'modern|professional|executive' AFTER description`
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!/Duplicate column/i.test(msg) && !/ER_DUP_FIELDNAME/i.test(msg)) {
      console.warn('[talentSiteCompat] ALTER compat_resume_templates.category:', msg);
    }
  }
  compatTemplateTablesReady = true;
}

function resumeCategoryZh(cat) {
  const m = { modern: '现代简约', professional: '专业商务', executive: '高管精英' };
  const k = String(cat || '').toLowerCase();
  return m[k] || '';
}

const RESUME_TEMPLATE_STUB_HTML =
  '<div class="resume-placeholder p-6 text-gray-700"><p>默认模板占位，可在管理端「简历模板」中编辑完整内容。</p></div>';

async function seedDefaultResumeTemplatesIfEmpty() {
  try {
    const [rows] = await pool.execute(`SELECT COUNT(*) AS c FROM compat_resume_templates`);
    const c = rows && rows[0] ? Number(rows[0].c) : 0;
    if (c > 0) return;
    const defaults = [
      ['现代简约', 'modern', RESUME_TEMPLATE_STUB_HTML, 1, 1],
      ['专业商务', 'professional', RESUME_TEMPLATE_STUB_HTML, 1, 2],
      ['高管精英', 'executive', RESUME_TEMPLATE_STUB_HTML, 1, 3]
    ];
    for (let i = 0; i < defaults.length; i++) {
      const row = defaults[i];
      await pool.execute(
        `INSERT INTO compat_resume_templates (name, description, content, status, sort_order, category) VALUES (?, ?, ?, ?, ?, ?)`,
        [row[0], '', row[2], row[3], row[4], row[1]]
      );
    }
  } catch (e) {
    console.warn('[talentSiteCompat] seedDefaultResumeTemplatesIfEmpty:', e.message || e);
  }
}

function parseJsonArray(val) {
  if (!val) return [];
  try {
    const j = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(j) ? j : [];
  } catch (_) {
    return [];
  }
}

// 求职者端：仅显示“启用”的简历模板
router.get('/resume-templates', async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    await seedDefaultResumeTemplatesIfEmpty();
    const [rows] = await pool.execute(
      `SELECT * FROM compat_resume_templates WHERE status = 1 ORDER BY sort_order ASC, id DESC`
    );
    const data = (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      content: r.content || '',
      status: Number(r.status) ? 1 : 0,
      sortOrder: r.sort_order || 0,
      category: r.category || '',
      categoryName: resumeCategoryZh(r.category) || '通用',
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /resume-templates:', e.message);
    res.json({ success: true, data: [] });
  }
});

/** enterprise/company-center.html / 求职者端 可能展示报告模板：仅返回启用模板；若需按端区分，可用 platform 过滤 */
router.get('/report-templates', async (req, res) => {
  try {
    await ensureCompatTemplateTables();
    const platform = String(req.query.platform || '').trim().toLowerCase();
    const allowPlatformFilter = platform === 'enterprise' || platform === 'jobseeker' || platform === 'candidate';
    const params = [];
    let where = 'WHERE status = 1';
    if (allowPlatformFilter) {
      where += ' AND LOWER(platform) = ?';
      params.push(platform === 'candidate' ? 'jobseeker' : platform);
    }
    const [rows] = await pool.execute(
      `SELECT * FROM compat_report_templates ${where} ORDER BY sort_order ASC, id DESC`,
      params
    );
    const data = (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      type: r.type,
      industry: r.industry || '',
      description: r.description || '',
      content: r.content || '',
      fields: parseJsonArray(r.fields),
      charts: parseJsonArray(r.charts),
      status: Number(r.status) ? 1 : 0,
      sortOrder: r.sort_order || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /report-templates:', e.message);
    res.json({ success: true, data: [] });
  }
});

router.get('/notifications', authenticate, getCompatNotifications);
router.put('/notifications/read-all', authenticate, putCompatNotificationsReadAll);
router.put('/notifications/:id/read', authenticate, putCompatNotificationRead);
router.get('/jobs/applications/my', authenticate, getCompatJobApplicationsMy);
router.get('/jobs/:id', cacheMiddleware(60), optionalAuthenticate, getCompatJobById);

let compatAnnouncementsTableReady = false;

async function ensureCompatAnnouncementsTable() {
  if (compatAnnouncementsTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enterprise_id INT NULL,
      user_id INT NULL,
      title VARCHAR(500) NOT NULL,
      content MEDIUMTEXT NULL,
      category VARCHAR(200) NULL,
      source VARCHAR(100) NULL,
      publish_date DATE NULL,
      expiry_date DATE NULL,
      status VARCHAR(50) DEFAULT 'published',
      views INT DEFAULT 0,
      extra_json LONGTEXT NULL,
      attached_project_ids LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ent (enterprise_id),
      INDEX idx_expiry (expiry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='legacy 政企公告兼容表'
  `);
  compatAnnouncementsTableReady = true;
}

function normalizeAnnouncementStatusInput(s) {
  if (s == null || s === '') return 'published';
  const x = String(s).trim();
  if (x === '发布中' || x === 'published') return 'published';
  if (x === '已下架' || x === 'offline') return 'offline';
  if (x === '已过期' || x === 'expired') return 'expired';
  return 'published';
}

function effectiveAnnouncementApiStatus(row) {
  const raw = String(row.status != null ? row.status : 'published').trim();
  const st = raw.toLowerCase();
  if (st === 'offline' || raw === '已下架') return 'offline';
  if (st === 'expired' || raw === '已过期') return 'expired';
  const exp = row.expiry_date;
  if (exp) {
    const end = new Date(exp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end < today) return 'expired';
  }
  return 'published';
}

/** 求职者端列表/详情是否可见（已下架不展示；已过期仍展示，仅禁止报名） */
function isAnnouncementPubliclyVisible(row) {
  const raw = String(row.status || '').trim();
  const st = raw.toLowerCase();
  if (st === 'offline' || raw === '已下架') return false;
  return true;
}

/** 公告是否已不可报名（下架、已过期、超过有效期） */
function isCompatAnnouncementSignupClosed(row) {
  if (!row) return true;
  const raw = String(row.status || '').trim();
  const st = raw.toLowerCase();
  if (st === 'offline' || raw === '已下架') return true;
  return effectiveAnnouncementApiStatus(row) === 'expired';
}

function parseAnnouncementExtraJson(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'object' ? raw : JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function parseAttachedProjectIds(raw) {
  if (!raw) return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(j)) return [];
    return j.map(Number).filter((n) => Number.isFinite(n));
  } catch (_) {
    return [];
  }
}

async function getEnterpriseIdForAnnouncements(req) {
  const role = req.user.role;
  if (role === 'enterprise') {
    const resolved = await resolveEnterpriseForCompatUser(req);
    if (resolved.error) return null;
    const n = resolved.enterpriseId != null ? Number(resolved.enterpriseId) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  let enterpriseId = req.enterpriseId;
  return enterpriseId != null && enterpriseId !== '' ? Number(enterpriseId) : null;
}

/** 公告行鉴权：解析后的主企业 id + JWT 历史 id + 行上 enterprise_id + 创建人 user_id（避免旧 enterprise_id 与当前主键不一致时无法维护公告） */
async function enterpriseMayAccessCompatAnnouncementRow(req, row) {
  if (!req.user || req.isGuest) return false;
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'enterprise') return false;
  if (!row) return false;
  const scopeIds = await collectCompatEnterpriseScopeIds(req);
  const rid = row.enterprise_id != null && row.enterprise_id !== '' ? Number(row.enterprise_id) : NaN;
  if (Number.isFinite(rid) && rid > 0 && scopeIds.includes(rid)) return true;
  if (Number(row.user_id) === Number(req.user.id)) return true;
  return false;
}

function mapAnnouncementRowsToListPayload(rows, projectRowMap) {
  return (rows || []).map((row) => {
    const extraJson = parseAnnouncementExtraJson(row.extra_json);
    const ids = parseAttachedProjectIds(row.attached_project_ids);
    const attachedProjects = ids.map((pid) => {
      const r = projectRowMap && projectRowMap.get(pid);
      if (r) {
        try {
          const m = mapCompatProjectRow(r);
          return { ...m, projectId: pid };
        } catch (err) {
          console.warn('[talentSiteCompat] mapCompatProjectRow announcement attach', pid, err.message);
          return {
            id: pid,
            projectId: pid,
            name: (r && r.name) || `岗位#${pid}`
          };
        }
      }
      return {
        id: pid,
        projectId: pid,
        name: `岗位#${pid}`
      };
    });
    const files =
      extraJson && Array.isArray(extraJson.files) ? extraJson.files : [];
    const entId =
      row.enterprise_id != null && row.enterprise_id !== ''
        ? Number(row.enterprise_id)
        : null;
    return {
      id: row.id,
      title: row.title,
      content: row.content || '',
      category: row.category || '民营企业',
      source: row.source || '政企端',
      publishDate: formatCompatProjectDate(row.publish_date),
      expiryDate: formatCompatProjectDate(row.expiry_date),
      status: effectiveAnnouncementApiStatus(row),
      views: row.views != null ? Number(row.views) : 0,
      extraJson,
      attachedProjects,
      enterpriseId: Number.isFinite(entId) && entId > 0 ? entId : null,
      companyId:
        Number.isFinite(entId) && entId > 0 ? String(entId) : null,
      companyName: row.enterprise_name || '',
      location: '',
      files
    };
  });
}

async function postCompatAnnouncement(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  let enterpriseId = await getEnterpriseIdForAnnouncements(req);
  if (role === 'enterprise' && !enterpriseId) {
    return res.status(400).json({ success: false, message: '未绑定企业信息' });
  }

  const b = req.body || {};
  const title = (b.title || '').trim();
  if (!title) {
    return res.status(400).json({ success: false, message: '标题不能为空' });
  }

  let extraJsonStr = null;
  if (b.extraJson != null) {
    try {
      extraJsonStr = JSON.stringify(b.extraJson);
    } catch (_) {
      extraJsonStr = '{}';
    }
  }

  const attached = Array.isArray(b.attachedProjects)
    ? b.attachedProjects.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];
  const attachedStr = JSON.stringify(attached);
  const statusNorm = normalizeAnnouncementStatusInput(b.status);

  try {
    await ensureCompatAnnouncementsTable();
    const [result] = await pool.execute(
      `INSERT INTO compat_announcements (
        enterprise_id, user_id, title, content, category, source,
        publish_date, expiry_date, status, extra_json, attached_project_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enterpriseId || null,
        req.user.id,
        title,
        b.content || null,
        b.category || null,
        b.source || null,
        b.publishDate ? String(b.publishDate).slice(0, 10) : null,
        b.expiryDate ? String(b.expiryDate).slice(0, 10) : null,
        statusNorm,
        extraJsonStr,
        attachedStr
      ]
    );
    return res.json({ success: true, data: { id: result.insertId } });
  } catch (e) {
    console.warn('[talentSiteCompat] POST /announcements:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
}

async function putCompatAnnouncement(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: '无效的公告 ID' });
  }

  try {
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_announcements WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '公告不存在' });
    }
    const row = rows[0];
    if (role !== 'admin') {
      if (!(await enterpriseMayAccessCompatAnnouncementRow(req, row))) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }

    const b = req.body || {};
    const definedKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    const onlyStatus = definedKeys.length === 1 && definedKeys[0] === 'status';
    if (onlyStatus) {
      const st = normalizeAnnouncementStatusInput(b.status);
      await pool.execute(
        'UPDATE compat_announcements SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [st, id]
      );
      return res.json({ success: true });
    }

    const title = b.title != null ? String(b.title).trim() : row.title;
    if (!title) {
      return res.status(400).json({ success: false, message: '标题不能为空' });
    }

    let extraJsonStr = row.extra_json;
    if (b.extraJson != null) {
      try {
        extraJsonStr = JSON.stringify(b.extraJson);
      } catch (_) {
        extraJsonStr = row.extra_json;
      }
    }

    let attachedStr = row.attached_project_ids;
    if (b.attachedProjects != null) {
      const attached = Array.isArray(b.attachedProjects)
        ? b.attachedProjects.map((x) => Number(x)).filter((n) => Number.isFinite(n))
        : [];
      attachedStr = JSON.stringify(attached);
    }

    const content = b.content !== undefined ? b.content : row.content;
    const category = b.category !== undefined ? b.category : row.category;
    const source = b.source !== undefined ? b.source : row.source;
    const publishDate =
      b.publishDate !== undefined
        ? b.publishDate
          ? String(b.publishDate).slice(0, 10)
          : null
        : row.publish_date;
    const expiryDate =
      b.expiryDate !== undefined
        ? b.expiryDate
          ? String(b.expiryDate).slice(0, 10)
          : null
        : row.expiry_date;
    let statusVal = row.status;
    if (b.status !== undefined) {
      statusVal = normalizeAnnouncementStatusInput(b.status);
    }

    await pool.execute(
      `UPDATE compat_announcements SET title=?, content=?, category=?, source=?, publish_date=?, expiry_date=?, status=?, extra_json=?, attached_project_ids=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [title, content, category, source, publishDate, expiryDate, statusVal, extraJsonStr, attachedStr, id]
    );
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT /announcements/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
}

async function deleteCompatAnnouncement(req, res) {
  if (req.isGuest) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: '无效的公告 ID' });
  }
  try {
    await ensureCompatAnnouncementsTable();
    const [rows] = await pool.execute('SELECT * FROM compat_announcements WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '公告不存在' });
    }
    const row = rows[0];
    if (role !== 'admin') {
      if (!(await enterpriseMayAccessCompatAnnouncementRow(req, row))) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
    }
    await pool.execute('DELETE FROM compat_announcements WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] DELETE /announcements/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
}

async function getCompatAnnouncementById(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: '无效的公告 ID' });
  }

  try {
    await ensureCompatAnnouncementsTable();
    const [rows] = await queryCompatAnnouncementsRows('WHERE a.id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '公告不存在' });
    }
    const row = rows[0];
    const role = req.user && req.user.role;
    if ((role === 'enterprise' || role === 'admin') && !req.isGuest) {
      if (role !== 'admin') {
        if (!(await enterpriseMayAccessCompatAnnouncementRow(req, row))) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
    } else if (!isAnnouncementPubliclyVisible(row)) {
      return res.status(404).json({ success: false, message: '公告不存在或已下架' });
    }
    const allIds = parseAttachedProjectIds(row.attached_project_ids);
    let projectRowMap = new Map();
    if (allIds.length) {
      try {
        await ensureCompatProjectsTable();
        const ph = allIds.map(() => '?').join(',');
        const [pr] = await pool.execute(
          `SELECT * FROM compat_enterprise_projects WHERE id IN (${ph})`,
          allIds
        );
        projectRowMap = new Map((pr || []).map((r) => [r.id, r]));
      } catch (projErr) {
        console.warn('[talentSiteCompat] GET /announcements/:id projects:', projErr.message);
        projectRowMap = new Map();
      }
    }
    const [data] = mapAnnouncementRowsToListPayload([row], projectRowMap);
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET /announcements/:id:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
}

router.get(
  '/announcements',
  (req, res, next) => {
    if (String(req.query.manage || '') === '1') {
      return authenticate(req, res, next);
    }
    next();
  },
  async (req, res) => {
    const manage = String(req.query.manage || '') === '1';
    if (!manage) {
      let limit = parseInt(req.query.pageSize, 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 100;
      limit = Math.min(limit, 200);
      try {
        await ensureCompatAnnouncementsTable();
        const [rows] = await queryCompatAnnouncementsRows(
          `WHERE LOWER(TRIM(COALESCE(a.status,''))) <> 'offline'
           ORDER BY a.created_at DESC LIMIT ${limit}`
        );
        const visible = (rows || []).filter(isAnnouncementPubliclyVisible);
        const allPid = new Set();
        visible.forEach((row) => {
          parseAttachedProjectIds(row.attached_project_ids).forEach((pid) => allPid.add(pid));
        });
        const idList = [...allPid];
        let projectRowMap = new Map();
        if (idList.length) {
          try {
            await ensureCompatProjectsTable();
            const ph = idList.map(() => '?').join(',');
            const [pr] = await pool.execute(
              `SELECT * FROM compat_enterprise_projects WHERE id IN (${ph})`,
              idList
            );
            projectRowMap = new Map((pr || []).map((p) => [p.id, p]));
          } catch (projErr) {
            console.warn('[talentSiteCompat] GET /announcements (public) projects:', projErr.message);
            projectRowMap = new Map();
          }
        }
        const data = mapAnnouncementRowsToListPayload(visible, projectRowMap);
        return res.json({
          success: true,
          data,
          total: data.length,
          page: 1,
          pageSize: limit
        });
      } catch (e) {
        console.warn('[talentSiteCompat] GET /announcements (public):', e.stack || e.message);
        return res.json({ success: true, data: [], total: 0, page: 1, pageSize: 20 });
      }
    }

    if (req.isGuest) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    const role = req.user.role;
    if (role !== 'enterprise' && role !== 'admin') {
      return res.json({ success: true, data: [], total: 0, page: 1, pageSize: 20 });
    }

    let limit = parseInt(req.query.pageSize, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 500;
    limit = Math.min(limit, 500);

    try {
      await ensureCompatAnnouncementsTable();
      let rows;
      if (role === 'admin') {
        const [r] = await queryCompatAnnouncementsRows(`ORDER BY a.created_at DESC LIMIT ${limit}`);
        rows = r;
      } else {
        const scopeIds = await collectCompatEnterpriseScopeIds(req);
        const uid = req.user.id != null ? Number(req.user.id) : NaN;
        const uidOk = Number.isFinite(uid) && uid > 0;
        if (scopeIds.length > 0) {
          const ph = scopeIds.map(() => '?').join(',');
          let r;
          if (uidOk) {
            [r] = await queryCompatAnnouncementsRows(
              `WHERE a.enterprise_id IN (${ph}) OR (a.user_id IS NOT NULL AND CAST(a.user_id AS UNSIGNED) = ?) ORDER BY a.created_at DESC LIMIT ${limit}`,
              [...scopeIds, uid]
            );
          } else {
            [r] = await queryCompatAnnouncementsRows(
              `WHERE a.enterprise_id IN (${ph}) ORDER BY a.created_at DESC LIMIT ${limit}`,
              [...scopeIds]
            );
          }
          rows = r;
        } else if (uidOk) {
          const [r] = await queryCompatAnnouncementsRows(
            `WHERE a.user_id IS NOT NULL AND CAST(a.user_id AS UNSIGNED) = ? ORDER BY a.created_at DESC LIMIT ${limit}`,
            [uid]
          );
          rows = r;
        } else {
          rows = [];
        }
      }

      const allPid = new Set();
      (rows || []).forEach((row) => {
        parseAttachedProjectIds(row.attached_project_ids).forEach((pid) => allPid.add(pid));
      });
      const idList = [...allPid];
      let projectRowMap = new Map();
      if (idList.length) {
        try {
          await ensureCompatProjectsTable();
          const ph = idList.map(() => '?').join(',');
          const [pr] = await pool.execute(
            `SELECT * FROM compat_enterprise_projects WHERE id IN (${ph})`,
            idList
          );
          projectRowMap = new Map((pr || []).map((p) => [p.id, p]));
        } catch (projErr) {
          console.warn('[talentSiteCompat] GET /announcements (manage) projects:', projErr.message);
          projectRowMap = new Map();
        }
      }

      const data = mapAnnouncementRowsToListPayload(rows || [], projectRowMap);
      return res.json({
        success: true,
        data,
        total: data.length,
        page: 1,
        pageSize: limit
      });
    } catch (e) {
      console.warn('[talentSiteCompat] GET /announcements:', e.message);
      return res.json({ success: true, data: [], total: 0, page: 1, pageSize: 20 });
    }
  }
);

router.get('/announcements/:id/navbar-branding', cacheMiddleware(120), getPublicAnnouncementNavbarBranding);
router.get('/announcements/:id', cacheMiddleware(120), optionalAuthenticate, getCompatAnnouncementById);
router.post('/announcements', authenticate, postCompatAnnouncement);
router.put('/announcements/:id', authenticate, putCompatAnnouncement);
router.delete('/announcements/:id', authenticate, deleteCompatAnnouncement);

/**
 * 兼容旧前端对 /enterprise 的探测：历史上恒返回空 data，易被误认为「企业数据没了」。
 * 与 GET /exam-allocations/batches 同源解析 enterprises.id；岗位/候选人仍以 /jobs、/candidates 为准。
 */
router.get('/enterprise', optionalAuthenticate, async (req, res) => {
  const meta = {
    hint:
      '本路径不是岗位或候选人列表。岗位请查看 GET /api/v1/jobs；报名请查看 GET /api/v1/candidates。下方 batches 为考试分配批次（若有）。'
  };
  if (!req.user || req.isGuest) {
    return res.json({ success: true, data: [], batches: [], meta });
  }
  try {
    const eid = await getCompatManageEnterpriseDbId(req);
    if (!eid) {
      return res.json({ success: true, data: [], batches: [], meta: { ...meta, reason: '未解析到 enterprises.id' } });
    }
    await ensureCompatExamAllocationBatchesTable();
    const [rows] = await pool.execute(
      `SELECT batch_id, batch_name, package_id, exam_time, exam_location, notes, candidate_count, created_at, updated_at
       FROM compat_exam_allocation_batches
       WHERE enterprise_id = ?
       ORDER BY updated_at DESC
       LIMIT 50`,
      [Number(eid)]
    );
    const batches = (rows || []).map((r) => ({
      batchCode: r.batch_id,
      id: r.batch_id,
      batchName: r.batch_name || r.batch_id,
      createdAt: r.created_at,
      candidateCount: r.candidate_count || 0,
      examTime: r.exam_time || '',
      examLocation: r.exam_location || '',
      notes: r.notes || '',
      packageId: r.package_id || null
    }));
    return res.json({ success: true, data: [], batches, meta: { ...meta, resolvedEnterpriseId: Number(eid) } });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, data: [], batches: [], meta });
    }
    console.warn('[talentSiteCompat] GET /enterprise:', e.message);
    return res.json({ success: true, data: [], batches: [], meta: { ...meta, error: e.message || String(e) } });
  }
});

function escapeCsvCell(val) {
  const s = val == null ? '' : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function mapEnterpriseExamSessionsRow(r) {
  const maxScore =
    r.summary_max_score != null && r.summary_max_score !== ''
      ? Number(r.summary_max_score)
      : r.paper_max_score != null && r.paper_max_score !== ''
        ? Number(r.paper_max_score)
        : null;
  const totalScore =
    r.display_total_score != null && r.display_total_score !== '' ? Number(r.display_total_score) : null;
  let scoreRate = null;
  if (maxScore != null && maxScore > 0 && totalScore != null) {
    scoreRate = Math.round((totalScore / maxScore) * 10000) / 100;
  }
  const sessionTotal =
    r.session_total_score != null && r.session_total_score !== '' ? Number(r.session_total_score) : null;
  const objectiveScore =
    r.summary_objective_score != null && r.summary_objective_score !== ''
      ? Number(r.summary_objective_score)
      : null;
  const subjectiveScore =
    r.summary_subjective_score != null && r.summary_subjective_score !== ''
      ? Number(r.summary_subjective_score)
      : null;
  const submittedAt = r.submitted_at ? new Date(r.submitted_at).toISOString() : null;
  return {
    session_id: r.session_id,
    sessionId: r.session_id,
    exam_id: r.exam_id,
    examId: r.exam_id,
    user_id: r.user_id,
    userId: r.user_id,
    status: r.status,
    session_total_score: sessionTotal,
    sessionTotalScore: sessionTotal,
    total_score: totalScore,
    totalScore,
    objective_score: objectiveScore,
    objectiveScore,
    subjective_score: subjectiveScore,
    subjectiveScore,
    max_score: maxScore,
    maxScore,
    score_rate: scoreRate,
    scoreRate,
    real_name: r.real_name,
    realName: r.real_name,
    username: r.username,
    phone: r.phone || '',
    education: r.education || '',
    exam_number: r.exam_number,
    examNumber: r.exam_number,
    gender: null,
    exam_name: r.exam_name,
    examName: r.exam_name,
    submitted_at: submittedAt,
    submittedAt
  };
}

async function fetchEnterpriseExamSessionRows({ role, enterpriseId, batchCodeRaw }) {
  const conditions = [];
  const params = [];
  if (role !== 'admin') {
    conditions.push('e.enterprise_id = ?');
    params.push(enterpriseId);
  }
  if (batchCodeRaw) {
    const asNum = parseInt(batchCodeRaw, 10);
    if (!Number.isNaN(asNum) && String(asNum) === batchCodeRaw) {
      conditions.push('e.id = ?');
      params.push(asNum);
    } else {
      conditions.push('e.name LIKE ?');
      params.push(`%${batchCodeRaw}%`);
    }
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { joinTableSql, userSelectSql } = await ExamEnrollmentModel.getExamSessionUserJoinFragments();

  const sqlWithSummary = `
    SELECT s.id AS session_id, s.exam_id, s.user_id, s.status, s.submitted_at,
           s.total_score AS session_total_score,
           COALESCE(esum.total_score, s.total_score) AS display_total_score,
           e.name AS exam_name,
           ${userSelectSql},
           p.total_score AS paper_max_score,
           esum.max_score AS summary_max_score,
           esum.objective_score AS summary_objective_score,
           esum.subjective_score AS summary_subjective_score
    FROM exam_sessions s
    INNER JOIN exams e ON e.id = s.exam_id
    LEFT JOIN ${joinTableSql} u ON u.id = s.user_id
    LEFT JOIN exam_papers p ON p.id = e.paper_id
    LEFT JOIN exam_summaries esum ON esum.session_id = s.id
    ${whereSql}
    ORDER BY COALESCE(s.submitted_at, s.updated_at, s.created_at) DESC
    LIMIT 500`;

  const sqlNoSummary = `
    SELECT s.id AS session_id, s.exam_id, s.user_id, s.status, s.submitted_at,
           s.total_score AS session_total_score,
           s.total_score AS display_total_score,
           e.name AS exam_name,
           ${userSelectSql},
           p.total_score AS paper_max_score,
           NULL AS summary_max_score,
           NULL AS summary_objective_score,
           NULL AS summary_subjective_score
    FROM exam_sessions s
    INNER JOIN exams e ON e.id = s.exam_id
    LEFT JOIN ${joinTableSql} u ON u.id = s.user_id
    LEFT JOIN exam_papers p ON p.id = e.paper_id
    ${whereSql}
    ORDER BY COALESCE(s.submitted_at, s.updated_at, s.created_at) DESC
    LIMIT 500`;

  let rows;
  try {
    [rows] = await pool.execute(sqlWithSummary, params);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' && (e.message || '').includes('exam_summaries')) {
      [rows] = await pool.execute(sqlNoSummary, params);
    } else {
      throw e;
    }
  }
  return rows || [];
}

async function resolveEnterpriseExamResultsContext(req) {
  if (req.isGuest || !req.user) {
    return { kind: 'unauthorized', message: '未登录' };
  }
  const role = req.user.role;
  if (role !== 'enterprise' && role !== 'admin') {
    return { kind: 'wrong_role' };
  }
  let enterpriseId = null;
  if (role === 'admin') {
    enterpriseId = req.enterpriseId != null ? Number(req.enterpriseId) : null;
  } else {
    enterpriseId = await getCompatManageEnterpriseDbId(req);
  }
  if (role === 'enterprise' && !enterpriseId) {
    return { kind: 'no_enterprise', message: '未绑定企业信息' };
  }
  const batchCodeRaw = req.query.batchCode != null ? String(req.query.batchCode).trim() : '';
  return { kind: 'ok', role, enterpriseId, batchCodeRaw };
}

/**
 * GET /exam-results/enterprise
 * 企业端 tests.html「测评结果」列表：从笔试库 exam_sessions 聚合，兼容旧版人才网路径
 * 总成绩优先 exam_summaries.total_score（与阅卷汇总一致），并返回客观/主观分项。
 * 查询参数：batchCode 可选 — 纯数字按考试 id（e.id）筛选；否则按考试名称模糊（e.name LIKE）。
 * 注意：企业端「分配批次号」如 B177… 不是考试名，勿作 batchCode 传入，否则易查不到数据。
 */
router.get('/exam-results/enterprise', authenticate, async (req, res) => {
  const ctx = await resolveEnterpriseExamResultsContext(req);
  if (ctx.kind === 'unauthorized') {
    return res.status(401).json({ success: false, message: ctx.message || '未登录' });
  }
  if (ctx.kind === 'wrong_role') {
    return res.json({ success: true, data: [] });
  }
  if (ctx.kind === 'no_enterprise') {
    return res.json({ success: true, data: [], message: ctx.message });
  }
  try {
    const rows = await fetchEnterpriseExamSessionRows({
      role: ctx.role,
      enterpriseId: ctx.enterpriseId,
      batchCodeRaw: ctx.batchCodeRaw
    });
    const data = (rows || []).map((r) => mapEnterpriseExamSessionsRow(r));
    return res.json({ success: true, data });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || (e.message && e.message.includes("doesn't exist"))) {
      console.warn('[talentSiteCompat] exam-results/enterprise: 表缺失，返回空列表', e.message);
      return res.json({ success: true, data: [] });
    }
    console.warn('[talentSiteCompat] exam-results/enterprise:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

/**
 * GET /exam-results/enterprise/export
 * 与列表同源 CSV（UTF-8 BOM），便于大表导出与「最终成绩」留档
 */
router.get('/exam-results/enterprise/export', authenticate, async (req, res) => {
  const ctx = await resolveEnterpriseExamResultsContext(req);
  if (ctx.kind === 'unauthorized') {
    return res.status(401).json({ success: false, message: ctx.message || '未登录' });
  }
  if (ctx.kind === 'wrong_role') {
    const headers = ['姓名', '用户名', '电话', '学历', '考试名称', '状态', '总成绩', '场次卷面总分', '满分(汇总/试卷)', '得分率%', '客观题得分', '主观题得分', '交卷时间', '场次ID', '考试ID', '用户ID'];
    const csv = `\ufeff${headers.join(',')}\n`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="测评结果_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }
  if (ctx.kind === 'no_enterprise') {
    const headers = ['姓名', '用户名', '电话', '学历', '考试名称', '状态', '总成绩', '场次卷面总分', '满分(汇总/试卷)', '得分率%', '客观题得分', '主观题得分', '交卷时间', '场次ID', '考试ID', '用户ID'];
    const csv = `\ufeff${headers.join(',')}\n`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="测评结果_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }
  try {
    const rows = await fetchEnterpriseExamSessionRows({
      role: ctx.role,
      enterpriseId: ctx.enterpriseId,
      batchCodeRaw: ctx.batchCodeRaw
    });
    const data = (rows || []).map((r) => mapEnterpriseExamSessionsRow(r));
    const headers = [
      '姓名',
      '用户名',
      '电话',
      '学历',
      '考试名称',
      '状态',
      '总成绩',
      '场次卷面总分',
      '满分(汇总/试卷)',
      '得分率%',
      '客观题得分',
      '主观题得分',
      '交卷时间',
      '场次ID',
      '考试ID',
      '用户ID'
    ];
    let csv = `\ufeff${headers.join(',')}\n`;
    for (const d of data) {
      csv += [
        escapeCsvCell(d.realName || ''),
        escapeCsvCell(d.username || ''),
        escapeCsvCell(d.phone || ''),
        escapeCsvCell(d.education || ''),
        escapeCsvCell(d.examName || ''),
        escapeCsvCell(d.status || ''),
        escapeCsvCell(d.totalScore != null ? d.totalScore : ''),
        escapeCsvCell(d.sessionTotalScore != null ? d.sessionTotalScore : ''),
        escapeCsvCell(d.maxScore != null ? d.maxScore : ''),
        escapeCsvCell(d.scoreRate != null ? d.scoreRate : ''),
        escapeCsvCell(d.objectiveScore != null ? d.objectiveScore : ''),
        escapeCsvCell(d.subjectiveScore != null ? d.subjectiveScore : ''),
        escapeCsvCell(d.submittedAt || ''),
        escapeCsvCell(d.sessionId),
        escapeCsvCell(d.examId),
        escapeCsvCell(d.userId)
      ].join(',');
      csv += '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="测评结果_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.warn('[talentSiteCompat] exam-results/enterprise/export:', e.message);
    return res.status(500).json({ success: false, message: e.message || '导出失败' });
  }
});

/**
 * GET /exam-results/enterprise/candidate-display-settings
 * 考生端成绩通知展示项（企业可持久化）
 */
router.get('/exam-results/enterprise/candidate-display-settings', authenticate, async (req, res) => {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const eid =
    req.user.role === 'admin' && req.enterpriseId != null
      ? Number(req.enterpriseId)
      : await getCompatManageEnterpriseDbId(req);
  if (!eid) {
    return res.json({ success: true, data: DEFAULT_EXAM_SCORE_DISPLAY_OPTIONS(), message: '未绑定企业' });
  }
  const data = await loadEnterpriseExamScoreDisplayOptions(eid);
  return res.json({ success: true, data });
});

/**
 * PUT /exam-results/enterprise/candidate-display-settings
 * body: { showTotal, showObjective, showSubjective, showScoreRate, showInterviewLine, interviewPassScore }
 */
router.put('/exam-results/enterprise/candidate-display-settings', authenticate, async (req, res) => {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const eid =
    req.user.role === 'admin' && req.enterpriseId != null
      ? Number(req.enterpriseId)
      : await getCompatManageEnterpriseDbId(req);
  if (!eid) {
    return res.status(400).json({ success: false, message: '未绑定企业信息' });
  }
  try {
    await saveEnterpriseExamScoreDisplayOptions(eid, req.body || {});
    const data = await loadEnterpriseExamScoreDisplayOptions(eid);
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT candidate-display-settings:', e.message);
    return res.status(500).json({ success: false, message: e.message || '保存失败' });
  }
});

/**
 * POST /exam-results/enterprise/push-score-notifications
 * 按当前筛选（batchCode）将成绩以站内通知发给考生；内容受 candidate-display-settings + body.options 合并控制。
 * body: { examId?: number, sessionIds?: number[], options?: Partial<display> }
 */
router.post('/exam-results/enterprise/push-score-notifications', authenticate, async (req, res) => {
  if (req.isGuest || !req.user) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  if (req.user.role !== 'enterprise' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  let enterpriseId =
    req.user.role === 'admin' && req.enterpriseId != null
      ? Number(req.enterpriseId)
      : await getCompatManageEnterpriseDbId(req);
  if (req.user.role === 'enterprise' && !enterpriseId) {
    return res.status(400).json({ success: false, message: '未绑定企业信息' });
  }
  if (!enterpriseId || !Number.isFinite(Number(enterpriseId)) || Number(enterpriseId) <= 0) {
    return res.status(400).json({ success: false, message: '无法解析企业 ID，不能推送成绩通知' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const batchCodeRaw =
    body.batchCode != null && String(body.batchCode).trim() !== ''
      ? String(body.batchCode).trim()
      : req.query.batchCode != null
        ? String(req.query.batchCode).trim()
        : '';
  const filterExamId = body.examId != null ? Number(body.examId) : NaN;
  const filterSessionIds = Array.isArray(body.sessionIds)
    ? body.sessionIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : null;
  const role = req.user.role;

  try {
    await ensureCompatExamScoreNotificationsTable();
    const rows = await fetchEnterpriseExamSessionRows({ role, enterpriseId, batchCodeRaw });
    const baseCfg = await loadEnterpriseExamScoreDisplayOptions(enterpriseId);
    const cfg = normalizeExamScoreDisplayOptions({ ...baseCfg, ...(body.options || {}) });

    let inserted = 0;
    let skipped = 0;
    for (const r of rows || []) {
      const st = r.status != null ? String(r.status) : '';
      if (st !== 'submitted' && st !== 'force_submitted') {
        skipped += 1;
        continue;
      }
      if (Number.isFinite(filterExamId) && filterExamId > 0 && Number(r.exam_id) !== filterExamId) {
        skipped += 1;
        continue;
      }
      if (filterSessionIds && filterSessionIds.length > 0 && !filterSessionIds.includes(Number(r.session_id))) {
        skipped += 1;
        continue;
      }
      const d = mapEnterpriseExamSessionsRow(r);
      const uid = Number(d.userId);
      if (!Number.isFinite(uid) || uid <= 0) {
        skipped += 1;
        continue;
      }
      const lines = [];
      lines.push(`考试：${d.examName || '专业测评'}`);
      if (cfg.showTotal && d.totalScore != null) {
        const maxPart = d.maxScore != null ? ` / 满分 ${d.maxScore}` : '';
        lines.push(`总成绩：${d.totalScore}${maxPart}`);
      }
      if (cfg.showObjective && d.objectiveScore != null) {
        lines.push(`客观题得分：${d.objectiveScore}`);
      }
      if (cfg.showSubjective && d.subjectiveScore != null) {
        lines.push(`主观题得分：${d.subjectiveScore}`);
      }
      if (cfg.showScoreRate && d.scoreRate != null) {
        lines.push(`得分率：${d.scoreRate}%`);
      }
      let interviewPassed = null;
      if (cfg.showInterviewLine && cfg.interviewPassScore != null && Number.isFinite(cfg.interviewPassScore)) {
        if (d.totalScore != null) {
          interviewPassed = d.totalScore >= cfg.interviewPassScore;
          lines.push(`是否进入面试：${interviewPassed ? '是' : '否'}（分数线 ${cfg.interviewPassScore}）`);
        } else {
          lines.push('是否进入面试：成绩未就绪，请稍后在「专业测评」中查看。');
        }
      }
      const content = lines.join('\n');
      const title = '测评成绩已发布';
      const payload = {
        examId: d.examId,
        sessionId: d.sessionId,
        examName: d.examName,
        display: {
          total: cfg.showTotal ? d.totalScore : undefined,
          objective: cfg.showObjective ? d.objectiveScore : undefined,
          subjective: cfg.showSubjective ? d.subjectiveScore : undefined,
          scoreRate: cfg.showScoreRate ? d.scoreRate : undefined,
          interviewPassed: cfg.showInterviewLine ? interviewPassed : undefined,
          interviewPassScore: cfg.showInterviewLine ? cfg.interviewPassScore : undefined
        }
      };
      await pool.execute(
        `INSERT INTO compat_exam_score_notifications (user_id, enterprise_id, exam_id, session_id, title, content, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), payload_json = VALUES(payload_json), created_at = CURRENT_TIMESTAMP`,
        [uid, enterpriseId, d.examId, d.sessionId, title, content, JSON.stringify(payload)]
      );
      inserted += 1;
    }
    return res.json({ success: true, data: { inserted, skipped, totalRows: (rows || []).length } });
  } catch (e) {
    console.warn('[talentSiteCompat] push-score-notifications:', e.message);
    return res.status(500).json({ success: false, message: e.message || '推送失败' });
  }
});

/** 首页等拉取的公开站点信息（与 /admin/settings/public 相同；政企/求职者端优先用 /public/site-settings，避免网关对路径含 admin 一律 403） */
async function sendCompatPublicSiteSettings(req, res) {
  try {
    const payload = await loadCompatSystemSettingsPayload();
    res.json({ success: true, data: buildPublicSiteSettingsBody(payload) });
  } catch (e) {
    console.warn('[talentSiteCompat] public site-settings:', e.message);
    res.json({
      success: true,
      data: buildPublicSiteSettingsBody({})
    });
  }
}
router.get('/public/site-settings', (req, res) => {
  sendCompatPublicSiteSettings(req, res);
});
router.get('/admin/settings/public', (req, res) => {
  sendCompatPublicSiteSettings(req, res);
});

/** 求职者会员套餐：写入系统设置 JSON，供 /public/site-settings 下发（仅 localStorage 时其他设备不可见） */
router.put(
  '/admin/membership-plans',
  authenticate,
  requireRole('admin'),
  requireAdminPortalPermission('jobseekers'),
  async (req, res) => {
    try {
      const plans = req.body;
      if (!Array.isArray(plans)) {
        return res.status(400).json({ success: false, message: 'membershipPlans 须为数组' });
      }
      const cur = await loadCompatSystemSettingsPayload();
      cur.membershipPlans = plans;
      await saveCompatSystemSettingsPayload(cur);
      return res.json({ success: true, data: plans });
    } catch (e) {
      console.warn('[talentSiteCompat] PUT /admin/membership-plans:', e.message);
      return res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
);

/** 管理端持久化系统设置（与 legacy admin/settings.html 对接；需门户权限 settings） */
router.get(
  '/admin/settings',
  authenticate,
  requireRole('admin'),
  requireAdminPortalPermission('settings'),
  async (req, res) => {
    try {
      const data = await loadCompatSystemSettingsPayload();
      return res.json({ success: true, data });
    } catch (e) {
      console.warn('[talentSiteCompat] GET /admin/settings:', e.message);
      return res.status(500).json({ success: false, message: e.message || '读取失败' });
    }
  }
);

router.put(
  '/admin/settings',
  authenticate,
  requireRole('admin'),
  requireAdminPortalPermission('settings'),
  async (req, res) => {
    try {
      const cur = await loadCompatSystemSettingsPayload();
      const merged = deepMergeSettings(cur, req.body || {});
      await saveCompatSystemSettingsPayload(merged);
      return res.json({ success: true, data: merged });
    } catch (e) {
      console.warn('[talentSiteCompat] PUT /admin/settings:', e.message);
      return res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
);

/** 企业主账号：子审核账号 CRUD（username 全局唯一） */
async function getCompatEnterpriseReviewerAccounts(req, res) {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ success: false, message: '请使用企业主账号管理子审核账号' });
  }
  try {
    await ensureCompatEnterpriseReviewersTable();
    const [rows] = await pool.execute(
      'SELECT id, enterprise_id, username, allowed_project_ids, status, created_at FROM compat_enterprise_reviewers WHERE enterprise_id = ? ORDER BY id ASC',
      [resolved.enterpriseId]
    );
    const data = (rows || []).map((r) => {
      let ids = null;
      if (r.allowed_project_ids != null && String(r.allowed_project_ids).trim() !== '') {
        try {
          const j = JSON.parse(r.allowed_project_ids);
          ids = Array.isArray(j) ? j.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : null;
        } catch (_) {
          ids = null;
        }
      }
      return {
        id: r.id,
        enterpriseId: r.enterprise_id,
        username: r.username,
        allowedProjectIds: ids,
        allProjects: ids === null,
        status: r.status,
        createdAt: r.created_at
      };
    });
    return res.json({ success: true, data });
  } catch (e) {
    console.warn('[talentSiteCompat] GET reviewer-accounts:', e.message);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
}

router.get(
  '/companies/me/reviewer-accounts',
  authenticate,
  requireRole('enterprise', 'admin'),
  getCompatEnterpriseReviewerAccounts
);

router.post('/companies/me/reviewer-accounts', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ success: false, message: '请使用企业主账号创建子审核账号' });
  }
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const password = b.password != null ? String(b.password) : '';
  const allProjects = b.allProjects === true || b.allProjects === 1 || b.allProjects === '1';
  let allowedJson = null;
  if (!allProjects) {
    const raw = b.allowedProjectIds;
    const arr = Array.isArray(raw) ? raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : [];
    allowedJson = JSON.stringify(arr);
  }
  if (!username || username.length < 2) {
    return res.status(400).json({ success: false, message: '用户名至少 2 个字符' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: '密码至少 6 位' });
  }
  try {
    await ensureCompatEnterpriseReviewersTable();
    const hash = await bcrypt.hash(password, 4);
    await pool.execute(
      `INSERT INTO compat_enterprise_reviewers (enterprise_id, username, password_hash, allowed_project_ids, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [resolved.enterpriseId, username, hash, allowedJson]
    );
    return res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: '该用户名已被占用' });
    }
    console.warn('[talentSiteCompat] POST reviewer-accounts:', e.message);
    return res.status(500).json({ success: false, message: e.message || '创建失败' });
  }
});

router.put('/companies/me/reviewer-accounts/:id', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ success: false, message: '请使用企业主账号操作' });
  }
  const rid = parseInt(req.params.id, 10);
  if (!Number.isFinite(rid) || rid <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  const b = req.body || {};
  try {
    await ensureCompatEnterpriseReviewersTable();
    const [rows] = await pool.execute(
      'SELECT * FROM compat_enterprise_reviewers WHERE id = ? AND enterprise_id = ? LIMIT 1',
      [rid, resolved.enterpriseId]
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: '账号不存在' });
    }
    const allProjects = b.allProjects === true || b.allProjects === 1 || b.allProjects === '1';
    let allowedJson = rows[0].allowed_project_ids;
    if (Object.prototype.hasOwnProperty.call(b, 'allProjects') || Object.prototype.hasOwnProperty.call(b, 'allowedProjectIds')) {
      if (allProjects) {
        allowedJson = null;
      } else {
        const raw = b.allowedProjectIds;
        const arr = Array.isArray(raw) ? raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : [];
        allowedJson = JSON.stringify(arr);
      }
    }
    const pwd = b.password != null ? String(b.password) : '';
    if (pwd) {
      if (pwd.length < 6) {
        return res.status(400).json({ success: false, message: '密码至少 6 位' });
      }
      const hash = await bcrypt.hash(pwd, 4);
      await pool.execute(
        'UPDATE compat_enterprise_reviewers SET password_hash = ?, allowed_project_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND enterprise_id = ?',
        [hash, allowedJson, rid, resolved.enterpriseId]
      );
    } else {
      await pool.execute(
        'UPDATE compat_enterprise_reviewers SET allowed_project_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND enterprise_id = ?',
        [allowedJson, rid, resolved.enterpriseId]
      );
    }
    const st = b.status != null ? String(b.status).trim() : '';
    if (st === 'active' || st === 'disabled') {
      await pool.execute(
        'UPDATE compat_enterprise_reviewers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND enterprise_id = ?',
        [st, rid, resolved.enterpriseId]
      );
    }
    return res.json({ success: true });
  } catch (e) {
    console.warn('[talentSiteCompat] PUT reviewer-accounts:', e.message);
    return res.status(500).json({ success: false, message: e.message || '更新失败' });
  }
});

router.delete('/companies/me/reviewer-accounts/:id', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  const resolved = await resolveEnterpriseForCompatUser(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ success: false, message: '请使用企业主账号操作' });
  }
  const rid = parseInt(req.params.id, 10);
  if (!Number.isFinite(rid) || rid <= 0) {
    return res.status(400).json({ success: false, message: '无效 id' });
  }
  try {
    await ensureCompatEnterpriseReviewersTable();
    const [r] = await pool.execute(
      'DELETE FROM compat_enterprise_reviewers WHERE id = ? AND enterprise_id = ?',
      [rid, resolved.enterpriseId]
    );
    return res.json({ success: true, deleted: r.affectedRows || 0 });
  } catch (e) {
    console.warn('[talentSiteCompat] DELETE reviewer-accounts:', e.message);
    return res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

router.postCompatProject = postCompatProject;
router.getCompatProjectsList = getCompatProjectsList;
router.getCompatTalentPoolList = getCompatTalentPoolList;
router.getCompatCooperations = getCompatCooperations;
router.postCompatJob = postCompatJob;
router.putCompatJob = putCompatJob;
router.deleteCompatJob = deleteCompatJob;
router.getCompatJobs = getCompatJobs;
router.getCompatJobById = getCompatJobById;
router.postCompatAnnouncement = postCompatAnnouncement;
router.putCompatAnnouncement = putCompatAnnouncement;
router.deleteCompatAnnouncement = deleteCompatAnnouncement;
router.getCompatAnnouncementById = getCompatAnnouncementById;
router.getCompatUserProfile = getCompatUserProfile;
router.putCompatUserProfile = putCompatUserProfile;
router.getCompatUserResume = getCompatUserResume;
router.putCompatUserResume = putCompatUserResume;
router.postCompatResumeGenerate = postCompatResumeGenerate;
router.getCompatAssessmentFeeSettings = getCompatAssessmentFeeSettings;
router.putCompatAssessmentFeeSettings = putCompatAssessmentFeeSettings;
router.getCompatCandidatesList = getCompatCandidatesList;
router.getCompatEnterpriseReviewerAccounts = getCompatEnterpriseReviewerAccounts;
router.postCreateExamEnterprise = postCreateExamEnterprise;
module.exports = router;
