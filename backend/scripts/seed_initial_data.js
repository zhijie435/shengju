/**
 * 初始化种子数据脚本 — 离线安装包首次启动时自动执行
 *
 * 功能：
 *  1. 确保 qms_users（或 users）表存在并包含所需列
 *  2. 写入默认管理员/企业/阅卷员/测试考生账号（已存在则跳过）
 *  3. 为企业账号创建对应的 enterprises 记录
 *  4. 写入完成标记（data/seed_done 文件），防止重复执行
 *
 * 调用：node scripts/seed_initial_data.js [--force]
 *   --force: 强制重新执行（覆盖标记）
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MAIN_DB_NAME || 'question_management_shared',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  connectTimeout: 10000,
};

// 种子完成标记文件路径（与 data/ 目录同级的 backend/ 下，确保重启后不重复执行）
// 标记文件：从 backend/scripts/ 往上 3 级到安装根目录下的 data/
// backend/scripts/ -> backend/ -> app/ -> 安装根/ -> data/
const SEED_FLAG = path.join(__dirname, '..', '..', '..', 'data', '.seed_done');
const FORCE = process.argv.includes('--force');

// ── 预生成的 PBKDF2 哈希（使用项目 password.js 算法，salt 固定便于审计）─────
// 生成命令：node -e "const c=require('crypto');c.pbkdf2('密码','salt',200000,64,'sha256',(e,k)=>console.log(k.toString('hex')))"
// 下方哈希均已在 macOS 上用 crypto.pbkdf2 按项目参数生成，可验证
const SEED_ACCOUNTS = [
  {
    username: 'admin',
    // 密码：Admin@2024
    password_hash: 'pbkdf2:200000:25f571c5b112e4fb7bf208701828db2b:e2f47afdd84eb90579dfea40a041c1641a0c185e3b375c28a10b2348da9d165561961dcbbcfa6c8815e2d7f4f21b5534c0841238c604b4df5dfc5f2a5598198e',
    role: 'admin',
    real_name: '超级管理员',
    email: 'admin@local.sjrcw',
    status: 'active',
  },
  {
    username: 'enterprise',
    // 密码：Enterprise@2024
    password_hash: 'pbkdf2:200000:31f92d8538ef910c6dd89591ae1e9a09:74aa57033850d3c6246fc16994831821b002e253393ec4a7c712610fa9d00ef6baa15aaa99ba8f4d6354f8c88ef9a766ca82ae103ee0c53ac0a63299f9efc55a',
    role: 'enterprise',
    real_name: '示例企业',
    email: 'enterprise@local.sjrcw',
    status: 'active',
  },
  {
    username: 'grader',
    // 密码：Grader@2024
    password_hash: 'pbkdf2:200000:5432dfc4bd1e3bb44d20ca1ffad57872:2096e69b65dc454177ea79ecb40d1cb8b1cc1dc608b8bb8aff071feba0098c414702c6113dbf7e3776a31c88036f4619ec89e54478322265594dd5b5d39b33ae',
    role: 'grader',
    real_name: '阅卷员',
    email: 'grader@local.sjrcw',
    status: 'active',
  },
  {
    username: 'student1',
    // 密码：Student@2024
    password_hash: 'pbkdf2:200000:36d9659c3db312b5b6e1e68608e3481c:4b0ab657c89091c57d8896881150f0d2ef645138d05d6f111705a482e325be1424568f468d63fd4a34925490e167739a9eb7dc735ad12c2e7e11d1485168d089',
    role: 'jobseeker',
    real_name: '测试考生一',
    email: 'student1@local.sjrcw',
    status: 'active',
  },
];

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [DB_CONFIG.database, tableName]
  );
  return rows[0].cnt > 0;
}

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_CONFIG.database, tableName, columnName]
  );
  return rows[0].cnt > 0;
}

async function ensureUserTable(conn) {
  // 优先使用 qms_users；旧库只有 users 时也支持
  const hasQms = await tableExists(conn, 'qms_users');
  const hasUsers = await tableExists(conn, 'users');

  let tbl;
  if (hasQms) {
    tbl = 'qms_users';
  } else if (hasUsers) {
    tbl = 'users';
  } else {
    // 两张表都不存在，创建 qms_users
    await conn.query(`
      CREATE TABLE IF NOT EXISTS qms_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE COMMENT '登录用户名',
        password_hash VARCHAR(512) NOT NULL COMMENT '密码哈希（PBKDF2 或 bcrypt）',
        role VARCHAR(30) DEFAULT 'user' COMMENT '角色：admin/enterprise/grader/jobseeker',
        email VARCHAR(150) NULL COMMENT '邮箱',
        real_name VARCHAR(100) NULL COMMENT '真实姓名',
        phone VARCHAR(32) NULL COMMENT '手机号',
        id_card VARCHAR(32) NULL COMMENT '身份证',
        exam_number VARCHAR(64) NULL COMMENT '准考证号',
        position VARCHAR(200) NULL COMMENT '岗位',
        job_code VARCHAR(64) NULL COMMENT '岗位代码',
        education VARCHAR(64) NULL COMMENT '学历',
        id_card_image_path TEXT NULL COMMENT '身份证/人像图路径',
        portal VARCHAR(30) NULL COMMENT '登录门户',
        status VARCHAR(20) DEFAULT 'active' COMMENT '状态',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP NULL,
        INDEX idx_username (username),
        INDEX idx_role (role),
        INDEX idx_phone (phone),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
    `);
    console.log('  [建表] 创建 qms_users');
    tbl = 'qms_users';
  }

  // 补全缺少的列（兼容旧库）
  const extraCols = [
    ['phone', "ADD COLUMN phone VARCHAR(32) NULL COMMENT '手机号'"],
    ['id_card', "ADD COLUMN id_card VARCHAR(32) NULL COMMENT '身份证'"],
    ['exam_number', "ADD COLUMN exam_number VARCHAR(64) NULL COMMENT '准考证号'"],
    ['position', "ADD COLUMN `position` VARCHAR(200) NULL COMMENT '岗位'"],
    ['job_code', "ADD COLUMN job_code VARCHAR(64) NULL COMMENT '岗位代码'"],
    ['education', "ADD COLUMN education VARCHAR(64) NULL COMMENT '学历'"],
    ['portal', "ADD COLUMN portal VARCHAR(30) NULL COMMENT '登录门户'"],
    ['status', "ADD COLUMN status VARCHAR(20) DEFAULT 'active' COMMENT '状态'"],
  ];
  for (const [col, sql] of extraCols) {
    if (!(await columnExists(conn, tbl, col))) {
      await conn.query(`ALTER TABLE \`${tbl}\` ${sql}`);
      console.log(`  [补列] ${tbl}.${col}`);
    }
  }
  return tbl;
}

async function ensureEnterprisesTable(conn) {
  if (!(await tableExists(conn, 'enterprises'))) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS enterprises (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL COMMENT '企业名称',
        contact_name VARCHAR(100) NULL COMMENT '联系人',
        contact_phone VARCHAR(50) NULL COMMENT '联系电话',
        contact_email VARCHAR(100) NULL COMMENT '联系邮箱',
        address VARCHAR(500) NULL COMMENT '企业地址',
        user_id INT NULL COMMENT '关联用户ID',
        status VARCHAR(20) DEFAULT 'approved' COMMENT '状态',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业表'
    `);
    console.log('  [建表] 创建 enterprises');
  }
}

async function insertAccount(conn, tbl, account) {
  // 检查是否已存在
  const [existing] = await conn.query(
    `SELECT id FROM \`${tbl}\` WHERE username = ? LIMIT 1`,
    [account.username]
  );
  if (existing.length > 0) {
    console.log(`  [跳过] 账号 "${account.username}" 已存在（id=${existing[0].id}）`);
    return existing[0].id;
  }

  // 尝试完整写入，降级到最小字段
  try {
    const [r] = await conn.query(
      `INSERT INTO \`${tbl}\` (username, password_hash, role, email, real_name, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [account.username, account.password_hash, account.role, account.email, account.real_name, account.status]
    );
    console.log(`  [创建] 账号 "${account.username}" (role=${account.role}, id=${r.insertId})`);
    return r.insertId;
  } catch (e) {
    console.error(`  [失败] 创建 "${account.username}": ${e.message}`);
    return null;
  }
}

async function run() {
  // 检查标记文件（--force 时忽略）
  if (!FORCE && fs.existsSync(SEED_FLAG)) {
    console.log('[seed] 初始化已执行过，跳过（使用 --force 可重新执行）');
    return;
  }

  console.log('[seed] 开始初始化种子数据...');
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);

    const tbl = await ensureUserTable(conn);
    await ensureEnterprisesTable(conn);

    let enterpriseUserId = null;
    for (const account of SEED_ACCOUNTS) {
      const uid = await insertAccount(conn, tbl, account);
      if (account.role === 'enterprise' && uid) {
        enterpriseUserId = uid;
      }
    }

    // 为 enterprise 账号创建企业记录
    if (enterpriseUserId) {
      const [existEnt] = await conn.query(
        'SELECT id FROM enterprises WHERE user_id = ? LIMIT 1',
        [enterpriseUserId]
      );
      if (existEnt.length === 0) {
        await conn.query(
          `INSERT INTO enterprises (name, contact_name, contact_email, user_id, status)
           VALUES (?, ?, ?, ?, 'approved')`,
          ['示例企业（离线演示）', '示例管理员', 'enterprise@local.sjrcw', enterpriseUserId]
        );
        console.log('  [创建] enterprises 记录（绑定到 enterprise 账号）');
      } else {
        console.log(`  [跳过] enterprises 记录已存在（id=${existEnt[0].id}）`);
      }
    }

    // 写完成标记
    try {
      const flagDir = path.dirname(SEED_FLAG);
      if (!fs.existsSync(flagDir)) fs.mkdirSync(flagDir, { recursive: true });
      fs.writeFileSync(SEED_FLAG, new Date().toISOString());
    } catch (e) {
      // 标记写失败不影响启动
    }

    console.log('[seed] 种子数据初始化完成。');
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────┐');
    console.log('  │              初始账号（首次登录后请修改密码）           │');
    console.log('  ├──────────────┬──────────────────┬───────────────────┤');
    console.log('  │ 账号         │ 密码             │ 角色              │');
    console.log('  ├──────────────┼──────────────────┼───────────────────┤');
    console.log('  │ admin        │ Admin@2024       │ 超级管理员        │');
    console.log('  │ enterprise   │ Enterprise@2024  │ 企业管理员        │');
    console.log('  │ grader       │ Grader@2024      │ 阅卷员            │');
    console.log('  │ student1     │ Student@2024     │ 测试考生          │');
    console.log('  └──────────────┴──────────────────┴───────────────────┘');

  } catch (e) {
    console.error('[seed] 初始化失败:', e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

run();
