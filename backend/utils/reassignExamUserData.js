/**
 * 将副账号上的考试相关数据改挂到主账号（报名 / 通知 / 会话 / 汇总表 user_id 冗余列）。
 * 与 scripts/reassign_exam_data_from_cand_to_main_user.js 行为一致，供脚本复用。
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} fromId
 * @param {number} toId
 * @param {{ examFilter: string, examParams: any[], dryRun: boolean }} opts
 * @returns {Promise<{ enUpdated: number, enDeleted: number, nUpdated: number, nDeleted: number, sUpdated: number, sDeleted: number, sumUpdated: number, anyWork: boolean }>}
 */
async function reassignExamUserDataForPair(conn, fromId, toId, opts) {
  const { examFilter, examParams, dryRun } = opts;
  let enUpdated = 0;
  let enDeleted = 0;
  let nUpdated = 0;
  let nDeleted = 0;
  let sUpdated = 0;
  let sDeleted = 0;
  let sumUpdated = 0;

  const [enRows] = await conn.query(
    `SELECT id, exam_id, user_id, invite_code, status FROM exam_enrollments WHERE user_id = ? ${examFilter} ORDER BY id`,
    [fromId, ...examParams]
  );
  for (const row of enRows || []) {
    const eid = row.exam_id;
    const [dup] = await conn.query(
      'SELECT id FROM exam_enrollments WHERE exam_id = ? AND user_id = ? LIMIT 1',
      [eid, toId]
    );
    if (dup && dup.length) {
      if (!dryRun) {
        await conn.query('DELETE FROM exam_enrollments WHERE id = ?', [row.id]);
      }
      enDeleted++;
    } else {
      if (!dryRun) {
        await conn.query('UPDATE exam_enrollments SET user_id = ? WHERE id = ?', [toId, row.id]);
      }
      enUpdated++;
    }
  }

  const [nRows] = await conn.query(
    `SELECT id, exam_id, user_id FROM exam_invitation_notifications WHERE user_id = ? ${examFilter} ORDER BY id`,
    [fromId, ...examParams]
  );
  for (const n of nRows || []) {
    const [nDup] = await conn.query(
      'SELECT id FROM exam_invitation_notifications WHERE exam_id = ? AND user_id = ? LIMIT 1',
      [n.exam_id, toId]
    );
    if (nDup && nDup.length) {
      if (!dryRun) {
        await conn.query('DELETE FROM exam_invitation_notifications WHERE id = ?', [n.id]);
      }
      nDeleted++;
    } else {
      if (!dryRun) {
        await conn.query('UPDATE exam_invitation_notifications SET user_id = ? WHERE id = ?', [toId, n.id]);
      }
      nUpdated++;
    }
  }

  const [sRows] = await conn.query(
    `SELECT id, exam_id, user_id FROM exam_sessions WHERE user_id = ? ${examFilter} ORDER BY id`,
    [fromId, ...examParams]
  );
  for (const s of sRows || []) {
    const [sDup] = await conn.query(
      'SELECT id FROM exam_sessions WHERE exam_id = ? AND user_id = ? LIMIT 1',
      [s.exam_id, toId]
    );
    if (sDup && sDup.length) {
      if (!dryRun) {
        await conn.query('DELETE FROM exam_sessions WHERE id = ?', [s.id]);
      }
      sDeleted++;
    } else {
      if (!dryRun) {
        await conn.query('UPDATE exam_sessions SET user_id = ? WHERE id = ?', [toId, s.id]);
      }
      sUpdated++;
    }
  }

  try {
    const [sumR] = await conn.query(
      `SELECT id FROM exam_summaries WHERE user_id = ? ${examFilter} ORDER BY id`,
      [fromId, ...examParams]
    );
    for (const r of sumR || []) {
      if (!dryRun) {
        await conn.query('UPDATE exam_summaries SET user_id = ? WHERE id = ?', [toId, r.id]);
      }
      sumUpdated++;
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') {
      console.warn('[reassignExamUserData] exam_summaries skip:', e.message);
    }
  }

  const anyWork =
    (enRows && enRows.length) ||
    (nRows && nRows.length) ||
    (sRows && sRows.length) ||
    sumUpdated > 0;
  return { enUpdated, enDeleted, nUpdated, nDeleted, sUpdated, sDeleted, sumUpdated, anyWork };
}

module.exports = { reassignExamUserDataForPair };
