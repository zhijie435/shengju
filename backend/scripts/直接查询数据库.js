// 直接查询数据库，检查账号是否存在
const mysql = require('mysql2/promise');
require('dotenv').config();

const USERNAME = 'gaoyajun';

async function main() {
  let connection;
  try {
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.MAIN_DB_NAME || 'question_management_shared',
      port: parseInt(process.env.DB_PORT) || 3306
    };

    console.log('╔════════════════════════════════════════╗');
    console.log('║  直接查询数据库检查账号              ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log('数据库配置:');
    console.log(`  主机: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`  用户: ${dbConfig.user}`);
    console.log(`  数据库: ${dbConfig.database}\n`);

    // 连接数据库
    console.log('正在连接数据库...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 连接成功\n');

    // 检查表是否存在
    console.log('【步骤1】检查 grading_accounts 表...');
    const [tables] = await connection.execute("SHOW TABLES LIKE 'grading_accounts'");
    if (tables.length === 0) {
      console.error('  ✗ 表不存在！');
      console.error('  请先运行: node scripts/run_grading_system_migration.js');
      process.exit(1);
    }
    console.log('  ✓ 表存在\n');

    // 查询所有账号
    console.log('【步骤2】查询所有子账号...');
    const [allAccounts] = await connection.execute('SELECT id, username, real_name, status FROM grading_accounts');
    console.log(`  找到 ${allAccounts.length} 个账号:`);
    if (allAccounts.length === 0) {
      console.log('  （无账号）');
    } else {
      allAccounts.forEach(acc => {
        console.log(`    - ID: ${acc.id}, 用户名: ${acc.username}, 姓名: ${acc.real_name || '-'}, 状态: ${acc.status}`);
      });
    }
    console.log('');

    // 查询特定账号
    console.log(`【步骤3】查询账号 ${USERNAME}...`);
    const [accounts] = await connection.execute(
      'SELECT * FROM grading_accounts WHERE username = ?',
      [USERNAME]
    );

    if (accounts.length === 0) {
      console.log(`  ✗ 账号 ${USERNAME} 不存在！`);
      console.log('\n  正在创建账号...');
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash('123456', 10);
      const [result] = await connection.execute(
        `INSERT INTO grading_accounts (username, password_hash, real_name, status)
         VALUES (?, ?, ?, 'active')`,
        [USERNAME, passwordHash, '高亚军']
      );
      console.log(`  ✓ 账号创建成功，ID: ${result.insertId}`);
      
      // 再次查询验证
      const [verify] = await connection.execute(
        'SELECT * FROM grading_accounts WHERE username = ?',
        [USERNAME]
      );
      if (verify.length > 0) {
        console.log('\n  ✓ 验证成功，账号已存在');
        console.log(`    ID: ${verify[0].id}`);
        console.log(`    用户名: ${verify[0].username}`);
        console.log(`    状态: ${verify[0].status}`);
      }
    } else {
      const account = accounts[0];
      console.log(`  ✓ 账号存在:`);
      console.log(`    ID: ${account.id}`);
      console.log(`    用户名: ${account.username}`);
      console.log(`    真实姓名: ${account.real_name || '-'}`);
      console.log(`    状态: ${account.status}`);
      console.log(`    创建时间: ${account.created_at}`);
      
      // 检查状态
      if (account.status !== 'active') {
        console.log(`\n  ⚠ 状态为 ${account.status}，正在修复...`);
        await connection.execute(
          'UPDATE grading_accounts SET status = ?, updated_at = NOW() WHERE id = ?',
          ['active', account.id]
        );
        console.log('  ✓ 状态已修复为 active');
      }
    }

    // 测试查询（模拟后端查询）
    console.log('\n【步骤4】测试后端查询逻辑...');
    const GradingAccountModel = require('../models/gradingAccountModel');
    const foundAccount = await GradingAccountModel.findByUsername(USERNAME);
    if (foundAccount) {
      console.log('  ✓ 使用模型查询成功');
      console.log(`    ID: ${foundAccount.id}`);
      console.log(`    用户名: ${foundAccount.username}`);
      console.log(`    状态: ${foundAccount.status}`);
    } else {
      console.error('  ✗ 使用模型查询失败！账号不存在');
      console.error('  这可能是因为：');
      console.error('  1. 模型使用的数据库连接配置不同');
      console.error('  2. 数据库连接池配置有问题');
    }

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║          最终结果                    ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`用户名: ${USERNAME}`);
    console.log(`密码: 123456`);
    console.log(`状态: active`);
    console.log('════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n✗✗✗ 执行失败！');
    console.error('错误:', error.message);
    console.error('代码:', error.code);
    if (error.stack) {
      console.error('\n堆栈:', error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();
