'use strict';

const axios = require('axios');

/**
 * 个人信息场景：登录后读取 / 更新个人信息
 * 模拟已登录用户访问个人中心的典型操作流程
 */

const GENDERS = ['male', 'female', 'other'];
const LOCATIONS = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安'];
const EDUCATIONS = ['high_school', 'junior_college', 'bachelor', 'master', 'doctor'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 执行个人信息场景
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.token - 已登录的 Bearer token
 * @param {string} opts.username
 * @param {function} opts.recordRequest
 * @param {number} opts.timeout
 */
async function runProfileScenario(opts) {
  const { baseUrl, token, username, recordRequest, timeout = 10000, baseHeaders = {} } = opts;

  if (!token) {
    return { success: false, error: '无有效 Token，跳过 profile 场景' };
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout,
    validateStatus: () => true,
    headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
  });

  // 步骤1：GET 个人信息
  const getStart = Date.now();
  let currentProfile = null;
  try {
    const res = await client.get('/api/v1/users/profile');
    recordRequest('/api/v1/users/profile', res.status, Date.now() - getStart);
    if (res.status === 200) {
      currentProfile = res.data?.data || res.data;
    }
  } catch (err) {
    recordRequest('/api/v1/users/profile', 0, Date.now() - getStart, err.message);
    return { success: false, error: err.message };
  }

  // 步骤2：PUT 更新个人信息（模拟用户修改）
  const updateStart = Date.now();
  try {
    const updatePayload = {
      realName: currentProfile?.realName || `压测用户_${username}`,
      gender: randomItem(GENDERS),
      location: randomItem(LOCATIONS),
      education: randomItem(EDUCATIONS),
      bio: `这是压测自动更新的简介 - ${Date.now()}`,
    };

    const res = await client.put('/api/v1/users/profile', updatePayload);
    // HTTP 200 但业务层报失败（如字段校验不通过），记为业务失败但不中断场景
    const businessFail = res.status === 200 && res.data?.success === false;
    recordRequest('/api/v1/users/profile (update)', res.status, Date.now() - updateStart,
      businessFail ? (res.data?.message || '业务层失败') : null, businessFail);

    if (res.status !== 200 && res.status !== 204) {
      // HTTP 层真实失败，中断场景
      return { success: false, error: `更新失败: ${res.data?.message || res.status}` };
    }
    // businessFail 时继续执行，仅记录为业务错误
  } catch (err) {
    recordRequest('/api/v1/users/profile (update)', 0, Date.now() - updateStart, err.message);
    return { success: false, error: err.message };
  }

  // 步骤3：再次 GET 验证更新成功
  const verifyStart = Date.now();
  try {
    const res = await client.get('/api/v1/users/profile');
    recordRequest('/api/v1/users/profile (verify)', res.status, Date.now() - verifyStart);
  } catch (err) {
    recordRequest('/api/v1/users/profile (verify)', 0, Date.now() - verifyStart, err.message);
  }

  // 步骤4：GET 测评记录（个人中心附加请求）
  const assessStart = Date.now();
  try {
    const res = await client.get('/api/v1/assessments/results');
    recordRequest('/api/v1/assessments/results', res.status, Date.now() - assessStart);
  } catch (err) {
    recordRequest('/api/v1/assessments/results', 0, Date.now() - assessStart, err.message);
  }

  return { success: true };
}

module.exports = { runProfileScenario };
