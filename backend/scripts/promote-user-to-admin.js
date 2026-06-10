/**
 * 将 qms_users 中指定用户提升为 admin，并尽量同步 qms_user_permissions（若存在行）。
 * 用法（在 backend 目录、已配置 .env）：
 *   node scripts/promote-user-to-admin.js shengjuceping789
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../config/database');
const UserModel = require('../models/userModel');

async function main() {
  const raw = process.argv[2];
  if (!raw || !String(raw).trim()) {
    console.error('用法: node scripts/promote-user-to-admin.js <用户名>');
    process.exit(1);
  }
  const username = String(raw).trim();
  const user = await UserModel.findByUsername(username);
  if (!user) {
    console.error('用户不存在:', username);
    process.exit(1);
  }
  await pool.execute('UPDATE qms_users SET role = ? WHERE id = ?', ['admin', user.id]);
  try {
    const col = await UserModel.getPermUserIdColumn();
    if (col) {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS n FROM qms_user_permissions WHERE ${col} = ?`,
        [user.id]
      );
      if (rows[0] && rows[0].n > 0) {
        await pool.execute(
          `UPDATE qms_user_permissions SET can_contribute = 1, can_edit_shared = 1, can_manage_users = 1, can_view_all_data = 1 WHERE ${col} = ?`,
          [user.id]
        );
      }
    }
  } catch (e) {
    console.warn('权限表更新跳过:', e.message);
  }
  console.log('已将该用户设为 admin:', username, 'id=', user.id);
  console.log('请重新登录以获取含 role=admin 的新 JWT。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
