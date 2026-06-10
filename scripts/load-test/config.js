'use strict';

/**
 * 压测配置文件
 * 所有参数均可通过环境变量覆盖
 */

const config = {
  // 目标服务地址
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',

  // 并发数（虚拟用户数）
  CONCURRENCY: parseInt(process.env.CONCURRENCY) || 10,

  // 持续时间（秒）
  DURATION: parseInt(process.env.DURATION) || 30,

  // 注册账号前缀
  USER_PREFIX: process.env.USER_PREFIX || 'loadtest',

  // 压测账号密码（统一）
  USER_PASSWORD: process.env.USER_PASSWORD || 'Load@Test2026!',

  // 是否启用 Playwright 端到端场景（低并发，默认关闭以节省资源）
  ENABLE_PLAYWRIGHT: process.env.ENABLE_PLAYWRIGHT === 'true' || false,

  // Playwright 并发数（建议 1-5）
  PLAYWRIGHT_CONCURRENCY: parseInt(process.env.PLAYWRIGHT_CONCURRENCY) || 2,

  // 请求超时（ms）
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 10000,

  // 每 N 秒输出一次实时汇总
  REPORT_INTERVAL: parseInt(process.env.REPORT_INTERVAL) || 10,

  // 注册阶段：每批并发注册数
  REGISTER_BATCH_SIZE: parseInt(process.env.REGISTER_BATCH_SIZE) || 10,

  // 是否跳过注册步骤（复用已有账号）
  SKIP_REGISTER: process.env.SKIP_REGISTER === 'true' || false,

  // 随机种子（用于生成手机号）
  PHONE_PREFIX: '139',

  // 请求间隔（ms）- 防止瞬时冲击，0=无间隔
  REQUEST_DELAY: parseInt(process.env.REQUEST_DELAY) || 0,

  // 输出目录
  OUTPUT_DIR: process.env.OUTPUT_DIR || './reports',

  // 场景权重（按权重随机选择场景，总和不必为100）
  SCENARIO_WEIGHTS: {
    auth: parseInt(process.env.WEIGHT_AUTH) || 15,          // 注册/登录
    profile: parseInt(process.env.WEIGHT_PROFILE) || 25,    // 个人信息读写
    browse: parseInt(process.env.WEIGHT_BROWSE) || 25,      // 匿名浏览
    notifications: parseInt(process.env.WEIGHT_NOTIFY) || 15, // 消息中心
    application: parseInt(process.env.WEIGHT_APPLICATION) || 20, // 报名场景（含写操作）
  },

  // API 路径
  API: {
    register: '/api/v1/auth/register-self',
    login: '/api/v1/auth/login',
    profile: '/api/v1/users/profile',
    resume: '/api/v1/users/resume',
    notifications: '/api/v1/notifications',
    jobs: '/api/v1/jobs',
    announcements: '/api/v1/announcements',
    cooperations: '/api/v1/cooperations',
    myApplications: '/api/v1/jobs/applications/my',
    assessmentResults: '/api/v1/assessments/results',
  },

  // 页面路径
  PAGES: {
    login: '/user/login.html',
    register: '/user/register.html',
    home: '/index.html',
    profile: '/user/profile.html',
    announcements: '/user/announcements.html',
    announcementDetail: '/user/announcement-detail.html?id=1',
  },

  // 性能阈值（超出则标记为瓶颈）
  THRESHOLDS: {
    p95: parseInt(process.env.THRESHOLD_P95) || 2000,   // P95 < 2s
    p99: parseInt(process.env.THRESHOLD_P99) || 5000,   // P99 < 5s
    errorRate: parseFloat(process.env.THRESHOLD_ERROR) || 0.01, // 错误率 < 1%
  },
};

// 预设测试模式
const PRESETS = {
  light: {
    CONCURRENCY: 10,
    DURATION: 30,
    ENABLE_PLAYWRIGHT: false,
    label: '轻量测试 (10并发/30s)',
  },
  medium: {
    CONCURRENCY: 50,
    DURATION: 60,
    ENABLE_PLAYWRIGHT: false,
    label: '中等测试 (50并发/60s)',
  },
  heavy: {
    CONCURRENCY: 100,
    DURATION: 120,
    ENABLE_PLAYWRIGHT: false,
    label: '高压测试 (100并发/120s)',
  },
  register: {
    CONCURRENCY: 20,
    DURATION: 60,
    ENABLE_PLAYWRIGHT: false,
    SCENARIO_WEIGHTS: { auth: 100, profile: 0, browse: 0, notifications: 0, application: 0 },
    label: '注册/登录专项测试 (20并发/60s)',
  },
};

// 应用预设
const preset = process.env.PRESET;
if (preset && PRESETS[preset]) {
  Object.assign(config, PRESETS[preset]);
  console.log(`[Config] 使用预设: ${PRESETS[preset].label}`);
}

module.exports = { config, PRESETS };
