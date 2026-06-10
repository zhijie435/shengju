'use strict';

const axios = require('axios');

/**
 * 报名场景：公告浏览 → 简历更新 → 提交报名 → 查看报名记录
 * 覆盖关键写操作：PUT /api/v1/users/resume、POST /api/v1/cooperations
 */

const EDUCATIONS = ['本科', '大专', '研究生', '高中', '中专'];
const GENDERS = ['male', 'female'];
const MAJORS = ['计算机科学', '软件工程', '信息管理', '电子商务', '工商管理', '会计学'];
const SCHOOLS = ['测试大学', '压测学院', '示例工业大学', '模拟财经大学', '演示师范大学'];
const JOBS = ['测试岗位', '研发工程师', '产品经理', '运营专员', '行政助理', '财务助理'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成假身份证号（18位，仅用于压测，不做真实校验）
 */
function generateFakeIdCard() {
  const regions = ['110101', '120101', '310101', '440101', '330101', '510101', '420101'];
  const region = regions[Math.floor(Math.random() * regions.length)];
  const year = String(1985 + Math.floor(Math.random() * 20));
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `${region}${year}${month}${day}${seq}X`;
}

/**
 * 执行报名完整场景
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.token - 已登录的 Bearer token
 * @param {string} opts.username
 * @param {string} [opts.phone]
 * @param {function} opts.recordRequest
 * @param {number} opts.timeout
 * @param {object} opts.baseHeaders
 */
async function runApplicationScenario(opts) {
  const { baseUrl, token, username, phone, recordRequest, timeout = 10000, baseHeaders = {} } = opts;

  if (!token) {
    return { success: false, error: '无有效 Token，跳过 application 场景' };
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout,
    validateStatus: () => true,
    headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
  });

  // ── 步骤1：GET 公告列表（含 attachedProjects）───────────────────────────
  const listStart = Date.now();
  let announcements = [];
  try {
    const res = await client.get('/api/v1/announcements', {
      params: { page: 1, pageSize: 10, status: 'published' },
    });
    recordRequest('/api/v1/announcements', res.status, Date.now() - listStart);
    if (res.status === 200) {
      const data = res.data?.data || res.data;
      announcements = Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.announcements)
          ? data.announcements
          : Array.isArray(data)
            ? data
            : [];
    }
  } catch (err) {
    recordRequest('/api/v1/announcements', 0, Date.now() - listStart, err.message);
    return { success: false, error: err.message };
  }

  // 无公告时直接返回（不强制有数据）
  if (announcements.length === 0) {
    return { success: true, skipped: true, reason: '当前无发布中的公告' };
  }

  // ── 步骤2：GET 公告详情 ─────────────────────────────────────────────────
  const targetAnn = announcements[Math.floor(Math.random() * announcements.length)];
  const annId = targetAnn?.id || targetAnn?.announcementId;

  if (!annId) {
    return { success: true, skipped: true, reason: '公告缺少 id 字段' };
  }

  const detailStart = Date.now();
  let annDetail = null;
  try {
    const res = await client.get(`/api/v1/announcements/${annId}`);
    recordRequest('/api/v1/announcements/:id', res.status, Date.now() - detailStart);
    if (res.status === 200) {
      annDetail = res.data?.data || res.data;
    }
  } catch (err) {
    recordRequest('/api/v1/announcements/:id', 0, Date.now() - detailStart, err.message);
  }

  // ── 步骤3：PUT 更新简历（报名前填写基础信息）────────────────────────────
  const resumeStart = Date.now();
  try {
    const resumePayload = {
      basicInfo: {
        realName: `压测用户_${username}`,
        gender: randomItem(GENDERS),
        idNumber: generateFakeIdCard(),
        phone: phone || '13900000001',
        education: randomItem(EDUCATIONS),
        major: randomItem(MAJORS),
        graduationSchool: randomItem(SCHOOLS),
        graduationYear: String(2010 + Math.floor(Math.random() * 14)),
      },
    };
    const res = await client.put('/api/v1/users/resume', resumePayload);
    const businessFail = res.status === 200 && res.data?.success === false;
    recordRequest('/api/v1/users/resume (update)', res.status, Date.now() - resumeStart,
      businessFail ? (res.data?.message || '简历更新业务失败') : null, businessFail);
  } catch (err) {
    recordRequest('/api/v1/users/resume (update)', 0, Date.now() - resumeStart, err.message);
  }

  // ── 步骤4：POST 提交报名 ────────────────────────────────────────────────
  // 400（已报名过）、422（公告已截止）均为正常业务情况，不计为错误
  const attachedProjects = annDetail?.attachedProjects || annDetail?.projects || [];
  const project = attachedProjects[0];
  const projectId = project?.id || project?.projectId;

  if (annId) {
    const applyStart = Date.now();
    try {
      const applyPayload = {
        announcementId: annId,
        ...(projectId ? { projectId } : {}),
        applyData: {
          name: `压测用户_${username}`,
          gender: randomItem(GENDERS),
          mobile: phone || '13900000001',
          appliedJob: randomItem(JOBS),
        },
      };
      const res = await client.post('/api/v1/cooperations', applyPayload);

      // 400/409/422 = 已报名/公告截止/条件不符，HTTP 200+success:false = 业务规则拒绝
      // 以上均属正常业务结果（服务器正确响应），不计为压测错误，统一上报为 200
      const isNormalBizReject =
        res.status === 400 || res.status === 409 || res.status === 422 ||
        (res.status === 200 && res.data?.success === false);
      const reportStatus = isNormalBizReject ? 200 : res.status;
      recordRequest('/api/v1/cooperations', reportStatus, Date.now() - applyStart);
    } catch (err) {
      recordRequest('/api/v1/cooperations', 0, Date.now() - applyStart, err.message);
    }
  }

  // ── 步骤5：GET 我的报名记录 ─────────────────────────────────────────────
  const myAppStart = Date.now();
  try {
    const res = await client.get('/api/v1/jobs/applications/my', {
      params: { page: 1, pageSize: 20 },
    });
    recordRequest('/api/v1/jobs/applications/my', res.status, Date.now() - myAppStart);
  } catch (err) {
    recordRequest('/api/v1/jobs/applications/my', 0, Date.now() - myAppStart, err.message);
  }

  return { success: true };
}

module.exports = { runApplicationScenario };
