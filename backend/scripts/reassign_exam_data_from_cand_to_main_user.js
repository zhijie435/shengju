/**
 * 将副账号上的考试数据合并到主账号（exam_enrollments / exam_invitation_notifications / exam_sessions / exam_summaries 若存在）
 *
 * 单对迁移：
 *   node scripts/reassign_exam_data_from_cand_to_main_user.js --from=118 --to=33 --dry-run
 *   node scripts/reassign_exam_data_from_cand_to_main_user.js --from=118 --to=33
 * 仅某场考试：
 *   node scripts/reassign_exam_data_from_cand_to_main_user.js --from=118 --to=33 --exam-id=55
 *
 * 按同一手机号批量（除主号外，其余 id 逐个迁到主号；建议先 --dry-run）：
 *   node scripts/reassign_exam_data_from_cand_to_main_user.js --to=33 --from-all-phone=18092263819 --dry-run
 *   node scripts/reassign_exam_data_from_cand_to_main_user.js --to=33 --from-all-phone=18092263819
 *
 * 说明：若某 from 在 exam_enrollments 中无任何数据，仍会尝试通知/会话；全无则跳过该 from。
 * 合并后副号 qms_users 行仍存在（不自动删用户）；仅迁考试相关表。详见 MERGE_CANDIDATE_ACCOUNTS.md
 */

require('dotenv').config();
const { pool } = require('../config/database');
const { reassignExamUserDataForPair } = require('../utils/reassignExamUserData');

function parseArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=').slice(1).join('=');
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`) || process.argv.some((x) => x === `--${name}=true`);
}

function normPhone(s) {
  return String(s || '').replace(/\D/g, '');
}

async function reassignOnePair(conn, fromId, toId, examFilter, examParams, dryRun) {
  const stats = await reassignExamUserDataForPair(conn, fromId, toId, { examFilter, examParams, dryRun });
  if (dryRun) {
    const [enRows] = await conn.query(
      `SELECT id, exam_id, user_id, invite_code, status FROM exam_enrollments WHERE user_id = ? ${examFilter} ORDER BY id`,
      [fromId, ...examParams]
    );
    const [nRows] = await conn.query(
      `SELECT id, exam_id, user_id FROM exam_invitation_notifications WHERE user_id = ? ${examFilter} ORDER BY id`,
      [fromId, ...examParams]
    );
    const [sRows] = await conn.query(
      `SELECT id, exam_id, user_id FROM exam_sessions WHERE user_id = ? ${examFilter} ORDER BY id`,
      [fromId, ...examParams]
    );
    for (const row of enRows || []) {
      const eid = row.exam_id;
      const [dup] = await conn.query(
        'SELECT id FROM exam_enrollments WHERE exam_id = ? AND user_id = ? LIMIT 1',
        [eid, toId]
      );
      if (dup && dup.length) {
        console.log(
          `[dry-run] 考试 ${eid} 主账号已有报名，将删除副账号报名 id=${row.id}（副 invite=${row.invite_code}）`
        );
      } else {
        console.log(`[dry-run] 更新 exam_enrollments id=${row.id}：user_id ${fromId} -> ${toId}（exam_id=${eid}）`);
      }
    }
    for (const n of nRows || []) {
      const [nDup] = await conn.query(
        'SELECT id FROM exam_invitation_notifications WHERE exam_id = ? AND user_id = ? LIMIT 1',
        [n.exam_id, toId]
      );
      if (nDup && nDup.length) {
        console.log(`[dry-run] 考试 ${n.exam_id} 主账号已有通知，将删除 from 侧通知 id=${n.id}`);
      } else {
        console.log(`[dry-run] 更新 exam_invitation_notifications id=${n.id}：user_id ${fromId} -> ${toId}`);
      }
    }
    for (const s of sRows || []) {
      const [sDup] = await conn.query(
        'SELECT id FROM exam_sessions WHERE exam_id = ? AND user_id = ? LIMIT 1',
        [s.exam_id, toId]
      );
      if (sDup && sDup.length) {
        console.log(
          `[dry-run] 考试 ${s.exam_id} 主账号已有 session，将删除 from 侧 session id=${s.id}（有答题时请先评估）`
        );
      } else {
        console.log(`[dry-run] 更新 exam_sessions id=${s.id}：user_id ${fromId} -> ${toId}`);
      }
    }
  }
  if (!stats.anyWork) {
    console.log(`[跳过] from=${fromId}：无考试相关表需迁移（报名/通知/会话/汇总）。`);
  }
  const { enUpdated, enDeleted, nUpdated, nDeleted, sUpdated, sDeleted, sumUpdated } = stats;
  return { enUpdated, enDeleted, nUpdated, nDeleted, sUpdated, sDeleted, sumUpdated, anyWork: stats.anyWork };
}

async function runSinglePair(fromId, toId, examIdArg, dryRun) {
  const examFilter =
    examIdArg != null && String(examIdArg).trim() !== '' ? ' AND exam_id = ? ' : '';
  const examParams =
    examIdArg != null && String(examIdArg).trim() !== '' ? [parseInt(examIdArg, 10)] : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const stats = await reassignOnePair(conn, fromId, toId, examFilter, examParams, dryRun);
    if (dryRun) {
      await conn.rollback();
      console.log(
        '\n[dry-run] 已回滚。确认后去掉 --dry-run 再执行。\n' +
          `  enroll: 更新 ${stats.enUpdated}、删除 ${stats.enDeleted}；` +
          `  notif: 更新 ${stats.nUpdated}、删 ${stats.nDeleted}；` +
          `  session: 更新 ${stats.sUpdated}、删 ${stats.sDeleted}；` +
          `  summaries.user_id: 更新 ${stats.sumUpdated != null ? stats.sumUpdated : 0}`
      );
    } else {
      if (!stats.anyWork) {
        await conn.rollback();
        console.log('无任何考试相关数据可迁移。');
      } else {
        await conn.commit();
        console.log(
          '迁移完成：\n' +
            `  exam_enrollments: 更新 ${stats.enUpdated}，因主号已有而删副号 ${stats.enDeleted}\n` +
            `  exam_invitation_notifications: 更新 ${stats.nUpdated}，删 ${stats.nDeleted}\n` +
            `  exam_sessions: 更新 ${stats.sUpdated}，删 ${stats.sDeleted}\n` +
            `  exam_summaries.user_id: 更新 ${stats.sumUpdated != null ? stats.sumUpdated : 0}\n` +
            '主账号需重新登录后查看「专业测评 / 消息」。'
        );
      }
    }
  } catch (e) {
    await conn.rollback();
    console.error('执行失败:', e.message || e);
    process.exit(1);
  } finally {
    conn.release();
  }
}

async function listIdsByPhone(phoneArg, excludeTo) {
  const d = normPhone(phoneArg);
  if (d.length < 10) return [];
  const variants = [d];
  if (d.length === 11 && d.startsWith('1')) {
    variants.push('86' + d);
  }
  const [rows] = await pool.query(
    `SELECT id, username, phone, real_name, role FROM qms_users
     WHERE id <> ?
       AND (
         REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'+','') = ?
         OR REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'+','') = ?
       )`,
    [excludeTo, variants[0], variants[1] || variants[0]]
  );
  return (rows || []).map((r) => ({ ...r, id: Number(r.id) })).sort((a, b) => a.id - b.id);
}

async function runAllPhone(toId, phoneArg, examIdArg, dryRun) {
  const candidates = await listIdsByPhone(phoneArg, toId);
  if (!candidates.length) {
    console.log('该手机号下除主号外无其它用户，或手机号格式无法匹配。');
    return;
  }
  console.log(
    `将把以下 ${candidates.length} 个 id 的考试数据合并到 to=${toId}：`,
    candidates.map((c) => c.id + '(' + (c.username || '') + ')').join(', ')
  );
  const examFilter =
    examIdArg != null && String(examIdArg).trim() !== '' ? ' AND exam_id = ? ' : '';
  const examParams =
    examIdArg != null && String(examIdArg).trim() !== '' ? [parseInt(examIdArg, 10)] : [];

  const totals = { enU: 0, enD: 0, nU: 0, nD: 0, sU: 0, sD: 0, sumU: 0, pairs: 0 };

  for (const c of candidates) {
    if (c.id === toId) continue;
    console.log(`\n--- 处理 from=${c.id} ${c.username || ''} ---`);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const stats = await reassignOnePair(conn, c.id, toId, examFilter, examParams, dryRun);
      if (dryRun) {
        await conn.rollback();
      } else if (stats.anyWork) {
        await conn.commit();
        totals.pairs++;
      } else {
        await conn.rollback();
      }
      totals.enU += stats.enUpdated;
      totals.enD += stats.enDeleted;
      totals.nU += stats.nUpdated;
      totals.nD += stats.nDeleted;
      totals.sU += stats.sUpdated;
      totals.sD += stats.sDeleted;
      totals.sumU += stats.sumUpdated || 0;
    } catch (e) {
      await conn.rollback();
      console.error(`from=${c.id} 失败:`, e.message || e);
    } finally {
      conn.release();
    }
  }
  if (dryRun) {
    console.log(
      `\n[全部 dry-run] 汇总: enroll 更新~${totals.enU} 删~${totals.enD}；` +
        ` notif 更新~${totals.nU} 删~${totals.nD}； session 更新~${totals.sU} 删~${totals.sD}； summaries~${totals.sumU}`
    );
  } else {
    console.log(
      `\n批量完成（有数据的 from 数约 ${totals.pairs}）。汇总: enroll 更新 ${totals.enU} 删 ${totals.enD}；` +
        ` notif ${totals.nU}/${totals.nD}； session ${totals.sU}/${totals.sD}； summaries ${totals.sumU}`
    );
  }
}

async function main() {
  const fromRaw = parseArg('from');
  const toRaw = parseArg('to');
  const fromAllPhone = parseArg('from-all-phone');
  const examIdArg = parseArg('exam-id');
  const dryRun = hasFlag('dry-run');

  const toId = toRaw != null ? parseInt(toRaw, 10) : NaN;
  if (!Number.isFinite(toId) || toId <= 0) {
    console.error('请指定 --to=<主账号user_id>（要保留的求职者/常用号）');
    process.exit(1);
  }

  if (fromAllPhone != null && String(fromAllPhone).trim() !== '') {
    await runAllPhone(toId, fromAllPhone, examIdArg, dryRun);
    process.exit(0);
  }

  const fromId = fromRaw != null ? parseInt(fromRaw, 10) : NaN;
  if (!Number.isFinite(fromId) || fromId <= 0) {
    console.error('请使用 --from=<id> 或 --from-all-phone=手机号 配合 --to=');
    process.exit(1);
  }
  if (fromId === toId) {
    console.error('from 与 to 不能相同');
    process.exit(1);
  }
  await runSinglePair(fromId, toId, examIdArg, dryRun);
  process.exit(0);
}

main();
