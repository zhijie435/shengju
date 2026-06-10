/**
 * 校验 slot_submitted 迁移是否已在当前连接的数据库中生效
 * 用法：在 backend 目录下执行 node scripts/check_slot_submitted_migration.js
 */
require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbName = process.env.MAIN_DB_NAME || 'question_management_shared';

async function check() {
  let pool;
  try {
    const db = require('../config/database');
    pool = db.pool;
    const [conn] = await pool.execute('SELECT DATABASE() as db');
    const currentDb = conn[0]?.db;
    console.log('当前连接数据库:', currentDb || '(未选库)');
    console.log('配置主库名 (.env MAIN_DB_NAME):', dbName);
    if (currentDb && currentDb !== dbName) {
      console.warn('⚠ 当前连接库与配置主库不一致，请确认是否在正确库执行迁移。');
    }

    const [cols] = await pool.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exam_answers' AND COLUMN_NAME = 'slot_submitted'",
      [currentDb || dbName]
    );
    if (!cols || cols.length === 0) {
      console.log('\n❌ exam_answers 表中未找到 slot_submitted 列，迁移未生效。');
      console.log('请在该库执行: backend/database/migrate_exam_answers_slot_submitted.sql');
      process.exit(1);
    }
    console.log('\n✓ exam_answers.slot_submitted 列已存在');

    const [rows] = await pool.execute('SELECT id, session_id, sub_question_id, question_number, slot_submitted FROM exam_answers LIMIT 3');
    console.log('示例数据（最多 3 条）:', rows?.length || 0, '条');
    if (rows && rows.length > 0) {
      rows.forEach((r, i) => console.log(`  ${i + 1}. id=${r.id} session_id=${r.session_id} sub_question_id=${r.sub_question_id} question_number=${r.question_number} slot_submitted=${r.slot_submitted}`));
    }
    console.log('\n迁移校验通过。');
  } catch (e) {
    console.error('校验失败:', e.message);
    if (e.message && e.message.includes('slot_submitted')) {
      console.log('请确认已在正确数据库执行 migrate_exam_answers_slot_submitted.sql');
    }
    process.exit(1);
  } finally {
    if (pool && typeof pool.end === 'function') await pool.end();
  }
}

check();
