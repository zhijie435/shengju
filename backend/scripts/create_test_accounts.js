// 创建管理端、企业端、考生端模拟测试账号（可重复执行）
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

const TEST_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'admin', real_name: '系统管理员' },
  { username: 'enterprise', password: '123456', role: 'enterprise', real_name: '测试企业' },
  { username: 'candidate', password: '123456', role: 'candidate', real_name: '测试考生' }
];

const ENTERPRISE_NAME = '测试企业（模拟）';

async function ensureUser(connection, { username, password, role, real_name }) {
  const [existing] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
  const passwordHash = await bcrypt.hash(password, 10);
  if (existing.length > 0) {
    await connection.execute(
      'UPDATE users SET password_hash = ?, role = ?, real_name = ?, status = ? WHERE username = ?',
      [passwordHash, role, real_name || null, 'active', username]
    );
    return existing[0].id;
  }
  const [result] = await connection.execute(
    'INSERT INTO users (username, password_hash, role, real_name, status) VALUES (?, ?, ?, ?, ?)',
    [username, passwordHash, role, real_name || null, 'active']
  );
  const userId = result.insertId;
  const [perm] = await connection.execute('SELECT user_id FROM user_permissions WHERE user_id = ?', [userId]);
  if (perm.length === 0) {
    const isAdmin = role === 'admin';
    await connection.execute(
      'INSERT INTO user_permissions (user_id, can_contribute, can_edit_shared, can_manage_users, can_view_all_data) VALUES (?, 1, ?, ?, ?)',
      [userId, isAdmin ? 1 : 0, isAdmin ? 1 : 0, isAdmin ? 1 : 0]
    );
  }
  return userId;
}

async function ensureEnterprise(connection, enterpriseUserId) {
  const [byUser] = await connection.execute('SELECT id FROM enterprises WHERE user_id = ?', [enterpriseUserId]);
  if (byUser.length > 0) {
    await connection.execute(
      "UPDATE enterprises SET name = ?, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [ENTERPRISE_NAME, byUser[0].id]
    );
    return byUser[0].id;
  }
  const [result] = await connection.execute(
    "INSERT INTO enterprises (name, user_id, status) VALUES (?, ?, 'approved')",
    [ENTERPRISE_NAME, enterpriseUserId]
  );
  return result.insertId;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.MAIN_DB_NAME || 'question_management_shared',
    port: parseInt(process.env.DB_PORT) || 3306
  });

  try {
    console.log('正在创建/更新模拟测试账号...\n');

    for (const acc of TEST_ACCOUNTS) {
      const userId = await ensureUser(connection, acc);
      console.log(`✓ ${acc.role.padEnd(12)} ${acc.username} / ${acc.password} (ID: ${userId})`);
      if (acc.role === 'enterprise') {
        const entId = await ensureEnterprise(connection, userId);
        console.log(`  关联企业 ID: ${entId}，状态: approved`);
      }
    }

    console.log('\n========== 测试账号一览 ==========');
    console.log('| 端     | 用户名      | 密码     | 说明           |');
    console.log('|-------|-------------|----------|----------------|');
    console.log('| 管理端 | admin       | admin123 | 总管理端登录   |');
    console.log('| 企业端 | enterprise  | 123456   | 企业端登录     |');
    console.log('| 考生端 | candidate   | 123456   | 考生端登录     |');
    console.log('===================================');
    console.log('\n请妥善保管密码，仅用于测试环境。');
  } catch (error) {
    console.error('执行失败:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
