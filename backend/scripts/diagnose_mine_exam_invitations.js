/**
 * 诊断：为何 GET /api/exam-invitations/mine 返回 data:[]（与线上「专业测评」空列表一致）
 *
 * 在 backend 目录、配置好 .env 可连**生产/测试库**后执行：
 *   node scripts/diagnose_mine_exam_invitations.js --phone=18092263819
 *   node scripts/diagnose_mine_exam_invitations.js --user-id=33
 *   node scripts/diagnose_mine_exam_invitations.js --username=gaoyajun
 *   node scripts/diagnose_mine_exam_invitations.js --phone=18092263819 --exam-id=55
 *
 * 会输出：同机号下所有 user id、与 mine 等价的 SQL 命中的报名行、
 * 若指定 exam-id 则只盯本场；未指定则列出你命中的全部 draft/published/ongoing 场（与当前 mine 接口一致）。
 */

require('dotenv').config();
const { pool } = require('../config/database');
const UserModel = require('../models/userModel');

/** 与 models/userModel.getAllIdsWithSamePhoneAsUser 同逻辑；脚本自包含，避免老代码无此方法时报错 */
async function getIdListForSamePhone(uid, phoneStr) {
  const p = phoneStr && String(phoneStr).trim();
  if (!p) {
    return [uid];
  }
  try {
    const [irows] = await pool.query('SELECT id FROM qms_users WHERE phone = ?', [p]);
    const ids = (irows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
    return ids.length ? [...new Set(ids)] : [uid];
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || (e.message || '').includes('Unknown column')) {
      return [uid];
    }
    throw e;
  }
}

function parseArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=').slice(1).join('=');
}

function normPhone(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

async function main() {
  const phoneArg = (parseArg('phone') || '').trim();
  const usernameArg = (parseArg('username') || '').trim();
  const userIdArg = parseInt(parseArg('user-id') || '0', 10);
  const examIdFilter = parseInt(parseArg('exam-id') || '0', 10);

  if (!phoneArg && !usernameArg && !(Number.isFinite(userIdArg) && userIdArg > 0)) {
    console.error('请指定 --phone=手机号 或 --user-id=数字 或 --username=用户名（至少一个）');
    process.exit(1);
  }

  let loginUser = null;
  if (Number.isFinite(userIdArg) && userIdArg > 0) {
    loginUser = await UserModel.findById(userIdArg);
  }
  if (usernameArg && !loginUser) {
    loginUser = await UserModel.findByUsername(usernameArg);
  }
  if (phoneArg && !loginUser) {
    if (normPhone(phoneArg).length < 10) {
      console.error('手机号不合法');
      process.exit(1);
    }
    loginUser = await UserModel.findByPhone(phoneArg);
  }

  if (!loginUser) {
    console.log('\n【结果】qms_users 中按 id / username / phone 查不到。mine 必为空。');
    process.exit(0);
  }

  const uid = Number(loginUser.id);
  console.log('\n======== 作为「当前登录用户」命中的行（与 JWT 的 userId 应一致）========');
  const [pOnly] = await pool.query('SELECT id, username, phone, `role`, status, real_name FROM qms_users WHERE id = ? LIMIT 1', [uid]);
  console.log(JSON.stringify(pOnly && pOnly[0] ? pOnly[0] : loginUser, null, 2));
  const phoneForList = pOnly && pOnly[0] && pOnly[0].phone != null ? String(pOnly[0].phone).trim() : '';
  if (phoneForList) {
    const [samePhoneRows] = await pool.query(
      'SELECT id, username, phone, `role`, status FROM qms_users WHERE phone = ? ORDER BY id ASC',
      [phoneForList]
    );
    if (samePhoneRows && samePhoneRows.length) {
      console.log('\n======== 该 phone 在 qms_users 的**全部**行（同机号多账号时不止一行）========');
      samePhoneRows.forEach((r) => console.log(JSON.stringify(r)));
    }
  } else {
    console.log('\n【警告】该 user 的 phone 为空。同号合并会退化为 [本 id]。可执行: UPDATE qms_users SET phone=? WHERE id=?');
  }

  const idList = await getIdListForSamePhone(uid, phoneForList || (loginUser.phone && String(loginUser.phone).trim()));
  console.log('\n======== 同机号下全部 user_id（与已部署的 mine 合并逻辑应一致，见 userModel.getAllIdsWithSamePhoneAsUser）========\n' + JSON.stringify(idList));

  const ph = idList.map(() => '?').join(',');
  const examParam = Number.isFinite(examIdFilter) && examIdFilter > 0 ? ' AND en.exam_id = ?' : '';
  const params = [...idList, ...(examParam ? [examIdFilter] : [])];
  const [rows] = await pool.query(
    `SELECT en.id AS enrollment_id, en.exam_id, en.user_id AS enrollment_user_id,
            e.name AS exam_name, e.status AS exam_status, e.start_time, e.end_time
     FROM exam_enrollments en
     JOIN exams e ON e.id = en.exam_id
     WHERE en.user_id IN (${ph})${examParam}
     ORDER BY e.start_time DESC, en.id DESC`,
    params
  );

  console.log('\n======== 这些 user_id 在库里的全部报名行（不筛 published）========');
  if (!rows || !rows.length) {
    console.log('（无）— exam_enrollments 里没有任何一行 user_id 落在上面 IN 列表中。');
  } else {
    rows.forEach((r) => {
      const ok = r.exam_status === 'draft' || r.exam_status === 'published' || r.exam_status === 'ongoing';
      const tag = ok ? '【会出现在 mine】' : '【不会：考试状态已结束/取消等】';
      console.log(tag, JSON.stringify(r));
    });
  }

  const [forMine] = await pool.query(
    `SELECT en.id AS enrollment_id, en.exam_id, e.name, e.status AS exam_status
     FROM exam_enrollments en
     JOIN exams e ON e.id = en.exam_id
     WHERE en.user_id IN (${ph})
       AND e.status IN ('draft', 'published', 'ongoing')${examParam ? ' AND en.exam_id = ?' : ''}
     ORDER BY e.start_time DESC`,
    params
  );
  console.log('\n======== 与 /exam-invitations/mine 完全一致的行（draft|published|ongoing）========');
  if (!forMine || !forMine.length) {
    console.log('（无）→ 接口会返回 data:[]');
  } else {
    forMine.forEach((r) => console.log(JSON.stringify(r)));
  }

  if (Number.isFinite(examIdFilter) && examIdFilter > 0) {
    const [enAll] = await pool.query(
      `SELECT en.id, en.user_id, en.exam_id, e.status, e.name
       FROM exam_enrollments en JOIN exams e ON e.id = en.exam_id
       WHERE en.exam_id = ?`,
      [examIdFilter]
    );
    console.log('\n======== 本场考试 exam_id=' + examIdFilter + ' 下**所有**报名行（对账用）========');
    if (enAll && enAll.length) {
      enAll.forEach((r) => {
        const hit = idList.map(Number).includes(Number(r.user_id));
        console.log((hit ? '【同机号会命中】' : '【不同 user，若你是这条需把报名迁到上面对 id】') + JSON.stringify(r));
      });
    } else {
      console.log('（无）— 该场在 exam_enrollments 中没有任何人。');
    }
  }

  console.log('\n-------- 可执行的修正思路（自己评估后再执行）--------');
  console.log('1) 若「本场所有报名」里 user_id 与「同机号 id 列表」完全对不上：用 UPDATE exam_enrollments SET user_id=主号id WHERE id=报名行id 或跑 reassign_exam_data_from_cand_to_main_user.js');
  console.log('2) 若 exam_status 是 draft/ended：在考试管理把考试置为 已发布 或 进行中。');
  console.log('3) 若本账号 phone 为空而报名在子号上：给主号写 phone，或做数据迁户。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
