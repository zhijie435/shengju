# 圣举人才网 — 压测工具套件

基于 Node.js + axios 的高并发 API 压测方案，支持 2000 人同时在线场景验证。

---

## 快速开始

### 1. 安装依赖

```bash
cd scripts/load-test
npm install
```

### 2. 确保后端服务已启动

```bash
# 确认服务可达（默认 localhost:3000）
curl http://localhost:3000/api/v1/health
```

### 3. 运行预设测试

```bash
# 轻量测试：10并发，30秒
npm run test:light

# 中等测试：50并发，60秒（推荐日常验证）
npm run test:medium

# 高压测试：100并发，120秒（上线前基准）
npm run test:heavy

# 注册/登录专项：20并发，60秒
npm run test:register
```

---

## 自定义配置

通过环境变量覆盖任意参数：

```bash
# 对远程服务器压测，200并发，3分钟
BASE_URL=http://your-server:3000 \
CONCURRENCY=200 \
DURATION=180 \
node loadtest.js

# 只压测浏览场景（不需要登录）
WEIGHT_BROWSE=100 \
WEIGHT_AUTH=0 \
WEIGHT_PROFILE=0 \
WEIGHT_NOTIFY=0 \
node loadtest.js

# 跳过注册（复用上次创建的账号）
SKIP_REGISTER=true CONCURRENCY=50 DURATION=60 node loadtest.js
```

### 完整环境变量列表

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BASE_URL` | `http://localhost:3000` | 目标服务地址 |
| `CONCURRENCY` | `10` | 并发虚拟用户数 |
| `DURATION` | `30` | 持续时间（秒） |
| `PRESET` | - | 预设模式：`light/medium/heavy/register` |
| `SKIP_REGISTER` | `false` | 是否跳过注册步骤 |
| `REQUEST_TIMEOUT` | `10000` | 单请求超时（ms） |
| `REQUEST_DELAY` | `0` | 请求间隔（ms），模拟用户思考时间 |
| `REPORT_INTERVAL` | `10` | 实时汇总间隔（秒） |
| `ENABLE_PLAYWRIGHT` | `false` | 是否启用 Playwright E2E 验证 |
| `PLAYWRIGHT_CONCURRENCY` | `2` | Playwright 并发数 |
| `THRESHOLD_P95` | `2000` | P95 告警阈值（ms） |
| `THRESHOLD_P99` | `5000` | P99 告警阈值（ms） |
| `THRESHOLD_ERROR` | `0.01` | 错误率告警阈值（0.01=1%） |
| `WEIGHT_AUTH` | `20` | 认证场景权重 |
| `WEIGHT_PROFILE` | `30` | 个人信息场景权重 |
| `WEIGHT_BROWSE` | `30` | 浏览场景权重 |
| `WEIGHT_NOTIFY` | `20` | 消息场景权重 |

---

## 文件结构

```
scripts/load-test/
├── loadtest.js              # 主入口（并发控制、报告生成）
├── config.js                # 所有可配置参数
├── monitor.js               # 系统资源采集（CPU/内存/磁盘）
├── package.json
├── README.md
├── reports/                 # 自动生成的测试报告（Markdown）
└── scenarios/
    ├── auth.scenario.js        # 注册→登录→退出
    ├── profile.scenario.js     # 读取/更新个人信息
    ├── browse.scenario.js      # 首页→公告→岗位（匿名）
    └── notifications.scenario.js  # 消息中心
```

---

## 测试场景说明

### auth（认证场景）
- `POST /api/v1/auth/register-self`
- `POST /api/v1/auth/login`
- `GET /api/v1/users/profile`（验证 Token）

### profile（个人信息场景）
- `GET /api/v1/users/profile`
- `PUT /api/v1/users/profile`（随机更新 gender/location/education）
- `GET /api/v1/users/profile`（验证更新）
- `GET /api/v1/assessments/results`

### browse（浏览场景，无需登录）
- `GET /index.html`
- `GET /api/v1/announcements`
- `GET /user/announcement-detail.html?id=1`
- `GET /api/v1/jobs`
- `GET /user/announcements.html`

### notifications（消息中心场景）
- `GET /api/v1/notifications`
- `PUT /api/v1/notifications/:id/read`
- `GET /api/v1/notifications/unread-count`
- `GET /api/v1/notifications?page=2`

---

## 输出报告示例

压测结束后自动输出 Markdown 格式报告，包含：

- **总览**：总请求数、成功率、QPS、P50/P95/P99
- **接口分类**：每个接口的请求数、均值、百分位延迟、错误率
- **系统资源**：CPU 和内存涨幅对比
- **承载量预估**：基于当前机器推算最大并发上限
- **瓶颈识别**：P95 超阈值接口、高错误率接口
- **优化建议**：根据测试结果动态给出针对性建议

报告同时保存至 `scripts/load-test/reports/` 目录。

---

## 注意事项

1. **首次运行前**请确保数据库已初始化（`npm run migrate:online-exam`）
2. 压测账号格式：`loadtest_${timestamp}_${i}`，密码：`Load@Test2026!`
3. 每次运行会创建新的测试账号，数据库中会产生测试数据，**生产环境使用后请手动清理**
4. 高并发测试（>100）建议先检查 MySQL 连接池大小（`DB_POOL_SIZE`）
5. macOS 上 `top -l 1` 采集 CPU 较慢（约1s），不影响压测本身
6. 报告中的承载量预估基于单机线性外推，仅供参考

---

## 清理测试数据

```sql
-- 清理所有压测账号（在 MySQL 中执行）
DELETE FROM qms_users WHERE username LIKE 'loadtest_%';
```

---

## 常见问题

**Q: 注册接口返回429 Too Many Requests**  
A: 触发了限流，调小并发数或增大 `REGISTER_BATCH_SIZE` 间隔。

**Q: 登录一直失败**  
A: 检查 `SKIP_REGISTER=true` 是否误用，或注册时的账号密码格式。

**Q: macOS 上 CPU 采集不准确**  
A: 正常，macOS `top -l 1` 有1秒延迟，监控数据仅供参考，核心指标看请求耗时。
