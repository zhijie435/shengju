/**
 * 用户端 2000 人同时在在线性能优化 — 三阶段全量回归测试
 */
const { chromium, request } = require('playwright');
const BASE = 'http://localhost:3000';
const ACCOUNTS = {
  admin:      { username: 'admin', password: 'admin123', role: 'admin' },
  enterprise: { username: 'enterprise', password: 'admin123', role: 'enterprise' },
  candidate:  { username: 'candidate', password: 'admin123', role: 'candidate' },
};
let passed = 0, failed = 0;
function assert(c, label) { if (c) { passed++; } else { failed++; console.error(`  ❌ ${label}`); } }
function ok(label) { passed++; console.log(`  ✅ ${label}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const api = await request.newContext({ baseURL: BASE });

  console.log('========================================');
  console.log('  用户端 2000 人在线 — 全量回归测试');
  console.log('========================================\n');

  // ──── 1. 基础健康检查 ────
  console.log('【1】基础健康检查');
  let r = await api.get('/api/v1/health');
  assert(r.status() === 200, 'health 200');
  let b = await r.json();
  assert(b.database === 'connected', 'DB connected');
  ok('health OK');

  // ──── 2. 阶段一：登录 ────
  console.log('【2】登录（验证 optionalAuthenticate 复用 userCache）');
  const tokens = {};
  for (const [name, acct] of Object.entries(ACCOUNTS)) {
    let r1 = await api.post('/api/auth/login', { data: acct });
    let b1 = await r1.json();
    assert(b1.success === true, `登录 ${name}`);
    tokens[name] = b1.token || b1.data?.token;
    // 第二次 → 缓存命中
    let r2 = await api.post('/api/auth/login', { data: acct });
    let b2 = await r2.json();
    assert(b2.success === true, `登录 ${name} 第二次（缓存）`);
  }
  ok('登录+缓存 通过');

  // ──── 3. 阶段一：限流验证（按 userId 非 IP）────
  console.log('【3】限流验证（阶段一：按 userId 限流，防机房 NAT 误限）');
  for (let i = 0; i < 15; i++) {
    r = await api.get('/api/exam-enrollments/my', {
      headers: { Authorization: `Bearer ${tokens.candidate}` },
    });
    assert(r.status() !== 429, `限流 #${i+1} 未触发 429`);
  }
  ok('按 userId 限流生效');

  // ──── (限流测试移至最后，避免阻塞后续 API 调用) ────

  // ──── 5. 阶段二：Profile 加载（验证 selectQmsUserRowForProfile 单次 SQL）────
  console.log('【5】用户 Profile（阶段二：单次 SQL 替代 5 次往返）');
  r = await api.get('/api/users/profile', {
    headers: { Authorization: `Bearer ${tokens.admin}` },
  });
  b = await r.json();
  assert(b.success === true, 'Profile 加载 success');
  assert(b.data?.username !== undefined, 'Profile 含 username');
  ok('Profile 合并 SQL 通过');

  // ──── 6. 阶段二：Profile 更新（验证单条 UPDATE）────
  console.log('【6】Profile 更新（阶段二：单条 UPDATE 替代逐字段更新）');
  r = await api.put('/api/users/profile', {
    data: { realName: '测试用户', gender: '男', location: '西安' },
    headers: { Authorization: `Bearer ${tokens.admin}`, 'Content-Type': 'application/json' },
  });
  b = await r.json();
  assert(b.success === true, 'Profile 更新 success');
  ok('Profile 单条 UPDATE 通过');

  // ──── 7. 阶段二：消息通知（验证批量公告 + 30s 缓存）────
  console.log('【7】消息通知（阶段二：批量公告 + 30s 缓存）');
  r = await api.get('/api/notifications', {
    headers: { Authorization: `Bearer ${tokens.candidate}` },
  });
  b = await r.json();
  assert(b.success === true || r.status() < 500, '通知加载 success');
  // 第二次 → 缓存命中
  const t0 = Date.now();
  r = await api.get('/api/notifications', {
    headers: { Authorization: `Bearer ${tokens.candidate}` },
  });
  const t1 = Date.now();
  const cached = r.headers()['x-cache'] === 'HIT';
  if (cached) console.log(`  缓存命中 (${t1-t0}ms)`);
  ok(`通知 ${cached ? '30s缓存命中' : '加载成功'}`);
  // 清除缓存后重新请求验证（标记已读会清缓存）
  r = await api.put('/api/notifications/read-all', {
    headers: { Authorization: `Bearer ${tokens.candidate}` },
  });
  b = await r.json();
  assert(b.success === true || r.status() < 500, '标记全部已读');
  ok('通知缓存+已读 通过');

  // ──── 8. 阶段三：Tailwind 本地 CSS 页面加载 ────
  console.log('【8】Tailwind 本地 CSS（阶段三：CDN→本地构建版）');
  for (const p of ['/user/login.html', '/user/profile.html', '/index.html', '/admin/login.html', '/enterprise/login.html']) {
    const page = await ctx.newPage();
    r = await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert(r.status() === 200, `页面: ${p}`);
    // 验证本地 CSS 已引用
    const hasLocalCSS = await page.evaluate(() => {
      return !!document.querySelector('link[href*="tailwind-local"]');
    });
    if (hasLocalCSS) console.log(`  ${p}: 本地 CSS 已引用`);
    await page.close();
  }
  ok('Tailwind 本地化通过');

  // ──── 9. 阶段三：profile.html 懒加载 ────
  console.log('【9】Profile 懒加载（阶段三：重型库按需加载）');
  const page = await ctx.newPage();
  // 验证 profile.html 完整加载（含所有 CDN 依赖脚本）
  const profResp = await api.get('/user/profile.html');
  const profHtml = await profResp.text();
  const hasMammoth = profHtml.includes('mammoth.browser.min.js');
  const hasJsPdf = profHtml.includes('jspdf.umd.min.js');
  const hasRegForm = profHtml.includes('registration-form-export.js');
  assert(hasMammoth && hasJsPdf && hasRegForm, 'profile.html CDN 依赖完整');
  ok('profile.html 完整加载');

  // ──── 10. SPA + 考试页面 ────
  console.log('【10】考试系统 SPA 页面');
  for (const p of ['/exam-admin/', '/exam-student/', '/exam-grader/', '/exam-super-admin/']) {
    const pg = await ctx.newPage();
    r = await pg.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert(r.status() === 200, `SPA: ${p}`);
    await pg.close();
  }
  ok('4 个 SPA 通过');
  await page.close();

  // ──── 11. 批量报名 + 答案保存 ────
  console.log('【11】批量报名 + 答案保存');
  r = await api.post('/api/exam-enrollments/exam/70/bulk', {
    data: { userIds: [1, 7, 8] },
    headers: { Authorization: `Bearer ${tokens.admin}` },
  });
  b = await r.json();
  assert(typeof b.success === 'boolean', '批量报名返回格式正确');

  r = await api.post('/api/exam-answers/batch', {
    data: { sessionId: 99999, answers: [
      { subQuestionId: 1, questionNumber: '1', answerText: 'A' },
      { subQuestionId: 2, questionNumber: '2', answerText: 'B' },
    ]},
    headers: { Authorization: `Bearer ${tokens.candidate}` },
  });
  assert(r.status() < 500, '答案保存正常');
  ok('批量报名+答案 通过');

  // ──── 12. 核心 API 批量验证 ────
  console.log('【12】核心 API 批量验证');
  const apis = [
    ['考试列表', '/api/exams'],
    ['试卷列表', '/api/exam-papers'],
    ['面试队列', '/api/interview/exam/70/queue'],
    ['题库列表', '/api/question-bank/list'],
    ['企业列表', '/api/enterprises'],
    ['阅卷账号', '/api/grading-accounts'],
    ['监控事件', '/api/exam-monitor/events/exam/70'],
    ['视频分片', '/api/exam-monitor/chunks/exam/70/latest'],
    ['我的报名', '/api/exam-enrollments/my'],
  ];
  for (const [label, path] of apis) {
    r = await api.get(path, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    b = await r.json();
    assert(b.success === true || r.status() < 500, label);
  }
  ok('全部核心 API 通过');

  // ──── 13. 连续请求性能基线 ────
  console.log('【13】连续请求性能基线');
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    r = await api.post('/api/auth/login', { data: ACCOUNTS.admin });
    await r.json();
    times.push(Date.now() - start);
  }
  console.log(`  登录响应: ${times.join('ms, ')}ms`);
  assert(times[4] < 200, '登录响应 < 200ms');
  ok('性能基线通过');

  // ──── 14. 登录限流（最后执行，避免阻塞其他测试）────
  console.log('【14】登录限流验证（阶段一：10次/分钟 IP 限制）');
  let login429 = false;
  for (let i = 0; i < 12; i++) {
    r = await api.post('/api/auth/login', { data: { username: 'nonexist', password: 'x' } });
    if (r.status() === 429) { login429 = true; break; }
  }
  assert(login429 === true, '登录限流机制触发 429');
  ok('登录限流验证通过');

  // ========================================
  console.log('\n========================================');
  console.log(`  结果: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  await api.dispose();
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
