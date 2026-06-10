# 笔试系统本地一体包（Docker）

目标：把**运行环境（Node + MySQL）**与**应用代码**用 Docker 固定下来；数据库内容通过 **SQL 导出文件**随包分发或自行从服务器导出。适合「换一台 Windows/Mac 机器，几步就能跑起来」。

## 你需要事先安装

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/)（含 Docker Compose v2），安装后重启一次电脑。
2. 本仓库在磁盘上的完整源码（含 `backend/`、`frontend/`）。

## 第一次使用（推荐流程）

### 1）构建前端静态资源（在仓库根目录执行）

后端会把 `frontend/*/dist` 一并打进镜像并在同一端口提供页面，因此**构建镜像前**需要先打包前端：

```bash
cd 仓库根目录
npm run build:all-exam-frontends
```

若未装根依赖，可先：`npm install`，再执行上面一条。

### 2）准备本地环境变量

```bash
cd deploy/local-docker
copy .env.example .env
```

（Mac/Linux 用 `cp .env.example .env`）按需编辑 `.env`，至少把 `JWT_SECRET` 改成随机字符串。

### 3）准备数据库（二选一）

**A. 带服务器真实数据（推荐用于验收/演示）**

在服务器上用 `mysqldump` 导出主库、人才网库（库名与线上一致，常见为 `question_management_shared`、`shengju`），把 SQL 文件放到 `deploy/local-docker/initdb/`，命名需晚于 `00-`，例如：

- `01-main.sql`
- `02-shengju.sql`

详见 `initdb/README.txt`。  
**注意**：MySQL 数据卷**只在第一次创建**时执行 `initdb`；若曾启动过要重来，需执行 `docker compose down -v` 再 `up`（会删本地库数据）。

**B. 空库开发**

不放业务 dump，仅依赖 `00-create-shengju-db.sql` 创建空库。首次跑起来后，需自行执行库表迁移、造数据（可用后端已有 migration 脚本或管理端功能，视你们环境而定）。

### 4）启动

在 `deploy/local-docker` 目录：

```bash
docker compose up --build
```

浏览器访问：

- 接口健康检查：`http://localhost:3000/health`
- 企业笔试管理（若已 build）：`http://localhost:3000/exam-admin/`
- 考生端：`http://localhost:3000/exam-student/`

端口可在 `.env` 里改 `EXAM_API_PORT`、`MYSQL_PUBLISH_PORT`。

### 5）Windows 一键脚本（可选）

在 `deploy/local-docker` 下双击或在 PowerShell 执行：

```powershell
.\start-local.ps1
```

会自动把 `.env.example` 复制为 `.env`（若不存在），再 `docker compose up --build`。

## 把整个目录打成 zip 给别人

1. 在**任意能构建前端**的机器上执行 `npm run build:all-exam-frontends`。
2. 不要打进 zip：`**/node_modules`、`**/dist` 以外的可删——**建议保留 dist**（否则对方还要再 build）。
3. 包含：`backend/`、`frontend/`（含各子应用 `dist`）、`deploy/local-docker/`、以及你放在 `initdb/` 的 SQL。
4. 对方安装 Docker Desktop 后，解压 → 按上文步骤 2～4 操作。

说明：Docker 镜像在对方机器首次 `compose up` 时会本地构建，**无需**把镜像文件一起传（除非你们用私有镜像仓库另说）。

## 服务器上导出数据库（示例命令）

在服务器 MySQL 可访问的机器上（库名按实际修改）：

```bash
mysqldump -h127.0.0.1 -uroot -p --single-transaction --routines --triggers question_management_shared > main.sql
mysqldump -h127.0.0.1 -uroot -p --single-transaction --routines --triggers shengju > shengju.sql
```

将生成的 `main.sql` / `shengju.sql` 按 `initdb/README.txt` 命名放入 `initdb/` 即可。

## 限制说明（心里有数）

- 镜像内已设置 `PUPPETEER_SKIP_DOWNLOAD=true`，**依赖 Chromium 的导出/截图**在默认镜像里可能不可用；需要时去掉 Dockerfile 中该行并重建镜像，或自行安装浏览器依赖。
- `uploads`、监考视频等大文件建议单独 rsync/拷贝，不必塞进 SQL；本 compose 已用卷挂载 `backend/uploads` 持久化容器内上传。
- 人才网其它站点、短信、阿里云、微信支付等**外部依赖**仍要在 `.env` 配置或接受本地不可用（与线上一致需自行接服务）。

## 常用命令

```bash
# 后台运行
docker compose up -d --build

# 查看日志
docker compose logs -f exam-api

# 停掉并删除数据卷（慎用）
docker compose down -v
```
