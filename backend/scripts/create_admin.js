// 创建管理员账号脚本
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function createAdmin() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.MAIN_DB_NAME || 'question_management_shared',
    port: parseInt(process.env.DB_PORT) || 3306
  });

  try {
    const username = process.argv[2] || 'admin';
    const password = process.argv[3] || 'admin123';
    const realName = process.argv[4] || '系统管理员';

    console.log(`正在创建管理员账号: ${username}...`);

    // 检查用户是否已存在
    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
      // 更新现有用户
      const passwordHash = await bcrypt.hash(password, 10);
      await connection.execute(
        'UPDATE users SET password_hash = ?, role = "admin", status = "active" WHERE username = ?',
        [passwordHash, username]
      );
      console.log(`✓ 管理员账号 ${username} 已更新`);
    } else {
      // 创建新用户
      const passwordHash = await bcrypt.hash(password, 10);
      const [result] = await connection.execute(
        'INSERT INTO users (username, password_hash, role, real_name, status) VALUES (?, ?, "admin", ?, "active")',
        [username, passwordHash, realName]
      );

      const userId = result.insertId;

      // 创建权限记录
      await connection.execute(
        'INSERT INTO user_permissions (user_id, can_contribute, can_edit_shared, can_manage_users, can_view_all_data) VALUES (?, 1, 1, 1, 1)',
        [userId]
      );

      console.log(`✓ 管理员账号 ${username} 创建成功 (ID: ${userId})`);
    }

    console.log(`\n登录信息:`);
    console.log(`  用户名: ${username}`);
    console.log(`  密码: ${password}`);
    console.log(`\n请妥善保管密码，首次登录后建议修改密码。`);

  } catch (error) {
    console.error('创建管理员失败:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

createAdmin();
