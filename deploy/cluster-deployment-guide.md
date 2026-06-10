# 圣举人才网 — 集群部署方案（阿里云 ECS）

> 目标：单台 4C/16G ECS 承载 **约 2000 人同时在线**笔试，PM2 Cluster 模式 + Nginx 反代 + Redis 缓存。

---

## 目录

1. [环境准备](#1-环境准备)
2. [项目部署流程](#2-项目部署流程)
3. [PM2 Cluster 配置](#3-pm2-cluster-配置)
4. [Nginx 完整配置](#4-nginx-完整配置)
5. [Redis 配置](#5-redis-配置)
6. [MySQL 优化](#6-mysql-优化)
7. [系统调优](#7-系统调优)
8. [监控与告警](#8-监控与告警)
9. [上线验证 Checklist](#9-上线验证-checklist)

---

## 1. 环境准备

### 1.1 ECS 规格推荐

| 规格 | 配置 | 说明 |
|------|------|------|
| 最低 | 4C/16G | 单机 500-1000 并发 |
| 推荐 | 8C/32G | 单机 2000 并发 |
| 高配 | 16C/64G | 单机 5000+ 并发 |

**操作系统**：Alibaba Cloud Linux 3（兼容 CentOS 8，推荐），或 Ubuntu 22.04 LTS

**磁盘**：系统盘 40G（SSD），数据盘 100G+(用于上传文件和日志)

### 1.2 安全组规则

```
入方向（允许）：
  22   TCP   你的办公 IP/32   SSH 管理
  80   TCP   0.0.0.0/0       HTTP
  443  TCP   0.0.0.0/0       HTTPS
  3306 TCP   私网 CIDR        MySQL（仅内网）
  6379 TCP   私网 CIDR        Redis（仅内网）

出方向：全部放行
```

### 1.3 安装 Node.js v22

```bash
# 方式一：使用阿里云镜像 NodeSource（推荐，速度快）
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs

# 验证
node -v   # 应输出 v22.x.x
npm -v    # 应输出 10.x.x

# 若网络慢，使用 nvm（更灵活）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22
echo "node: $(node -v)"
```

### 1.4 安装 PM2

```bash
# 全局安装 PM2
npm install -g pm2

# 配置 PM2 开机自启
pm2 startup systemd -u root --hp /root
# 按照命令输出，执行对应的 systemctl 命令

# 验证
pm2 -v    # 应输出 5.x.x
```

### 1.5 安装 Nginx

```bash
# Alibaba Cloud Linux 3 / CentOS
yum install -y nginx

# Ubuntu / Debian
apt update && apt install -y nginx

# 启动并设置开机自启
systemctl enable nginx
systemctl start nginx
systemctl status nginx

# 安装 Brotli 模块（可选，用于更好的压缩）
# yum install -y nginx-mod-http-brotli   # 部分发行版支持

nginx -v   # 确认版本 >= 1.20
```

### 1.6 安装 Redis

```bash
# 方式一：yum 安装（Redis 7.x）
yum install -y redis

# 方式二：使用阿里云 Redis（PaaS，推荐生产环境）
# 在阿里云控制台创建 Redis 实例，获取内网连接地址

# 启动 Redis
systemctl enable redis
systemctl start redis

# 验证
redis-cli ping   # 应返回 PONG

# 检查版本
redis-cli info server | grep redis_version
```

### 1.7 安装编译依赖（用于 bcrypt/canvas 重建）

```bash
yum groupinstall -y "Development Tools"
yum install -y \
  cairo-devel \
  libjpeg-turbo-devel \
  pango-devel \
  giflib-devel \
  python3
```

---

## 2. 项目部署流程

### 2.1 创建项目目录

```bash
# 创建统一的应用目录
mkdir -p /opt/sjrcw
mkdir -p /opt/sjrcw/logs
mkdir -p /opt/sjrcw/uploads
mkdir -p /var/log/nginx/sjrcw

# 挂载数据盘到 uploads（若有单独数据盘）
# mkfs.ext4 /dev/vdb
# mount /dev/vdb /opt/sjrcw/uploads
# echo '/dev/vdb /opt/sjrcw/uploads ext4 defaults 0 0' >> /etc/fstab
```

### 2.2 上传代码

**方式一：rsync（推荐，增量同步快）**

```bash
# 在本地执行（Mac/Linux）
# 首次全量上传（排除 node_modules 和 .env）
rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='backend/uploads/*' \
  --exclude='*.log' \
  --exclude='.git' \
  /Users/wuzhijie/Documents/xiaohongshu/sjrcw/code/ \
  root@YOUR_ECS_IP:/opt/sjrcw/code/

# 后续增量更新
rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='backend/uploads/*' \
  /Users/wuzhijie/Documents/xiaohongshu/sjrcw/code/ \
  root@YOUR_ECS_IP:/opt/sjrcw/code/
```

**方式二：Git（适合有 Git 服务器的情况）**

```bash
# 在 ECS 上执行
cd /opt/sjrcw
git clone git@your-git-server:sjrcw/code.git code
cd code
git checkout main
git pull
```

**方式三：scp 打包上传**

```bash
# 本地打包（排除无关文件）
cd /Users/wuzhijie/Documents/xiaohongshu/sjrcw
tar --exclude='code/node_modules' \
    --exclude='code/.git' \
    --exclude='code/backend/uploads' \
    -czf sjrcw-code.tar.gz code/

# 上传到 ECS
scp sjrcw-code.tar.gz root@YOUR_ECS_IP:/opt/sjrcw/

# 在 ECS 解压
ssh root@YOUR_ECS_IP
cd /opt/sjrcw
tar -xzf sjrcw-code.tar.gz
```

### 2.3 安装后端依赖

```bash
cd /opt/sjrcw/code/backend

# 安装所有依赖
npm install --production

# 重建原生模块（bcrypt, canvas, sharp）
# 这些模块在 macOS 编译后不能直接用于 Linux，必须重建
npm rebuild bcrypt
npm rebuild canvas
npm rebuild sharp

# 若 canvas 安装失败（缺少系统库）
# npm install --canvas_binary_host_mirror=https://registry.npmmirror.com/-/binary/canvas canvas

# 验证关键模块
node -e "require('bcrypt'); console.log('bcrypt OK')"
node -e "require('canvas'); console.log('canvas OK')"
```

### 2.4 构建前端资源

```bash
cd /opt/sjrcw/code

# 安装各前端依赖
cd frontend/exam-admin    && npm install && cd /opt/sjrcw/code
cd frontend/exam-student  && npm install && cd /opt/sjrcw/code
cd frontend/exam-grader   && npm install && cd /opt/sjrcw/code
cd frontend/exam-super-admin && npm install && cd /opt/sjrcw/code

# 全量构建（生产模式）
npm run build:all-exam-frontends

# 验证构建产物
ls -la frontend/exam-admin/dist/
ls -la frontend/exam-student/dist/
ls -la frontend/exam-grader/dist/
ls -la frontend/exam-super-admin/dist/
```

### 2.5 配置环境变量

```bash
# 创建生产环境配置
cat > /opt/sjrcw/code/backend/.env << 'EOF'
# ===== 服务配置 =====
PORT=3000
NODE_ENV=production

# ===== 数据库配置 =====
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_STRONG_DB_PASSWORD
MAIN_DB_NAME=question_management_shared
SHENGJU_DB_NAME=shengju
DB_POOL_SIZE=50
DB_POOL_MIN=10

# ===== JWT =====
JWT_SECRET=YOUR_VERY_LONG_RANDOM_JWT_SECRET_AT_LEAST_64_CHARS

# ===== Redis（如使用阿里云 Redis，填云实例地址）=====
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ===== 请求限制 =====
BODY_PARSER_LIMIT=80mb
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=600

# ===== AI =====
DEEPSEEK_API_KEY=YOUR_DEEPSEEK_KEY

# ===== 阿里云短信 =====
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=

# ===== 阿里云人脸识别 =====
ALIYUN_VIAPI_ACCESS_KEY_ID=
ALIYUN_VIAPI_ACCESS_KEY_SECRET=

# ===== 微信支付 =====
WECHAT_PAY_MCH_ID=
WECHAT_PAY_APP_ID=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_CERT_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY_PATH=/opt/sjrcw/certs/apiclient_key.pem

# ===== 上传目录 =====
UPLOAD_DIR=/opt/sjrcw/uploads
EOF

# 权限保护
chmod 600 /opt/sjrcw/code/backend/.env
```

### 2.6 数据库迁移

```bash
# 按顺序执行迁移
cd /opt/sjrcw/code

# 先确认数据库已创建
mysql -u root -p -h 127.0.0.1 -P 3306 << 'EOF'
CREATE DATABASE IF NOT EXISTS question_management_shared
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS shengju
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SHOW DATABASES;
EOF

# 执行迁移脚本（后端启动时会自动执行，或手动按顺序执行）
# 笔试系统表
node backend/database/migrate-online-exam.js 2>&1 | tee /opt/sjrcw/logs/migrate-exam.log

# 试卷表
node backend/database/migrate-exam-papers.js 2>&1 | tee /opt/sjrcw/logs/migrate-papers.log

# 阅卷系统
node backend/database/migrate-grading.js 2>&1 | tee /opt/sjrcw/logs/migrate-grading.log

# 用户字段扩展
node backend/database/migrate-users-candidate.js 2>&1 | tee /opt/sjrcw/logs/migrate-users.log

echo "迁移完成，查看日志确认无错误"
```

---

## 3. PM2 Cluster 配置

### 3.1 ecosystem.config.js

在项目根目录创建：

```bash
cat > /opt/sjrcw/code/ecosystem.config.js << 'EOF'
'use strict';

module.exports = {
  apps: [
    {
      name: 'sjrcw-api',
      script: './backend/server.js',
      cwd: '/opt/sjrcw/code',

      // Cluster 模式：使用 3 个进程（4C 机器留 1 核给 Nginx/Redis）
      instances: 3,
      exec_mode: 'cluster',

      // 内存限制：单进程 1.5G（3进程共 4.5G，16G机器还有余量给OS/DB）
      max_memory_restart: '1500M',

      // Node.js 启动参数（增加 V8 堆内存上限）
      node_args: '--max-old-space-size=1400',

      // 环境变量
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // 日志配置
      out_file: '/opt/sjrcw/logs/sjrcw-out.log',
      error_file: '/opt/sjrcw/logs/sjrcw-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // 崩溃重启策略
      restart_delay: 3000,        // 重启前等待 3s
      max_restarts: 10,           // 最多重启 10 次
      min_uptime: '30s',          // 运行超过 30s 才算正常启动
      autorestart: true,

      // 优雅关闭（等待 in-flight 请求完成）
      kill_timeout: 10000,        // 等待 10s 后强制结束
      wait_ready: true,           // 等待 server.js 发送 process.send('ready')
      listen_timeout: 15000,

      // 监控（不在生产环境开启文件监听，改用手动 reload）
      watch: false,

      // 进程间 Session 共享（需 Redis）
      // 注意：WebSocket 连接需要 sticky session（见 Nginx 配置）
    },
  ],
};
EOF
```

> **重要**：如果 `server.js` 支持发送 `process.send('ready')`，请在服务完全启动后调用，否则删去 `wait_ready` 配置。

### 3.2 启动 / 管理命令

```bash
# 首次启动
cd /opt/sjrcw/code
pm2 start ecosystem.config.js

# 查看运行状态
pm2 status
pm2 list

# 查看实时日志
pm2 logs sjrcw-api
pm2 logs sjrcw-api --lines 200

# 平滑重载（不中断现有请求，适合代码更新）
pm2 reload sjrcw-api

# 完全重启（彻底重启，适合配置变更）
pm2 restart sjrcw-api

# 停止
pm2 stop sjrcw-api

# 查看详细监控（CPU/内存/进程）
pm2 monit

# 保存 PM2 进程列表（开机自动恢复）
pm2 save

# 查看单个进程的详细信息
pm2 describe sjrcw-api

# 扩缩容（动态调整进程数）
pm2 scale sjrcw-api 4    # 扩至4进程
pm2 scale sjrcw-api 2    # 缩至2进程
```

### 3.3 代码更新流程

```bash
# 完整的代码更新脚本（可保存为 /opt/sjrcw/deploy.sh）
cat > /opt/sjrcw/deploy.sh << 'DEPLOY_SCRIPT'
#!/bin/bash
set -e

APP_DIR=/opt/sjrcw/code
LOG=/opt/sjrcw/logs/deploy-$(date +%Y%m%d_%H%M%S).log

echo "[$(date)] 开始部署" | tee -a $LOG

# 1. 拉取最新代码
cd $APP_DIR
git pull origin main 2>&1 | tee -a $LOG

# 2. 安装后端依赖（有新依赖时）
cd $APP_DIR/backend
npm install --production 2>&1 | tee -a $LOG

# 3. 重建原生模块（如 package.json 有变动）
npm rebuild bcrypt canvas 2>&1 | tee -a $LOG

# 4. 构建前端（如前端有变动）
cd $APP_DIR
npm run build:all-exam-frontends 2>&1 | tee -a $LOG

# 5. 平滑重载 PM2（零停机）
pm2 reload sjrcw-api 2>&1 | tee -a $LOG

echo "[$(date)] 部署完成" | tee -a $LOG
DEPLOY_SCRIPT
chmod +x /opt/sjrcw/deploy.sh
```

---

## 4. Nginx 完整配置

### 4.1 主配置文件调整

```bash
# 编辑 /etc/nginx/nginx.conf
cat > /etc/nginx/nginx.conf << 'EOF'
user nginx;

# worker 数设置为 CPU 核数
worker_processes auto;

# 提升文件句柄限制
worker_rlimit_nofile 65535;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 10240;    # 单 worker 最大连接数
    use epoll;                   # Linux 高性能 I/O 模型
    multi_accept on;             # 一次接受多个连接
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # 日志格式（含响应时间、upstream时间）
    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    'rt=$request_time upt="$upstream_response_time"';

    access_log /var/log/nginx/sjrcw/access.log main buffer=32k flush=5s;

    # 基础优化
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 1000;
    server_tokens off;

    # 请求体大小限制（与后端 BODY_PARSER_LIMIT 对齐）
    client_max_body_size 80m;
    client_body_buffer_size 16k;
    client_header_buffer_size 4k;

    # Gzip 压缩（对 JS/CSS/JSON 有显著效果）
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml
        font/woff
        font/woff2;

    # 限流区（防 DDoS / 暴力破解）
    # 全局 API 限流：每个 IP 每秒最多 20 个请求
    limit_req_zone $binary_remote_addr zone=api_limit:20m rate=20r/s;
    # 登录/注册接口独立限流：每个 IP 每秒最多 2 个请求
    limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=2r/s;

    # Upstream：3 个 PM2 进程（监听同一端口，PM2 Cluster 自动路由）
    upstream sjrcw_backend {
        # PM2 Cluster 模式下，所有进程共享端口 3000，Nginx 只需代理到该端口
        server 127.0.0.1:3000;
        keepalive 64;    # 保持长连接，减少 TCP 握手开销
    }

    include /etc/nginx/conf.d/*.conf;
}
EOF
```

### 4.2 站点配置文件

```bash
cat > /etc/nginx/conf.d/sjrcw.conf << 'EOF'
# ─── HTTP → HTTPS 重定向 ──────────────────────────────────────────────────
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Let's Encrypt 验证路径（certbot 使用）
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ─── HTTPS 主站 ──────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL 证书（Let's Encrypt 或阿里云 SSL 下载的证书）
    ssl_certificate     /etc/nginx/ssl/your-domain.com.pem;
    ssl_certificate_key /etc/nginx/ssl/your-domain.com.key;

    # SSL 优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # HSTS（启用后浏览器强制 HTTPS，谨慎操作）
    # add_header Strict-Transport-Security "max-age=63072000" always;

    # ── 静态资源：legacy-shengju 直接服务 ─────────────────────────────────
    root /opt/sjrcw/code;

    # legacy 人才网静态页面（直接服务，无需 Node.js 处理）
    location ^~ /legacy-shengju/ {
        alias /opt/sjrcw/code/legacy-shengju/;
        try_files $uri $uri/ =404;
        # 静态资源长缓存
        location ~* \.(js|css|png|jpg|gif|ico|woff|woff2|ttf|svg)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # 圣举人才网首页/前台页面（src/ 目录下的 HTML）
    location ^~ /src/ {
        alias /opt/sjrcw/code/src/;
        try_files $uri $uri/ =404;
        location ~* \.(js|css|png|jpg|gif|ico|woff|woff2)$ {
            expires 7d;
            add_header Cache-Control "public";
        }
    }

    # 人才网用户端页面（legacy 静态站）
    location ^~ /user/ {
        alias /opt/sjrcw/code/legacy-shengju/user/;
        try_files $uri $uri/ =404;
    }

    # 人才网管理端
    location ^~ /admin/ {
        alias /opt/sjrcw/code/legacy-shengju/admin/;
        try_files $uri $uri/ =404;
    }

    # 人才网企业端
    location ^~ /enterprise/ {
        alias /opt/sjrcw/code/legacy-shengju/enterprise/;
        try_files $uri $uri/ =404;
    }

    # ── 考试子系统 SPA（Vue 构建产物）────────────────────────────────────
    location ^~ /exam-admin {
        alias /opt/sjrcw/code/frontend/exam-admin/dist;
        try_files $uri $uri/ /exam-admin/index.html;
        location ~* \.(js|css|woff|woff2|png|jpg|svg|ico)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    location ^~ /exam-student {
        alias /opt/sjrcw/code/frontend/exam-student/dist;
        try_files $uri $uri/ /exam-student/index.html;
        location ~* \.(js|css|woff|woff2|png|jpg|svg|ico)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    location ^~ /exam-grader {
        alias /opt/sjrcw/code/frontend/exam-grader/dist;
        try_files $uri $uri/ /exam-grader/index.html;
        location ~* \.(js|css|woff|woff2|png|jpg|svg|ico)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    location ^~ /exam-super-admin {
        alias /opt/sjrcw/code/frontend/exam-super-admin/dist;
        try_files $uri $uri/ /exam-super-admin/index.html;
        location ~* \.(js|css|woff|woff2|png|jpg|svg|ico)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # ── 上传文件静态服务 ──────────────────────────────────────────────────
    location ^~ /uploads/ {
        alias /opt/sjrcw/uploads/;
        # 防止直接访问敏感文件
        location ~* \.(sh|env|js|py)$ { deny all; }
        expires 7d;
    }

    # ── WebSocket 代理（考试实时监控）─────────────────────────────────────
    location /ws/exam {
        proxy_pass http://sjrcw_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 长连接超时（考试可能持续 2-3 小时）
        proxy_read_timeout 7200s;
        proxy_send_timeout 7200s;
        proxy_connect_timeout 10s;

        # 不缓存 WebSocket
        proxy_buffering off;
    }

    # ── API 代理 ──────────────────────────────────────────────────────────
    # 认证接口：严格限流
    location ~ ^/api/(v1/)?(auth)/ {
        limit_req zone=auth_limit burst=5 nodelay;
        limit_req_status 429;

        proxy_pass http://sjrcw_backend;
        include /etc/nginx/conf.d/proxy_params.conf;
    }

    # 其他 API：普通限流
    location /api/ {
        limit_req zone=api_limit burst=50 nodelay;
        limit_req_status 429;

        proxy_pass http://sjrcw_backend;
        include /etc/nginx/conf.d/proxy_params.conf;
    }

    # ── 首页重定向 ───────────────────────────────────────────────────────
    location = / {
        return 301 /index.html;
    }

    location /index.html {
        root /opt/sjrcw/code/legacy-shengju;
        try_files $uri =404;
    }

    # ── 自定义错误页 ─────────────────────────────────────────────────────
    error_page 429 /429.html;
    location = /429.html {
        return 429 '{"code":429,"message":"请求过于频繁，请稍后重试"}';
        add_header Content-Type application/json;
    }

    error_page 502 503 504 /50x.html;
    location = /50x.html {
        return 503 '{"code":503,"message":"服务暂时不可用，请稍后重试"}';
        add_header Content-Type application/json;
    }
}
EOF
```

### 4.3 Proxy 公共参数

```bash
cat > /etc/nginx/conf.d/proxy_params.conf << 'EOF'
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

proxy_connect_timeout 10s;
proxy_read_timeout 60s;
proxy_send_timeout 60s;

proxy_buffer_size 16k;
proxy_buffers 4 64k;
proxy_busy_buffers_size 128k;

# 后端关闭连接时不报 502
proxy_next_upstream error timeout;
EOF
```

### 4.4 SSL 证书配置（Let's Encrypt）

```bash
# 安装 certbot
yum install -y certbot python3-certbot-nginx

# 申请证书（自动修改 Nginx 配置，推荐）
certbot --nginx -d your-domain.com -d www.your-domain.com

# 或手动申请并自己配置（更可控）
certbot certonly --webroot \
  -w /var/www/certbot \
  -d your-domain.com \
  -d www.your-domain.com

# 证书路径（自动生成）
# /etc/letsencrypt/live/your-domain.com/fullchain.pem
# /etc/letsencrypt/live/your-domain.com/privkey.pem

# 配置自动续期（cron）
echo "0 2 * * * root certbot renew --quiet --nginx" >> /etc/crontab

# 验证证书有效性
certbot certificates

# 阿里云 SSL 证书（下载后手动放置）
mkdir -p /etc/nginx/ssl
cp your-domain.com.pem /etc/nginx/ssl/
cp your-domain.com.key /etc/nginx/ssl/
chmod 600 /etc/nginx/ssl/*.key
```

### 4.5 Nginx 操作命令

```bash
# 测试配置语法
nginx -t

# 重载配置（不中断连接）
systemctl reload nginx
# 或
nginx -s reload

# 重启（中断当前连接）
systemctl restart nginx

# 查看实时访问日志
tail -f /var/log/nginx/sjrcw/access.log

# 分析慢请求（响应时间 > 2s 的请求）
awk '$NF > 2 {print $0}' /var/log/nginx/sjrcw/access.log | tail -50

# 统计接口 QPS
awk '{print $7}' /var/log/nginx/sjrcw/access.log | sort | uniq -c | sort -rn | head -20
```

---

## 5. Redis 配置

### 5.1 本地 Redis 配置

```bash
# 备份原始配置
cp /etc/redis/redis.conf /etc/redis/redis.conf.bak

# 修改关键参数
cat >> /etc/redis/redis.conf << 'EOF'

# ===== 圣举人才网 Redis 优化配置 =====

# 绑定本机（仅内网访问）
bind 127.0.0.1

# 端口
port 6379

# 设置密码（生产环境必须设置）
requirepass YOUR_REDIS_PASSWORD

# 最大内存限制（16G机器留 2G 给 Redis）
maxmemory 2gb

# 内存淘汰策略（缓存场景用 allkeys-lru）
maxmemory-policy allkeys-lru

# 持久化（禁用 RDB 快照，启用 AOF，适合缓存+Session）
save ""
appendonly yes
appendfsync everysec

# 最大连接数
maxclients 1000

# TCP keepalive（检测死连接）
tcp-keepalive 300

# 慢查询日志（超过 10ms 的命令记录）
slowlog-log-slower-than 10000
slowlog-max-len 128

# 关闭保护模式（已设置密码+bind时可关闭）
protected-mode no
EOF

# 重启 Redis 使配置生效
systemctl restart redis

# 验证
redis-cli -a YOUR_REDIS_PASSWORD ping
redis-cli -a YOUR_REDIS_PASSWORD info memory | grep used_memory_human
```

### 5.2 后端 Redis 接入验证

```bash
# 确认 .env 中 Redis 配置正确
grep REDIS /opt/sjrcw/code/backend/.env

# 手动测试连接
redis-cli -h 127.0.0.1 -p 6379 -a YOUR_REDIS_PASSWORD set test_key "hello"
redis-cli -h 127.0.0.1 -p 6379 -a YOUR_REDIS_PASSWORD get test_key
# 应输出: hello
```

---

## 6. MySQL 优化

### 6.1 关键参数调整

找到 MySQL 配置文件（通常 `/etc/my.cnf` 或 `/etc/mysql/my.cnf`）：

```bash
cat >> /etc/my.cnf << 'EOF'

[mysqld]
# ===== 圣举人才网 MySQL 优化配置 =====

# 字符集
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# InnoDB 缓冲池（设置为物理内存的 60-70%，16G机器设 8G）
innodb_buffer_pool_size = 8G
innodb_buffer_pool_instances = 4    # 每个实例 2G

# 最大连接数（与后端 DB_POOL_SIZE * PM2进程数 对齐）
# 3进程 * 50连接 = 150，留有余量设 300
max_connections = 300
max_connect_errors = 1000

# 连接等待超时
wait_timeout = 600
interactive_timeout = 600

# InnoDB 事务日志
innodb_log_file_size = 512M
innodb_log_buffer_size = 64M

# InnoDB IO 优化（SSD 盘推荐）
innodb_flush_log_at_trx_commit = 2    # 性能优先（非严格持久化）
innodb_io_capacity = 2000             # SSD IOPS 参考值
innodb_io_capacity_max = 4000

# 慢查询日志
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1        # 超过 1s 记录慢查询
log_queries_not_using_indexes = 1    # 记录未使用索引的查询

# 查询缓存（MySQL 8.x 已移除，此行跳过）
# query_cache_type = 0

# 临时表大小
tmp_table_size = 256M
max_heap_table_size = 256M

# 二进制日志（如需主从复制）
# log_bin = /var/log/mysql/binlog
# binlog_format = ROW
# expire_logs_days = 7
EOF

# 重启 MySQL
systemctl restart mysqld

# 验证缓冲池大小
mysql -u root -p -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size';"
```

### 6.2 建索引 SQL

```sql
-- 在 MySQL 中执行（建议在低峰期执行，大表添加索引耗时较长）
USE question_management_shared;

-- 1. 用户表：手机号索引（注册/登录/短信验证高频查询）
CREATE INDEX IF NOT EXISTS idx_qms_users_phone
  ON qms_users (phone)
  COMMENT '手机号登录/注册查重';

-- 2. 用户表：用户名索引（登录查询）
CREATE INDEX IF NOT EXISTS idx_qms_users_username
  ON qms_users (username)
  COMMENT '用户名登录';

-- 3. 考试会话表：考生+考试联合索引（断线续考、进度查询）
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user_exam
  ON exam_sessions (user_id, exam_id, status)
  COMMENT '考生-考试会话联合查询';

-- 4. 消息通知表：用户+已读状态索引（消息中心高频查询）
-- 注意：如果 notifications 表不存在，请先确认表名
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications (user_id, is_read, created_at)
  COMMENT '消息中心未读消息查询';

-- 5. 报名表：考试+状态索引（考试报名统计）
CREATE INDEX IF NOT EXISTS idx_exam_enrollments_exam_status
  ON exam_enrollments (exam_id, status, created_at)
  COMMENT '考试报名状态统计';

-- 执行完毕，检查索引
SHOW INDEX FROM qms_users;
SHOW INDEX FROM exam_sessions;
SHOW INDEX FROM exam_enrollments;
```

---

## 7. 系统调优

### 7.1 Linux 内核参数

```bash
# 编辑 /etc/sysctl.conf
cat >> /etc/sysctl.conf << 'EOF'

# ===== 圣举人才网 内核参数优化 =====

# 网络连接队列
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# TIME_WAIT 优化（高并发场景减少端口耗尽）
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15

# 扩大本地端口范围
net.ipv4.ip_local_port_range = 1024 65535

# TCP keepalive 优化
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 3
net.ipv4.tcp_keepalive_intvl = 30

# 文件系统 inotify（PM2 使用）
fs.inotify.max_user_watches = 524288

# 虚拟内存
vm.swappiness = 10               # 减少 swap 使用（数据库服务器）
vm.dirty_ratio = 20
vm.dirty_background_ratio = 5

# 最大文件描述符数
fs.file-max = 1000000
EOF

# 立即生效（无需重启）
sysctl -p

# 验证
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_max_syn_backlog
```

### 7.2 文件句柄限制

```bash
# 系统级限制
cat >> /etc/security/limits.conf << 'EOF'

# ===== 圣举人才网 文件句柄配置 =====
*       soft    nofile  65535
*       hard    nofile  65535
root    soft    nofile  65535
root    hard    nofile  65535

# 进程数限制（防止 fork bomb）
*       soft    nproc   65535
*       hard    nproc   65535
EOF

# systemd 服务级别限制（对 PM2/Nginx 生效）
mkdir -p /etc/systemd/system/nginx.service.d/
cat > /etc/systemd/system/nginx.service.d/limits.conf << 'EOF'
[Service]
LimitNOFILE=65535
EOF

mkdir -p /etc/systemd/system/redis.service.d/
cat > /etc/systemd/system/redis.service.d/limits.conf << 'EOF'
[Service]
LimitNOFILE=65535
EOF

# 重载 systemd 配置
systemctl daemon-reload
systemctl restart nginx
systemctl restart redis

# 验证当前进程的文件句柄限制
cat /proc/$(pgrep nginx | head -1)/limits | grep "open files"
```

### 7.3 Node.js 进程内存设置

`ecosystem.config.js` 中已配置 `node_args: '--max-old-space-size=1400'`。

额外调优建议：

```bash
# 查看当前 PM2 进程内存
pm2 list

# 若单进程内存持续增长（内存泄漏），设置自动重启阈值
# 在 ecosystem.config.js 中已配置 max_memory_restart: '1500M'

# Node.js GC 优化（可在 node_args 中追加）
# --optimize-for-size          # 内存敏感场景
# --gc-interval=100            # GC 频率
```

---

## 8. 监控与告警

### 8.1 PM2 监控命令

```bash
# 实时监控面板（CPU/内存/日志）
pm2 monit

# 查看所有进程状态和资源
pm2 list

# 查看详细信息
pm2 describe sjrcw-api

# 实时查看日志（合并所有进程）
pm2 logs sjrcw-api --lines 100

# 只看错误日志
pm2 logs sjrcw-api --err

# 清空日志
pm2 flush sjrcw-api

# 导出统计数据（用于外部监控系统）
pm2 prettylist
```

### 8.2 Shell 健康检查脚本

```bash
# 创建健康检查脚本
cat > /opt/sjrcw/scripts/health-check.sh << 'HEALTH_SCRIPT'
#!/bin/bash

API_URL="http://localhost:3000/api/v1/health"
THRESHOLD_MS=2000      # 响应时间告警阈值（ms）
LOG_FILE="/opt/sjrcw/logs/health-check.log"
MAX_LOG_LINES=10000

# 执行健康检查
start_time=$(date +%s%3N)
response=$(curl -s -o /tmp/health_response -w "%{http_code}" \
  --connect-timeout 5 \
  --max-time 10 \
  "$API_URL" 2>/dev/null)
end_time=$(date +%s%3N)
duration=$((end_time - start_time))
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$response" = "200" ]; then
    status="OK"
    if [ "$duration" -gt "$THRESHOLD_MS" ]; then
        status="SLOW"
        echo "[$timestamp] ⚠ SLOW: ${duration}ms (阈值${THRESHOLD_MS}ms)" >> "$LOG_FILE"
    fi
else
    status="FAIL"
    echo "[$timestamp] ❌ FAIL: HTTP $response, ${duration}ms" >> "$LOG_FILE"

    # 告警：PM2 进程数检查
    pm2_count=$(pm2 list | grep -c "online" 2>/dev/null || echo 0)
    echo "[$timestamp] PM2 online进程数: $pm2_count" >> "$LOG_FILE"

    # 若进程数为0，尝试重启
    if [ "$pm2_count" -eq 0 ]; then
        echo "[$timestamp] 尝试重启 PM2..." >> "$LOG_FILE"
        pm2 start /opt/sjrcw/code/ecosystem.config.js >> "$LOG_FILE" 2>&1
    fi
fi

# 输出到标准日志
echo "[$timestamp] $status ${duration}ms HTTP:$response"

# 限制日志文件大小
if [ "$(wc -l < "$LOG_FILE" 2>/dev/null)" -gt "$MAX_LOG_LINES" ]; then
    tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
HEALTH_SCRIPT
chmod +x /opt/sjrcw/scripts/health-check.sh

# 配置 cron（每分钟执行一次）
(crontab -l 2>/dev/null; echo "* * * * * /opt/sjrcw/scripts/health-check.sh >> /opt/sjrcw/logs/cron-health.log 2>&1") | crontab -

# 验证 cron 已添加
crontab -l | grep health-check
```

### 8.3 系统资源监控脚本

```bash
cat > /opt/sjrcw/scripts/resource-monitor.sh << 'RESOURCE_SCRIPT'
#!/bin/bash

LOG_FILE="/opt/sjrcw/logs/resource-monitor.log"
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

# CPU 使用率
cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | tr -d '%us,')

# 内存使用率
mem_info=$(free -m | grep Mem)
mem_total=$(echo $mem_info | awk '{print $2}')
mem_used=$(echo $mem_info | awk '{print $3}')
mem_percent=$(echo "scale=1; $mem_used * 100 / $mem_total" | bc)

# 磁盘使用率
disk_percent=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')

# PM2 进程内存（仅第一个进程）
pm2_mem=$(pm2 prettylist 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    total = sum(p.get('pm2_env', {}).get('monit', {}).get('memory', 0) for p in data)
    print(f'{total // 1024 // 1024}MB')
except: print('N/A')
" 2>/dev/null || echo "N/A")

# MySQL 连接数
mysql_conn=$(mysql -u root -p"$DB_PASSWORD" -e "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null | awk 'NR==2{print $2}' || echo "N/A")

echo "[$timestamp] CPU:${cpu_usage}% MEM:${mem_percent}% DISK:${disk_percent}% PM2:${pm2_mem} MySQL:${mysql_conn}conn" >> "$LOG_FILE"

# 告警阈值检查
if [ "${disk_percent}" -gt 85 ]; then
    echo "[$timestamp] ⚠ 磁盘使用率 ${disk_percent}%，请清理日志或扩容" >> "$LOG_FILE"
fi
RESOURCE_SCRIPT
chmod +x /opt/sjrcw/scripts/resource-monitor.sh

# 每 5 分钟采集一次
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/sjrcw/scripts/resource-monitor.sh") | crontab -
```

---

## 9. 上线验证 Checklist

### 9.1 健康检查 URL 列表

| URL | 预期结果 | 说明 |
|-----|---------|------|
| `GET /api/v1/health` | HTTP 200 | 后端服务存活 |
| `GET /index.html` | HTTP 200 | 首页可访问 |
| `GET /user/login.html` | HTTP 200 | 登录页可访问 |
| `GET /exam-admin/` | HTTP 200 | 企业端 SPA |
| `GET /exam-student/` | HTTP 200 | 考生端 SPA |
| `GET /exam-grader/` | HTTP 200 | 阅卷端 SPA |
| `GET /exam-super-admin/` | HTTP 200 | 总管理端 SPA |

### 9.2 冒烟测试命令（curl）

```bash
#!/bin/bash
# 将 YOUR_DOMAIN 替换为实际域名或 IP
BASE_URL="https://your-domain.com"
# 本地测试时用：BASE_URL="http://localhost:3000"

echo "=== 圣举人才网 上线冒烟测试 ==="
echo ""

# 1. 健康检查
echo "[1/8] 健康检查..."
curl -s -o /dev/null -w "  健康检查: HTTP %{http_code} (耗时 %{time_total}s)\n" \
  "$BASE_URL/api/v1/health"

# 2. 首页
echo "[2/8] 首页..."
curl -s -o /dev/null -w "  首页: HTTP %{http_code} (耗时 %{time_total}s)\n" \
  "$BASE_URL/index.html"

# 3. 登录页
echo "[3/8] 登录页..."
curl -s -o /dev/null -w "  登录页: HTTP %{http_code} (耗时 %{time_total}s)\n" \
  "$BASE_URL/user/login.html"

# 4. 注册接口（测试账号）
echo "[4/8] 注册接口..."
REG_RESULT=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST "$BASE_URL/api/v1/auth/register-self" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "smoke_test_'$(date +%s)'",
    "password": "Load@Test2026!",
    "email": "smoke_test_'$(date +%s)'@test.internal",
    "realName": "冒烟测试",
    "userType": "jobseeker"
  }')
REG_CODE=$(echo "$REG_RESULT" | grep "HTTP_CODE:" | cut -d: -f2)
echo "  注册接口: HTTP $REG_CODE"

# 5. 岗位列表
echo "[5/8] 岗位列表..."
curl -s -o /dev/null -w "  岗位列表: HTTP %{http_code} (耗时 %{time_total}s)\n" \
  "$BASE_URL/api/v1/jobs?page=1&pageSize=10"

# 6. 公告列表
echo "[6/8] 公告列表..."
curl -s -o /dev/null -w "  公告列表: HTTP %{http_code} (耗时 %{time_total}s)\n" \
  "$BASE_URL/api/v1/announcements?page=1&pageSize=10"

# 7. 考生端 SPA
echo "[7/8] 考生端 SPA..."
curl -s -o /dev/null -w "  考生端: HTTP %{http_code} (耗时 %{time_total}s)\n" \
  "$BASE_URL/exam-student/"

# 8. WebSocket（检查 Upgrade 头）
echo "[8/8] WebSocket 端点..."
WS_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  "$BASE_URL/ws/exam" 2>/dev/null)
if [ "$WS_RESULT" = "101" ] || [ "$WS_RESULT" = "400" ]; then
  echo "  WebSocket: 端点可达 (HTTP $WS_RESULT)"
else
  echo "  WebSocket: HTTP $WS_RESULT（可能需要完整握手）"
fi

echo ""
echo "=== 冒烟测试完成 ==="
```

### 9.3 PM2 进程状态验证

```bash
# 检查所有进程是否在线
pm2 status

# 预期输出示例：
# ┌─────┬──────────────┬─────────────┬──────┬───────────┬──────────┬──────────┐
# │ id  │ name         │ namespace   │ mode │ pid       │ status   │ cpu      │
# ├─────┼──────────────┼─────────────┼──────┼───────────┼──────────┼──────────┤
# │ 0   │ sjrcw-api    │ default     │ cluster │ 12345 │ online   │ 0%       │
# │ 1   │ sjrcw-api    │ default     │ cluster │ 12346 │ online   │ 0%       │
# │ 2   │ sjrcw-api    │ default     │ cluster │ 12347 │ online   │ 0%       │
# └─────┴──────────────┴─────────────┴──────┴───────────┴──────────┴──────────┘

# 确认无错误日志
pm2 logs sjrcw-api --err --lines 50

# 检查重启次数（正常应为 0）
pm2 describe sjrcw-api | grep "↺"

# 验证 Nginx 配置并重载
nginx -t && systemctl reload nginx

# 检查端口监听
ss -tlnp | grep -E '80|443|3000|6379'
# 预期：nginx 监听 80/443，node 监听 3000，redis 监听 6379

# 查看最新错误日志
tail -n 100 /opt/sjrcw/logs/sjrcw-err.log
tail -n 100 /var/log/nginx/error.log
```

### 9.4 性能基线验证

```bash
# 在服务器本地执行简单性能测试（需安装 ab 或 wrk）
# 安装 wrk
yum install -y wrk  # 或 apt install wrk

# 30秒，100并发，测试健康接口（热身）
wrk -t4 -c100 -d30s http://localhost:3000/api/v1/health

# 测试首页静态资源
wrk -t4 -c100 -d30s http://localhost:3000/index.html

# 预期基线指标（4C/16G 机器）：
# 健康接口:    QPS > 5000，P99 < 50ms
# 静态 HTML:   QPS > 10000（Nginx 直接服务），P99 < 20ms
# 登录接口:    QPS > 200，P99 < 500ms（受 DB + bcrypt 限制）
```

---

## 附录：快速命令速查

```bash
# 启动全部服务
systemctl start nginx redis mysqld
pm2 start /opt/sjrcw/code/ecosystem.config.js
pm2 save

# 平滑重启（代码更新后）
/opt/sjrcw/deploy.sh

# 查看所有日志
pm2 logs                          # Node.js 日志
tail -f /var/log/nginx/sjrcw/access.log  # Nginx 访问日志
tail -f /var/log/nginx/error.log         # Nginx 错误日志
tail -f /opt/sjrcw/logs/sjrcw-err.log   # Node.js 错误日志
tail -f /opt/sjrcw/logs/health-check.log # 健康检查日志

# 资源检查
pm2 monit                         # PM2 实时监控
htop                              # 系统资源（需 yum install htop）
iostat -x 1 5                     # 磁盘 I/O
ss -s                             # TCP 连接统计

# 清理测试账号
mysql -u root -p question_management_shared \
  -e "DELETE FROM qms_users WHERE username LIKE 'loadtest_%';"
```

---

*文档版本：v1.0 | 最后更新：2026-06-10 | 适用：圣举人才网考试测评系统*
