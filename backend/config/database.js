const mysql = require('mysql2/promise');
require('dotenv').config();

// 主数据库配置（用于用户信息、权限、共享题库）
const MAIN_DB_NAME = process.env.MAIN_DB_NAME || 'question_management_shared';
// 人才网数据库（sj_exam_import_requests、sj_exam_imported_candidates 等），可选；不配置则按批次导入不显示人才网批次
const SHENGJU_DB_NAME = process.env.SHENGJU_DB_NAME || process.env.TALENT_NETWORK_DB || '';

// 连接池大小：支持约 2000 人同时在线时建议 50–100，单机 MySQL max_connections 需 >= 本值 + 其他库池
const MAIN_POOL_SIZE = Math.max(10, parseInt(process.env.DB_POOL_SIZE, 10) || 50);
const MAIN_QUEUE_LIMIT = Math.max(0, parseInt(process.env.DB_POOL_QUEUE_LIMIT, 10)) || 500;

// 创建主数据库连接池
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: MAIN_DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: MAIN_POOL_SIZE,
  queueLimit: MAIN_QUEUE_LIMIT,
  timezone: '+08:00',
  charset: 'utf8mb4',
  connectTimeout: 10000,
  multipleStatements: false
});

// 人才网库连接池（与主库同 host/user/password，仅 database 不同）
const SHENGJU_POOL_SIZE = Math.max(2, parseInt(process.env.SHENGJU_POOL_SIZE, 10) || 10);
let poolShengju = null;
if (SHENGJU_DB_NAME) {
  poolShengju = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: SHENGJU_DB_NAME,
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: SHENGJU_POOL_SIZE,
    queueLimit: 200,
    timezone: '+08:00',
    charset: 'utf8mb4',
    connectTimeout: 10000,
    multipleStatements: false
  });
}

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    // 测试查询
    await connection.query('SELECT 1');
    console.log('✓ 主数据库连接成功');
    console.log(`  - 数据库: ${MAIN_DB_NAME}`);
    console.log(`  - 主机: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`);
    connection.release();
    return true;
  } catch (error) {
    console.error('✗ 数据库连接失败:');
    console.error(`  错误信息: ${error.message}`);
    console.error(`  请检查:`);
    console.error(`  1. MySQL服务是否启动`);
    console.error(`  2. .env文件中的数据库配置是否正确`);
    console.error(`  3. 数据库 ${MAIN_DB_NAME} 是否已创建`);
    console.error(`  4. 用户名和密码是否正确`);
    return false;
  }
}

// 获取数据库连接信息（用于调试）
function getConnectionInfo() {
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: MAIN_DB_NAME,
    port: parseInt(process.env.DB_PORT) || 3306
  };
}

module.exports = {
  pool,
  poolShengju,
  testConnection,
  getConnectionInfo,
  MAIN_DB_NAME,
  SHENGJU_DB_NAME
};

