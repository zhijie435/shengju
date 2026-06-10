/**
 * 将各业务表中 enterprise_id 从旧值统一改为新值（与笔试库 enterprises.id 对齐）。
 *
 * 在 backend 目录执行。默认仅打印影响行数，不加 --execute 不改库。
 *
 *   node scripts/realign_enterprise_foreign_keys.js --from-id=10 --to-id=16
 *   node scripts/realign_enterprise_foreign_keys.js --from-id=10 --to-id=16 --execute
 *
 * 执行前务必备份数据库。
 * compat_enterprise_company_profile 主键为 enterprise_id：若 to 已有一行，则对 from 行执行 DELETE（保留 to），不再 UPDATE。
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

async function listTablesWithEnterpriseIdColumn() {
  const [rows] = await pool.execute(
    `SELECT TABLE_NAME AS t
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'enterprise_id'
     ORDER BY TABLE_NAME`
  );
  return (rows || []).map((r) => r.t).filter(Boolean);
}

async function main() {
  const fromId = n(parseArg('from-id'));
  const toId = n(parseArg('to-id'));
  const doExecute = process.argv.includes('--execute');

  if (!fromId || !toId || fromId === toId) {
    console.error('用法: node scripts/realign_enterprise_foreign_keys.js --from-id=旧 --to-id=新 [--execute]');
    process.exit(1);
  }

  const tables = await listTablesWithEnterpriseIdColumn();
  if (!tables.length) {
    console.log('当前库无 enterprise_id 列。');
    await pool.end().catch(() => {});
    return;
  }

  console.log(`将 enterprise_id ${fromId} → ${toId}，表数=${tables.length}，模式=${doExecute ? '执行 UPDATE' : '仅预览'}\n`);

  const conn = await pool.getConnection();
  try {
    if (doExecute) await conn.beginTransaction();

    for (const table of tables) {
      const [[cnt]] = await conn.execute(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`enterprise_id\` = ?`,
        [fromId]
      );
      const c = Number(cnt && cnt.n) || 0;
      if (c === 0) {
        console.log(`[skip] ${table}: 0 行`);
        continue;
      }
      if (table === 'compat_enterprise_company_profile') {
        const [[cntTo]] = await conn.execute(
          `SELECT COUNT(*) AS n FROM \`${table}\` WHERE enterprise_id = ?`,
          [toId]
        );
        const hasToRow = Number(cntTo && cntTo.n) > 0;
        if (!doExecute) {
          console.log(
            hasToRow
              ? `[dry-run] ${table}: ${c} 行 → DELETE enterprise_id=${fromId}（已存在 enterprise_id=${toId} 主键行，不能 UPDATE）`
              : `[dry-run] ${table}: ${c} 行 → UPDATE enterprise_id ${fromId}→${toId}`
          );
          continue;
        }
        if (hasToRow) {
          const [dr] = await conn.execute(`DELETE FROM \`${table}\` WHERE enterprise_id = ?`, [fromId]);
          const delN = dr && typeof dr.affectedRows === 'number' ? dr.affectedRows : 0;
          console.log(`[ok] ${table}: DELETE from_id（保留 to_id=${toId}）affectedRows=${delN}`);
        } else {
          const [r] = await conn.execute(
            `UPDATE \`${table}\` SET \`enterprise_id\` = ? WHERE \`enterprise_id\` = ?`,
            [toId, fromId]
          );
          const affected = r && typeof r.affectedRows === 'number' ? r.affectedRows : c;
          console.log(`[ok] ${table}: affectedRows=${affected}`);
        }
        continue;
      }

      if (!doExecute) {
        console.log(`[dry-run] ${table}: ${c} 行 → UPDATE enterprise_id ${fromId}→${toId}`);
        continue;
      }
      try {
        const [r] = await conn.execute(
          `UPDATE \`${table}\` SET \`enterprise_id\` = ? WHERE \`enterprise_id\` = ?`,
          [toId, fromId]
        );
        const affected = r && typeof r.affectedRows === 'number' ? r.affectedRows : c;
        console.log(`[ok] ${table}: affectedRows=${affected}`);
      } catch (e) {
        console.error(`[fail] ${table}: ${e.message}`);
        throw e;
      }
    }

    if (doExecute) await conn.commit();
    console.log('\n完成。');
  } catch (e) {
    if (doExecute) await conn.rollback();
    console.error('\n已回滚:', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end().catch(() => {});
  }
}

main();
