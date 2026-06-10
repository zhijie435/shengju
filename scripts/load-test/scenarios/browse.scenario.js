'use strict';

const axios = require('axios');

/**
 * 浏览场景：匿名访问首页 → 公告列表 → 岗位列表
 * 无需登录，模拟未认证用户的浏览行为
 */

/**
 * 执行浏览场景
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {function} opts.recordRequest
 * @param {number} opts.timeout
 * @param {string} [opts.token] - 可选，传入则以登录状态浏览
 */
async function runBrowseScenario(opts) {
  const { baseUrl, recordRequest, timeout = 10000, token = null, baseHeaders = {} } = opts;

  const headers = { ...baseHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const client = axios.create({
    baseURL: baseUrl,
    timeout,
    validateStatus: () => true,
    headers,
  });

  // 步骤1：访问首页 HTML
  const homeStart = Date.now();
  try {
    const res = await client.get('/index.html');
    recordRequest('/index.html', res.status, Date.now() - homeStart);
  } catch (err) {
    recordRequest('/index.html', 0, Date.now() - homeStart, err.message);
  }

  // 步骤2：获取公告列表 API
  const announcementsStart = Date.now();
  try {
    const res = await client.get('/api/v1/announcements', {
      params: { page: 1, pageSize: 10 },
    });
    recordRequest('/api/v1/announcements', res.status, Date.now() - announcementsStart);
  } catch (err) {
    recordRequest('/api/v1/announcements', 0, Date.now() - announcementsStart, err.message);
  }

  // 步骤3：公告详情页 HTML
  const announcementDetailStart = Date.now();
  try {
    const res = await client.get('/user/announcement-detail.html?id=1');
    recordRequest('/user/announcement-detail.html', res.status, Date.now() - announcementDetailStart);
  } catch (err) {
    recordRequest('/user/announcement-detail.html', 0, Date.now() - announcementDetailStart, err.message);
  }

  // 步骤4：岗位列表 API（核心高频接口）
  const jobsStart = Date.now();
  try {
    const res = await client.get('/api/v1/jobs', {
      params: { page: 1, pageSize: 20 },
    });
    recordRequest('/api/v1/jobs', res.status, Date.now() - jobsStart);
  } catch (err) {
    recordRequest('/api/v1/jobs', 0, Date.now() - jobsStart, err.message);
  }

  // 步骤5：公告列表页 HTML
  const announcementsPageStart = Date.now();
  try {
    const res = await client.get('/user/announcements.html');
    recordRequest('/user/announcements.html', res.status, Date.now() - announcementsPageStart);
  } catch (err) {
    recordRequest('/user/announcements.html', 0, Date.now() - announcementsPageStart, err.message);
  }

  return { success: true };
}

/**
 * Playwright 端到端浏览场景（低并发，验证页面渲染正确性）
 * @param {object} opts
 * @param {object} opts.page - Playwright Page 对象
 * @param {string} opts.baseUrl
 * @param {function} opts.recordRequest
 */
async function runBrowseScenarioE2E(opts) {
  const { page, baseUrl, recordRequest } = opts;

  // 步骤1：打开首页
  let start = Date.now();
  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    recordRequest('/index.html (E2E)', 200, Date.now() - start);
  } catch (err) {
    recordRequest('/index.html (E2E)', 0, Date.now() - start, err.message);
    return { success: false, error: err.message };
  }

  // 步骤2：打开公告列表页
  start = Date.now();
  try {
    await page.goto(`${baseUrl}/user/announcements.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    recordRequest('/user/announcements.html (E2E)', 200, Date.now() - start);

    // 等待公告列表元素加载
    await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
  } catch (err) {
    recordRequest('/user/announcements.html (E2E)', 0, Date.now() - start, err.message);
  }

  // 步骤3：打开公告详情页
  start = Date.now();
  try {
    await page.goto(`${baseUrl}/user/announcement-detail.html?id=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    recordRequest('/user/announcement-detail.html (E2E)', 200, Date.now() - start);
  } catch (err) {
    recordRequest('/user/announcement-detail.html (E2E)', 0, Date.now() - start, err.message);
  }

  return { success: true };
}

module.exports = { runBrowseScenario, runBrowseScenarioE2E };
