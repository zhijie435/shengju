const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

async function runMigration() {
  let connection;
  try {
    // 创建数据库连接
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true
    });

    const dbName = process.env.MAIN_DB_NAME || 'question_management_shared';
    
    // 选择数据库
    await connection.query(`USE ${dbName}`);
    console.log(`✓ 已连接到数据库: ${dbName}`);

    // 读取迁移脚本
    const migrationPath = path.join(__dirname, '../database/migrate_grading_system.sql');
    const sql = await fs.readFile(migrationPath, 'utf-8');
    
    // 执行迁移
    console.log('开始执行阅卷系统数据库迁移...');
    
    // 分割并执行SQL语句
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('SET'));
    
    for (const statement of statements) {
      if (statement.length > 10) { // 过滤太短的语句
        try {
          await connection.query(statement);
        } catch (err) {
          // 如果是表已存在的错误，忽略
          if (!err.message.includes('already exists') && !err.message.includes('Duplicate')) {
            throw err;
          }
        }
      }
    }
    
    console.log('✓ 阅卷系统数据库迁移完成');
    
    // 验证表是否创建成功
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'grading%'"
    );
    console.log('✓ 已创建的表:', tables.map(t => Object.values(t)[0]).join(', '));
    
  } catch (error) {
    console.error('✗ 迁移失败:', error.message);
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
