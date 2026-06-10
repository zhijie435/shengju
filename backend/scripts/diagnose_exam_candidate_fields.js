/**
 * 诊断：某场考试下考生准考证/岗位/身份证照为何未写入 qms_users
 *
 * 用法（在 backend 目录、.env 可连库）：
 *   node scripts/diagnose_exam_candidate_fields.js --exam-id=55
 *   node scripts/diagnose_exam_candidate_fields.js --exam-id=55 --user-id=33
 *   node scripts/diagnose_exam_candidate_fields.js --exam-id=55 --phone=18092263819
 *
 * 会输出：环境、考试与企业、qms_users 当前值、compat 批次、sj_ 行数与样例、
 * 若匹配到 sj 行则显示归一化后的 exam_no/job_code 等，便于判断「源无数据 / 对不上人 / 未配库」。
 */

require('dotenv').config();
const { pool, poolShengju } = require('../config/database');
const { normalizeSjImportedRow } = require('../utils/sjImportedCandidateNormalize');

function parseArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=').slice(1).join('=');
}

function normPhone(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function section(title) {
  console.log(`\n========== ${title} ==========`);
}

async function tableExists(conn, name) {
  try {
    const [r] = await conn.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
      [name]
    );
    return r && r.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const examId = parseInt(parseArg('exam-id') || '0', 10);
  const userId = parseInt(parseArg('user-id') || '0', 10);
  const phoneFilter = (parseArg('phone') || '').replace(/\D/g, '');

  if (!Number.isFinite(examId) || examId <= 0) {
    console.error('请指定 --exam-id=数字');
    process.exit(1);
  }

  section('环境');
  const mainName = process.env.MAIN_DB_NAME || process.env.DB_NAME || '（未设）';
  const sjName = process.env.SHENGJU_DB_NAME || process.env.TALENT_NETWORK_DB || '（未设，圣举 sj_ 用主库 pool 查）';
  const sjUseMain = !poolShengju;
  console.log(`MAIN_DB_NAME / 当前连库: ${mainName}`);
  console.log(`SHENGJU_DB_NAME: ${sjName}`);
  console.log(`poolShengju: ${poolShengju ? '已配置' : '未配置，脚本与现网补全用主库 pool 查 sj_'}`);
  console.log(`同库时建议在 .env 设 SHENGJU_DB_NAME=${mainName} 与 MAIN 一致，避免歧义。`);

  const sjPool = poolShengju || pool;

  section('考试与 enterprise');
  const [exRows] = await pool.query('SELECT id, name, status, enterprise_id FROM exams WHERE id = ?', [examId]);
  if (!exRows || !exRows[0]) {
    console.log('exams 表无此 exam_id');
    process.exit(1);
  }
  const ex = exRows[0];
  const entId = ex.enterprise_id != null ? Number(ex.enterprise_id) : 0;
  console.log(`exam: id=${ex.id} name=${ex.name} status=[${ex.status}] enterprise_id=${ex.enterprise_id}`);
  if (String(ex.status || '') !== 'published' && String(ex.status || '') !== 'ongoing') {
    console.log('【注意】个人中心「专业测评」只显示 published/ongoing；考生管理列表不依赖此状态，但已结束考试可能影响其它逻辑。');
  }
  if (!entId) {
    console.log('【错误】exams.enterprise_id 为空，圣举按企业补全无法继续。');
    process.exit(1);
  }

  const hasCompat = await tableExists(pool, 'compat_exam_allocation_batches');
  const hasSj = await tableExists(sjPool, 'sj_exam_imported_candidates');
  console.log(`表 compat_exam_allocation_batches: ${hasCompat ? '有' : '无'}`);
  console.log(`表 sj_exam_imported_candidates: ${hasSj ? '有' : '无（补全无数据源）'}`);

  if (!hasSj) {
    console.log('\n无法从 sj_ 表补全：请确认库名与表已部署。');
  }

  let batchIds = [];
  if (hasCompat) {
    const [bRows] = await pool.query(
      `SELECT DISTINCT batch_id FROM compat_exam_allocation_batches
       WHERE enterprise_id = ? AND batch_id IS NOT NULL AND TRIM(COALESCE(batch_id,'')) <> ''`,
      [entId]
    );
    batchIds = (bRows || [])
      .map((r) => String(r.batch_id).trim())
      .filter(Boolean);
  }
  console.log(`\n从 compat 得到的 batch_id 数: ${batchIds.length} ${batchIds.length ? `(${batchIds.slice(0, 5).join(',')}${batchIds.length > 5 ? '...' : ''})` : ''}`);

  if (hasSj && !batchIds.length) {
    try {
      const [rEnt] = await sjPool.query(
        `SELECT DISTINCT batch_id FROM sj_exam_imported_candidates
         WHERE enterprise_id = ? AND batch_id IS NOT NULL AND TRIM(COALESCE(batch_id,'')) <> ''`,
        [entId]
      );
      if (rEnt && rEnt.length) {
        batchIds = [...new Set(rEnt.map((x) => String(x.batch_id).trim()).filter(Boolean))];
        console.log(`从 sj 按 enterprise_id 补到 batch_id 数: ${batchIds.length}（与现网 backfill 逻辑一致）`);
      }
    } catch (e) {
      console.log(`按 enterprise 查 sj.batch_id: ${e.code || e.message}（表可能无 enterprise_id 列）`);
    }
  }

  let allSj = [];
  if (hasSj && batchIds.length) {
    const ph = batchIds.map(() => '?').join(',');
    try {
      const [sjRows] = await sjPool.query(
        `SELECT * FROM sj_exam_imported_candidates WHERE batch_id IN (${ph})`,
        batchIds
      );
      allSj = sjRows || [];
    } catch (e) {
      console.log('查询 sj 失败:', e.message);
    }
  }
  if (hasSj && !allSj.length) {
    try {
      const [bRep] = await sjPool.query(
        `SELECT batch_id, COUNT(*) AS cnt FROM sj_exam_imported_candidates WHERE enterprise_id = ? GROUP BY batch_id ORDER BY cnt DESC LIMIT 15`,
        [entId]
      );
      if (bRep && bRep.length) {
        console.log(
          '\n【注意】按 compat 的 batch_id 在 sj_ 中 0 行。本企业 sj_ 实际 batch_id 样例：'
        );
        for (const b of bRep) {
          console.log(`  batch_id=[${b.batch_id}] 行数=${b.cnt}`);
        }
        console.log('  compat 的 batch 与上表若不一致，旧逻辑无法命中；已在新版用 enterprise_id 全量回退。');
      } else {
        try {
          const [cnt0] = await sjPool.query(
            `SELECT COUNT(*) AS c FROM sj_exam_imported_candidates WHERE enterprise_id = ?`,
            [entId]
          );
          const n = cnt0 && cnt0[0] ? cnt0[0].c : 0;
          if (n === 0) {
            console.log('\n【注意】enterprise_id=该企业的 sj_ 行数为 0，源数据可能未进库。');
          }
        } catch (e) {
          /* 无 enterprise_id 列时忽略 */
        }
      }
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') console.log('  batch 分布查询:', e.message);
    }
  }
  if (hasSj && !allSj.length) {
    try {
      const [entRows] = await sjPool.query(
        `SELECT * FROM sj_exam_imported_candidates WHERE enterprise_id = ? LIMIT 10000`,
        [entId]
      );
      allSj = entRows || [];
      if (allSj.length) {
        console.log(
          `\n已按 enterprise_id 拉取 sj_ 行: ${allSj.length} 条（与线网补全回退一致）`
        );
      }
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') console.log('  enterprise 全量查 sj:', e.message);
    }
  }
  console.log(`\nsj_exam_imported_candidates 供匹配行数: ${allSj.length}`);
  if (allSj[0]) {
    const k = Object.keys(allSj[0]);
    console.log(`  样例列名（前 25 个）: ${k.slice(0, 25).join(', ')}${k.length > 25 ? '...' : ''}`);
  }

  const dbName = process.env.MAIN_DB_NAME || 'shengju';
  const [qmsCols] = await pool.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'qms_users'`,
    [dbName]
  );
  const colSet = new Set((qmsCols || []).map((x) => String(x.c).toLowerCase()));
  const hasExam = colSet.has('exam_number');
  const hasJc = colSet.has('job_code');
  if (!hasExam) {
    console.log(
      '\n【根因级】qms_users 无 exam_number 等考生列。补全 UPDATE 会全部跳过，界面上永为空。' +
        '\n请执行: node scripts/run_qms_users_exam_fields_migration.js 后重启 Node。'
    );
  }
  const selU = (name, alias) =>
    colSet.has(name) ? `u.\`${name}\` AS \`${alias}\`` : `NULL AS \`${alias}\``;
  const uSelect = [selU('username', 'username'), selU('real_name', 'real_name'), selU('phone', 'phone')];
  if (colSet.has('exam_number')) uSelect.push('u.exam_number AS exam_number');
  if (colSet.has('job_code')) uSelect.push('u.job_code AS job_code');
  if (colSet.has('position')) uSelect.push('u.position AS position');
  if (colSet.has('id_card_image_path')) uSelect.push('u.id_card_image_path AS id_card_image_path');
  if (colSet.has('id_card')) uSelect.push('u.id_card AS id_card');

  const [enRows] = await pool.query(
    `SELECT en.id AS enrollment_id, en.user_id, en.exam_id, ${uSelect.join(', ')}
     FROM exam_enrollments en
     JOIN qms_users u ON u.id = en.user_id
     WHERE en.exam_id = ?
     ORDER BY en.id`,
    [examId]
  );
  const list = enRows || [];
  const filtered = userId
    ? list.filter((r) => Number(r.user_id) === userId)
    : phoneFilter
      ? list.filter((r) => normPhone(r.phone) === phoneFilter)
      : list;

  const targets = filtered.length ? filtered : list;
  if (!targets.length) {
    console.log('\n【错误】无 exam_enrollments 行（该考试下没有考生？）');
    process.exit(0);
  }

  for (const row of targets) {
    section(
      `考生 en.id=${row.enrollment_id} user_id=${row.user_id} ${row.username || ''} / ${row.real_name || ''}`
    );
    console.log(
      `qms_users: phone=[${row.phone}] exam_number=[${row.exam_number || ''}] job_code=[${row.job_code || ''}] position=[${row.position || ''}] id_card_image_path=${row.id_card_image_path ? '有' : '无'}`
    );

    const enPhone = normPhone(row.phone);
    const nameKey = String(row.real_name || '')
      .trim()
      .toLowerCase();
    if (!allSj.length) {
      console.log('【原因】无 sj_ 可匹配行：无 batch 或表空，请做企业端分配/导入或查 compat。');
      continue;
    }
    const normalized = allSj
      .map((r) => ({ raw: r, n: normalizeSjImportedRow(r) }))
      .filter((x) => x.n);
    const byPhone = normalized.filter((x) => normPhone(x.n.mobile) === enPhone && enPhone.length >= 10);
    const byName = normalized.filter((x) => (x.n.name || '').toLowerCase() === nameKey && nameKey);
    const hit =
      (byPhone.length === 1 ? byPhone[0] : byPhone.find((x) => (x.n.name || '').toLowerCase() === nameKey)) ||
      (byName.length === 1 ? byName[0] : null) ||
      byName[0];

    if (hit) {
      console.log('【匹配】可从 sj_ 归一化得到（补全应能写入，若仍空请查 merge 或重启后再拉列表）:');
      console.log(
        `  exam_no=[${hit.n.exam_no}] job_code=[${hit.n.job_code}] mobile=[${hit.n.mobile}] name=[${hit.n.name}] id_number=[${(hit.n.id_number || '').slice(0, 4)}...]`
      );
    } else {
      console.log('【原因】当前 sj_ 中无与本条姓名+手机能唯一对应的行。');
      console.log(`  本端: enPhone=[${enPhone}] nameKey=[${nameKey}]`);
      if (enPhone && byPhone.length > 1) {
        console.log(`  同手机在 sj_ 有 ${byPhone.length} 条，需保证姓名一致或清重复。`);
      }
    }
  }

  section('建议');
  console.log('1) 无 sj_ 行：在企业端做考试分配/导入，并确认 save-batch 等写入 sj_。');
  console.log('2) 有 sj_ 但匹配不上：核对 real_name/phone 与 sj_ 行是否一致（空格、生僻字、多音）。');
  console.log('3) 有匹配仍空：确认已部署最新 examEnrollments 补全逻辑并重启 Node；再打开考生管理触发列表拉取。');
  console.log('4) 分配 payload 补全：compat_exam_allocation_batches 有该行企业的 payload_json.allocations 且含准考证/岗位/photo。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
