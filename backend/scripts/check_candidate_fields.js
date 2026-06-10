/**
 * 检查 users 表是否具备考生管理展示所需字段，并抽样打印一条考生数据
 * 在 backend 目录执行: node scripts/check_candidate_fields.js
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

const REQUIRED_COLUMNS = ['phone', 'exam_number', 'position', 'id_card_image_path', 'education', 'job_code'];

async function main() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('数据库:', DB_CONFIG.database);

    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [DB_CONFIG.database]
    );
    const existing = new Set(cols.map(r => r.COLUMN_NAME));
    console.log('\n【1】users 表考生相关字段检查:');
    let allOk = true;
    for (const col of REQUIRED_COLUMNS) {
      const ok = existing.has(col);
      console.log('  ', ok ? '✓' : '✗', col, ok ? '(存在)' : '(缺失，请执行对应迁移脚本)');
      if (!ok) allOk = false;
    }

    if (!allOk) {
      console.log('\n请按顺序执行: node scripts/run_users_candidate_migration.js');
      console.log('              node scripts/run_id_card_image_migration.js');
      console.log('              node scripts/run_education_job_code_migration.js');
      process.exitCode = 1;
      return;
    }

    try {
      const [rows] = await conn.query(
        `SELECT id, real_name, phone, exam_number, position, education, job_code, id_card_image_path
         FROM users WHERE role = 'candidate' LIMIT 3`
      );
      console.log('\n【2】抽样考生数据（最多 3 条）:');
      if (rows.length === 0) {
        console.log('  当前无 role=candidate 的用户。请先通过「按批次从企业导入」导入考生。');
      } else {
        rows.forEach((r, i) => {
          console.log(`  --- 第 ${i + 1} 条 ---`);
          console.log('    姓名:', r.real_name, '| 岗位:', r.position || '(空)', '| 学历:', r.education || '(空)', '| 岗位代码:', r.job_code || '(空)', '| 身份证照:', r.id_card_image_path ? '有' : '(空)');
        });
        const withData = rows.filter(r => r.position || r.education || r.job_code || r.id_card_image_path).length;
        if (withData === 0 && rows.length > 0) {
          console.log('\n  提示: 以上考生岗位/学历/岗位代码/身份证照均为空。');
          console.log('  请在企业端再次点击「导入考生到笔试系统」，然后在笔试系统该考试下「按批次从企业导入」再执行一次，即可把企业端数据写入。');
        }
      }
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') console.log('\n【2】查询考生抽样时出错（表可能缺列），请先完成上述迁移。');
      else throw e;
    }
    console.log('\n检查结束。');
  } catch (e) {
    console.error(e.message || e);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

main();
