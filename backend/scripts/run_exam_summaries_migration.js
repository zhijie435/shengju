/**
 * 执行考试汇总数据和评估报告相关的数据库迁移
 * 包括：
 * 1. 创建 exam_summaries 表
 * 2. 创建 exam_evaluation_reports 表
 * 3. 为 exam_paper_sub_questions 添加 exam_purpose 字段
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const MAIN_DB_NAME = process.env.MAIN_DB_NAME || 'question_management_shared';

async function runMigration() {
  let connection;
  try {
    console.log('========================================');
    console.log('开始执行考试汇总数据和评估报告迁移...');
    console.log(`数据库: ${MAIN_DB_NAME}`);
    console.log(`主机: ${DB_HOST}:${DB_PORT}`);
    console.log('========================================\n');

    // 连接数据库
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: MAIN_DB_NAME,
      multipleStatements: true
    });

    console.log('✓ 数据库连接成功\n');

    // 1. 创建 exam_summaries 表
    console.log('1. 创建 exam_summaries 表...');
    const summariesSql = fs.readFileSync(
      path.join(__dirname, '../database/migrate_exam_summaries.sql'),
      'utf8'
    );
    await connection.query(summariesSql);
    console.log('   ✓ exam_summaries 表创建成功\n');

    // 2. 创建 exam_evaluation_reports 表
    console.log('2. 创建 exam_evaluation_reports 表...');
    const reportsSql = fs.readFileSync(
      path.join(__dirname, '../database/migrate_exam_evaluation_reports.sql'),
      'utf8'
    );
    await connection.query(reportsSql);
    console.log('   ✓ exam_evaluation_reports 表创建成功\n');

    // 3. 为 exam_paper_sub_questions 添加 exam_purpose 字段
    console.log('3. 为 exam_paper_sub_questions 添加 exam_purpose 字段...');
    const examPurposeSql = fs.readFileSync(
      path.join(__dirname, '../database/migrate_add_exam_purpose_to_sub_questions.sql'),
      'utf8'
    );
    await connection.query(examPurposeSql);
    console.log('   ✓ exam_purpose 字段添加成功\n');

    console.log('========================================');
    console.log('✓ 所有迁移执行成功！');
    console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ 迁移执行失败:');
    console.error('错误信息:', error.message);
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('数据库连接已关闭');
    }
  }
}

// 执行迁移
runMigration().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
