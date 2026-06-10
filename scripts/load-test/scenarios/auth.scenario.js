'use strict';

const axios = require('axios');

/**
 * 认证场景：注册 → 登录 → 退出
 * 使用 axios 直接调 API（高并发模式）
 */

/**
 * 执行单次认证场景
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {object} opts.account - { username, password, email }
 * @param {function} opts.recordRequest - (url, status, duration, error?) => void
 * @returns {Promise<{ token: string|null, success: boolean }>}
 */
async function runAuthScenario(opts) {
  const { baseUrl, account, recordRequest, timeout = 10000, baseHeaders = {} } = opts;
  const client = axios.create({
    baseURL: baseUrl,
    timeout,
    validateStatus: () => true,
    headers: baseHeaders,
  });

  let token = null;

  // 步骤1：注册（SMS_BYPASS=true 时 smsCode 传任意 6 位即可）
  if (account.shouldRegister) {
    const registerStart = Date.now();
    try {
      const res = await client.post('/api/v1/auth/register-self', {
        username: account.username,
        password: account.password,
        email: account.email,
        realName: '压测用户',
        userType: 'jobseeker',
        phone: account.phone || '',
        smsCode: account.smsCode || '123456',  // SMS_BYPASS 模式下接受任意 4+ 位
      });
      recordRequest('/api/v1/auth/register-self', res.status, Date.now() - registerStart);
      if (res.status !== 200 && res.status !== 201) {
        const msg = res.data?.message || res.data?.error || '注册失败';
        recordRequest('/api/v1/auth/register-self', res.status, Date.now() - registerStart, msg);
        return { token: null, success: false, error: `注册失败: ${msg}` };
      }
    } catch (err) {
      recordRequest('/api/v1/auth/register-self', 0, Date.now() - registerStart, err.message);
      return { token: null, success: false, error: err.message };
    }
  }

  // 步骤2：登录
  const loginStart = Date.now();
  try {
    const res = await client.post('/api/v1/auth/login', {
      identifier: account.username,
      password: account.password,
      userType: 'jobseeker',
    });

    if (res.status === 200 && res.data?.data?.token) {
      token = res.data.data.token;
      recordRequest('/api/v1/auth/login', res.status, Date.now() - loginStart);
    } else if (res.status === 200 && res.data?.token) {
      token = res.data.token;
      recordRequest('/api/v1/auth/login', res.status, Date.now() - loginStart);
    } else {
      // HTTP 200 但业务层失败（如账号不存在/密码错误）
      const businessFail = res.status === 200 && res.data?.success === false;
      const errMsg = res.data?.message || `HTTP ${res.status}`;
      recordRequest('/api/v1/auth/login', res.status, Date.now() - loginStart, errMsg, businessFail);
      return { token: null, success: false, error: `登录失败: ${errMsg}` };
    }
  } catch (err) {
    recordRequest('/api/v1/auth/login', 0, Date.now() - loginStart, err.message);
    return { token: null, success: false, error: err.message };
  }

  // 步骤3：访问受保护资源（验证 Token 有效性）
  const verifyStart = Date.now();
  try {
    const res = await client.get('/api/v1/users/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    recordRequest('/api/v1/users/profile (auth-verify)', res.status, Date.now() - verifyStart);
  } catch (err) {
    recordRequest('/api/v1/users/profile (auth-verify)', 0, Date.now() - verifyStart, err.message);
  }

  return { token, success: true };
}

/**
 * 批量注册账号（供主程序调用）
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {Array<{username, password, email}>} opts.accounts
 * @param {number} opts.batchSize
 * @param {function} opts.onProgress - (done, total) => void
 * @param {function} opts.recordRequest
 * @returns {Promise<Array<{username, password, email, registered: boolean}>>}
 */
async function bulkRegister(opts) {
  const { baseUrl, accounts, batchSize = 10, onProgress, recordRequest, timeout = 10000 } = opts;
  const client = axios.create({ baseURL: baseUrl, timeout, validateStatus: () => true });

  const results = [];
  let done = 0;

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (account) => {
        const start = Date.now();
        try {
          const res = await client.post('/api/v1/auth/register-self', {
            username: account.username,
            password: account.password,
            email: account.email,
            realName: '压测用户',
            userType: 'jobseeker',
            phone: account.phone || '',
            smsCode: account.smsCode || '123456',  // SMS_BYPASS 模式下接受任意 4+ 位
          });
          recordRequest('/api/v1/auth/register-self', res.status, Date.now() - start);
          const ok = res.status === 200 || res.status === 201;
          return { ...account, registered: ok };
        } catch (err) {
          recordRequest('/api/v1/auth/register-self', 0, Date.now() - start, err.message);
          return { ...account, registered: false };
        }
      })
    );

    batchResults.forEach((r) => {
      results.push(r.status === 'fulfilled' ? r.value : { registered: false });
    });

    done += batch.length;
    if (onProgress) onProgress(done, accounts.length);

    // 批次间短暂休息，避免瞬时冲击注册接口
    if (i + batchSize < accounts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

module.exports = { runAuthScenario, bulkRegister };
