/**
 * 阅卷相关表/字段迁移
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT) || 3306
};

async function runMigration() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('Running grading migration...');

    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exam_paper_sub_questions'",
      [DB_CONFIG.database]
    );
    const existing = new Set(cols.map(r => r.COLUMN_NAME));

    if (!existing.has('standard_answer')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN standard_answer TEXT COMMENT '标准答案'");
      console.log('  OK: standard_answer');
    } else console.log('  Skip: standard_answer');
    if (!existing.has('answer_analysis')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN answer_analysis LONGTEXT COMMENT '答案解析'");
      console.log('  OK: answer_analysis');
    } else console.log('  Skip: answer_analysis');
    if (!existing.has('grading_points')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN grading_points JSON COMMENT '主观题评分要点'");
      console.log('  OK: grading_points');
    } else console.log('  Skip: grading_points');
    if (!existing.has('answer')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN answer TEXT COMMENT '答案（纯文本，题库/Word导入）'");
      console.log('  OK: answer');
    } else console.log('  Skip: answer');
    if (!existing.has('answer_html')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN answer_html LONGTEXT COMMENT '答案HTML格式'");
      console.log('  OK: answer_html');
    } else console.log('  Skip: answer_html');
    if (!existing.has('explanation')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN explanation TEXT COMMENT '解析（纯文本）'");
      console.log('  OK: explanation');
    } else console.log('  Skip: explanation');
    if (!existing.has('explanation_html')) {
      await conn.query("ALTER TABLE exam_paper_sub_questions ADD COLUMN explanation_html LONGTEXT COMMENT '解析HTML格式'");
      console.log('  OK: explanation_html');
    } else console.log('  Skip: explanation_html');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS exam_graders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        exam_id INT NOT NULL,
        user_id INT NOT NULL,
        assigned_sub_question_ids JSON COMMENT '分配的小题ID列表',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_exam_id (exam_id),
        INDEX idx_user_id (user_id)
      )
    `);
    console.log('  OK: exam_graders');

    console.log('Migration done.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

runMigration();
