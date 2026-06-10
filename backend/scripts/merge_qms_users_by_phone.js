/**
 * 按「规范化手机号」合并重复 qms_users：保留一条主号，其余副号的考试数据挂到主号，并可清空副号手机避免再分散登录。
 *
 * 主号选取规则与 UserModel.findByPhone 一致：role 优先 user，其次 candidate/jobseeker，再 enterprise/admin，同序取 id 最小。
 *
 * 用法（在 backend 目录、配置好 .env 数据库）：
 *   node scripts/merge_qms_users_by_phone.js                    # 仅预览，不写库
 *   node scripts/merge_qms_users_by_phone.js --execute          # 真正执行
 *   node scripts/merge_qms_users_by_phone.js --phone=18092263819 # 只处理该号
 *   node scripts/merge_qms_users_by_phone.js --execute --phone=18092263819
 *
 * 会处理：exam_enrollments、exam_invitation_notifications、exam_sessions、exam_summaries（若存在）；
 * 副号 qms_users：phone 置 NULL；status 依次尝试 inactive、suspended、disabled（与 ENUM 对齐，可用 MERGE_DUP_STATUS_TRIES 覆盖）。
 * 不修改 compat_* 等业务表上的 user_id；人才网报名表仍以原 user_id 关联，主号登录后考试列表已通过同号合并接口拉齐。
 *
 * 执行 SQL 迁移文件（身份证图 URL 列加长）示例：
 *   cd /var/www/新的/backend
 *   mysql -h127.0.0.1 -u shengju -p shengju < database/migrate_qms_users_id_card_image_path_text.sql
 */

require('dotenv').config();
const { pool } = require('../config/database');
const { reassignExamUserDataForPair } = require('../utils/reassignExamUserData');

function normPhone(s) {
  return String(s || '').replace(/\D/g, '');
}

function roleRank(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r === 'user') return 0;
  if (r === 'candidate' || r === 'jobseeker') return 1;
  if (r === 'enterprise' || r === 'admin') return 2;
  return 3;
}

function pickCanonicalUser(rows) {
  return [...rows].sort((a, b) => {
    const ra = roleRank(a.role);
    const rb = roleRank(b.role);
    if (ra !== rb) return ra - rb;
    return Number(a.id) - Number(b.id);
  })[0];
}

function isEmptyVal(v) {
  return v == null || String(v).trim() === '';
}

/**
 * 把副号上主号仍为空的档案字段补到主号（同一连接内，便于事务）。
 */
async function mergeProfilePreferCanonical(conn, canonId, dupId, dryRun) {
  const [rows] = await conn.query('SELECT * FROM qms_users WHERE id IN (?, ?)', [canonId, dupId]);
  const canon = rows.find((r) => Number(r.id) === Number(canonId));
  const dup = rows.find((r) => Number(r.id) === Number(dupId));
  if (!canon || !dup) return;

  const cols = ['real_name', 'id_card', 'exam_number', 'position', 'education', 'job_code', 'email'];
  for (const col of cols) {
    if (!(col in dup)) continue;
    if (!isEmptyVal(canon[col])) continue;
    const d = dup[col];
    if (isEmptyVal(d)) continue;
    const val = String(d).trim();
    if (dryRun) {
      console.log(`  [dry-run] 主号 ${canonId} 将补全 ${col} <- 副号 ${dupId}`);
      continue;
    }
    try {
      await conn.query(`UPDATE qms_users SET \`${col}\` = ? WHERE id = ?`, [val, canonId]);
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  }

  if ('id_card_image_path' in dup && 'id_card_image_path' in canon) {
    const c = canon.id_card_image_path != null ? String(canon.id_card_image_path) : '';
    const d = dup.id_card_image_path != null ? String(dup.id_card_image_path) : '';
    const cTrim = c.trim();
    const dTrim = d.trim();
    if ((!cTrim && dTrim) || (dTrim.length > cTrim.length && dTrim.length > 8)) {
      const maxLen = 1020;
      const val = dTrim.length > maxLen ? dTrim.slice(0, maxLen) : dTrim;
      if (dryRun) {
        console.log(`  [dry-run] 主号 ${canonId} 将更新 id_card_image_path（副号 ${dupId}，长度 ${dTrim.length}）`);
      } else {
        try {
          await conn.query('UPDATE qms_users SET id_card_image_path = ? WHERE id = ?', [val, canonId]);
        } catch (e) {
          console.warn(`  [merge] id_card_image_path 写入失败:`, e.message);
        }
      }
    }
  }
}

/** 与常见库表一致：ENUM('active','inactive','suspended') 无 disabled，需依次尝试 */
function dupStatusCandidates() {
  const raw = process.env.MERGE_DUP_STATUS_TRIES || 'inactive,suspended,disabled';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function deactivateDup(conn, dupId, dryRun) {
  const tries = dupStatusCandidates();
  if (dryRun) {
    console.log(`  [dry-run] 副号 ${dupId}：将 phone=NULL，并依次尝试 status=${tries.join('|')}`);
    return;
  }
  await conn.query('UPDATE qms_users SET phone = NULL WHERE id = ?', [dupId]);
  let set = false;
  for (const st of tries) {
    try {
      await conn.query('UPDATE qms_users SET status = ? WHERE id = ?', [st, dupId]);
      set = true;
      break;
    } catch (e) {
      /* ENUM 不含该值时换下一个 */
    }
  }
  if (!set) {
    console.warn(
      `  [merge] 副号 ${dupId}：phone 已清空；status 未改（库 ENUM 可能不含 ${tries.join(',')}）。` +
        '可设环境变量 MERGE_DUP_STATUS_TRIES=你的枚举值 后仅对该 id 手工 UPDATE，或保持仅用「清空手机」限制手机登录。'
    );
  }
}

async function processDupPair(canonId, dupId, dryRun) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await mergeProfilePreferCanonical(conn, canonId, dupId, dryRun);
    const examStats = await reassignExamUserDataForPair(conn, dupId, canonId, {
      examFilter: '',
      examParams: [],
      dryRun
    });
    await deactivateDup(conn, dupId, dryRun);
    if (dryRun) {
      await conn.rollback();
    } else {
      await conn.commit();
    }
    return examStats;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function main() {
  const dryRun = !process.argv.includes('--execute');
  const phoneFilter = (() => {
    const a = process.argv.find((x) => x.startsWith('--phone='));
    return a ? normPhone(a.split('=').slice(1).join('=')) : '';
  })();

  if (dryRun) {
    console.log('【预览模式】不写库。确认无误后追加 --execute 再跑。\n');
  }

  const [all] = await pool.query(
    `SELECT id, username, real_name, phone, role, status
     FROM qms_users
     WHERE phone IS NOT NULL AND TRIM(COALESCE(phone,'')) <> ''`
  );

  const groups = new Map();
  for (const u of all || []) {
    const p = normPhone(u.phone);
    if (p.length < 10) continue;
    if (phoneFilter && p !== phoneFilter) continue;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(u);
  }

  const multi = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  if (!multi.length) {
    console.log(phoneFilter ? `没有「${phoneFilter}」下多于一条的账号。` : '没有「同手机号多条 qms_users」需要合并。');
    process.exit(0);
  }

  console.log(`共 ${multi.length} 个手机号存在多条账号，将逐组合并。\n`);

  const totals = {
    groups: 0,
    dups: 0,
    enU: 0,
    enD: 0,
    nU: 0,
    nD: 0,
    sU: 0,
    sD: 0,
    sumU: 0
  };

  for (const [p, arr] of multi.sort((a, b) => a[0].localeCompare(b[0]))) {
    const canon = pickCanonicalUser(arr);
    const dups = arr.filter((u) => Number(u.id) !== Number(canon.id)).sort((a, b) => Number(a.id) - Number(b.id));
    console.log(`\n=== 手机 ${p} 主号 id=${canon.id} (${canon.username}) role=${canon.role}；副号 ${dups.map((d) => d.id).join(',')} ===`);

    for (const d of dups) {
      console.log(`--- 副号 id=${d.id} (${d.username}) -> 主号 ${canon.id} ---`);
      try {
        const st = await processDupPair(Number(canon.id), Number(d.id), dryRun);
        totals.dups++;
        totals.enU += st.enUpdated;
        totals.enD += st.enDeleted;
        totals.nU += st.nUpdated;
        totals.nD += st.nDeleted;
        totals.sU += st.sUpdated;
        totals.sD += st.sDeleted;
        totals.sumU += st.sumUpdated;
      } catch (e) {
        console.error(`失败 id ${d.id}:`, e.message || e);
      }
    }
    totals.groups++;
  }

  console.log(
    `\n完成${dryRun ? '（预览）' : ''}：处理手机号组 ${totals.groups}，副号 ${totals.dups} 个；` +
      `报名 更新${totals.enU}/删${totals.enD}；通知 ${totals.nU}/${totals.nD}；会话 ${totals.sU}/${totals.sD}；汇总 user_id ${totals.sumU}`
  );
  if (!dryRun) {
    console.log('请让考生使用「主号」或原手机号登录（已指向主号 findByPhone 规则）；副号已清空手机，一般不再用于手机登录。');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
