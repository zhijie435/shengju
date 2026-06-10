// 检查 grading_accounts 表在哪个数据库中
const mysql = require('mysql2/promise');
require('dotenv').config();

const USERNAME = 'gaoyajun';
const DB1 = process.env.MAIN_DB_NAME || 'question_management_shared';
const DB2 = 'question_recognition';

async function checkDatabase(dbName, connection) {
  try {
    // 切换到指定数据库
    await connection.query(`USE \`${dbName}\``);
    
    // 检查表是否存在
    const [tables] = await connection.query("SHOW TABLES LIKE 'grading_accounts'");
    const tableExists = tables.length > 0;
    
    if (!tableExists) {
      return { exists: false, accounts: [] };
    }
    
    // 查询账号
    const [accounts] = await connection.query(
      'SELECT id, username, real_name, status FROM grading_accounts WHERE username = ?',
      [USERNAME]
    );
    
    // 查询所有账号
    const [allAccounts] = await connection.query(
      'SELECT id, username, real_name, status FROM grading_accounts LIMIT 10'
    );
    
    return {
      exists: true,
      accounts: accounts,
      allAccounts: allAccounts
    };
  } catch (error) {
    if (error.code === 'ER_BAD_DB_ERROR') {
      return { exists: false, error: '数据库不存在' };
    }
    throw error;
  }
}

async function main() {
  let connection;
  try {
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: parseInt(process.env.DB_PORT) || 3306,
      multipleStatements: false
    };

    console.log('╔════════════════════════════════════════╗');
    console.log('║  检查 grading_accounts 表位置        ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log('数据库配置:');
    console.log(`  主机: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`  用户: ${dbConfig.user}`);
    console.log(`  主数据库 (MAIN_DB_NAME): ${DB1}`);
    console.log(`  题目数据库: ${DB2}\n`);

    // 连接数据库（不指定数据库）
    console.log('正在连接数据库...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 连接成功\n');

    // 检查主数据库
    console.log(`【检查数据库1】${DB1}`);
    console.log('─'.repeat(50));
    const result1 = await checkDatabase(DB1, connection);
    if (result1.error) {
      console.log(`  ✗ ${result1.error}\n`);
    } else if (!result1.exists) {
      console.log('  ✗ grading_accounts 表不存在\n');
    } else {
      console.log('  ✓ grading_accounts 表存在');
      console.log(`  ✓ 找到 ${result1.allAccounts.length} 个账号`);
      if (result1.accounts.length > 0) {
        const acc = result1.accounts[0];
        console.log(`  ✓ 找到账号 ${USERNAME}:`);
        console.log(`    ID: ${acc.id}`);
        console.log(`    用户名: ${acc.username}`);
        console.log(`    状态: ${acc.status}`);
      } else {
        console.log(`  ✗ 未找到账号 ${USERNAME}`);
        if (result1.allAccounts.length > 0) {
          console.log('  当前数据库中的账号:');
          result1.allAccounts.forEach(a => {
            console.log(`    - ${a.username} (${a.status})`);
          });
        }
      }
      console.log('');
    }

    // 检查题目数据库
    console.log(`【检查数据库2】${DB2}`);
    console.log('─'.repeat(50));
    const result2 = await checkDatabase(DB2, connection);
    if (result2.error) {
      console.log(`  ✗ ${result2.error}\n`);
    } else if (!result2.exists) {
      console.log('  ✗ grading_accounts 表不存在\n');
    } else {
      console.log('  ⚠ grading_accounts 表存在（不应该在这里！）');
      console.log(`  ⚠ 找到 ${result2.allAccounts.length} 个账号`);
      if (result2.accounts.length > 0) {
        const acc = result2.accounts[0];
        console.log(`  ⚠ 找到账号 ${USERNAME}:`);
        console.log(`    ID: ${acc.id}`);
        console.log(`    用户名: ${acc.username}`);
        console.log(`    状态: ${acc.status}`);
        console.log('\n  ⚠ 警告：账号在错误的数据库中！');
      }
      console.log('');
    }

    // 总结
    console.log('╔════════════════════════════════════════╗');
    console.log('║          检查结果总结                ║');
    console.log('╚════════════════════════════════════════╝');
    
    const accountInDB1 = result1.exists && result1.accounts.length > 0;
    const accountInDB2 = result2.exists && result2.accounts.length > 0;
    const tableInDB1 = result1.exists;
    const tableInDB2 = result2.exists;
    
    if (accountInDB1) {
      console.log(`✓ 账号 ${USERNAME} 在正确的数据库中: ${DB1}`);
    } else if (accountInDB2) {
      console.log(`✗ 账号 ${USERNAME} 在错误的数据库中: ${DB2}`);
      console.log(`  应该移动到: ${DB1}`);
    } else {
      console.log(`✗ 账号 ${USERNAME} 不存在`);
      if (tableInDB1) {
        console.log(`  表在 ${DB1} 中，但账号不存在`);
      } else if (tableInDB2) {
        console.log(`  表在 ${DB2} 中（错误位置），账号也不存在`);
      } else {
        console.log(`  表不存在，需要运行迁移脚本`);
      }
    }
    
    if (tableInDB2 && !tableInDB1) {
      console.log(`\n⚠ 警告：表在错误的数据库中！`);
      console.log(`  表位置: ${DB2}`);
      console.log(`  应该位置: ${DB1}`);
      console.log(`\n  解决方案：`);
      console.log(`  1. 在 ${DB1} 中运行迁移脚本创建表`);
      console.log(`  2. 如果 ${DB2} 中有数据，需要迁移数据`);
    }
    
    console.log('\n════════════════════════════════════════\n');

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
