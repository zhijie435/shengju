/**
 * 诊断：enterprises 是否有多条「同一人才网公司 / 同一登录用户」导致审核/测评/考试数据分散。
 *
 * 【必须先 cd 到服务器上「含 backend 文件夹」的项目根，再进 backend】
 * 例如（路径以你机器为准，在 /root 下一般没有 backend）：
 *   cd /var/www/shengjuceping/backend
 *   或  cd "/var/www/新的/backend"   # 进到 backend「目录」，不要 cd 到 .js 文件
 *   ls scripts/diagnose_enterprise_duplicates.js   # 确认文件存在
 *
 * 在 backend 目录、且 .env 能连上同一套 MySQL 后执行（参数里写数字，不要写中文占位）：
 *   node scripts/diagnose_enterprise_duplicates.js
 *   node scripts/diagnose_enterprise_duplicates.js --user-id=33
 *   node scripts/diagnose_enterprise_duplicates.js --talent-company-id=55
 *   node scripts/diagnose_enterprise_duplicates.js --from-id=101 --to-id=5 --print-merge-sql
 *
 * 默认只读查库；--print-merge-sql 会打印将业务数据从 FROM 迁到 TO 的 UPDATE 模板（务必先备份、再在事务中执行）。
 * 批量改库中所有 enterprise_id 列：node scripts/realign_enterprise_foreign_keys.js --from-id=10 --to-id=16 [--execute]
 */

require('dotenv').config();
const { pool } = require('../config/database');

function parseArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=').slice(1).join('=');
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

/** 已知挂 enterprises.id 的 compat / 业务表（与 information_schema 常见列对齐；缺表时 print-merge 会跳过） */
const ENTERPRISE_ID_TABLES = [
  { table: 'assessments', column: 'enterprise_id' },
  { table: 'compat_admin_company_settings', column: 'enterprise_id' },
  { table: 'compat_admit_print_notifications', column: 'enterprise_id' },
  { table: 'compat_announcements', column: 'enterprise_id' },
  { table: 'compat_cooperation_applications', column: 'enterprise_id' },
  { table: 'compat_enterprise_ai_reports', column: 'enterprise_id' },
  { table: 'compat_enterprise_assessment_fee_settings', column: 'enterprise_id' },
  { table: 'compat_enterprise_company_profile', column: 'enterprise_id' },
  { table: 'compat_enterprise_jobs', column: 'enterprise_id' },
  { table: 'compat_enterprise_projects', column: 'enterprise_id' },
  { table: 'compat_enterprise_reviewers', column: 'enterprise_id' },
  { table: 'compat_enterprise_verification_requests', column: 'enterprise_id' },
  { table: 'compat_exam_allocation_batches', column: 'enterprise_id' },
  { table: 'enterprise_package_papers', column: 'enterprise_id' },
  { table: 'exams', column: 'enterprise_id' },
  { table: 'jobs', column: 'enterprise_id' },
  { table: 'projects', column: 'enterprise_id' },
  { table: 'qms_exams', column: 'enterprise_id' },
  { table: 'qms_grading_accounts', column: 'enterprise_id' }
];

async function tableExists(table) {
  try {
    const [r] = await pool.execute(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
      [table]
    );
    return r && r.length > 0;
  } catch (e) {
    return false;
  }
}

async function columnExists(table, col) {
  try {
    const [r] = await pool.execute(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, col]
    );
    return r && r.length > 0;
  } catch (e) {
    return false;
  }
}

async function main() {
  const uid = n(parseArg('user-id'));
  const tc = n(parseArg('talent-company-id'));
  const fromId = n(parseArg('from-id'));
  const toId = n(parseArg('to-id'));
  const printMerge = process.argv.includes('--print-merge-sql');

  console.log('=== enterprises：按 talent_company_id 重复（同一人才网公司多条笔试企业）===\n');
  const [dupTc] = await pool.execute(`
    SELECT talent_company_id AS tc, COUNT(*) AS cnt, GROUP_CONCAT(id ORDER BY id) AS ids
    FROM enterprises
    WHERE talent_company_id IS NOT NULL AND talent_company_id > 0
    GROUP BY talent_company_id
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 50
  `);
  if (!dupTc || !dupTc.length) {
    console.log('（无）同一 talent_company_id 下多条 enterprises 行。\n');
  } else {
    console.table(dupTc);
  }

  console.log('=== enterprises：同一 user_id 多行（同一登录账号多条企业）===\n');
  const [dupU] = await pool.execute(`
    SELECT user_id AS uid, COUNT(*) AS cnt, GROUP_CONCAT(id ORDER BY id) AS ids
    FROM enterprises
    WHERE user_id IS NOT NULL AND user_id > 0
    GROUP BY user_id
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 50
  `);
  if (!dupU || !dupU.length) {
    console.log('（无）同一 user_id 下多条 enterprises 行。\n');
  } else {
    console.table(dupU);
  }

  if (uid) {
    console.log(`=== 与 user_id=${uid} 相关的 enterprises 行 ===\n`);
    const [rows] = await pool.execute(
      `SELECT id, name, user_id, talent_company_id, status FROM enterprises WHERE user_id = ? ORDER BY id ASC`,
      [uid]
    );
    console.table(rows || []);
  }

  if (tc) {
    console.log(`=== talent_company_id=${tc} 的 enterprises 行 ===\n`);
    const [rows] = await pool.execute(
      `SELECT id, name, user_id, talent_company_id, status FROM enterprises WHERE talent_company_id = ? ORDER BY id ASC`,
      [tc]
    );
    console.table(rows || []);
  }

  if (printMerge && fromId && toId && fromId !== toId) {
    console.log(`\n--- 合并模板：业务 enterprise_id 从 ${fromId} 改为 ${toId}（执行前务必备份 + 停服或在事务中操作）---\n`);
    for (const { table, column } of ENTERPRISE_ID_TABLES) {
      if (!(await tableExists(table))) continue;
      if (!(await columnExists(table, column))) continue;
      console.log(
        `UPDATE \`${table}\` SET \`${column}\` = ${toId} WHERE \`${column}\` = ${fromId}; -- 请先 SELECT COUNT(*) 确认影响行数`
      );
    }
    console.log(
      `\n-- 合并后：保留 id=${toId}，删除空壳 id=${fromId}（确认无引用后再删）\n-- DELETE FROM enterprises WHERE id = ${fromId} LIMIT 1;\n`
    );
    console.log(
      `-- 将登录用户绑到主企业（若 from 才是主账号绑定的行，按需改）\n-- UPDATE qms_users SET enterprise_id = ${toId} WHERE enterprise_id = ${fromId};\n`
    );
  }

  await pool.end().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
