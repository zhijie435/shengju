/**
 * 单场公共考场码：exams.public_room_code（唯一），已存在列时跳过；为空的历史考试自动补码。
 * 从 backend 目录加载 .env，在项目根或 backend 下执行：node backend/scripts/run_exams_public_room_code_migration.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT, 10) || 3306
};

async function runSql(conn, sql, desc) {
  try {
    await conn.query(sql);
    if (desc) console.log('  OK:', desc);
    return true;
  } catch (e) {
    if (desc) console.warn('  Skip:', desc, '-', e.message);
    return false;
  }
}

async function runMigration() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Running exams.public_room_code migration...');
    await runSql(
      connection,
      "ALTER TABLE exams ADD COLUMN public_room_code VARCHAR(24) NULL COMMENT '单场公共考场码（全员相同）' AFTER status",
      'exams.public_room_code'
    );
    await runSql(
      connection,
      'ALTER TABLE exams ADD UNIQUE INDEX uk_exams_public_room_code (public_room_code)',
      'uk_exams_public_room_code'
    );
    const [examRows] = await connection.query(
      'SELECT id FROM exams WHERE public_room_code IS NULL OR public_room_code = ?',
      ['']
    );
    for (const row of examRows || []) {
      let updated = false;
      for (let i = 0; i < 40 && !updated; i++) {
        const code = `sj${crypto.randomBytes(5).toString('hex')}`;
        try {
          await connection.query('UPDATE exams SET public_room_code = ? WHERE id = ?', [code, row.id]);
          updated = true;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }
    console.log('Done.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  runMigration();
}
module.exports = runMigration;
