// 测试登录功能脚本
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function testLogin() {
  console.log('========================================');
  console.log('测试管理员登录功能');
  console.log('========================================\n');

  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.MAIN_DB_NAME || 'question_management_shared',
    port: parseInt(process.env.DB_PORT) || 3306
  };

  try {
    const connection = await mysql.createConnection(config);

    // 1. 检查管理员账号是否存在
    console.log('[1] 检查管理员账号...');
    const [users] = await connection.execute(
      "SELECT id, username, password_hash, role, status FROM users WHERE username = 'admin'"
    );

    if (users.length === 0) {
      console.log('✗ 管理员账号不存在');
      console.log('请先运行: node scripts/create_admin.js admin admin123 系统管理员\n');
      await connection.end();
      return;
    }

    const admin = users[0];
    console.log(`✓ 找到管理员账号: ${admin.username}`);
    console.log(`  角色: ${admin.role}`);
    console.log(`  状态: ${admin.status}\n`);

    // 2. 检查账号状态
    if (admin.status !== 'active') {
      console.log('✗ 账号状态不是active，无法登录');
      console.log('正在更新账号状态...');
      await connection.execute(
        "UPDATE users SET status = 'active' WHERE username = 'admin'"
      );
      console.log('✓ 账号状态已更新为active\n');
    }

    // 3. 验证密码
    console.log('[2] 验证密码...');
    const testPassword = 'admin123';
    const isValid = await bcrypt.compare(testPassword, admin.password_hash);
    
    if (isValid) {
      console.log('✓ 密码验证成功\n');
    } else {
      console.log('✗ 密码验证失败');
      console.log('正在重置密码...');
      const newPasswordHash = await bcrypt.hash(testPassword, 10);
      await connection.execute(
        "UPDATE users SET password_hash = ? WHERE username = 'admin'",
        [newPasswordHash]
      );
      console.log('✓ 密码已重置\n');
    }

    // 4. 检查权限
    console.log('[3] 检查权限...');
    const [permissions] = await connection.execute(
      'SELECT * FROM user_permissions WHERE user_id = ?',
      [admin.id]
    );

    if (permissions.length === 0) {
      console.log('✗ 权限记录不存在，正在创建...');
      await connection.execute(
        'INSERT INTO user_permissions (user_id, can_contribute, can_edit_shared, can_manage_users, can_view_all_data) VALUES (?, 1, 1, 1, 1)',
        [admin.id]
      );
      console.log('✓ 权限记录已创建\n');
    } else {
      console.log('✓ 权限记录存在\n');
    }

    await connection.end();

    console.log('========================================');
    console.log('测试完成！');
    console.log('========================================\n');
    console.log('登录信息:');
    console.log('  用户名: admin');
    console.log('  密码: admin123');
    console.log('\n现在可以使用以上信息登录系统了！\n');

  } catch (error) {
    console.error('\n✗ 测试失败:');
    console.error(`错误信息: ${error.message}`);
    console.error('\n可能的原因:');
    console.error('1. 数据库未初始化');
    console.error('2. 数据库连接配置错误');
    console.error('3. MySQL服务未启动\n');
    process.exit(1);
  }
}

testLogin();
