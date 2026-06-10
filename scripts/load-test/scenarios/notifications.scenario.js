'use strict';

const axios = require('axios');

/**
 * 消息中心场景：登录后查看消息通知
 * 模拟用户进入消息中心并标记已读的操作
 */

/**
 * 执行消息中心场景
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.token - 已登录的 Bearer token
 * @param {function} opts.recordRequest
 * @param {number} opts.timeout
 */
async function runNotificationsScenario(opts) {
  const { baseUrl, token, recordRequest, timeout = 10000, baseHeaders = {} } = opts;

  if (!token) {
    return { success: false, error: '无有效 Token，跳过 notifications 场景' };
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout,
    validateStatus: () => true,
    headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
  });

  // 步骤1：获取消息列表（第1页）
  const listStart = Date.now();
  let notifications = [];
  try {
    const res = await client.get('/api/v1/notifications', {
      params: { page: 1, pageSize: 20, type: 'all' },
    });
    recordRequest('/api/v1/notifications', res.status, Date.now() - listStart);

    if (res.status === 200) {
      const data = res.data?.data || res.data;
      notifications = Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data)
          ? data
          : [];
    }
  } catch (err) {
    recordRequest('/api/v1/notifications', 0, Date.now() - listStart, err.message);
    return { success: false, error: err.message };
  }

  // 步骤2：标记第一条未读消息为已读（如果存在）
  const unread = notifications.filter((n) => !n.isRead && n.id);
  if (unread.length > 0) {
    const markStart = Date.now();
    const targetId = unread[0].id;
    try {
      const res = await client.put(`/api/v1/notifications/${targetId}/read`);
      recordRequest(`/api/v1/notifications/:id/read`, res.status, Date.now() - markStart);
    } catch (err) {
      recordRequest(`/api/v1/notifications/:id/read`, 0, Date.now() - markStart, err.message);
    }
  }

  // 步骤3：模拟用户翻页（通知接口支持分页）
  const page2Start = Date.now();
  try {
    const res = await client.get('/api/v1/notifications', {
      params: { page: 2, pageSize: 20, type: 'all' },
    });
    recordRequest('/api/v1/notifications?page=2', res.status, Date.now() - page2Start);
  } catch (err) {
    recordRequest('/api/v1/notifications?page=2', 0, Date.now() - page2Start, err.message);
  }

  // 步骤4：GET 简历信息（用户中心常见附加操作）
  const resumeStart = Date.now();
  try {
    const res = await client.get('/api/v1/users/resume');
    recordRequest('/api/v1/users/resume', res.status, Date.now() - resumeStart);
  } catch (err) {
    recordRequest('/api/v1/users/resume', 0, Date.now() - resumeStart, err.message);
  }

  return { success: true };
}

module.exports = { runNotificationsScenario };
