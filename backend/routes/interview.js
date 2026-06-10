const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const ExamModel = require('../models/examModel');
const ExamSessionModel = require('../models/examSessionModel');
const EnterpriseModel = require('../models/enterpriseModel');
const ExamAudioRecordingModel = require('../models/examAudioRecordingModel');
const ExamEnrollmentModel = require('../models/examEnrollmentModel');
const { sessionOwnedByUser } = require('../utils/sessionUserMatch');

// 录音文件存储目录
const AUDIO_UPLOAD_DIR = path.join(__dirname, '../uploads/interview-audio');
const VIDEO_UPLOAD_DIR = path.join(__dirname, '../uploads/interview-video');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** interview_rubrics 列名缓存（兼容纳库遗留列如 qms_exam_id） */
let interviewRubricsColsCache = null;

function invalidateInterviewRubricsColumnCache() {
  interviewRubricsColsCache = null;
}

async function getInterviewRubricsColumnNames() {
  if (!interviewRubricsColsCache) {
    try {
      const [rows] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'interview_rubrics'`
      );
      interviewRubricsColsCache = new Set((rows || []).map((r) => String(r.COLUMN_NAME)));
    } catch (_) {
      interviewRubricsColsCache = new Set(['exam_id']);
    }
  }
  return interviewRubricsColsCache;
}

async function dbTableExists(tableName) {
  const tn = String(tableName || '').trim();
  if (!tn) return false;
  try {
    const [r] = await pool.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
      [tn]
    );
    return !!(r && r.length);
  } catch (_) {
    return false;
  }
}

/** @returns {Promise<Set<string>|null>} */
async function fetchTableColumnsSet(tableName) {
  if (!(await dbTableExists(tableName))) return null;
  try {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    return new Set((rows || []).map((x) => String(x.COLUMN_NAME)));
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }
}

/** 考试配置中 interviewConfig 可能未解析；工作人员 ID 可能为中文逗号分隔或 JSON 数组 */
function getParsedAnswerSystemConfig(exam) {
  let asc = exam && exam.answer_system_config;
  if (typeof asc === 'string') {
    try {
      asc = JSON.parse(asc);
    } catch (_) {
      asc = {};
    }
  }
  if (!asc || typeof asc !== 'object') asc = {};
  return asc;
}

function splitConfigIdList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  return String(v)
    .replace(/[\uFF0C\u3001;|]/g, ',')
    .split(/[,，\s\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @returns {{ asc: object, staffIds: string[], supervisorIds: string[] }} */
function getStaffSupervisorIdsForExam(exam) {
  const asc = getParsedAnswerSystemConfig(exam);
  const ic = asc.interviewConfig;
  const raw = ic && typeof ic === 'object' ? ic : {};
  return {
    asc,
    staffIds: splitConfigIdList(raw.staffAccountIds),
    supervisorIds: splitConfigIdList(raw.supervisorAccountIds)
  };
}

const INTERVIEW_GRADER_COL_CANDIDATES = [
  'grading_account_id',
  'grader_id',
  'account_id',
  'examiner_account_id',
  'grading_grader_id',
  'sub_account_id'
];

/**
 * 解析面试相关表中「考官/阅卷子账号」外键列名（旧库常见 grader_id）。
 * @param {string} tableName
 * @returns {Promise<string|null>}
 */
async function resolveInterviewGraderColumn(tableName) {
  const set = await fetchTableColumnsSet(tableName);
  if (!set || set.size === 0) return null;
  const lower = new Set([...set].map((c) => String(c || '').toLowerCase()));
  for (const c of INTERVIEW_GRADER_COL_CANDIDATES) {
    if (lower.has(c)) return c;
  }
  const deny = new Set([
    'id',
    'exam_id',
    'room_id',
    'role',
    'sequence_no',
    'session_id',
    'rubric_item_id',
    'comment',
    'score',
    'created_at',
    'updated_at'
  ]);
  const hints = [...lower].filter(
    (c) =>
      !deny.has(c) &&
      (c.includes('grader') || c.includes('account') || c.includes('examiner') || c.endsWith('_ga_id'))
  );
  if (hints.length === 1) return hints[0];
  return null;
}

/** qms_exams.paper_id 常外键指向 qms_exam_papers；从 exam_papers 补一行（与 sync_exam_papers_row_to_qms_exam_papers.sql 对齐）。 */
async function tryEnsureQmsExamPaperMirrorRow(paperId) {
  const pid = parseInt(String(paperId), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (!(await dbTableExists('qms_exam_papers'))) return;
  try {
    const [ex] = await pool.execute('SELECT id FROM qms_exam_papers WHERE id = ? LIMIT 1', [pid]);
    if (ex && ex.length) return;
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return;
    throw e;
  }
  const mappedSqls = [
    `INSERT INTO qms_exam_papers (
        id, paper_name, project_name, total_score, qms_exam_time, page_size,
        content_html, content_text, images_base64, notes, question_count, major_question_count,
        created_at, updated_at, qms_exam_type, preview_html, is_enabled, visible_side, project_info
      )
      SELECT
        id, paper_name, project_name, total_score, exam_time, page_size,
        content_html, content_text, images_base64, notes, question_count, major_question_count,
        created_at, updated_at, exam_type, preview_html, is_enabled, visible_side, project_info
      FROM exam_papers WHERE id = ?`,
    `INSERT INTO qms_exam_papers (
        id, paper_name, project_name, total_score, qms_exam_time, page_size,
        content_html, notes, created_at, updated_at, qms_exam_type, preview_html
      )
      SELECT
        id, paper_name, project_name, total_score, exam_time, page_size,
        content_html, notes, created_at, updated_at, exam_type, preview_html
      FROM exam_papers WHERE id = ?`,
    `INSERT INTO qms_exam_papers (
        id, paper_name, total_score, qms_exam_time, page_size,
        created_at, updated_at, qms_exam_type, preview_html
      )
      SELECT
        id, paper_name, total_score, exam_time, page_size,
        created_at, updated_at, exam_type, preview_html
      FROM exam_papers WHERE id = ?`,
    `INSERT INTO qms_exam_papers (id, paper_name, total_score, qms_exam_time, page_size)
      SELECT id, paper_name, total_score, exam_time, page_size
      FROM exam_papers WHERE id = ?`
  ];
  for (const sql of mappedSqls) {
    try {
      await pool.execute(sql, [pid]);
      console.log('[interview] qms_exam_papers: 已从 exam_papers 补镜像 id=%s', pid);
      return;
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return;
    }
  }
  const ts = await fetchTableColumnsSet('qms_exam_papers');
  const ss = await fetchTableColumnsSet('exam_papers');
  if (!ts || !ss) return;
  const common = [...ts].filter((c) => ss.has(c));
  if (common.length < 2 || !common.includes('id')) return;
  const list = common.map((c) => `\`${c}\``).join(', ');
  try {
    await pool.execute(
      `INSERT INTO qms_exam_papers (${list}) SELECT ${list} FROM exam_papers WHERE id = ?`,
      [pid]
    );
    console.log('[interview] qms_exam_papers: 列交集补镜像 id=%s', pid);
  } catch (e) {
    if (e && e.code !== 'ER_DUP_ENTRY') {
      console.warn('[interview] qms_exam_papers 交集镜像失败:', e.message || e);
    }
  }
}

/** qms_exams.enterprise_id 可能外键指向 qms_enterprises；从 enterprises 按列交集补一行。 */
async function tryEnsureQmsEnterpriseMirrorRow(entId) {
  const id = parseInt(String(entId), 10);
  if (!Number.isFinite(id) || id <= 0) return;
  if (!(await dbTableExists('qms_enterprises'))) return;
  try {
    const [ex] = await pool.execute('SELECT id FROM qms_enterprises WHERE id = ? LIMIT 1', [id]);
    if (ex && ex.length) return;
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return;
    throw e;
  }
  const minimalAttempts = [
    () => pool.execute('INSERT INTO qms_enterprises (id, name) SELECT id, name FROM enterprises WHERE id = ?', [id]),
    () =>
      pool.execute(
        'INSERT INTO qms_enterprises (id, company_name) SELECT id, name FROM enterprises WHERE id = ?',
        [id]
      )
  ];
  for (const run of minimalAttempts) {
    try {
      await run();
      console.log('[interview] qms_enterprises: 最小列补镜像 id=%s', id);
      return;
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return;
    }
  }
  const qcols = await fetchTableColumnsSet('qms_enterprises');
  const ecols = await fetchTableColumnsSet('enterprises');
  if (!qcols || !ecols) return;
  const common = [...qcols].filter((c) => ecols.has(c));
  if (common.length < 2 || !common.includes('id')) return;
  const list = common.map((c) => `\`${c}\``).join(', ');
  try {
    await pool.execute(
      `INSERT INTO qms_enterprises (${list}) SELECT ${list} FROM enterprises WHERE id = ?`,
      [id]
    );
    console.log('[interview] qms_enterprises: 已从 enterprises 补镜像 id=%s', id);
  } catch (e) {
    if (e && e.code !== 'ER_DUP_ENTRY') {
      console.warn('[interview] qms_enterprises 镜像失败:', e.message || e);
    }
  }
}

/** qms_exams.created_by 可能外键指向 qms_users；从 users 按列交集补一行。 */
async function tryEnsureQmsUserMirrorRow(userId) {
  const uid = parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) return;
  if (!(await dbTableExists('qms_users'))) return;
  try {
    const [ex] = await pool.execute('SELECT id FROM qms_users WHERE id = ? LIMIT 1', [uid]);
    if (ex && ex.length) return;
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return;
    throw e;
  }
  const minimalUserAttempts = [
    () => pool.execute('INSERT INTO qms_users (id, username) SELECT id, username FROM users WHERE id = ?', [uid]),
    () =>
      pool.execute(
        "INSERT INTO qms_users (id, username) SELECT id, COALESCE(NULLIF(TRIM(username), ''), CONCAT('u', id)) FROM users WHERE id = ?",
        [uid]
      )
  ];
  for (const run of minimalUserAttempts) {
    try {
      await run();
      console.log('[interview] qms_users: 最小列补镜像 id=%s', uid);
      return;
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return;
    }
  }
  const qcols = await fetchTableColumnsSet('qms_users');
  const ucols = await fetchTableColumnsSet('users');
  if (!qcols || !ucols) return;
  const common = [...qcols].filter((c) => ucols.has(c));
  if (common.length < 2 || !common.includes('id')) return;
  const list = common.map((c) => `\`${c}\``).join(', ');
  try {
    await pool.execute(`INSERT INTO qms_users (${list}) SELECT ${list} FROM users WHERE id = ?`, [uid]);
    console.log('[interview] qms_users: 已从 users 补镜像 id=%s', uid);
  } catch (e) {
    if (e && e.code !== 'ER_DUP_ENTRY') {
      console.warn('[interview] qms_users 镜像失败:', e.message || e);
    }
  }
}

/**
 * 旧库 interview_rubrics.qns_exam_id → FK REFERENCES qns_exams(id)，
 * 而接口中的 examId 来自 exams 表；须解析为 qns_exams 中真实存在的 id。
 * 注意：不得以 exams.id 冒充 qns_exams.id（会触发外键错误）；information_schema 探测不可靠时也不能直接回退为 eid。
 */
async function resolveQnsExamIdForInterviewRubric(examId) {
  const eid = parseInt(String(examId), 10);
  if (!Number.isFinite(eid) || eid <= 0) return null;

  try {
    await pool.execute('SELECT 1 FROM qns_exams LIMIT 1');
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') {
      /** 无 qns_exams 表：仅当 rubrics 表无该外键时由上层仅用 exam_id；此处返回 eid 保持历史兼容 */
      return eid;
    }
    throw e;
  }

  const [r0] = await pool.execute('SELECT id FROM qns_exams WHERE id = ? LIMIT 1', [eid]);
  if (r0 && r0.length) return Number(r0[0].id);

  const altSqls = [
    ['SELECT id FROM qns_exams WHERE qms_exam_id = ? LIMIT 1', [eid]],
    ['SELECT id FROM qns_exams WHERE exam_id = ? LIMIT 1', [eid]],
    ['SELECT id FROM qns_exams WHERE interview_exam_id = ? LIMIT 1', [eid]],
    [
      'SELECT qe.id FROM qns_exams qe INNER JOIN exams ex ON ex.paper_id = qe.paper_id WHERE ex.id = ? LIMIT 1',
      [eid]
    ],
    [
      'SELECT qe.id FROM qns_exams qe INNER JOIN exams ex ON ex.id = qe.exam_id WHERE ex.id = ? LIMIT 1',
      [eid]
    ]
  ];
  for (const [sql, params] of altSqls) {
    try {
      const [rx] = await pool.execute(sql, params);
      if (rx && rx.length && rx[0].id != null) return Number(rx[0].id);
    } catch (_) {
      /* 列名不存在等 */
    }
  }
  return null;
}

/**
 * 旧库 interview_rubrics.qms_exam_id → FK REFERENCES qms_exams(id)，
 * 接口 examId 来自 exams 表；须解析为 qms_exams 中存在的 id（不得以 exams.id 冒充）。
 */
async function resolveQmsExamIdForInterviewRubric(examId) {
  const eid = parseInt(String(examId), 10);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  try {
    await pool.execute('SELECT 1 FROM qms_exams LIMIT 1');
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return eid;
    throw e;
  }
  const [r0] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [eid]);
  if (r0 && r0.length) return Number(r0[0].id);
  const altSqls = [
    ['SELECT id FROM qms_exams WHERE exam_id = ? LIMIT 1', [eid]],
    ['SELECT id FROM qms_exams WHERE interview_exam_id = ? LIMIT 1', [eid]],
    ['SELECT qm.id FROM qms_exams qm INNER JOIN exams ex ON ex.paper_id = qm.paper_id WHERE ex.id = ? LIMIT 1', [eid]],
    ['SELECT id FROM qms_exams WHERE qns_exam_id = ? LIMIT 1', [eid]]
  ];
  for (const [sql, params] of altSqls) {
    try {
      const [rx] = await pool.execute(sql, params);
      if (rx && rx.length && rx[0].id != null) return Number(rx[0].id);
    } catch (_) {
      /* 列名不存在等 */
    }
  }
  return null;
}

/** 两表共有列：优先常用顺序，再补齐其余共有列（避免 qms_exams 多出的 NOT NULL 列未写入）。 */
function buildQmsExamsMirrorColumnsOrdered(qmsCols, examCols) {
  if (!qmsCols || !examCols) return null;
  const preferredOrder = [
    'id',
    'enterprise_id',
    'paper_id',
    'name',
    'description',
    'start_time',
    'end_time',
    'duration_minutes',
    'monitor_config',
    'answer_system_config',
    'candidate_config',
    'examiner_config',
    'status',
    'exam_type',
    'interview_config',
    'created_by',
    'created_at',
    'updated_at',
    'interview_current_draw_number',
    'public_room_code'
  ];
  const out = [];
  const seen = new Set();
  for (const c of preferredOrder) {
    if (qmsCols.has(c) && examCols.has(c)) {
      out.push(c);
      seen.add(c);
    }
  }
  for (const c of [...qmsCols].sort()) {
    if (examCols.has(c) && !seen.has(c)) {
      out.push(c);
      seen.add(c);
    }
  }
  return out.length && out.includes('id') ? out : null;
}

/**
 * 独占连接临时关闭 SESSION 外键检查插入 qms_exams（finally 恢复，避免污染连接池其他请求）。
 * @returns {Promise<boolean>}
 */
async function tryInsertQmsExamsSelectFromExamsFkOff(cols, eid) {
  if (!cols || !cols.length || !cols.includes('id')) return false;
  const list = cols.map((c) => `\`${c}\``).join(', ');
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('SET SESSION foreign_key_checks = 0');
    await conn.execute(`INSERT INTO qms_exams (${list}) SELECT ${list} FROM exams WHERE id = ?`, [eid]);
  } catch (e) {
    console.warn('[interview] qms_exams FK_OFF 插入失败:', e && e.code, e && e.message);
    return false;
  } finally {
    if (conn) {
      try {
        await conn.query('SET SESSION foreign_key_checks = 1');
      } catch (_) {
        /* ignore */
      }
      conn.release();
    }
  }
  try {
    const [v] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [eid]);
    return !!(v && v.length);
  } catch (_) {
    return false;
  }
}

/**
 * 测评考试仅在 exams 中维护时，qms_exams 可能无对应行；为通过 interview_rubrics.qms_exam_id 外键补镜像行。
 * 线上 qms_exams 常与 exams 列对齐（见 database/sync_exams_row_to_qms_exams.sql），应整行从 exams 拷贝；
 * 并先尽量补齐 qms_exam_papers / qms_enterprises 以满足外键。
 */
async function tryEnsureQmsExamMirrorRow(examsId) {
  const eid = parseInt(String(examsId), 10);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  try {
    const [r0] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [eid]);
    if (r0 && r0.length) return Number(r0[0].id);
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }

  try {
    const exam = await ExamModel.findById(eid);
    if (exam) {
      await tryEnsureQmsExamPaperMirrorRow(exam.paper_id);
      await tryEnsureQmsEnterpriseMirrorRow(exam.enterprise_id);
      await tryEnsureQmsUserMirrorRow(exam.created_by);
    }
  } catch (_) {
    /* ignore */
  }

  const qmsCols = await fetchTableColumnsSet('qms_exams');
  const examCols = await fetchTableColumnsSet('exams');
  let lastQmsMirrorErr = null;
  if (qmsCols && examCols) {
    const full = buildQmsExamsMirrorColumnsOrdered(qmsCols, examCols);
    if (full && full.includes('id')) {
      const minimalCore = [
        'id',
        'enterprise_id',
        'paper_id',
        'name',
        'description',
        'start_time',
        'end_time',
        'duration_minutes',
        'status'
      ].filter((c) => full.includes(c));
      const stripVariants = [
        full,
        full.filter((c) => c !== 'created_by'),
        full.filter((c) => c !== 'interview_current_draw_number'),
        full.filter((c) => c !== 'created_by' && c !== 'interview_current_draw_number'),
        full.filter((c) => !['monitor_config', 'answer_system_config'].includes(c)),
        full.filter((c) => c !== 'public_room_code'),
        minimalCore.length >= 4 ? minimalCore : null
      ].filter(Boolean);
      const seenKey = new Set();
      for (const cols of stripVariants) {
        const key = cols.join(',');
        if (!cols.length || !cols.includes('id') || seenKey.has(key)) continue;
        seenKey.add(key);
        const list = cols.map((c) => `\`${c}\``).join(', ');
        try {
          await pool.execute(`INSERT INTO qms_exams (${list}) SELECT ${list} FROM exams WHERE id = ?`, [eid]);
          const [v] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [eid]);
          if (v && v.length) {
            console.log('[interview] qms_exams: 已从 exams 补镜像行 id=%s（interview_rubrics 外键）', eid);
            return eid;
          }
        } catch (err) {
          lastQmsMirrorErr = err;
          if (err && err.code === 'ER_DUP_ENTRY') {
            const [v2] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [eid]);
            if (v2 && v2.length) return eid;
          } else {
            console.warn('[interview] qms_exams mirror:', err && err.code, err && err.message);
          }
        }
      }
      if (minimalCore.length >= 4) {
        if (await tryInsertQmsExamsSelectFromExamsFkOff(minimalCore, eid)) {
          console.warn(
            '[interview] qms_exams: 已在 SESSION 外键检查关闭下插入 id=%s（请按需核对 qms 侧依赖数据）',
            eid
          );
          return eid;
        }
      }
      if (await tryInsertQmsExamsSelectFromExamsFkOff(full, eid)) {
        console.warn('[interview] qms_exams: 已在 SESSION 外键检查关闭下全列插入 id=%s', eid);
        return eid;
      }
    }
  } else {
    console.warn('[interview] qms_exams mirror: 无法读取 exams / qms_exams 列信息（information_schema）');
  }
  if (lastQmsMirrorErr) {
    console.warn('[interview] qms_exams mirror 最后一次错误:', lastQmsMirrorErr.message || lastQmsMirrorErr);
  }

  let title = `面试考试#${eid}`;
  let paperId = null;
  let enterpriseId = null;
  try {
    const exam = await ExamModel.findById(eid);
    if (exam) {
      if (exam.name) title = String(exam.name).trim().slice(0, 250) || title;
      if (exam.paper_id != null && Number.isFinite(Number(exam.paper_id))) paperId = Number(exam.paper_id);
      if (exam.enterprise_id != null && Number.isFinite(Number(exam.enterprise_id))) {
        enterpriseId = Number(exam.enterprise_id);
      }
    }
  } catch (_) {
    /* ignore */
  }
  const attempts = [];
  attempts.push(() => pool.execute('INSERT INTO qms_exams (id, name) VALUES (?, ?)', [eid, title]));
  attempts.push(() => pool.execute('INSERT INTO qms_exams (id, title) VALUES (?, ?)', [eid, title]));
  attempts.push(() => pool.execute('INSERT INTO qms_exams (id, exam_name) VALUES (?, ?)', [eid, title]));
  if (enterpriseId != null) {
    attempts.push(() =>
      pool.execute('INSERT INTO qms_exams (id, name, enterprise_id) VALUES (?, ?, ?)', [eid, title, enterpriseId])
    );
    attempts.push(() =>
      pool.execute('INSERT INTO qms_exams (id, title, enterprise_id) VALUES (?, ?, ?)', [eid, title, enterpriseId])
    );
  }
  if (paperId != null) {
    attempts.push(() =>
      pool.execute('INSERT INTO qms_exams (id, paper_id, name) VALUES (?, ?, ?)', [eid, paperId, title])
    );
    attempts.push(() =>
      pool.execute('INSERT INTO qms_exams (id, paper_id, title) VALUES (?, ?, ?)', [eid, paperId, title])
    );
  }
  attempts.push(() => pool.execute('INSERT INTO qms_exams (id) VALUES (?)', [eid]));
  for (const run of attempts) {
    try {
      await run();
      const [v] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [eid]);
      if (v && v.length) {
        console.log('[interview] qms_exams: 已为 exams.id=%s 补镜像行（兼容 interview_rubrics 外键）', eid);
        return eid;
      }
    } catch (_) {
      /* 列组合不匹配则试下一套 */
    }
  }
  return null;
}

/**
 * 测评考试只在 exams 中维护时，qns_exams 可能无对应主键；为通过 interview_rubrics 外键，按最小列组合插入 id=exams.id 的镜像行。
 */
async function tryEnsureQnsExamMirrorRow(examsId) {
  const eid = parseInt(String(examsId), 10);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  try {
    const [r0] = await pool.execute('SELECT id FROM qns_exams WHERE id = ? LIMIT 1', [eid]);
    if (r0 && r0.length) return Number(r0[0].id);
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }

  let title = `面试考试#${eid}`;
  let paperId = null;
  let enterpriseId = null;
  try {
    const exam = await ExamModel.findById(eid);
    if (exam) {
      if (exam.name) title = String(exam.name).trim().slice(0, 250) || title;
      if (exam.paper_id != null && Number.isFinite(Number(exam.paper_id))) paperId = Number(exam.paper_id);
      if (exam.enterprise_id != null && Number.isFinite(Number(exam.enterprise_id))) {
        enterpriseId = Number(exam.enterprise_id);
      }
    }
  } catch (_) {
    /* ignore */
  }

  const attempts = [];
  attempts.push(() => pool.execute('INSERT INTO qns_exams (id, name) VALUES (?, ?)', [eid, title]));
  attempts.push(() => pool.execute('INSERT INTO qns_exams (id, title) VALUES (?, ?)', [eid, title]));
  attempts.push(() => pool.execute('INSERT INTO qns_exams (id, exam_name) VALUES (?, ?)', [eid, title]));
  if (enterpriseId != null) {
    attempts.push(() =>
      pool.execute('INSERT INTO qns_exams (id, name, enterprise_id) VALUES (?, ?, ?)', [eid, title, enterpriseId])
    );
    attempts.push(() =>
      pool.execute('INSERT INTO qns_exams (id, title, enterprise_id) VALUES (?, ?, ?)', [eid, title, enterpriseId])
    );
  }
  if (paperId != null) {
    attempts.push(() =>
      pool.execute('INSERT INTO qns_exams (id, paper_id, name) VALUES (?, ?, ?)', [eid, paperId, title])
    );
    attempts.push(() =>
      pool.execute('INSERT INTO qns_exams (id, paper_id, title) VALUES (?, ?, ?)', [eid, paperId, title])
    );
  }
  attempts.push(() => pool.execute('INSERT INTO qns_exams (id) VALUES (?)', [eid]));

  for (const run of attempts) {
    try {
      await run();
      const [v] = await pool.execute('SELECT id FROM qns_exams WHERE id = ? LIMIT 1', [eid]);
      if (v && v.length) {
        console.log('[interview] qns_exams: 已为 exams.id=%s 补镜像行（兼容 interview_rubrics 外键）', eid);
        return eid;
      }
    } catch (err) {
      /* 列组合不匹配则试下一套 */
    }
  }
  return null;
}

/** WHERE：按 exams.id 查评分表行（兼容 qms_exam_id / qns_exam_id） */
async function interviewRubricWhereForExam(examIdParam, cols) {
  const e = parseInt(String(examIdParam), 10);
  const parts = ['exam_id = ?'];
  const params = [e];
  if (cols.has('qms_exam_id')) {
    const qms = await resolveQmsExamIdForInterviewRubric(examIdParam);
    parts.push('qms_exam_id = ?');
    params.push(qms != null ? qms : e);
    if (qms != null && qms !== e) {
      parts.push('qms_exam_id = ?');
      params.push(e);
    }
  }
  if (cols.has('qns_exam_id')) {
    const qns = await resolveQnsExamIdForInterviewRubric(examIdParam);
    parts.push('qns_exam_id = ?');
    params.push(qns != null ? qns : e);
    if (qns != null && qns !== e) {
      parts.push('qns_exam_id = ?');
      params.push(e);
    }
  }
  return { sql: '(' + parts.join(' OR ') + ')', params };
}

function interviewRubricExamIdSelectExpr(cols) {
  const hasQms = cols.has('qms_exam_id');
  const hasQns = cols.has('qns_exam_id');
  if (hasQms && hasQns) {
    return 'COALESCE(NULLIF(exam_id, 0), NULLIF(qms_exam_id, 0), NULLIF(qns_exam_id, 0)) AS exam_id';
  }
  if (hasQms) return 'COALESCE(NULLIF(exam_id, 0), qms_exam_id) AS exam_id';
  if (hasQns) return 'COALESCE(NULLIF(exam_id, 0), NULLIF(qns_exam_id, 0)) AS exam_id';
  return 'exam_id';
}

/**
 * 线上旧库可能已有 interview_rubrics 表但列名为 interview_exam_id / qms_exam_id / qns_exam_id 等。
 * CREATE TABLE IF NOT EXISTS 不会升级旧表结构，须在运行时对齐。
 */
async function ensureInterviewRubricsExamIdColumn() {
  try {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'interview_rubrics'`
    );
    if (!rows || rows.length === 0) return;
    const colNames = rows.map((r) => String(r.COLUMN_NAME || ''));
    const lower = new Set(colNames.map((c) => c.toLowerCase()));

    // 仅有 qms_exam_id、无 exam_id → 重命名为 exam_id（与旧 QMS 库兼容）
    if (!lower.has('exam_id') && lower.has('qms_exam_id')) {
      const legacy = colNames.find((c) => c.toLowerCase() === 'qms_exam_id');
      if (legacy && /^[a-zA-Z0-9_]+$/.test(legacy)) {
        await pool.execute(
          `ALTER TABLE interview_rubrics CHANGE COLUMN \`${legacy}\` exam_id INT NOT NULL COMMENT '考试ID'`
        );
        console.log('[interview] interview_rubrics：已将列 qms_exam_id 重命名为 exam_id');
        invalidateInterviewRubricsColumnCache();
        return;
      }
    }

    // 同时存在 exam_id 与 qms_exam_id：INSERT 须写两列
    if (lower.has('exam_id') && lower.has('qms_exam_id')) {
      console.log(
        '[interview] interview_rubrics 同时存在 exam_id 与 qms_exam_id，保存评分表时将同步写入两列。'
      );
      invalidateInterviewRubricsColumnCache();
      return;
    }

    // 仅有 qns_exam_id（外键指向 qns_exams）、无 exam_id → 增加 exam_id 便于与 exams 对齐
    if (!lower.has('exam_id') && lower.has('qns_exam_id')) {
      await pool.execute(
        `ALTER TABLE interview_rubrics ADD COLUMN exam_id INT NULL COMMENT 'exams.id（与 qns_exam_id 并行）' AFTER id`
      );
      try {
        await pool.execute('UPDATE interview_rubrics SET exam_id = qns_exam_id WHERE exam_id IS NULL');
      } catch (_) {
        /* ignore */
      }
      console.log('[interview] interview_rubrics：已新增 exam_id 列（与 qns_exam_id 并存）');
      invalidateInterviewRubricsColumnCache();
      return;
    }

    // 同时存在 exam_id 与 qns_exam_id（常见旧库）：写入时须填合法 qns_exam_id
    if (lower.has('exam_id') && lower.has('qns_exam_id')) {
      console.log(
        '[interview] interview_rubrics 同时存在 exam_id 与 qns_exam_id，保存评分表时将写入 qns_exams 中存在的 qns_exam_id。'
      );
      invalidateInterviewRubricsColumnCache();
      return;
    }

    if (lower.has('exam_id')) return;

    const legacyInterview = colNames.find((c) => c.toLowerCase() === 'interview_exam_id');
    if (legacyInterview && /^[a-zA-Z0-9_]+$/.test(legacyInterview)) {
      await pool.execute(
        `ALTER TABLE interview_rubrics CHANGE COLUMN \`${legacyInterview}\` exam_id INT NOT NULL COMMENT '考试ID'`
      );
      console.log('[interview] interview_rubrics：已将列 interview_exam_id 重命名为 exam_id');
      invalidateInterviewRubricsColumnCache();
      return;
    }

    await pool.execute(
      `ALTER TABLE interview_rubrics ADD COLUMN exam_id INT NOT NULL DEFAULT 0 COMMENT '考试ID' AFTER id`
    );
    console.warn(
      '[interview] interview_rubrics 未找到 interview_exam_id/qms_exam_id/qns_exam_id，已新增 exam_id（默认0）。请在库中核对旧数据或重新保存评分表。'
    );
    invalidateInterviewRubricsColumnCache();
  } catch (e) {
    console.warn('[interview] ensureInterviewRubricsExamIdColumn:', e.message);
  }
}

// 初始化面试相关表（评分表 + 考官绑定）
async function initializeInterviewTables() {
  // 评分表配置表
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS interview_rubrics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL COMMENT '考试ID',
      item_order INT NOT NULL DEFAULT 0 COMMENT '排序',
      item_name VARCHAR(255) NOT NULL COMMENT '测评要素名称',
      item_description VARCHAR(1000) DEFAULT NULL COMMENT '测评要素说明',
      max_score DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '该要素满分',
      weight DECIMAL(10,4) DEFAULT 1 COMMENT '权重（预留）',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_interview_rubrics_exam_id (exam_id),
      CONSTRAINT fk_eint_rubrics_ref_exams
        FOREIGN KEY (exam_id) REFERENCES exams(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='面试评分表配置';
  `);

  await ensureInterviewRubricsExamIdColumn();

  // 面试考场表（一场考试可设多个考场）
  // 注意：MySQL 中外键约束名须在库内唯一；短名如 fk_interview_rooms_exam 易与他表迁移脚本冲突导致 errno 121
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS exam_interview_rooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL COMMENT '考试ID',
      name VARCHAR(100) NOT NULL COMMENT '考场名称',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '排序',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_exam_interview_rooms_exam (exam_id),
      CONSTRAINT fk_eint_rooms_ref_exams
        FOREIGN KEY (exam_id) REFERENCES exams(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='面试考场表';
  `);

  // 面试考官绑定表（考试 ↔ 阅卷子账号，可选考场）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS exam_interview_examiners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL COMMENT '考试ID',
      room_id INT NULL COMMENT '考场ID，NULL表示未分配考场',
      grading_account_id INT NOT NULL COMMENT '阅卷子账号ID',
      role VARCHAR(50) DEFAULT 'interviewer' COMMENT '角色：interviewer-考官, chief-主考',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_examiners_exam_room (exam_id, room_id),
      INDEX idx_examiners_exam (exam_id),
      INDEX idx_examiners_room (room_id),
      INDEX idx_examiners_ga (grading_account_id),
      CONSTRAINT fk_eint_examiners_ref_exams
        FOREIGN KEY (exam_id) REFERENCES exams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_eint_examiners_ref_rooms
        FOREIGN KEY (room_id) REFERENCES exam_interview_rooms(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_eint_examiners_ref_grading_acct
        FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='面试考官绑定表';
  `);

  // 兼容旧库：若表已存在且无 room_id，则添加列
  try {
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_interview_examiners' AND COLUMN_NAME = 'room_id'`
    );
    if (!cols || cols.length === 0) {
      await pool.execute(`ALTER TABLE exam_interview_examiners ADD COLUMN room_id INT NULL COMMENT '考场ID' AFTER exam_id`);
      try {
        await pool.execute(`ALTER TABLE exam_interview_examiners DROP INDEX uk_exam_account`);
      } catch (_) {}
      try {
        await pool.execute(`ALTER TABLE exam_interview_examiners ADD INDEX idx_examiners_exam_room (exam_id, room_id)`);
      } catch (_) {}
    }
  } catch (alterErr) {
    console.warn('exam_interview_examiners room_id migration:', alterErr.message);
  }

  // 考官序号（考官一、考官二等）：若表已存在且无 sequence_no，则添加列
  try {
    const [seqCols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_interview_examiners' AND COLUMN_NAME = 'sequence_no'`
    );
    if (!seqCols || seqCols.length === 0) {
      await pool.execute(`ALTER TABLE exam_interview_examiners ADD COLUMN sequence_no INT DEFAULT NULL COMMENT '考官序号(1=考官一)' AFTER role`);
    }
  } catch (seqErr) {
    console.warn('exam_interview_examiners sequence_no migration:', seqErr.message);
  }

  // 面试评分记录表
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS interview_grading_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL COMMENT '考试ID',
      session_id INT NOT NULL COMMENT '考试会话ID',
      rubric_item_id INT NOT NULL COMMENT '评分表条目ID',
      grading_account_id INT NOT NULL COMMENT '阅卷子账号ID',
      score DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '得分',
      comment TEXT NULL COMMENT '评语',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_exam_session_item_grader (exam_id, session_id, rubric_item_id, grading_account_id),
      INDEX idx_igr_exam_session (exam_id, session_id),
      CONSTRAINT fk_eint_igr_ref_exams
        FOREIGN KEY (exam_id) REFERENCES exams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_eint_igr_ref_sessions
        FOREIGN KEY (session_id) REFERENCES exam_sessions(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_eint_igr_ref_rubrics
        FOREIGN KEY (rubric_item_id) REFERENCES interview_rubrics(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_eint_igr_ref_grading_acct
        FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='面试评分记录表';
  `);

  // 旧库可能早已存在无 exam_id 的 interview_grading_records；CREATE IF NOT EXISTS 不会补列，会导致 WHERE exam_id 报错
  try {
    const igrCols = await fetchTableColumnsSet('interview_grading_records');
    if (igrCols && igrCols.size) {
      const lower = new Set([...igrCols].map((c) => String(c).toLowerCase()));
      if (!lower.has('exam_id')) {
        await pool.execute(
          `ALTER TABLE interview_grading_records ADD COLUMN exam_id INT NULL COMMENT '考试ID' AFTER id`
        );
        await pool.execute(
          `UPDATE interview_grading_records igr
           INNER JOIN exam_sessions s ON s.id = igr.session_id
           SET igr.exam_id = s.exam_id
           WHERE igr.exam_id IS NULL`
        );
        try {
          await pool.execute(
            `ALTER TABLE interview_grading_records MODIFY COLUMN exam_id INT NOT NULL COMMENT '考试ID'`
          );
        } catch (ne) {
          console.warn('[interview] interview_grading_records.exam_id 设为 NOT NULL 跳过（存在无法关联会话的行）:', ne.message);
        }
        try {
          await pool.execute(
            `ALTER TABLE interview_grading_records ADD INDEX idx_igr_exam_session (exam_id, session_id)`
          );
        } catch (_) {}
      }
    }
  } catch (mig) {
    console.warn('[interview] interview_grading_records 补 exam_id 列:', mig.message);
  }

  // 监督员签字表（每场考试一份汇总表，监督员签字一次）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS exam_interview_supervisor_signature (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL COMMENT '考试ID',
      grading_account_id INT NOT NULL COMMENT '签字人（监督员）子账号ID',
      signature_image MEDIUMTEXT NULL COMMENT '签字图片 base64',
      signed_at DATETIME NULL COMMENT '签字时间',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_supervisor_sig_exam (exam_id),
      CONSTRAINT fk_eint_sup_sig_ref_exams FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      CONSTRAINT fk_eint_sup_sig_ref_ga FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='面试监督员签字';
  `);

  await refreshInterviewDynamicGraderColumns();
}

/** 进程内只执行一次 DDL/迁移，避免每次请求跑 initializeInterviewTables 导致超时或 502 */
let interviewTablesInitPromise = null;

async function ensureInterviewTablesInitialized() {
  if (!interviewTablesInitPromise) {
    interviewTablesInitPromise = initializeInterviewTables().catch((err) => {
      interviewTablesInitPromise = null;
      console.error('[interview] initializeInterviewTables failed:', err?.message || err);
      throw err;
    });
  }
  await interviewTablesInitPromise;
}

async function getExamPapersColumnSet() {
  try {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'exam_papers'`
    );
    return new Set((rows || []).map((r) => String(r.COLUMN_NAME || '').toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

let interviewSqlEieGraderCol = 'grading_account_id';
let interviewSqlIgrGraderCol = 'grading_account_id';

async function refreshInterviewDynamicGraderColumns() {
  try {
    const eieCol = await resolveInterviewGraderColumn('exam_interview_examiners');
    const igrCol = await resolveInterviewGraderColumn('interview_grading_records');
    interviewSqlEieGraderCol = eieCol || 'grading_account_id';
    interviewSqlIgrGraderCol = igrCol || 'grading_account_id';
  } catch (_) {
    interviewSqlEieGraderCol = 'grading_account_id';
    interviewSqlIgrGraderCol = 'grading_account_id';
  }
}

function getInterviewFlowModeFromExam(exam) {
  const ic = (exam && exam.answer_system_config && exam.answer_system_config.interviewConfig) || {};
  const m = ic.interviewFlowMode;
  if (m === 'prerecord' || m === 'online') return m;
  return 'legacy';
}

/** @returns {Promise<{ gateOpenAt: Date|string|null, confirmPending: number }>} */
async function fetchExamPrerecordGateRow(examId) {
  try {
    const [r] = await pool.execute(
      `SELECT interview_prerecord_gate_open_at AS gate, interview_prerecord_confirm_pending AS pend FROM exams WHERE id = ?`,
      [examId]
    );
    const row = r[0] || {};
    return { gateOpenAt: row.gate || null, confirmPending: Number(row.pend) || 0 };
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') return { gateOpenAt: null, confirmPending: 0 };
    throw e;
  }
}

/**
 * 提前录制：按策略自动到点置「待确认」或「已开放」。
 * @param {import('../models/examModel').Exam} exam
 */
async function tryPrerecordScheduleAutoOpen(exam) {
  const eid = Number(exam.id);
  if (!Number.isFinite(eid) || eid <= 0) return;
  if (getInterviewFlowModeFromExam(exam) !== 'prerecord') return;
  const ic = (exam.answer_system_config || {}).interviewConfig || {};
  const policy = String(ic.prerecordStartPolicy || 'manual').trim();
  if (policy === 'manual') return;
  const raw = ic.prerecordScheduledStartAt;
  if (raw == null || String(raw).trim() === '') return;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t) || Date.now() < t) return;
  const { gateOpenAt, confirmPending } = await fetchExamPrerecordGateRow(eid);
  if (gateOpenAt) return;
  if (policy === 'scheduled') {
    try {
      await pool.execute(
        `UPDATE exams SET interview_prerecord_gate_open_at = CURRENT_TIMESTAMP, interview_prerecord_confirm_pending = 0 WHERE id = ?`,
        [eid]
      );
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
    return;
  }
  if (policy === 'scheduled_confirm' && !confirmPending) {
    try {
      await pool.execute(`UPDATE exams SET interview_prerecord_confirm_pending = 1 WHERE id = ?`, [eid]);
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
  }
}

/**
 * 线上模式：交卷后自动推进叫号（不校验监督员口令）。
 * @param {number} examId
 * @param {number} submittedUserId
 */
async function maybeAutoAdvanceInterviewAfterSubmit(examId, submittedUserId) {
  const exam = await ExamModel.findById(examId);
  if (!exam) return;
  const ic = (exam.answer_system_config || {}).interviewConfig || {};
  if (getInterviewFlowModeFromExam(exam) !== 'online' || !ic.onlineAutoAdvanceOnSubmit) return;
  await refreshInterviewDynamicGraderColumns();
  let currentDraw = null;
  try {
    const [r] = await pool.execute('SELECT interview_current_draw_number FROM exams WHERE id = ?', [examId]);
    currentDraw = r[0] && r[0].interview_current_draw_number != null ? Number(r[0].interview_current_draw_number) : null;
  } catch (_) {
    return;
  }
  const [enRows] = await pool.execute(
    `SELECT en.user_id, en.draw_number FROM exam_enrollments en WHERE en.exam_id = ? ORDER BY COALESCE(en.draw_number, 9999) ASC, en.id ASC`,
    [examId]
  ).catch(() => [[]]);
  const enrollments = dedupeEnrollmentsForDrawSchedule(enRows || []);
  const sorted = enrollments.filter((e) => e.draw_number != null).sort((a, b) => (a.draw_number || 9999) - (b.draw_number || 9999));
  if (!sorted.length) return;
  const currentIndex = currentDraw == null ? -1 : sorted.findIndex((e) => e.draw_number === currentDraw);
  const currentEn = currentIndex >= 0 && currentIndex < sorted.length ? sorted[currentIndex] : null;
  if (!currentEn || Number(currentEn.user_id) !== Number(submittedUserId)) return;
  const [sessionRows] = await pool.execute(
    'SELECT id, status FROM exam_sessions WHERE exam_id = ? AND user_id = ? LIMIT 1',
    [examId, submittedUserId]
  );
  const currentSession = sessionRows[0];
  if (!currentSession || currentSession.status !== 'submitted') return;
  const [examinerRows] = await pool.execute(
    `SELECT DISTINCT ${eieGraderQualified('eie')} AS grading_account_id FROM exam_interview_examiners eie WHERE eie.exam_id = ?`,
    [examId]
  );
  const [savedRows] = await pool.execute(
    `SELECT DISTINCT ${igrGraderColQ()} AS grading_account_id FROM interview_grading_records WHERE exam_id = ? AND session_id = ?`,
    [examId, currentSession.id]
  );
  const examinerIds = new Set((examinerRows || []).map((row) => row.grading_account_id));
  const savedIds = new Set((savedRows || []).map((row) => row.grading_account_id));
  const missing = [...examinerIds].filter((id) => !savedIds.has(id));
  if (missing.length > 0) return;
  const nextIndex = currentDraw == null ? 0 : sorted.findIndex((e) => e.draw_number === currentDraw) + 1;
  const nextEn = nextIndex >= 0 && nextIndex < sorted.length ? sorted[nextIndex] : null;
  const nextDrawNumber = nextEn ? nextEn.draw_number : null;
  if (nextDrawNumber != null) {
    await pool.execute('UPDATE exams SET interview_current_draw_number = ? WHERE id = ?', [nextDrawNumber, examId]);
  }
}

function sqlQuoteIdentInterview(name) {
  const s = String(name || '').replace(/`/g, '');
  return s ? `\`${s}\`` : '`grading_account_id`';
}

function eieGraderColQ() {
  return sqlQuoteIdentInterview(interviewSqlEieGraderCol);
}

function igrGraderColQ() {
  return sqlQuoteIdentInterview(interviewSqlIgrGraderCol);
}

/**
 * 查询某会话的面试评分记录；若动态列名与库表不一致（Unknown column），刷新列缓存后重试一次。
 * @param {number} examId
 * @param {number} sessionId
 * @param {number|null} graderId 为 null 时不按考官过滤（企业端或工作人员查看）
 */
async function fetchInterviewGradingRowsForSession(examId, sessionId, graderId) {
  await refreshInterviewDynamicGraderColumns();
  const params = [examId, sessionId];
  let sql =
    'SELECT * FROM interview_grading_records WHERE exam_id = ? AND session_id = ?';
  if (graderId != null) {
    sql += ` AND ${igrGraderColQ()} = ?`;
    params.push(graderId);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows || [];
    } catch (e) {
      const msg = (e && e.message) || '';
      const isBadField =
        (e && e.code === 'ER_BAD_FIELD_ERROR') ||
        msg.includes('Unknown column') ||
        msg.includes('doesn\'t exist');
      if (attempt === 0 && isBadField) {
        await refreshInterviewDynamicGraderColumns();
        sql =
          'SELECT * FROM interview_grading_records WHERE exam_id = ? AND session_id = ?';
        if (graderId != null) {
          sql += ` AND ${igrGraderColQ()} = ?`;
        }
        continue;
      }
      throw e;
    }
  }
  return [];
}

/**
 * 会话列表 LEFT JOIN 报名表的签号在「主号进场、副号报名」等场景下为 NULL；用与考生端一致的同手机号报名解析补全 draw_number。
 * @param {number|string} examId
 * @param {Array<Record<string, unknown>>} sessions
 */
async function mergeInterviewSessionDrawNumbersFromEnrollment(examId, sessions) {
  const eid = Number(examId);
  if (!Number.isFinite(eid) || eid <= 0 || !Array.isArray(sessions) || !sessions.length) return;
  const needFix = sessions.filter((row) => {
    if (!row || row.user_id == null) return false;
    const dn = row.draw_number;
    return dn == null || dn === '' || (typeof dn === 'string' && String(dn).trim() === '');
  });
  await Promise.all(
    needFix.map(async (row) => {
      try {
        const en = await ExamEnrollmentModel.findByExamForLoginUser(eid, row.user_id);
        if (en != null && en.draw_number != null && en.draw_number !== '') {
          row.draw_number = en.draw_number;
        }
      } catch (_) {}
    })
  );
}

/** 有 draw_number 的报名行优先（避免 LEFT JOIN 多行时丢签号） */
function hasDrawNumberRow(r) {
  return r && r.draw_number != null && String(r.draw_number).trim() !== '';
}

/**
 * 考官端/汇总列表：同一 exam_sessions 行或同一考生多条会话时只保留一条，避免出现两个「1号」等重复展示。
 * 1) 先按 session id 合并（多报名 JOIN 笛卡尔）
 * 2) 再按 user_id 保留一条：ongoing > pending > submitted，同状态取 id 较大者
 * 3) 再按 draw_number 合并：同一签号仍多条时只保留一条（同上优先级），用于不同账号重复签号等脏数据
 */
function dedupeInterviewSessionsForGraderList(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) return [];
  const bySessionId = new Map();
  for (const row of sessions) {
    if (!row || row.id == null) continue;
    const sid = Number(row.id);
    if (!Number.isFinite(sid)) continue;
    if (!bySessionId.has(sid)) {
      bySessionId.set(sid, { ...row });
      continue;
    }
    const prev = bySessionId.get(sid);
    if (hasDrawNumberRow(row) && !hasDrawNumberRow(prev)) bySessionId.set(sid, { ...row });
  }
  const uniqueBySid = Array.from(bySessionId.values());

  function pickPreferredSessionRow(candidates) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const ongoing = candidates.filter((c) => c.status === 'ongoing');
    if (ongoing.length) return ongoing.sort((a, b) => Number(b.id) - Number(a.id))[0];
    const submitted = candidates.filter((c) => c.status === 'submitted' || c.status === 'force_submitted');
    if (submitted.length) return submitted.sort((a, b) => Number(b.id) - Number(a.id))[0];
    const pending = candidates.filter((c) => c.status === 'pending');
    if (pending.length) return pending.sort((a, b) => Number(b.id) - Number(a.id))[0];
    return candidates.sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  const byUserId = new Map();
  for (const row of uniqueBySid) {
    const uid = row.user_id;
    if (uid == null) continue;
    const k = Number(uid);
    if (!Number.isFinite(k)) continue;
    const arr = byUserId.get(k) || [];
    arr.push(row);
    byUserId.set(k, arr);
  }
  const out = [];
  for (const arr of byUserId.values()) {
    const picked = pickPreferredSessionRow(arr);
    if (picked) out.push(picked);
  }

  // 3) 同一签号仍对应多条会话（多为不同 user_id 重复抽签号或历史脏数据）：列表只保留一条，避免考官端两个「3号」。
  // 优先 ongoing > pending > submitted，同状态取 id 较大者。若业务上确有多人同号，须在 exam_enrollments 修正签号。
  const byDraw = new Map();
  const noDraw = [];
  for (const row of out) {
    if (!hasDrawNumberRow(row)) {
      noDraw.push(row);
      continue;
    }
    const d = Number(row.draw_number);
    if (!Number.isFinite(d)) {
      noDraw.push(row);
      continue;
    }
    const arr = byDraw.get(d) || [];
    arr.push(row);
    byDraw.set(d, arr);
  }
  const drawMerged = [];
  for (const arr of byDraw.values()) {
    const picked = pickPreferredSessionRow(arr);
    if (picked) drawMerged.push(picked);
  }
  const merged = [...drawMerged, ...noDraw];
  merged.sort((a, b) => {
    const da = hasDrawNumberRow(a) ? Number(a.draw_number) : 9999;
    const db = hasDrawNumberRow(b) ? Number(b.draw_number) : 9999;
    if (da !== db) return da - db;
    return Number(a.id) - Number(b.id);
  });
  return merged;
}

/**
 * 同一场考试、同一 user_id 多条报名时只保留一条（优先有签号的，否则 id 较大者），
 * 避免叫号/「下一位」与考官列表出现重复签号（非串项目，多为重复导入或同人多条 en）。
 */
function dedupeEnrollmentsForDrawSchedule(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const byUid = new Map();
  for (const e of rows) {
    if (!e || e.user_id == null) continue;
    const uid = Number(e.user_id);
    if (!Number.isFinite(uid)) continue;
    const prev = byUid.get(uid);
    if (!prev) {
      byUid.set(uid, e);
      continue;
    }
    const hasDn = (r) => r != null && r.draw_number != null && String(r.draw_number).trim() !== '';
    if (hasDn(e) && !hasDn(prev)) byUid.set(uid, e);
    else if (hasDn(e) === hasDn(prev)) {
      const idE = e.id != null ? Number(e.id) : 0;
      const idP = prev.id != null ? Number(prev.id) : 0;
      if (idE > idP) byUid.set(uid, e);
    }
  }
  return Array.from(byUid.values());
}

/** 带表别名：eie.`grading_account_id`（或旧库 account_id 等） */
function eieGraderQualified(alias = 'eie') {
  const a = String(alias || 'eie').replace(/`/g, '');
  return `${a}.${sqlQuoteIdentInterview(interviewSqlEieGraderCol)}`;
}

/** 计时计分员（仅 staffAccountIds、非监督员、且非本场绑定考官）切换叫号需监督确认 */
async function assertTimerAdvanceSupervisorConfirmation(req, exam) {
  if (req.user.role !== 'grader') return;
  const graderId = req.user.graderId || req.user.id;
  const { asc, staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
  const ic = asc.interviewConfig || {};
  if (!staffIds.includes(String(graderId)) || supervisorIds.includes(String(graderId))) return;

  const examId = Number(exam.id);
  const eieCol = eieGraderColQ();
  const [eie] = await pool.execute(
    `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieCol} = ? LIMIT 1`,
    [examId, graderId]
  );
  if (eie.length) return;

  const pin = (ic.advanceSupervisorPin || '').toString().trim();
  const body = req.body || {};
  if (pin) {
    const got = (body.supervisorPin || '').toString().trim();
    if (got !== pin) {
      const err = new Error('监督员口令不正确或未填写');
      err.statusCode = 400;
      throw err;
    }
    return;
  }
  if (!body.supervisorAcknowledged) {
    const err = new Error('请由监督员确认后再切换叫号（或由企业在面试配置中设置监督员口令 advanceSupervisorPin）');
    err.statusCode = 400;
    throw err;
  }
}

async function computeTimerAdvanceAckFlags(exam, req) {
  const out = { requiresStaffAdvanceAck: false, advanceSupervisorPinConfigured: false };
  if (req.user.role !== 'grader') return out;
  const graderId = req.user.graderId || req.user.id;
  const { asc, staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
  const ic = asc.interviewConfig || {};
  out.advanceSupervisorPinConfigured = !!(ic.advanceSupervisorPin || '').toString().trim();
  if (!staffIds.includes(String(graderId)) || supervisorIds.includes(String(graderId))) return out;
  const examId = Number(exam.id);
  const eieCol = eieGraderColQ();
  const [eie] = await pool.execute(
    `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieCol} = ? LIMIT 1`,
    [examId, graderId]
  );
  if (eie.length) return out;
  out.requiresStaffAdvanceAck = true;
  return out;
}

// Multer 存储配置（按考试/会话分目录）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const examId = req.body.examId || req.body.exam_id || '0';
    const sessionId = req.body.sessionId || req.body.session_id || '0';
    const dir = path.join(AUDIO_UPLOAD_DIR, String(examId), String(sessionId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    let ext = 'webm';
    if (mime.includes('mp3')) ext = 'mp3';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('wav')) ext = 'wav';
    cb(null, `audio_${Date.now()}.${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 单个录音最大 100MB
});

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const examId = req.params.examId || '0';
    const sessionId = req.params.sessionId || '0';
    const dir = path.join(VIDEO_UPLOAD_DIR, String(examId), String(sessionId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const kind = (req.body && req.body.kind ? String(req.body.kind) : 'front').replace(/[^a-z]/gi, '').slice(0, 8) || 'front';
    const lower = (file.originalname || '').toLowerCase();
    const ext = lower.endsWith('.mp4') ? 'mp4' : 'webm';
    cb(null, `${kind}_${Date.now()}.${ext}`);
  }
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 512 * 1024 * 1024 }
});

// 所有接口都需要登陆
router.use(authenticate);

// 面试考试设置是否已完成（总管理端/企业端开启考试前校验）
router.get(
  '/interview-exams/:examId/settings-complete',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = req.params.examId;
      const exam = await ExamModel.findById(examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      const cols = await getInterviewRubricsColumnNames();
      const { sql: rubWhere, params: rubParams } = await interviewRubricWhereForExam(examId, cols);
      const [rubricRows] = await pool.execute(
        `SELECT 1 FROM interview_rubrics WHERE ${rubWhere} LIMIT 1`,
        rubParams
      );
      const [examinerRows] = await pool.execute('SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? LIMIT 1', [examId]);
      const { staffIds } = getStaffSupervisorIdsForExam(exam);
      const hasRubric = (rubricRows && rubricRows.length) > 0;
      const hasExaminer = (examinerRows && examinerRows.length) > 0;
      const hasStaff = staffIds.length > 0;
      const complete = hasRubric && hasExaminer && hasStaff;
      let message = '';
      if (!complete) {
        const missing = [];
        if (!hasRubric) missing.push('评分表');
        if (!hasExaminer) missing.push('考官');
        if (!hasStaff) missing.push('计时计分工作人员');
        message = '请先完成面试考试设置：' + missing.join('、');
      }
      res.json({ success: true, complete, message: message || undefined });
    } catch (e) {
      console.error('Settings complete check error:', e);
      res.status(500).json({ success: false, message: e.message || '检查失败' });
    }
  }
);

// 当前考官的面试考试列表（含仅计时计分工作人员可见的考试，带 isStaffOnly 标记）
router.get(
  '/my-exams',
  requireRole('grader'),
  async (req, res) => {
    try {
      try {
        await ensureInterviewTablesInitialized();
      } catch (initErr) {
        // 初始化失败不应阻断已存在表的查询
        console.warn('initializeInterviewTables for /my-exams:', initErr?.message || initErr);
      }
      const graderId = req.user.graderId || req.user.id;
      const paperCols = await getExamPapersColumnSet();
      await refreshInterviewDynamicGraderColumns();
      const examinerColQualified = eieGraderQualified('eie');
      const paperNameExpr = paperCols.has('paper_name')
        ? 'p.paper_name'
        : paperCols.has('name')
          ? 'p.name AS paper_name'
          : 'NULL AS paper_name';
      const examTypeExpr = paperCols.has('exam_type') ? 'p.exam_type' : 'NULL AS exam_type';
      const interviewFilter = paperCols.has('exam_type') ? `WHERE p.exam_type = 'interview'` : '';
      const [rows] = await pool.execute(
        `SELECT e.id, e.name, e.start_time, e.end_time, ${paperNameExpr}, ${examTypeExpr}, e.answer_system_config
         FROM exam_interview_examiners eie
         JOIN exams e ON eie.exam_id = e.id
         LEFT JOIN exam_papers p ON e.paper_id = p.id
         WHERE ${examinerColQualified} = ?
         ORDER BY e.start_time DESC, e.id DESC`,
        [graderId]
      );
      const examinerExamIds = new Set((rows || []).map((r) => r.id));
      const result = (rows || []).map((r) => {
        const { answer_system_config, ...rest } = r;
        return { ...rest, isStaffOnly: false };
      });
      // 面试类型在试卷表 exam_papers.exam_type，不在 exams 表；用 p.exam_type 才能正确筛出面试考试，使计时计分/监督员账号能看到考试列表
      const [allInterviewRows] = await pool.execute(
        `SELECT e.id, e.name, e.start_time, e.end_time, ${paperNameExpr}, ${examTypeExpr}, e.answer_system_config
         FROM exams e
         LEFT JOIN exam_papers p ON e.paper_id = p.id
         ${interviewFilter}
         ORDER BY e.start_time DESC, e.id DESC`
      ).catch((err) => {
        console.warn('Get all interview exams error:', err?.message);
        return [[]];
      });
      for (const row of allInterviewRows || []) {
        if (examinerExamIds.has(row.id)) continue;
        const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam({ answer_system_config: row.answer_system_config });
        if (staffIds.some((id) => id === String(graderId)) || supervisorIds.some((id) => id === String(graderId))) {
          const { answer_system_config, ...rest } = row;
          result.push({ ...rest, isStaffOnly: true });
        }
      }
      result.sort((a, b) => new Date(b.start_time || 0) - new Date(a.start_time || 0));
      res.json({ success: true, data: result });
    } catch (e) {
      console.error('Get my interview exams error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 上传面试录音（考生端）
router.post(
  '/recordings',
  requireRole('candidate', 'user', 'admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      await ExamAudioRecordingModel.initializeTable();

      const sessionId = req.body.sessionId || req.body.session_id;
      const subQuestionId = req.body.subQuestionId || req.body.sub_question_id || null;
      const durationSeconds = parseFloat(req.body.durationSeconds || req.body.duration_seconds) || 0;

      if (!sessionId || !req.file) {
        return res
          .status(400)
          .json({ success: false, message: 'sessionId 和 file 为必填项' });
      }

      const session = await ExamSessionModel.findById(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, message: '会话不存在' });
      }
      if (req.user.role === 'candidate' && !sessionOwnedByUser(session, req.user.id)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }

      const relativePath = path
        .relative(path.join(__dirname, '..'), req.file.path)
        .replace(/\\/g, '/');

      const id = await ExamAudioRecordingModel.create({
        sessionId: session.id,
        subQuestionId: subQuestionId ? Number(subQuestionId) : null,
        filePath: relativePath,
        fileSize: req.file.size,
        durationSeconds
      });

      res.json({
        success: true,
        data: {
          id,
          filePath: relativePath
        }
      });
    } catch (e) {
      console.error('Upload interview recording error:', e);
      res.status(500).json({ success: false, message: e.message || '上传失败' });
    }
  }
);


// 获取某场面试考试的考生会话列表（企业/总管理/考官端/计时计分工作人员）
router.get(
  '/interview-exams/:examId/sessions',
  requireRole('admin', 'enterprise', 'enterprise_reviewer', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise' || req.user.role === 'enterprise_reviewer') {
        let allowedEntId = null;
        if (req.enterpriseId != null && String(req.enterpriseId).trim() !== '') {
          const n = Number(req.enterpriseId);
          if (Number.isFinite(n) && n > 0) allowedEntId = n;
        }
        if (allowedEntId == null) {
          const ent = await EnterpriseModel.findByUserId(req.user.id);
          if (ent) allowedEntId = ent.id;
        }
        if (!allowedEntId || Number(exam.enterprise_id) !== Number(allowedEntId)) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      // 考官端：须为绑定考官、计时计分工作人员或监督员
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [rows] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners 
           WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [req.params.examId, graderId]
        );
        if (!rows.length) {
          const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
          if (!staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
            return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
          }
        }
      }

      const { joinTableSql: candJoin, userSelectSql: candUserCols } =
        await ExamEnrollmentModel.getExamSessionUserJoinFragments();
      // 仅含本场已报名考生：INNER JOIN enrollments，避免无报名占位会话（测试账号等）混入列表导致签号/状态重复感
      // 带签号并按签号排序（1号、2号…）；无 draw_number 或 room_entered_at 列时降级；考生表为 qms_users 时无 real_name 列须动态选列
      let sessions = [];
      try {
        const [rows] = await pool.execute(
          `SELECT s.id, s.user_id, s.status, s.total_score, s.submitted_at, s.started_at, s.room_entered_at,
                  ${candUserCols},
                  en.draw_number
           FROM exam_sessions s
           JOIN ${candJoin} u ON s.user_id = u.id
           INNER JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
           WHERE s.exam_id = ?
           ORDER BY COALESCE(en.draw_number, 9999) ASC, s.id ASC`,
          [req.params.examId]
        );
        sessions = rows || [];
      } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR' && ((err.message || '').includes('draw_number') || (err.message || '').includes('room_entered_at'))) {
          const [rows] = await pool.execute(
            `SELECT s.id, s.user_id, s.status, s.total_score, s.submitted_at, s.started_at,
                    ${candUserCols}
             FROM exam_sessions s
             JOIN ${candJoin} u ON s.user_id = u.id
             WHERE s.exam_id = ?
             ORDER BY s.submitted_at DESC, s.id DESC`,
            [req.params.examId]
          );
          sessions = (rows || []).map((r) => ({ ...r, draw_number: null, room_entered_at: null }));
        } else {
          throw err;
        }
      }

      await mergeInterviewSessionDrawNumbersFromEnrollment(req.params.examId, sessions);
      sessions = dedupeInterviewSessionsForGraderList(sessions);

      res.json({ success: true, data: sessions });
    } catch (e) {
      console.error('Get interview sessions error:', e);
      const msg = e.message || '获取失败';
      const code = e.code || '';
      if (code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(msg)) {
        return res.status(503).json({
          success: false,
          message: '数据库结构未就绪，请执行面试相关迁移后重试',
          detail: msg
        });
      }
      res.status(500).json({ success: false, message: msg });
    }
  }
);

// 考官：允许某考生开始答题（顺序入场时由考官点击「开始答题」触发）
router.post(
  '/interview-exams/:examId/sessions/:sessionId/allow-start',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const sessionId = Number(req.params.sessionId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [gr] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        if (!gr.length) {
          const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
          if (!staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
            return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
          }
        }
      }
      const [sessions] = await pool.execute('SELECT * FROM exam_sessions WHERE id = ? AND exam_id = ?', [sessionId, examId]);
      const session = sessions[0];
      if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
      if (session.status !== 'pending') {
        return res.json({ success: true, message: '已开始或已交卷', data: session });
      }
      const asc = exam.answer_system_config || {};
      const ic = asc.interviewConfig || {};
      const sequentialEntry =
        ic.sequentialEntry === true || ic.interviewFlowMode === 'online';
      if (sequentialEntry && session.room_entered_at == null) {
        return res.status(400).json({ success: false, message: '请等待考生进入考场后再开始答题' });
      }
      await ExamSessionModel.start(sessionId);
      // 设置当前答题考生抽签号，便于计时计分端「下一位」可点及考官端显示当前号
      try {
        const [enRows] = await pool.execute('SELECT draw_number FROM exam_enrollments WHERE exam_id = ? AND user_id = ?', [examId, session.user_id]);
        const drawNum = enRows[0] && enRows[0].draw_number != null ? Number(enRows[0].draw_number) : null;
        if (drawNum != null) {
          await pool.execute('UPDATE exams SET interview_current_draw_number = ? WHERE id = ?', [drawNum, examId]);
        }
      } catch (_) {}
      const [updated] = await pool.execute('SELECT * FROM exam_sessions WHERE id = ?', [sessionId]);
      res.json({ success: true, message: '已允许开始答题', data: updated[0] });
    } catch (e) {
      console.error('Allow start error:', e);
      res.status(500).json({ success: false, message: e.message || '操作失败' });
    }
  }
);

// 获取当前叫号状态（抽签系统用：当前号、下一位、待准备号，不推进）
router.get(
  '/interview-exams/:examId/current-draw-status',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [gr] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        if (!gr.length) {
          const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
          if (!staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
            return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
          }
        }
      }
      let currentDraw = null;
      try {
        const [r] = await pool.execute('SELECT interview_current_draw_number FROM exams WHERE id = ?', [examId]);
        currentDraw = r[0] && r[0].interview_current_draw_number != null ? Number(r[0].interview_current_draw_number) : null;
      } catch (_) {}
      const [enRows] = await pool.execute(
        `SELECT en.id, en.user_id, en.draw_number
         FROM exam_enrollments en
         WHERE en.exam_id = ?
         ORDER BY COALESCE(en.draw_number, 9999) ASC, en.id ASC`,
        [examId]
      ).catch(() => [[]]);
      const enrollments = dedupeEnrollmentsForDrawSchedule(enRows || []);
      const hasDraw = enrollments.some((e) => e.draw_number != null);
      if (!hasDraw) {
        return res.json({
          success: true,
          data: { currentDrawNumber: null, nextCandidate: null, waitingCandidate: null, drawSchedule: [] }
        });
      }
      const sorted = enrollments.filter((e) => e.draw_number != null).sort((a, b) => (a.draw_number || 9999) - (b.draw_number || 9999));
      const currentIndex = currentDraw == null ? -1 : sorted.findIndex((e) => e.draw_number === currentDraw);
      const nextIdx = currentIndex < 0 ? 0 : currentIndex + 1;
      const nextEn = nextIdx < sorted.length ? sorted[nextIdx] : null;
      const waitingEn = nextIdx + 1 < sorted.length ? sorted[nextIdx + 1] : null;
      const drawSchedule = sorted.map((e, idx) => ({
        order: idx + 1,
        userId: e.user_id,
        drawNumber: e.draw_number,
        isCurrent: currentDraw != null && e.draw_number === currentDraw,
        isNext: nextEn != null && e.draw_number === nextEn.draw_number,
        isWaiting: waitingEn != null && e.draw_number === waitingEn.draw_number
      }));
      res.json({
        success: true,
        data: {
          currentDrawNumber: currentDraw,
          nextCandidate: nextEn ? { drawNumber: nextEn.draw_number, userId: nextEn.user_id } : null,
          waitingCandidate: waitingEn ? { drawNumber: waitingEn.draw_number, userId: waitingEn.user_id } : null,
          drawSchedule
        }
      });
    } catch (e) {
      console.error('Current draw status error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 下一位考生（计时计分员/监督员/考官均可调用；须当前号考生已交卷且所有考官已保存评分；考官调用时满足条件即推进）
router.post(
  '/interview-exams/:examId/next-candidate',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [eie] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
        const isStaffOrSupervisor = staffIds.some((id) => id === String(graderId)) || supervisorIds.some((id) => id === String(graderId));
        if (!eie.length && !isStaffOrSupervisor) {
          return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
        }
      }
      try {
        await assertTimerAdvanceSupervisorConfirmation(req, exam);
      } catch (advErr) {
        const code = advErr.statusCode || 400;
        return res.status(code).json({ success: false, message: advErr.message || '操作被拒绝' });
      }
      let currentDraw = null;
      try {
        const [r] = await pool.execute('SELECT interview_current_draw_number FROM exams WHERE id = ?', [examId]);
        currentDraw = r[0] && r[0].interview_current_draw_number != null ? Number(r[0].interview_current_draw_number) : null;
      } catch (_) {}
      const [enRows] = await pool.execute(
        `SELECT en.id, en.user_id, en.draw_number
         FROM exam_enrollments en
         WHERE en.exam_id = ?
         ORDER BY COALESCE(en.draw_number, 9999) ASC, en.id ASC`,
        [examId]
      ).catch(() => [[]]);
      const enrollments = dedupeEnrollmentsForDrawSchedule(enRows || []);
      const hasDraw = enrollments.some((e) => e.draw_number != null);
      if (!hasDraw) {
        return res.json({ success: true, message: '未配置抽签号', data: { nextDrawNumber: null, nextCandidate: null, waitingCandidate: null } });
      }
      const sorted = enrollments.filter((e) => e.draw_number != null).sort((a, b) => (a.draw_number || 9999) - (b.draw_number || 9999));
      const currentIndex = currentDraw == null ? -1 : sorted.findIndex((e) => e.draw_number === currentDraw);
      const currentEn = currentIndex >= 0 && currentIndex < sorted.length ? sorted[currentIndex] : null;
      if (currentEn && req.user.role !== 'admin') {
        const [sessionRows] = await pool.execute(
          'SELECT id, status FROM exam_sessions WHERE exam_id = ? AND user_id = ? LIMIT 1',
          [examId, currentEn.user_id]
        );
        const currentSession = sessionRows[0];
        if (!currentSession) {
          return res.status(400).json({ success: false, message: '当前号考生暂无考试会话' });
        }
        if (currentSession.status !== 'submitted') {
          return res.status(400).json({ success: false, message: '请等待当前考生交卷后再点击下一位' });
        }
        const [examinerRows] = await pool.execute(
          `SELECT DISTINCT ${eieGraderQualified('eie')} AS grading_account_id FROM exam_interview_examiners eie WHERE eie.exam_id = ?`,
          [examId]
        );
        const [savedRows] = await pool.execute(
          `SELECT DISTINCT ${igrGraderColQ()} AS grading_account_id FROM interview_grading_records WHERE exam_id = ? AND session_id = ?`,
          [examId, currentSession.id]
        );
        const examinerIds = new Set((examinerRows || []).map((row) => row.grading_account_id));
        const savedIds = new Set((savedRows || []).map((row) => row.grading_account_id));
        const missing = [...examinerIds].filter((id) => !savedIds.has(id));
        if (missing.length > 0) {
          return res.status(400).json({ success: false, message: '请等待所有考官保存评分后再点击下一位' });
        }
      }
      const nextIndex = currentDraw == null ? 0 : sorted.findIndex((e) => e.draw_number === currentDraw) + 1;
      const nextEn = nextIndex >= 0 && nextIndex < sorted.length ? sorted[nextIndex] : null;
      const waitingEn = nextIndex + 1 >= 0 && nextIndex + 1 < sorted.length ? sorted[nextIndex + 1] : null;
      const nextDrawNumber = nextEn ? nextEn.draw_number : null;
      if (nextDrawNumber != null) {
        await pool.execute('UPDATE exams SET interview_current_draw_number = ? WHERE id = ?', [nextDrawNumber, examId]);
      }
      res.json({
        success: true,
        message: nextDrawNumber != null ? `请${nextDrawNumber}号考生进入考试${waitingEn ? `，请${waitingEn.draw_number}号考生进入候考环节` : ''}` : '已无下一名考生',
        data: {
          nextDrawNumber,
          nextCandidate: nextEn ? { drawNumber: nextEn.draw_number, userId: nextEn.user_id } : null,
          waitingCandidate: waitingEn ? { drawNumber: waitingEn.draw_number, userId: waitingEn.user_id } : null
        }
      });
    } catch (e) {
      console.error('Next candidate error:', e);
      res.status(500).json({ success: false, message: e.message || '操作失败' });
    }
  }
);

// 上一位考生：叫号指针回退（计时计分员须监督确认；当前考生答题中不可回退）
router.post(
  '/interview-exams/:examId/previous-candidate',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [eie] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
        const isStaffOrSupervisor = staffIds.some((id) => id === String(graderId)) || supervisorIds.some((id) => id === String(graderId));
        if (!eie.length && !isStaffOrSupervisor) {
          return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
        }
      }
      try {
        await assertTimerAdvanceSupervisorConfirmation(req, exam);
      } catch (advErr) {
        const code = advErr.statusCode || 400;
        return res.status(code).json({ success: false, message: advErr.message || '操作被拒绝' });
      }

      let currentDraw = null;
      try {
        const [r] = await pool.execute('SELECT interview_current_draw_number FROM exams WHERE id = ?', [examId]);
        currentDraw = r[0] && r[0].interview_current_draw_number != null ? Number(r[0].interview_current_draw_number) : null;
      } catch (_) {}

      const [enRows] = await pool.execute(
        `SELECT en.id, en.user_id, en.draw_number
         FROM exam_enrollments en
         WHERE en.exam_id = ?
         ORDER BY COALESCE(en.draw_number, 9999) ASC, en.id ASC`,
        [examId]
      ).catch(() => [[]]);
      const enrollments = dedupeEnrollmentsForDrawSchedule(enRows || []);
      const sorted = (enrollments || []).filter((e) => e.draw_number != null).sort((a, b) => (a.draw_number || 9999) - (b.draw_number || 9999));
      if (!sorted.length) {
        return res.json({ success: true, message: '未配置抽签号', data: { previousDrawNumber: null } });
      }
      if (currentDraw == null) {
        return res.status(400).json({ success: false, message: '当前叫号指针为空，无法回退' });
      }
      const currentIdx = sorted.findIndex((e) => e.draw_number === currentDraw);
      if (currentIdx < 0) {
        return res.status(400).json({ success: false, message: '当前叫号与抽签表不一致，无法回退' });
      }
      const currentEn = sorted[currentIdx];
      const [sessionRows] = await pool.execute(
        'SELECT id, status FROM exam_sessions WHERE exam_id = ? AND user_id = ? LIMIT 1',
        [examId, currentEn.user_id]
      );
      const curSession = sessionRows[0];
      if (curSession && curSession.status === 'ongoing') {
        return res.status(400).json({ success: false, message: '当前考生答题未结束，请先交卷后再回退叫号' });
      }

      let previousDrawNumber = null;
      let message = '';
      if (currentIdx === 0) {
        await pool.execute('UPDATE exams SET interview_current_draw_number = NULL WHERE id = ?', [examId]);
        message = '已回退到叫号起点（当前指针已清空）';
      } else {
        previousDrawNumber = sorted[currentIdx - 1].draw_number;
        await pool.execute('UPDATE exams SET interview_current_draw_number = ? WHERE id = ?', [previousDrawNumber, examId]);
        message = `已回退到${previousDrawNumber}号`;
      }
      res.json({ success: true, message, data: { previousDrawNumber } });
    } catch (e) {
      console.error('Previous candidate error:', e);
      res.status(500).json({ success: false, message: e.message || '操作失败' });
    }
  }
);

/** 计时计分/监督员（grader）是否可操作本场提前录制闸门 */
function assertGraderStaffOrSupervisorForPrerecordGate(req, exam) {
  if (req.user.role !== 'grader') return true;
  const graderId = req.user.graderId || req.user.id;
  const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
  return (
    staffIds.some((id) => id === String(graderId)) || supervisorIds.some((id) => id === String(graderId))
  );
}

// 提前录制：立即开放正式答题（企业/总管理/本场计时计分或监督员）
router.post(
  '/interview-exams/:examId/prerecord/open-gate',
  requireRole('admin', 'enterprise', 'enterprise_reviewer', 'grader'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise' || req.user.role === 'enterprise_reviewer') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader' && !assertGraderStaffOrSupervisorForPrerecordGate(req, exam)) {
        return res.status(403).json({ success: false, message: '仅本场计时计分工作人员或监督员可开放答题' });
      }
      if (getInterviewFlowModeFromExam(exam) !== 'prerecord') {
        return res.status(400).json({ success: false, message: '本场考试未配置为提前录制模式' });
      }
      await pool.execute(
        `UPDATE exams SET interview_prerecord_gate_open_at = CURRENT_TIMESTAMP, interview_prerecord_confirm_pending = 0 WHERE id = ?`,
        [examId]
      );
      res.json({ success: true, message: '已开放考生正式答题' });
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        return res.status(503).json({ success: false, message: '请先执行数据库迁移 interview_prerecord_online' });
      }
      res.status(500).json({ success: false, message: e.message || '操作失败' });
    }
  }
);

// 提前录制：定时+确认 — 考务确认开放答题
router.post(
  '/interview-exams/:examId/prerecord/confirm-scheduled',
  requireRole('admin', 'enterprise', 'enterprise_reviewer', 'grader'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise' || req.user.role === 'enterprise_reviewer') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader' && !assertGraderStaffOrSupervisorForPrerecordGate(req, exam)) {
        return res.status(403).json({ success: false, message: '仅本场计时计分工作人员或监督员可确认开放答题' });
      }
      if (getInterviewFlowModeFromExam(exam) !== 'prerecord') {
        return res.status(400).json({ success: false, message: '本场考试未配置为提前录制模式' });
      }
      await pool.execute(
        `UPDATE exams SET interview_prerecord_gate_open_at = CURRENT_TIMESTAMP, interview_prerecord_confirm_pending = 0 WHERE id = ?`,
        [examId]
      );
      res.json({ success: true, message: '已确认并开放考生正式答题' });
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        return res.status(503).json({ success: false, message: '请先执行数据库迁移 interview_prerecord_online' });
      }
      res.status(500).json({ success: false, message: e.message || '操作失败' });
    }
  }
);

// 提前录制：查询闸门状态（考务端）
router.get(
  '/interview-exams/:examId/prerecord/status',
  requireRole('admin', 'enterprise', 'enterprise_reviewer', 'grader'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise' || req.user.role === 'enterprise_reviewer') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [eie] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        if (!eie.length && !assertGraderStaffOrSupervisorForPrerecordGate(req, exam)) {
          return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
        }
      }
      const row = await fetchExamPrerecordGateRow(examId);
      const ic = (exam.answer_system_config || {}).interviewConfig || {};
      res.json({
        success: true,
        data: {
          interviewFlowMode: getInterviewFlowModeFromExam(exam),
          prerecordStartPolicy: ic.prerecordStartPolicy || 'manual',
          prerecordScheduledStartAt: ic.prerecordScheduledStartAt || null,
          gateOpenAt: row.gateOpenAt,
          confirmPending: !!row.confirmPending
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 提前录制：考生上传正面录像（multipart）
router.post(
  '/interview-exams/:examId/sessions/:sessionId/prerecord-videos',
  requireRole('candidate', 'user', 'admin'),
  uploadVideo.single('file'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const sessionId = Number(req.params.sessionId);
      const kind = (req.body.kind || 'front').toString().replace(/[^a-z]/gi, '').slice(0, 8) || 'front';
      if (!['front', 'side'].includes(kind)) {
        return res.status(400).json({ success: false, message: 'kind 须为 front 或 side' });
      }
      if (!req.file) return res.status(400).json({ success: false, message: '请上传文件' });
      const session = await ExamSessionModel.findById(sessionId);
      if (!session || Number(session.exam_id) !== examId) {
        return res.status(404).json({ success: false, message: '会话不存在' });
      }
      if (req.user.role !== 'admin' && !sessionOwnedByUser(session, req.user.id)) {
        return res.status(403).json({ success: false, message: '无权限' });
      }
      const exam = await ExamModel.findById(examId);
      if (!exam || getInterviewFlowModeFromExam(exam) !== 'prerecord') {
        return res.status(400).json({ success: false, message: '仅提前录制模式可上传面试录像' });
      }
      const rel = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
      const dur = parseInt(String(req.body.durationSeconds || req.body.duration_seconds || '0'), 10) || null;
      await pool.execute(
        `INSERT INTO interview_session_videos (exam_id, session_id, kind, file_path, duration_seconds)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), duration_seconds = VALUES(duration_seconds), created_at = CURRENT_TIMESTAMP`,
        [examId, sessionId, kind, rel, dur]
      );
      await ExamSessionModel.setPrerecordVideoStatus(sessionId, kind === 'front' ? 'front_ok' : 'side_ok');
      res.json({ success: true, data: { filePath: rel, kind } });
    } catch (e) {
      if (e.code === 'ER_NO_SUCH_TABLE') {
        return res.status(503).json({ success: false, message: '请先执行数据库迁移创建 interview_session_videos' });
      }
      res.status(500).json({ success: false, message: e.message || '上传失败' });
    }
  }
);

// 提前录制：考官/企业获取会话录像 URL 元数据
router.get(
  '/interview-exams/:examId/sessions/:sessionId/prerecord-videos',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const sessionId = Number(req.params.sessionId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [gr] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        if (!gr.length) {
          const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
          if (!staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
            return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
          }
        }
      }
      const [rows] = await pool.execute(
        `SELECT id, kind, file_path AS filePath, duration_seconds AS durationSeconds, created_at AS createdAt
         FROM interview_session_videos WHERE exam_id = ? AND session_id = ? ORDER BY kind`,
        [examId, sessionId]
      ).catch(() => [[]]);
      res.json({ success: true, data: rows || [] });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 获取某场面试考试单个会话的录音列表
router.get(
  '/interview-exams/:examId/sessions/:sessionId/recordings',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      const [sessions] = await pool.execute(
        'SELECT * FROM exam_sessions WHERE id = ? AND exam_id = ?',
        [req.params.sessionId, req.params.examId]
      );
      const sessionRow = sessions[0];
      if (!sessionRow) {
        return res.status(404).json({ success: false, message: '会话不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [rows] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners 
           WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [req.params.examId, graderId]
        );
        if (!rows.length) {
          return res
            .status(403)
            .json({ success: false, message: '无权限访问该面试考试' });
        }
      }

      const list = await ExamAudioRecordingModel.listBySession(req.params.sessionId);
      const data = (list || []).map((r) => ({
        ...r,
        file_url: '/' + String(r.file_path || '').replace(/^\/+/, '')
      }));
      res.json({ success: true, data });
    } catch (e) {
      console.error('Get interview recordings error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 获取某场面试考试的评分表配置
router.get(
  '/interview-exams/:examId/rubric',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      // 考官端只能查看绑定到自己的考试
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [rows] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners 
           WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [req.params.examId, graderId]
        );
        if (!rows.length) {
          return res
            .status(403)
            .json({ success: false, message: '无权限访问该面试考试' });
        }
      }

      const cols = await getInterviewRubricsColumnNames();
      const examCol = interviewRubricExamIdSelectExpr(cols);
      const { sql: whereSql, params: whereParams } = await interviewRubricWhereForExam(
        req.params.examId,
        cols
      );

      const [rows] = await pool.execute(
        `SELECT id, ${examCol}, item_order, item_name, item_description, max_score, weight
         FROM interview_rubrics
         WHERE ${whereSql}
         ORDER BY item_order ASC, id ASC`,
        whereParams
      );

      res.json({ success: true, data: rows || [] });
    } catch (e) {
      console.error('Get interview rubric error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 保存某场面试考试的评分表配置（企业/总管理）
router.post(
  '/interview-exams/:examId/rubric',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      const items = Array.isArray(req.body.items) ? req.body.items : [];
      const cols = await getInterviewRubricsColumnNames();
      const hasQms = cols.has('qms_exam_id');
      const hasQns = cols.has('qns_exam_id');
      const examIdStr = req.params.examId;
      let resolvedQms = null;
      if (hasQms) {
        resolvedQms = await resolveQmsExamIdForInterviewRubric(examIdStr);
        if (resolvedQms == null) {
          resolvedQms = await tryEnsureQmsExamMirrorRow(examIdStr);
        }
        if (resolvedQms != null) {
          try {
            const [vgm] = await pool.execute('SELECT id FROM qms_exams WHERE id = ? LIMIT 1', [resolvedQms]);
            if (!vgm || !vgm.length) resolvedQms = null;
          } catch (_) {
            resolvedQms = null;
          }
        }
        if (resolvedQms == null) {
          return res.status(400).json({
            success: false,
            message:
              '评分表数据表含 qms_exam_id 外键（指向 qms_exams），当前考试在 qms_exams 中无对应主键且无法自动补全。请确认已部署最新后端；仍失败时请查看 Node 日志中的 [interview] qms_exams 相关报错，或在服务器上执行 database/sync_exams_row_to_qms_exams.sql（将 WHERE id 改为本场 exams.id）后重试。'
          });
        }
      }
      let resolvedQns = null;
      if (hasQns) {
        resolvedQns = await resolveQnsExamIdForInterviewRubric(examIdStr);
        if (resolvedQns == null) {
          resolvedQns = await tryEnsureQnsExamMirrorRow(examIdStr);
        }
        if (resolvedQns != null) {
          try {
            const [vg] = await pool.execute('SELECT id FROM qns_exams WHERE id = ? LIMIT 1', [resolvedQns]);
            if (!vg || !vg.length) resolvedQns = null;
          } catch (_) {
            resolvedQns = null;
          }
        }
        if (resolvedQns == null) {
          return res.status(400).json({
            success: false,
            message:
              '评分表数据表含 qns_exam_id 外键（指向 qns_exams），当前考试在 qns_exams 中无对应主键且无法自动补全。请在数据库中建立 exams 与 qns_exams 的对应关系（例如同步 qns_exams 行 id=考试 id），或联系管理员检查 qns_exams 表必填列后重试。'
          });
        }
      }
      const { sql: delWhere, params: delParams } = await interviewRubricWhereForExam(examIdStr, cols);
      await pool.execute(`DELETE FROM interview_rubrics WHERE ${delWhere}`, delParams);

      if (items.length) {
        const values = [];
        const params = [];
        const insertCols = ['exam_id'];
        if (hasQms) insertCols.push('qms_exam_id');
        if (hasQns) insertCols.push('qns_exam_id');
        insertCols.push('item_order', 'item_name', 'item_description', 'max_score', 'weight');
        const colSql = '(' + insertCols.join(', ') + ')';

        items.forEach((item, index) => {
          const order =
            item.item_order != null ? Number(item.item_order) : index + 1;
          const name = String(item.item_name || '').trim();
          if (!name) return;
          const desc = item.item_description || null;
          const maxScore =
            item.max_score != null ? Number(item.max_score) : 0;
          const weight =
            item.weight != null ? Number(item.weight) || 1 : 1;
          const ph = insertCols.map(() => '?').join(', ');
          values.push('(' + ph + ')');
          params.push(examIdStr);
          if (hasQms) params.push(resolvedQms);
          if (hasQns) params.push(resolvedQns);
          params.push(order, name, desc, maxScore, weight);
        });

        if (values.length) {
          await pool.execute(
            `INSERT INTO interview_rubrics ${colSql} VALUES ${values.join(',')}`,
            params
          );
        }
      }

      res.json({ success: true, message: '已保存评分表配置' });
    } catch (e) {
      console.error('Save interview rubric error:', e);
      res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
);

// 获取某场面试考试的考场列表
router.get(
  '/interview-exams/:examId/rooms',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      const [rows] = await pool.execute(
        `SELECT id, exam_id, name, sort_order FROM exam_interview_rooms WHERE exam_id = ? ORDER BY sort_order ASC, id ASC`,
        [req.params.examId]
      );

      res.json({ success: true, data: rows || [] });
    } catch (e) {
      console.error('Get interview rooms error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 新增考场
router.post(
  '/interview-exams/:examId/rooms',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      const name = (req.body.name || '').trim() || '考场';
      const [maxOrder] = await pool.execute(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM exam_interview_rooms WHERE exam_id = ?`,
        [req.params.examId]
      );
      const sortOrder = (maxOrder[0] && maxOrder[0].next_order) ? maxOrder[0].next_order : 1;

      const [ins] = await pool.execute(
        `INSERT INTO exam_interview_rooms (exam_id, name, sort_order) VALUES (?, ?, ?)`,
        [req.params.examId, name, sortOrder]
      );

      const roomId = ins.insertId;
      res.json({ success: true, data: { id: roomId, exam_id: Number(req.params.examId), name, sort_order: sortOrder } });
    } catch (e) {
      console.error('Create interview room error:', e);
      res.status(500).json({ success: false, message: e.message || '创建失败' });
    }
  }
);

// 删除考场（会级联删除该考场下的考官绑定）
router.delete(
  '/interview-exams/:examId/rooms/:roomId',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      await pool.execute(
        `DELETE FROM exam_interview_rooms WHERE id = ? AND exam_id = ?`,
        [req.params.roomId, req.params.examId]
      );

      res.json({ success: true, message: '已删除考场' });
    } catch (e) {
      console.error('Delete interview room error:', e);
      res.status(500).json({ success: false, message: e.message || '删除失败' });
    }
  }
);

// 获取某场面试考试的考官列表（含 room_id）
router.get(
  '/interview-exams/:examId/examiners',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      const [rows] = await pool.execute(
        `SELECT eie.id, eie.exam_id, eie.room_id, ${eieGraderQualified('eie')} AS grading_account_id, eie.role, eie.sequence_no,
                ga.username, ga.real_name, ga.status
         FROM exam_interview_examiners eie
         JOIN grading_accounts ga ON ${eieGraderQualified('eie')} = ga.id
         WHERE eie.exam_id = ?
         ORDER BY eie.room_id ASC, eie.sequence_no ASC, eie.id ASC`,
        [req.params.examId]
      );

      res.json({ success: true, data: rows || [] });
    } catch (e) {
      console.error('Get interview examiners error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 考官端：获取当前登录考官在本场考试的序号标签（考官一、考官二等）
router.get(
  '/interview-exams/:examId/my-examiner-label',
  requireRole('grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const graderId = req.user.graderId || req.user.id;
      const [rows] = await pool.execute(
        `SELECT role, sequence_no FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
        [examId, graderId]
      );
      if (!rows || !rows.length) return res.status(404).json({ success: false, message: '非本场考官' });
      const role = (rows[0].role || '').toString().toLowerCase();
      const seq = rows[0].sequence_no != null ? Number(rows[0].sequence_no) : 1;
      const label = role === 'chief' ? '主考官' : '考官' + seq;
      res.json({ success: true, data: { label } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 保存某场面试考试的考官列表
router.post(
  '/interview-exams/:examId/examiners',
  requireRole('admin', 'enterprise'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();

      const exam = await ExamModel.findById(req.params.examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      // 支持 examiners: [{ gradingAccountId, role, roomId, sequence_no }] 或兼容旧格式
      const examinersInput = Array.isArray(req.body.examiners) ? req.body.examiners : [];
      const legacyIds = Array.isArray(req.body.gradingAccountIds) ? req.body.gradingAccountIds : [];
      const examiners = examinersInput.length > 0
        ? examinersInput.map((e) => ({
            gradingAccountId: Number(e.gradingAccountId ?? e.id),
            role: (e.role === 'chief' ? 'chief' : 'interviewer'),
            roomId: e.roomId != null && e.roomId !== '' ? Number(e.roomId) : null,
            sequenceNo: e.sequence_no != null ? Number(e.sequence_no) : (e.sequenceNo != null ? Number(e.sequenceNo) : null)
          }))
        : legacyIds.map((id) => ({ gradingAccountId: Number(id), role: 'interviewer', roomId: null, sequenceNo: null }));

      // 过滤无效项，按 room_id 分组；若前端已传 sequence_no 则采用其顺序，否则每组内随机排序并分配 sequence_no（1,2,3...）
      const valid = examiners.filter((e) => Number.isFinite(e.gradingAccountId) && e.gradingAccountId > 0);
      const byRoom = new Map();
      valid.forEach((e) => {
        const key = e.roomId == null ? '__null__' : e.roomId;
        if (!byRoom.has(key)) byRoom.set(key, []);
        byRoom.get(key).push(e);
      });
      function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }
      const withSequence = [];
      byRoom.forEach((list) => {
        const hasSequence = list.every((e) => e.sequenceNo != null && Number.isFinite(e.sequenceNo));
        if (hasSequence) {
          const sorted = [...list].sort((a, b) => a.sequenceNo - b.sequenceNo);
          sorted.forEach((e) => withSequence.push({ ...e, sequenceNo: e.sequenceNo }));
        } else {
          const shuffled = shuffle(list);
          shuffled.forEach((e, idx) => {
            withSequence.push({ ...e, sequenceNo: idx + 1 });
          });
        }
      });

      await pool.execute(
        'DELETE FROM exam_interview_examiners WHERE exam_id = ?',
        [req.params.examId]
      );

      if (withSequence.length) {
        const values = [];
        const params = [];
        withSequence.forEach((e) => {
          values.push('(?, ?, ?, ?, ?)');
          params.push(req.params.examId, e.roomId || null, e.gradingAccountId, e.role, e.sequenceNo);
        });
        await pool.execute(
          `INSERT INTO exam_interview_examiners
           (exam_id, room_id, ${eieGraderColQ()}, role, sequence_no)
           VALUES ${values.join(',')}`,
          params
        );
      }

      res.json({ success: true, message: '已保存考官设置' });
    } catch (e) {
      console.error('Save interview examiners error:', e);
      res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
);

// 获取某场面试考试单个会话的评分结果（当前考官）
router.get(
  '/interview-exams/:examId/sessions/:sessionId/grades',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      await refreshInterviewDynamicGraderColumns();
      const examId = Number(req.params.examId);
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(examId) || examId <= 0 || !Number.isFinite(sessionId) || sessionId <= 0) {
        return res.status(400).json({ success: false, message: '无效的考试或会话参数' });
      }

      const exam = await ExamModel.findById(examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }

      const [sessOwn] = await pool.execute(
        'SELECT id FROM exam_sessions WHERE id = ? AND exam_id = ? LIMIT 1',
        [sessionId, examId]
      );
      if (!sessOwn.length) {
        return res.status(404).json({ success: false, message: '会话不存在' });
      }

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      let graderId = null;
      if (req.user.role === 'grader') {
        const gid = req.user.graderId || req.user.id;
        let eieOk;
        try {
          const [r] = await pool.execute(
            `SELECT 1 FROM exam_interview_examiners 
             WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
            [examId, gid]
          );
          eieOk = r;
        } catch (eieErr) {
          const bad =
            eieErr &&
            (eieErr.code === 'ER_BAD_FIELD_ERROR' ||
              String(eieErr.message || '').includes('Unknown column'));
          if (!bad) throw eieErr;
          await refreshInterviewDynamicGraderColumns();
          const [r2] = await pool.execute(
            `SELECT 1 FROM exam_interview_examiners 
             WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
            [examId, gid]
          );
          eieOk = r2;
        }
        if (eieOk.length) {
          graderId = gid;
        } else {
          const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
          if (!staffIds.some((id) => id === String(gid)) && !supervisorIds.some((id) => id === String(gid))) {
            return res.status(403).json({ success: false, message: '无权限访问该面试考试' });
          }
          // 非本场绑定考官：不返回多考官原始行，避免前端按要素只取一条时串分；计时计分端用 staffOnly 汇总接口
          return res.json({ success: true, data: [] });
        }
      }

      const rows = await fetchInterviewGradingRowsForSession(examId, sessionId, graderId);
      res.json({ success: true, data: rows || [] });
    } catch (e) {
      console.error('Get interview grades error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 提交/更新单个会话的评分结果（当前考官）
router.post(
  '/interview-exams/:examId/sessions/:sessionId/grades',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(examId) || examId <= 0 || !Number.isFinite(sessionId) || sessionId <= 0) {
        return res.status(400).json({ success: false, message: '无效的考试或会话参数' });
      }

      const exam = await ExamModel.findById(examId);
      if (!exam) {
        return res.status(404).json({ success: false, message: '考试不存在' });
      }
      const asc = exam.answer_system_config || {};
      const dropHighestLowest =
        asc.interviewConfig && Object.prototype.hasOwnProperty.call(asc.interviewConfig, 'dropHighestLowest')
          ? !!asc.interviewConfig.dropHighestLowest
          : true; // 默认保持“去高低后平均”的旧行为

      if (req.user.role === 'enterprise') {
        const entId =
          req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }

      let graderId;
      if (req.user.role === 'grader') {
        graderId = req.user.graderId || req.user.id;
        const [rows] = await pool.execute(
          `SELECT 1 FROM exam_interview_examiners 
           WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`,
          [examId, graderId]
        );
        if (!rows.length) {
          return res
            .status(403)
            .json({ success: false, message: '无权限访问该面试考试' });
        }
      } else {
        graderId = req.body.gradingAccountId || req.body.grading_account_id || null;
        if (!graderId) {
          return res
            .status(400)
            .json({ success: false, message: '缺少 gradingAccountId' });
        }
      }

      const grades = Array.isArray(req.body.grades) ? req.body.grades : [];
      if (!grades.length) {
        return res
          .status(400)
          .json({ success: false, message: '缺少评分数据' });
      }

      for (const g of grades) {
        const rubricItemId = Number(g.rubricItemId || g.rubric_item_id);
        if (!rubricItemId) continue;
        const rawScore = Number(g.score);
        if (!Number.isFinite(rawScore) || rawScore < 0) continue;
        const score = Math.round(rawScore * 100) / 100;
        const comment = g.comment || g.remark || null;
        await pool.execute(
          `INSERT INTO interview_grading_records
             (exam_id, session_id, rubric_item_id, ${igrGraderColQ()}, score, comment)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE score = VALUES(score), comment = VALUES(comment), updated_at = CURRENT_TIMESTAMP`,
          [examId, sessionId, rubricItemId, graderId, score, comment]
        );
      }

      // 多考官：按考官分组得总分，根据配置决定是否去掉一个最高分和一个最低分后取平均分写回 total_score
      const [perGrader] = await pool.execute(
        `SELECT ${igrGraderColQ()} AS grading_account_id, COALESCE(SUM(score), 0) AS total
         FROM interview_grading_records WHERE exam_id = ? AND session_id = ? GROUP BY ${igrGraderColQ()}`,
        [examId, sessionId]
      );
      let totalScore = 0;
      if (perGrader.length > 0) {
        let totals = perGrader.map((r) => Number(r.total || 0));
        if (dropHighestLowest && totals.length > 2) {
          totals = [...totals].sort((a, b) => a - b);
          totals.pop();
          totals.shift();
        }
        totalScore = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
      }
      await pool.execute(
        'UPDATE exam_sessions SET total_score = ? WHERE id = ?',
        [Math.round(totalScore * 100) / 100, sessionId]
      );

      res.json({ success: true, message: '评分已保存', data: { totalScore } });
    } catch (e) {
      console.error('Save interview grades error:', e);
      res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
);

// 工作人员/企业/管理员/考官端（计时计分）：面试成绩汇总（各考官总分、去高低后平均分、签字状态）
router.get(
  '/interview-exams/:examId/staff/summary',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      const { asc, staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
      const dropHighestLowest =
        asc.interviewConfig && Object.prototype.hasOwnProperty.call(asc.interviewConfig, 'dropHighestLowest')
          ? !!asc.interviewConfig.dropHighestLowest
          : true;
      if (req.user.role === 'enterprise') {
        let allowedEntId = null;
        if (req.enterpriseId != null && String(req.enterpriseId).trim() !== '') {
          const n = Number(req.enterpriseId);
          if (Number.isFinite(n) && n > 0) allowedEntId = n;
        }
        if (allowedEntId == null) {
          const ent = await EnterpriseModel.findByUserId(req.user.id);
          if (ent) allowedEntId = ent.id;
        }
        if (!allowedEntId || Number(exam.enterprise_id) !== Number(allowedEntId)) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      let currentUserIsSupervisor = false;
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [eie] = await pool.execute(`SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`, [examId, graderId]);
        if (!eie.length && !staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
        currentUserIsSupervisor = supervisorIds.some((id) => id === String(graderId));
      }
      const { joinTableSql: candJoin, userSelectSql: candUserCols } =
        await ExamEnrollmentModel.getExamSessionUserJoinFragments();
      let sessions = [];
      try {
        const [rows] = await pool.execute(
          `SELECT s.id, s.user_id, s.status, s.total_score, s.submitted_at, s.started_at, s.score_confirmed_at, s.score_confirmed_by,
                  ${candUserCols},
                  en.draw_number
           FROM exam_sessions s
           JOIN ${candJoin} u ON s.user_id = u.id
           INNER JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
           WHERE s.exam_id = ?
           ORDER BY COALESCE(en.draw_number, 9999) ASC, s.id ASC`,
          [examId]
        );
        sessions = rows || [];
      } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR' && (err.message || '').match(/score_confirmed|draw_number|started_at/)) {
          const [rows] = await pool.execute(
            `SELECT s.id, s.user_id, s.status, s.total_score, s.submitted_at, s.started_at,
                    ${candUserCols}
             FROM exam_sessions s
             JOIN ${candJoin} u ON s.user_id = u.id WHERE s.exam_id = ? ORDER BY s.id ASC`,
            [examId]
          );
          sessions = (rows || []).map((r) => ({ ...r, draw_number: null, score_confirmed_at: null, score_confirmed_by: null }));
        } else {
          throw err;
        }
      }
      await mergeInterviewSessionDrawNumbersFromEnrollment(examId, sessions);
      sessions = dedupeInterviewSessionsForGraderList(sessions);
      const examinerLabelByAccountId = {};
      const examinerOrder = [];
      try {
        const [eieRows] = await pool.execute(
          `SELECT ${eieGraderQualified('eie')} AS grading_account_id, eie.role, eie.sequence_no, eie.room_id
           FROM exam_interview_examiners eie
           WHERE eie.exam_id = ?
           ORDER BY eie.room_id ASC, eie.sequence_no ASC, eie.id ASC`,
          [examId]
        );
        const seen = new Set();
        (eieRows || []).forEach((r, idx) => {
          const id = r.grading_account_id;
          if (seen.has(id)) return;
          seen.add(id);
          const roleVal = (r.role || '').toString().toLowerCase();
          const seq = r.sequence_no != null ? Number(r.sequence_no) : idx + 1;
          const label = roleVal === 'chief' ? '主考官' : '考官' + seq;
          examinerLabelByAccountId[id] = label;
          examinerOrder.push(label);
        });
      } catch (_) {}
      const list = [];
      for (const row of sessions) {
        const [perGrader] = await pool.execute(
          `SELECT ${igrGraderColQ()} AS grading_account_id, COALESCE(SUM(score), 0) AS total
           FROM interview_grading_records WHERE exam_id = ? AND session_id = ? GROUP BY ${igrGraderColQ()}`,
          [examId, row.id]
        );
        const totals = (perGrader || []).map((r) => ({ gradingAccountId: r.grading_account_id, total: Number(r.total || 0) }));
        let avgScore = row.total_score != null ? Number(row.total_score) : null;
        if (totals.length > 0 && avgScore == null) {
          let nums = totals.map((t) => t.total);
          if (dropHighestLowest && nums.length > 2) {
            nums = [...nums].sort((a, b) => a - b);
            nums.pop();
            nums.shift();
          }
          avgScore = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        }
        const graderTotalsWithLabel = totals.map((t) => ({
          gradingAccountId: t.gradingAccountId,
          total: t.total,
          examinerLabel: examinerLabelByAccountId[t.gradingAccountId] || ('考官' + t.gradingAccountId)
        })).sort((a, b) => {
          const ia = examinerOrder.indexOf(a.examinerLabel);
          const ib = examinerOrder.indexOf(b.examinerLabel);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        let droppedHighest = null;
        let droppedLowest = null;
        if (totals.length > 2 && dropHighestLowest) {
          const nums = totals.map((t) => Number(t.total || 0)).sort((a, b) => a - b);
          droppedLowest = nums[0];
          droppedHighest = nums[nums.length - 1];
        }
        list.push({
          sessionId: row.id,
          userId: row.user_id,
          realName: row.real_name,
          username: row.username,
          examNumber: row.exam_number,
          drawNumber: row.draw_number,
          status: row.status,
          totalScore: row.total_score,
          finalScore: avgScore,
          graderTotals: graderTotalsWithLabel,
          droppedHighest,
          droppedLowest,
          scoreConfirmedAt: row.score_confirmed_at,
          scoreConfirmedBy: row.score_confirmed_by,
          startedAt: row.started_at || null
        });
      }
      let currentDrawNumber = null;
      try {
        const [dr] = await pool.execute('SELECT interview_current_draw_number FROM exams WHERE id = ?', [examId]);
        if (dr[0] && dr[0].interview_current_draw_number != null) currentDrawNumber = Number(dr[0].interview_current_draw_number);
      } catch (_) {}
      const ackFlags = await computeTimerAdvanceAckFlags(exam, req);
      res.json({
        success: true,
        data: list,
        currentUserIsSupervisor,
        examinerOrder,
        currentDrawNumber,
        requiresStaffAdvanceAck: ackFlags.requiresStaffAdvanceAck,
        advanceSupervisorPinConfigured: ackFlags.advanceSupervisorPinConfigured
      });
    } catch (e) {
      console.error('Staff summary error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 工作人员/企业/管理员/考官端（计时计分）：考官数据汇总表（打印用）
router.get(
  '/interview-exams/:examId/staff/grading-table',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      const { asc, staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
      const dropHighestLowest =
        asc.interviewConfig && Object.prototype.hasOwnProperty.call(asc.interviewConfig, 'dropHighestLowest')
          ? !!asc.interviewConfig.dropHighestLowest
          : true;
      if (req.user.role === 'enterprise') {
        let allowedEntId = null;
        if (req.enterpriseId != null && String(req.enterpriseId).trim() !== '') {
          const n = Number(req.enterpriseId);
          if (Number.isFinite(n) && n > 0) allowedEntId = n;
        }
        if (allowedEntId == null) {
          const ent = await EnterpriseModel.findByUserId(req.user.id);
          if (ent) allowedEntId = ent.id;
        }
        if (!allowedEntId || Number(exam.enterprise_id) !== Number(allowedEntId)) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [eie] = await pool.execute(`SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`, [examId, graderId]);
        if (!eie.length && !staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      const { joinTableSql: candJoin2, userSelectSql: candUserCols2 } =
        await ExamEnrollmentModel.getExamSessionUserJoinFragments();
      let sessions = [];
      try {
        const [rows] = await pool.execute(
          `SELECT s.id, s.user_id, s.total_score, s.score_confirmed_at,
                  ${candUserCols2},
                  en.draw_number
           FROM exam_sessions s
           JOIN ${candJoin2} u ON s.user_id = u.id
           INNER JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
           WHERE s.exam_id = ?
           ORDER BY COALESCE(en.draw_number, 9999) ASC`,
          [examId]
        );
        sessions = rows || [];
      } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') {
          const [rows] = await pool.execute(
            `SELECT s.id, s.user_id, s.total_score, ${candUserCols2}
             FROM exam_sessions s JOIN ${candJoin2} u ON s.user_id = u.id WHERE s.exam_id = ? ORDER BY s.id`,
            [examId]
          );
          sessions = (rows || []).map((r) => ({ ...r, draw_number: null, score_confirmed_at: null }));
        } else {
          throw err;
        }
      }
      await mergeInterviewSessionDrawNumbersFromEnrollment(examId, sessions);
      sessions = dedupeInterviewSessionsForGraderList(sessions);
      const cols = await getInterviewRubricsColumnNames();
      const { sql: rubricWhere, params: rubricWhereParams } = await interviewRubricWhereForExam(
        examId,
        cols
      );
      const [rubricRows] = await pool.execute(
        `SELECT id, item_order, item_name, max_score FROM interview_rubrics WHERE ${rubricWhere} ORDER BY item_order, id`,
        rubricWhereParams
      );
      const [allRecords] = await pool.execute(
        `SELECT session_id, rubric_item_id, ${igrGraderColQ()} AS grading_account_id, score FROM interview_grading_records WHERE exam_id = ?`,
        [examId]
      );
      const [eieGraderRows] = await pool.execute(
        `SELECT ${eieGraderQualified('eie')} AS id, eie.role, eie.sequence_no, eie.room_id
         FROM exam_interview_examiners eie
         WHERE eie.exam_id = ?
         ORDER BY eie.room_id ASC, eie.sequence_no ASC, eie.id ASC`,
        [examId]
      );
      const graderMap = {};
      const graderOrder = [];
      const seen = new Set();
      (eieGraderRows || []).forEach((g, idx) => {
        if (seen.has(g.id)) return;
        seen.add(g.id);
        const roleVal = (g.role || '').toString().toLowerCase();
        const seq = g.sequence_no != null ? Number(g.sequence_no) : idx + 1;
        const label = roleVal === 'chief' ? '主考官' : '考官' + seq;
        graderMap[g.id] = label;
        graderOrder.push(g.id);
      });
      const graderNames = graderOrder.map((id) => ({ id }));
      const recordsBySession = {};
      (allRecords || []).forEach((r) => {
        if (!recordsBySession[r.session_id]) recordsBySession[r.session_id] = [];
        recordsBySession[r.session_id].push(r);
      });
      const rows = (sessions || []).map((s) => {
        const recs = recordsBySession[s.id] || [];
        const byGrader = {};
        recs.forEach((r) => {
          if (!byGrader[r.grading_account_id]) byGrader[r.grading_account_id] = {};
          byGrader[r.grading_account_id][r.rubric_item_id] = r.score;
        });
        const graderTotals = {};
        Object.keys(byGrader).forEach((gid) => {
          graderTotals[gid] = Object.values(byGrader[gid]).reduce((a, b) => a + Number(b || 0), 0);
        });
        const totalsArr = Object.values(graderTotals).map((n) => Number(n || 0));
        let finalScore = s.total_score != null ? Number(s.total_score) : null;
        let droppedHighest = null;
        let droppedLowest = null;
        if (totalsArr.length > 0) {
          if (finalScore == null) {
            let nums = [...totalsArr].sort((a, b) => a - b);
            if (dropHighestLowest && nums.length > 2) {
              droppedLowest = nums.shift();
              droppedHighest = nums.pop();
              finalScore = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
            } else {
              finalScore = nums.reduce((a, b) => a + b, 0) / nums.length;
            }
          } else if (dropHighestLowest && totalsArr.length > 2) {
            const sorted = [...totalsArr].sort((a, b) => a - b);
            droppedLowest = sorted[0];
            droppedHighest = sorted[sorted.length - 1];
          }
        }
        return {
          sessionId: s.id,
          drawNumber: s.draw_number,
          realName: s.real_name,
          username: s.username,
          examNumber: s.exam_number,
          rubricScores: rubricRows.map((rub) => ({
            itemName: rub.item_name,
            maxScore: rub.max_score,
            byGrader: (graderNames || []).map((g) => ({ graderId: g.id, graderName: graderMap[g.id], score: (byGrader[g.id] || {})[rub.id] ?? null }))
          })),
          graderTotals: (graderNames || []).map((g) => ({ graderId: g.id, name: graderMap[g.id], total: graderTotals[g.id] ?? null })),
          droppedHighest,
          droppedLowest,
          finalScore,
          scoreConfirmedAt: s.score_confirmed_at
        };
      });
      let supervisorSignature = null;
      try {
        const [sigRows] = await pool.execute(
          'SELECT signature_image FROM exam_interview_supervisor_signature WHERE exam_id = ? LIMIT 1',
          [examId]
        );
        if (sigRows && sigRows[0] && sigRows[0].signature_image) supervisorSignature = sigRows[0].signature_image;
      } catch (_) {}
      res.json({ success: true, data: { examName: exam.name, rubricItems: rubricRows, rows, supervisorSignature } });
    } catch (e) {
      console.error('Grading table error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 获取监督员签字（企业/总管理/监督员）
router.get(
  '/interview-exams/:examId/supervisor-signature',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      if (req.user.role === 'grader') {
        const graderId = req.user.graderId || req.user.id;
        const [eie] = await pool.execute(`SELECT 1 FROM exam_interview_examiners WHERE exam_id = ? AND ${eieGraderColQ()} = ? LIMIT 1`, [examId, graderId]);
        const { staffIds, supervisorIds } = getStaffSupervisorIdsForExam(exam);
        if (!eie.length && !staffIds.some((id) => id === String(graderId)) && !supervisorIds.some((id) => id === String(graderId))) {
          return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      const [rows] = await pool.execute(
        'SELECT grading_account_id, signature_image, signed_at FROM exam_interview_supervisor_signature WHERE exam_id = ? LIMIT 1',
        [examId]
      );
      const row = rows && rows[0];
      if (!row) return res.json({ success: true, data: null });
      res.json({
        success: true,
        data: {
          gradingAccountId: row.grading_account_id,
          signatureImage: row.signature_image || null,
          signedAt: row.signed_at || null
        }
      });
    } catch (e) {
      console.error('Get supervisor signature error:', e);
      res.status(500).json({ success: false, message: e.message || '获取失败' });
    }
  }
);

// 提交监督员签字（仅监督员账号）
router.post(
  '/interview-exams/:examId/supervisor-signature',
  requireRole('admin', 'enterprise', 'grader'),
  async (req, res) => {
    try {
      await ensureInterviewTablesInitialized();
      const examId = Number(req.params.examId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      if (req.user.role === 'enterprise') {
        const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
        if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
      }
      const graderId = req.user.role === 'grader' ? (req.user.graderId || req.user.id) : null;
      if (req.user.role === 'grader') {
        const { supervisorIds } = getStaffSupervisorIdsForExam(exam);
        if (!supervisorIds.some((id) => id === String(graderId))) {
          return res.status(403).json({ success: false, message: '仅监督员可提交签字' });
        }
      } else {
        // admin/enterprise 可代录（无 graderId 时用 body 中的 gradingAccountId）
      }
      const accountId = graderId != null ? graderId : (req.body.gradingAccountId != null ? Number(req.body.gradingAccountId) : null);
      const signatureImage = req.body.signatureImage != null ? String(req.body.signatureImage) : null;
      const signedAt = req.body.signedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');
      const finalAccountId = accountId != null ? accountId : graderId;
      if (finalAccountId == null) return res.status(400).json({ success: false, message: '请提供 gradingAccountId' });
      await pool.execute(
        `INSERT INTO exam_interview_supervisor_signature (exam_id, grading_account_id, signature_image, signed_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE grading_account_id = VALUES(grading_account_id), signature_image = VALUES(signature_image), signed_at = VALUES(signed_at), updated_at = CURRENT_TIMESTAMP`,
        [examId, finalAccountId, signatureImage, signedAt]
      );
      res.json({ success: true, message: '签字已保存' });
    } catch (e) {
      console.error('Post supervisor signature error:', e);
      res.status(500).json({ success: false, message: e.message || '保存失败' });
    }
  }
);

// 考生本人签字确认成绩 或 工作人员/管理员代录确认
router.post(
  '/interview-exams/:examId/sessions/:sessionId/confirm-score',
  requireRole('candidate', 'user', 'admin', 'enterprise'),
  async (req, res) => {
    try {
      const examId = Number(req.params.examId);
      const sessionId = Number(req.params.sessionId);
      const exam = await ExamModel.findById(examId);
      if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
      const [sessions] = await pool.execute('SELECT * FROM exam_sessions WHERE id = ? AND exam_id = ?', [sessionId, examId]);
      const session = sessions[0];
      if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
      const isCandidate = req.user.role === 'candidate' || req.user.role === 'user';
      if (isCandidate && !sessionOwnedByUser(session, req.user.id)) return res.status(403).json({ success: false, message: '只能确认本人成绩' });
      if (!isCandidate) {
        if (req.user.role === 'enterprise') {
          const entId = req.enterpriseId || (await EnterpriseModel.findByUserId(req.user.id))?.id;
          if (exam.enterprise_id !== entId) return res.status(403).json({ success: false, message: '无权限' });
        }
      }
      try {
        await pool.execute(
          'UPDATE exam_sessions SET score_confirmed_at = CURRENT_TIMESTAMP, score_confirmed_by = ? WHERE id = ?',
          [req.user.id, sessionId]
        );
      } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR' && (err.message || '').match(/score_confirmed/)) {
          return res.status(500).json({ success: false, message: '请先执行面试顺序与工作人员端数据库迁移' });
        }
        throw err;
      }
      res.json({ success: true, message: '已确认成绩' });
    } catch (e) {
      console.error('Confirm score error:', e);
      res.status(500).json({ success: false, message: e.message || '操作失败' });
    }
  }
);

module.exports = router;
module.exports.tryPrerecordScheduleAutoOpen = tryPrerecordScheduleAutoOpen;
module.exports.maybeAutoAdvanceInterviewAfterSubmit = maybeAutoAdvanceInterviewAfterSubmit;

