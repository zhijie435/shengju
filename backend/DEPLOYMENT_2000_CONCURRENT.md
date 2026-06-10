# 约 2000 人同时在线考试 - 部署与配置说明

本说明描述为支持约 **2000 人同时在线考试** 已做的代码调整及推荐部署配置。

## 一、已修改的代码与配置项

### 1. 主数据库连接池（`config/database.js`）

- **原状**：`connectionLimit: 10`，高并发时易排队。
- **现况**：
  - 默认 `connectionLimit: 50`，可通过环境变量 **`DB_POOL_SIZE`** 调整（建议 50–100）。
  - 排队上限 **`DB_POOL_QUEUE_LIMIT`** 默认 500，避免无界排队。
- **MySQL 端**：确保 `max_connections` ≥ 主库池大小 + 人才网库池 + 其他应用占用（单机建议 ≥ 150）。

### 2. 用户库连接池（`config/userDatabase.js`）

- **原状**：每个用户一个连接池、每池 5 连接，2000 用户会占用上万连接。
- **现况**：
  - 用户池数量上限 **`MAX_USER_POOLS`** 默认 100（可设 `MAX_USER_POOLS=150` 等）。
  - 每池连接数 **`USER_POOL_CONNECTION_LIMIT`** 默认 2。
  - 超过上限时按 **LRU** 淘汰最少使用的用户池，总连接数约控制在 `MAX_USER_POOLS * USER_POOL_CONNECTION_LIMIT` 内。

### 3. API 限流（`server.js`）

- **新增**：对 `/api/*` 启用 `express-rate-limit`。
  - **`RATE_LIMIT_WINDOW_MS`**：限流窗口（毫秒），默认 15 分钟。
  - **`RATE_LIMIT_MAX_PER_IP`**：每 IP 在窗口内最大请求数，默认 600。
- 前置若有 Nginx/负载均衡，请设置 **`TRUST_PROXY=1`**，以便按真实客户端 IP 限流。

### 4. WebSocket（`services/examWebSocket.js`）

- **新增**：`maxPayload` 默认 512KB，可通过 **`WS_MAX_PAYLOAD`**（字节）调整。
- 监控/心跳为轻量消息，单进程可承载数千 WebSocket 连接；若多实例部署，需负载均衡**粘性会话**或改用 Redis 等做跨实例广播。

### 5. 认证与状态

- 认证为 **JWT**，无服务端 session 存储，便于水平扩展。
- 考生免登录考试使用 JWT 中的 `sessionId`，无状态。

---

## 二、推荐环境变量（.env）

在项目根或 `backend` 目录下的 `.env` 中可增加或修改：

```env
# 主库连接池（约 2000 人在线建议 50–100）
DB_POOL_SIZE=50
DB_POOL_QUEUE_LIMIT=500

# 人才网库连接池
SHENGJU_POOL_SIZE=10

# 用户库池数量与每池连接数
MAX_USER_POOLS=100
USER_POOL_CONNECTION_LIMIT=2

# API 限流：15 分钟每 IP 最多请求数
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_PER_IP=600

# 若部署在 Nginx/负载均衡后，设为 1
TRUST_PROXY=1

# 生产环境
NODE_ENV=production
```

---

## 三、MySQL 建议

- **max_connections**：建议 ≥ 200（主池 + 人才网池 + 用户池 + 余量）。
- **innodb_buffer_pool_size**：根据内存适当调大，减少磁盘 IO。
- 考试相关表（如 `exam_sessions`、`exam_answers`）建议按 `exam_id`、`session_id` 等建索引，便于高并发查询。

---

## 四、多实例与扩展

- **单机**：以上配置即可支持约 2000 人同时在线。
- **多实例**：
  - 使用 Nginx 等做负载均衡，建议**粘性会话**（同一客户端命中同一后端），以便 WebSocket 监控稳定。
  - 各实例独立连接 MySQL，总连接数 = 实例数 × 每实例主池大小 + 实例数 × 用户池相关连接，需保证 MySQL `max_connections` 足够。
  - 限流为每实例独立计数的“每 IP 每窗口请求数”，多实例会成倍放宽；若需全局限流，可后续接入 Redis 等共享存储。

---

## 五、监控建议

- 监控 **数据库连接数**、**慢查询**、**应用 CPU/内存**。
- 关注 **限流触发**（如 429 响应）和 **连接池排队**（可打日志或指标），便于在 2000 人峰值前调大池或限流阈值。

以上修改均在当前代码库中完成，按需调整 `.env` 与 MySQL 即可支撑约 2000 人同时在线考试。
