#!/usr/bin/env node
'use strict';

/**
 * 圣举人才网 — 压测主入口
 *
 * 使用方式：
 *   node loadtest.js
 *   PRESET=medium node loadtest.js
 *   CONCURRENCY=50 DURATION=60 BASE_URL=http://yourserver:3000 node loadtest.js
 */

const { config } = require('./config');
const {
  takeSnapshot,
  compareSnapshots,
  estimateCapacity,
  startContinuousMonitor,
  printSnapshot,
  formatBytes,
} = require('./monitor');
const { runAuthScenario, bulkRegister } = require('./scenarios/auth.scenario');
const { runProfileScenario } = require('./scenarios/profile.scenario');
const { runBrowseScenario } = require('./scenarios/browse.scenario');
const { runNotificationsScenario } = require('./scenarios/notifications.scenario');
const { runApplicationScenario } = require('./scenarios/application.scenario');

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── 全局统计 ──────────────────────────────────────────────────────────────

/** @type {Array<{url: string, status: number, duration: number, error?: string, time: number}>} */
const requestLog = [];
let totalRequests = 0;
let totalErrors = 0;
let testStartTime = null;

function recordRequest(url, status, duration, error = null, businessFail = false) {
  totalRequests++;
  const ok = (status >= 200 && status < 400) && !businessFail;
  if (!ok) totalErrors++;
  requestLog.push({
    url: normalizeUrl(url),
    status,
    duration,
    error: error || null,
    businessFail,
    time: Date.now(),
  });
}

/** 规范化 URL（去掉查询参数中的动态值，便于分组统计） */
function normalizeUrl(url) {
  return url
    .replace(/\/\d+\//g, '/:id/')
    .replace(/\/\d+$/, '/:id')
    .replace(/\?.*$/, '');
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/** 生成随机11位手机号（1开头，合法格式） */
function randomPhone() {
  const prefixes = ['130', '131', '132', '133', '134', '135', '136', '137', '138', '139',
    '150', '151', '152', '153', '155', '156', '157', '158', '159',
    '170', '171', '172', '173', '175', '176', '177', '178',
    '180', '181', '182', '183', '184', '185', '186', '187', '188', '189'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  return prefix + suffix;
}

/** 生成压测账号列表 */
function generateAccounts(n) {
  const ts = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const username = `${config.USER_PREFIX}_${ts}_${i}`;
    return {
      username,
      password: config.USER_PASSWORD,
      email: `${username}@loadtest.internal`,
      phone: randomPhone(),
      smsCode: '123456',  // SMS_BYPASS=true 时任意 4+ 位均有效
    };
  });
}

/** 计算百分位延迟 */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** 按 URL 分组统计 */
function groupByUrl(logs) {
  const groups = {};
  for (const r of logs) {
    if (!groups[r.url]) {
      groups[r.url] = { total: 0, errors: 0, durations: [] };
    }
    groups[r.url].total++;
    if (r.status < 200 || r.status >= 400 || r.status === 0 || r.businessFail) {
      groups[r.url].errors++;
    }
    groups[r.url].durations.push(r.duration);
  }
  return groups;
}

/** 选择场景（按权重随机） */
function pickScenario() {
  const weights = config.SCENARIO_WEIGHTS;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (const [name, w] of Object.entries(weights)) {
    rand -= w;
    if (rand <= 0) return name;
  }
  return 'browse';
}

// ─── 实时报告 ──────────────────────────────────────────────────────────────

let lastReportSize = 0;

function printRealtimeSummary() {
  const now = Date.now();
  const elapsed = (now - testStartTime) / 1000;
  const recentLogs = requestLog.slice(lastReportSize);
  lastReportSize = requestLog.length;

  const recentErrors = recentLogs.filter((r) => r.status < 200 || r.status >= 400 || r.status === 0 || r.businessFail).length;
  const recentDurations = recentLogs.map((r) => r.duration);
  const qps = recentDurations.length > 0
    ? (recentDurations.length / config.REPORT_INTERVAL).toFixed(1)
    : '0.0';
  const p50 = percentile(recentDurations, 50);
  const p95 = percentile(recentDurations, 95);
  const p99 = percentile(recentDurations, 99);
  const errRate = recentDurations.length > 0
    ? ((recentErrors / recentDurations.length) * 100).toFixed(1)
    : '0.0';

  const totalQps = elapsed > 0 ? (totalRequests / elapsed).toFixed(1) : '0.0';
  const totalErrRate = totalRequests > 0
    ? ((totalErrors / totalRequests) * 100).toFixed(1)
    : '0.0';

  console.log(
    `\n[${new Date().toLocaleTimeString()}] ` +
    `已运行 ${elapsed.toFixed(0)}s | ` +
    `累计请求: ${totalRequests} | 总QPS: ${totalQps} | 总错误率: ${totalErrRate}%`
  );
  console.log(
    `  最近${config.REPORT_INTERVAL}s: QPS=${qps} | ` +
    `P50=${p50}ms | P95=${p95}ms | P99=${p99}ms | ` +
    `错误率=${errRate}%`
  );

  // 标注慢接口
  const slowRequests = recentLogs.filter((r) => r.duration > config.THRESHOLDS.p95);
  if (slowRequests.length > 0) {
    const topSlow = slowRequests.sort((a, b) => b.duration - a.duration).slice(0, 3);
    console.log(`  ⚠ 慢请求(>${config.THRESHOLDS.p95}ms): ` +
      topSlow.map((r) => `${r.url}(${r.duration}ms)`).join(', '));
  }
}

// ─── 单个虚拟用户逻辑 ──────────────────────────────────────────────────────

async function runVirtualUser(account, endTime, userIndex = 0) {
  let token = null;

  // 每个虚拟用户模拟独立 IP（绕过 IP 级限流）
  // 服务器需设置 app.set('trust proxy', 1)，后端已配置
  const fakeIp = `10.${Math.floor(userIndex / 254) + 1}.${(userIndex % 254) + 1}.1`;
  const baseHeaders = { 'X-Forwarded-For': fakeIp, 'X-Real-IP': fakeIp };

  // 先登录一次，后续场景复用 token
  if (account) {
    const loginStart = Date.now();
    try {
      const client = axios.create({
        baseURL: config.BASE_URL,
        timeout: config.REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: baseHeaders,
      });
      const res = await client.post('/api/v1/auth/login', {
        identifier: account.username,
        password: account.password,
        userType: 'jobseeker',
      });
      if (res.status === 200) {
        token = res.data?.data?.token || res.data?.token || null;
        // 业务层登录失败（token 为 null）时，尝试先注册再重新登录
        if (!token && res.data?.success === false) {
          recordRequest('/api/v1/auth/login', res.status, Date.now() - loginStart, res.data?.message, true);
          // 先注册
          try {
            await client.post('/api/v1/auth/register-self', {
              username: account.username,
              password: account.password,
              email: account.email,
              realName: '压测用户',
              userType: 'jobseeker',
              phone: account.phone || '',
              smsCode: account.smsCode || '123456',
            });
          } catch (_) {}
          // 再登录
          const retryStart = Date.now();
          try {
            const r2 = await client.post('/api/v1/auth/login', {
              identifier: account.username,
              password: account.password,
              userType: 'jobseeker',
            });
            recordRequest('/api/v1/auth/login (retry)', r2.status, Date.now() - retryStart);
            if (r2.status === 200) {
              token = r2.data?.data?.token || r2.data?.token || null;
            }
          } catch (retryErr) {
            recordRequest('/api/v1/auth/login (retry)', 0, Date.now() - retryStart, retryErr.message);
          }
        } else {
          const loginFailed = !token;
          recordRequest('/api/v1/auth/login', res.status, Date.now() - loginStart,
            loginFailed ? (res.data?.message || '无 token') : null, loginFailed);
        }
      } else {
        recordRequest('/api/v1/auth/login', res.status, Date.now() - loginStart);
      }
    } catch (err) {
      recordRequest('/api/v1/auth/login', 0, Date.now() - loginStart, err.message);
    }
  }

  // 持续运行场景，直到测试时间结束
  while (Date.now() < endTime) {
    const scenario = pickScenario();
    const commonOpts = {
      baseUrl: config.BASE_URL,
      token,
      username: account?.username || 'anonymous',
      recordRequest,
      timeout: config.REQUEST_TIMEOUT,
      baseHeaders,  // 传递给各场景使用
    };

    try {
      switch (scenario) {
        case 'auth':
          // auth 场景：再次登录（验证并发登录性能）
          await runAuthScenario({
            ...commonOpts,
            account: { ...account, shouldRegister: false },
          });
          break;

        case 'profile':
          await runProfileScenario(commonOpts);
          break;

        case 'browse':
          await runBrowseScenario(commonOpts);
          break;

        case 'notifications':
          await runNotificationsScenario(commonOpts);
          break;

        case 'application':
          await runApplicationScenario({
            ...commonOpts,
            phone: account?.phone,
          });
          break;

        default:
          await runBrowseScenario(commonOpts);
      }
    } catch {
      // 场景级错误静默处理，不影响其他用户
    }

    // 请求间隔（防止 CPU 100%，模拟真实用户思考时间）
    if (config.REQUEST_DELAY > 0) {
      await new Promise((r) => setTimeout(r, config.REQUEST_DELAY));
    } else {
      // 最小 yield，防止事件循环饥饿
      await new Promise((r) => setImmediate(r));
    }
  }
}

// ─── 最终报告生成 ──────────────────────────────────────────────────────────

function generateReport({
  startSnapshot,
  endSnapshot,
  peakSnapshot,
  duration,
  concurrency,
  accountCount,
}) {
  const groups = groupByUrl(requestLog);
  const allDurations = requestLog.map((r) => r.duration);
  const elapsed = duration;

  const totalQps = (totalRequests / elapsed).toFixed(2);
  const successRate = totalRequests > 0
    ? (((totalRequests - totalErrors) / totalRequests) * 100).toFixed(2)
    : '0.00';
  const p50 = percentile(allDurations, 50);
  const p95 = percentile(allDurations, 95);
  const p99 = percentile(allDurations, 99);

  const delta = compareSnapshots(startSnapshot, endSnapshot);
  const capacity = estimateCapacity(endSnapshot, concurrency, peakSnapshot?.cpu?.usage);

  // 识别瓶颈
  const bottlenecks = [];
  for (const [url, stats] of Object.entries(groups)) {
    const urlP95 = percentile(stats.durations, 95);
    const urlErrRate = (stats.errors / stats.total) * 100;
    if (urlP95 > config.THRESHOLDS.p95) {
      bottlenecks.push({ url, p95: urlP95, type: 'slow' });
    }
    if (urlErrRate > config.THRESHOLDS.errorRate * 100) {
      bottlenecks.push({ url, errRate: urlErrRate.toFixed(1), type: 'error' });
    }
  }

  // 优化建议（动态选择）
  const suggestions = [];
  if (p95 > config.THRESHOLDS.p95) suggestions.push('- 接口 P95 超阈值，建议增加数据库查询索引，检查 N+1 查询');
  if (delta.cpu.delta > 30) suggestions.push('- CPU 涨幅较大，建议开启 PM2 Cluster 模式（多进程），或水平扩容');
  if (delta.memory.percentDelta > 20) suggestions.push('- 内存涨幅明显，检查是否有内存泄漏，启用 Node.js --max-old-space-size 限制');
  if (parseFloat(successRate) < 99) suggestions.push('- 成功率不足99%，检查连接池大小（DB_POOL_SIZE）和限流配置（RATE_LIMIT_*）');
  if (bottlenecks.filter((b) => b.type === 'slow').length > 0) {
    suggestions.push('- 慢接口建议开启 Redis 缓存（公告列表、岗位列表等读多写少接口）');
  }
  if (delta.cpu.peakLoad > endSnapshot.cpu.cores * 0.8) {
    suggestions.push('- 系统负载接近 CPU 核数，建议 Nginx upstream 增加节点做负载均衡');
  }
  if (suggestions.length === 0) suggestions.push('- 当前性能表现良好，可进一步提升并发数进行压测极限测试');

  // 识别写操作接口（POST/PUT）
  const WRITE_URL_PATTERNS = [
    /register-self/,
    /auth\/login/,
    /\/profile.*update/,
    /\/resume.*update/,
    /\/resume.*put/,
    /notifications.*read/,
    /cooperations/,
    /\/login\s*\(retry\)/,
  ];
  function isWriteUrl(url) {
    return WRITE_URL_PATTERNS.some((p) => p.test(url));
  }

  // 按接口统计行
  const urlRows = Object.entries(groups)
    .sort((a, b) => percentile(b[1].durations, 95) - percentile(a[1].durations, 95))
    .map(([url, stats]) => {
      const urlP50 = percentile(stats.durations, 50);
      const urlP95 = percentile(stats.durations, 95);
      const urlP99 = percentile(stats.durations, 99);
      const urlErr = ((stats.errors / stats.total) * 100).toFixed(1);
      const avgDur = (stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length).toFixed(0);
      const isSlow = urlP95 > config.THRESHOLDS.p95 ? ' ⚠' : '';
      const writeTag = isWriteUrl(url) ? '[W] ' : '';
      return `| ${writeTag}${url}${isSlow} | ${stats.total} | ${avgDur} | ${urlP50} | ${urlP95} | ${urlP99} | ${urlErr}% |`;
    });

  const report = `
# 圣举人才网 压测报告

生成时间：${new Date().toLocaleString('zh-CN')}
目标地址：${config.BASE_URL}

---

## 测试概览

| 指标 | 数值 |
|------|------|
| 并发用户数 | ${concurrency} |
| 持续时间 | ${elapsed}s |
| 测试账号数 | ${accountCount} |
| **总请求数** | **${totalRequests}** |
| **成功率** | **${successRate}%** |
| **总QPS** | **${totalQps}** |
| P50 响应时间 | ${p50} ms |
| P95 响应时间 | ${p95} ms ${p95 > config.THRESHOLDS.p95 ? '⚠ 超阈值' : '✓'} |
| P99 响应时间 | ${p99} ms ${p99 > config.THRESHOLDS.p99 ? '⚠ 超阈值' : '✓'} |
| 失败请求数 | ${totalErrors} |

---

## 接口分类统计（按P95排序）

| 接口 | 请求数 | 均值(ms) | P50(ms) | P95(ms) | P99(ms) | 错误率 |
|------|--------|----------|---------|---------|---------|--------|
${urlRows.join('\n')}

---

## 系统资源涨幅

| 指标 | 测试前 | 测试后 | 涨幅 |
|------|--------|--------|------|
| CPU 使用率 | ${delta.cpu.before.toFixed(1)}% | ${delta.cpu.after.toFixed(1)}% | +${delta.cpu.delta.toFixed(1)}% |
| 峰值 Load | - | ${delta.cpu.peakLoad.toFixed(2)} | - |
| 内存使用率 | ${startSnapshot.memory.usagePercent.toFixed(1)}% | ${endSnapshot.memory.usagePercent.toFixed(1)}% | +${delta.memory.percentDelta.toFixed(1)}% |
| 内存使用量 | ${startSnapshot.memory.usedFormatted} | ${endSnapshot.memory.usedFormatted} | +${delta.memory.deltaFormatted} |
| 磁盘使用率 | ${delta.disk.before}% | ${delta.disk.after}% | - |

---

## 承载量预估

| 指标 | 值 |
|------|----|
| 当前并发数 | ${capacity.currentConcurrency} |
| CPU 限制估算最大并发 | ${capacity.maxByCpu} |
| 内存限制估算最大并发 | ${capacity.maxByMem} |
| **综合估算最大并发** | **${capacity.estimatedMax}** |
| 建议 | ${capacity.recommendation} |

> 注：此估算基于当前单机线性外推，实际生产环境受数据库、网络、磁盘IO等因素影响，建议以实测为准。

---

## 性能瓶颈识别

${bottlenecks.length === 0
    ? '✅ 未发现明显瓶颈，所有接口均在阈值范围内。'
    : bottlenecks.map((b) =>
      b.type === 'slow'
        ? `- ⚠ **${b.url}**: P95=${b.p95}ms（阈值 ${config.THRESHOLDS.p95}ms），响应偏慢`
        : `- ❌ **${b.url}**: 错误率=${b.errRate}%（阈值 ${(config.THRESHOLDS.errorRate * 100).toFixed(0)}%）`
    ).join('\n')
  }

---

## 优化建议

${suggestions.join('\n')}
- 建议在生产环境搭配 **Redis** 做接口缓存（TTL 30-60s），可显著降低 DB 压力
- 建议配置 **Nginx limit_req** 限流（登录/注册接口独立限流，防止暴力破解）
- 建议定期跑此压测脚本，在每次上线前验证性能基线

---

*压测工具：圣举人才网 LoadTest Suite | Node.js ${process.version}*
`;

  return report;
}

// ─── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const { concurrency, duration } = {
    concurrency: config.CONCURRENCY,
    duration: config.DURATION,
  };

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║        圣举人才网 — 在线压测工具 v1.0.0         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`目标地址:   ${config.BASE_URL}`);
  console.log(`并发用户数: ${concurrency}`);
  console.log(`持续时间:   ${duration}s`);
  console.log(`请求超时:   ${config.REQUEST_TIMEOUT}ms`);
  console.log(`Playwright: ${config.ENABLE_PLAYWRIGHT ? '启用' : '禁用'}`);
  console.log('');

  // 检查目标服务可达性
  console.log('[准备] 检查目标服务可达性...');
  try {
    const res = await axios.get(`${config.BASE_URL}/api/v1/health`, { timeout: 5000, validateStatus: () => true });
    if (res.status < 500) {
      console.log(`[准备] 服务可达 (状态码: ${res.status}) ✓\n`);
    } else {
      console.warn(`[准备] 服务响应异常 (状态码: ${res.status})，继续执行压测...`);
    }
  } catch (err) {
    console.warn(`[准备] 健康检查失败 (${err.message})，目标服务可能未启动，请确认后再运行压测`);
    process.exit(1);
  }

  // 采集测试前快照
  console.log('[Monitor] 采集基线系统资源快照...');
  const startSnapshot = takeSnapshot('测试前');
  printSnapshot(startSnapshot);
  console.log('');

  // 生成账号列表
  let accounts = generateAccounts(concurrency);

  // 注册阶段
  if (!config.SKIP_REGISTER) {
    console.log(`[注册] 开始批量注册 ${accounts.length} 个测试账号...`);
    const regStart = Date.now();
    accounts = await bulkRegister({
      baseUrl: config.BASE_URL,
      accounts,
      batchSize: config.REGISTER_BATCH_SIZE,
      recordRequest,
      timeout: config.REQUEST_TIMEOUT,
      onProgress: (done, total) => {
        process.stdout.write(`\r[注册] 进度: ${done}/${total}`);
      },
    });
    console.log(`\n[注册] 完成，耗时 ${((Date.now() - regStart) / 1000).toFixed(1)}s`);
    const registered = accounts.filter((a) => a.registered).length;
    console.log(`[注册] 成功: ${registered}/${accounts.length}\n`);

    if (registered === 0) {
      console.error('[注册] 所有账号注册失败！请检查注册接口是否正常。');
      process.exit(1);
    }

    // 只使用注册成功的账号
    accounts = accounts.filter((a) => a.registered);
  } else {
    console.log(`[注册] 已跳过注册阶段（SKIP_REGISTER=true）\n`);
  }

  // 启动持续系统监控（每2秒一次）
  let peakCpuUsage = startSnapshot.cpu.usage;
  const sysMonitor = startContinuousMonitor(2000, (snap) => {
    if (snap.cpu.usage > peakCpuUsage) peakCpuUsage = snap.cpu.usage;
  });

  // 启动实时汇总定时器
  const reportTimer = setInterval(printRealtimeSummary, config.REPORT_INTERVAL * 1000);

  // 压测主循环
  console.log(`[压测] 开始！并发 ${concurrency} 用户，持续 ${duration}s`);
  console.log(
    `[压测] 场景权重: ` +
    `auth=${config.SCENARIO_WEIGHTS.auth}% ` +
    `browse=${config.SCENARIO_WEIGHTS.browse}% ` +
    `profile=${config.SCENARIO_WEIGHTS.profile}% ` +
    `notifications=${config.SCENARIO_WEIGHTS.notifications}% ` +
    `application=${config.SCENARIO_WEIGHTS.application || 0}%\n`
  );

  testStartTime = Date.now();
  const endTime = testStartTime + duration * 1000;

  // 并发启动所有虚拟用户
  const userPromises = accounts.slice(0, concurrency).map((account, idx) =>
    runVirtualUser(account, endTime, idx).catch((err) => {
      console.error(`[VUser-${idx}] 异常退出: ${err.message}`);
    })
  );

  // 等待所有虚拟用户结束
  await Promise.all(userPromises);
  clearInterval(reportTimer);
  sysMonitor.stop();

  const actualDuration = (Date.now() - testStartTime) / 1000;
  console.log(`\n[压测] 完成，实际运行 ${actualDuration.toFixed(1)}s\n`);

  // 采集测试后快照
  console.log('[Monitor] 采集测试后系统资源快照...');
  const endSnapshot = takeSnapshot('测试后');
  printSnapshot(endSnapshot);

  // 获取峰值快照（用峰值CPU）
  const peakSnap = { ...endSnapshot, cpu: { ...endSnapshot.cpu, usage: peakCpuUsage } };

  // 生成最终报告
  const report = generateReport({
    startSnapshot,
    endSnapshot,
    peakSnapshot: peakSnap,
    duration: actualDuration,
    concurrency,
    accountCount: accounts.length,
  });

  console.log('\n' + '═'.repeat(60));
  console.log(report);
  console.log('═'.repeat(60));

  // 保存报告到文件
  try {
    const outputDir = path.resolve(__dirname, config.OUTPUT_DIR);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filename = `loadtest-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    const reportPath = path.join(outputDir, filename);
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\n[报告] 已保存至: ${reportPath}`);
  } catch (err) {
    console.warn(`[报告] 保存文件失败: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
