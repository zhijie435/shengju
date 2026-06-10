/**
 * 管理端：企业 / 认证兼容表诊断（由 server.js 显式挂载，避免仅挂在 Router 时线上 404）
 */
const { pool, poolShengju, MAIN_DB_NAME, SHENGJU_DB_NAME } = require('../config/database');

async function snapshotDb(label, p) {
  if (!p) {
    return { label, connected: false, reason: '未配置连接池' };
  }
  const out = { label, connected: true };
  for (const table of ['enterprises', 'compat_enterprise_verification_requests']) {
    try {
      const [rows] = await p.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
      const c = rows && rows[0] ? rows[0].c : 0;
      out[`${table}Count`] = Number(c) || 0;
    } catch (e) {
      out[`${table}Count`] = null;
      out[`${table}Error`] = e.message;
    }
  }
  try {
    const [sample] = await p.query(
      `SELECT enterprise_id, status, updated_at FROM compat_enterprise_verification_requests ORDER BY updated_at DESC LIMIT 8`
    );
    out.compatSample = sample || [];
  } catch (e) {
    out.compatSampleError = e.message;
  }
  return out;
}

async function getEnterpriseCompatDiag(req, res) {
  try {
    const main = await snapshotDb(`main:${MAIN_DB_NAME}`, pool);
    const shengju = poolShengju
      ? await snapshotDb(`shengju:${SHENGJU_DB_NAME || '(env TALENT_NETWORK_DB/SHENGJU_DB_NAME)'}`, poolShengju)
      : {
          label: 'shengju',
          connected: false,
          reason: '未设置环境变量 SHENGJU_DB_NAME 或 TALENT_NETWORK_DB，管理端不会合并人才网库数据'
        };
    res.json({
      success: true,
      data: {
        env: {
          MAIN_DB_NAME,
          SHENGJU_DB_NAME: SHENGJU_DB_NAME || '',
          poolShengjuEnabled: !!poolShengju
        },
        main,
        shengju,
        hint:
          '若 compat_enterprise_verification_requests 在主库为 0、在人才库有数据：请在 .env 配置 SHENGJU_DB_NAME=人才库名 并重启 Node。' +
          ' 若两边都为 0：企业端提交未成功（看浏览器 Network 是否 413/500）或 enterprise_id 未写入。'
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || '诊断失败' });
  }
}

module.exports = { getEnterpriseCompatDiag };
