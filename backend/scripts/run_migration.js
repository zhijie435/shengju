const mysql = require('mysql2/promise');
const fs = require('fs').promise;
const path = require('path');

async function runMigration() {
  // 读取数据库配置
  const dbConfig = require('../config/database');
  
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    multipleStatements: true
  });

  try {
    console.log('开始运行迁移脚本...');
    
    // 读取迁移文件
    const migrationPath = path.join(__dirname, '../database/migrate_add_preview_html.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf8');
    
    // 执行迁移
    await connection.query(migrationSQL);
    
    console.log('迁移脚本执行成功！preview_html 字段已添加。');
  } catch (error) {
    console.error('迁移失败:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration().catch(console.error);
