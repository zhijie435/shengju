// 检查数据库状态脚本
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkDatabase() {
  console.log('========================================');
  console.log('数据库状态检查');
  console.log('========================================\n');

  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT) || 3306
  };

  const dbName = process.env.MAIN_DB_NAME || 'question_management_shared';

  try {
    // 1. 测试MySQL连接
    console.log('[1] 测试MySQL连接...');
    const connection = await mysql.createConnection(config);
    console.log('✓ MySQL连接成功\n');
    await connection.end();

    // 2. 检查数据库是否存在
    console.log(`[2] 检查数据库 "${dbName}" 是否存在...`);
    const checkDbConn = await mysql.createConnection(config);
    const [databases] = await checkDbConn.execute(
      'SHOW DATABASES LIKE ?',
      [dbName]
    );
    await checkDbConn.end();

    if (databases.length === 0) {
      console.log(`✗ 数据库 "${dbName}" 不存在`);
      console.log(`\n请执行以下SQL创建数据库:`);
      console.log(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      console.log(`\n或运行初始化脚本: backend/database/shared_db_init.sql\n`);
      return;
    }
    console.log(`✓ 数据库 "${dbName}" 存在\n`);

    // 3. 检查表是否存在
    console.log('[3] 检查数据表...');
    const dbConn = await mysql.createConnection({
      ...config,
      database: dbName
    });

    const [tables] = await dbConn.execute('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    
    const requiredTables = ['users', 'user_databases', 'user_permissions', 'question_bank', 'question_bank_reviews'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));

    if (missingTables.length > 0) {
      console.log(`✗ 缺少以下表: ${missingTables.join(', ')}`);
      console.log(`\n请执行初始化脚本: backend/database/shared_db_init.sql\n`);
      await dbConn.end();
      return;
    }
    console.log(`✓ 所有必需的表都存在\n`);

    // 4. 检查用户数据
    console.log('[4] 检查用户数据...');
    const [users] = await dbConn.execute('SELECT id, username, role, status FROM users');
    
    if (users.length === 0) {
      console.log('✗ 数据库中没有用户');
      console.log('\n请创建管理员账号:');
      console.log('  node scripts/create_admin.js admin admin123 系统管理员\n');
    } else {
      console.log(`✓ 找到 ${users.length} 个用户:`);
      users.forEach(u => {
        console.log(`  - ${u.username} (${u.role}, ${u.status})`);
      });
      console.log();
    }

    // 5. 检查管理员账号
    const [admins] = await dbConn.execute(
      "SELECT id, username, status FROM users WHERE role = 'admin' AND status = 'active'"
    );
    
    if (admins.length === 0) {
      console.log('⚠ 警告: 没有活动的管理员账号');
      console.log('请创建管理员账号:');
      console.log('  node scripts/create_admin.js admin admin123 系统管理员\n');
    } else {
      console.log(`✓ 找到 ${admins.length} 个活动的管理员账号\n`);
    }

    await dbConn.end();

    console.log('========================================');
    console.log('检查完成！');
    console.log('========================================\n');

  } catch (error) {
    console.error('\n✗ 检查失败:');
    console.error(`错误信息: ${error.message}`);
    console.error('\n可能的原因:');
    console.error('1. MySQL服务未启动');
    console.error('2. 数据库配置错误（检查 .env 文件）');
    console.error('3. 用户名或密码错误');
    console.error('4. 网络连接问题\n');
    process.exit(1);
  }
}

checkDatabase();
