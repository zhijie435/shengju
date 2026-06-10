# 圣举人才网 — 考试测评系统

> 在线考试 + 面试 + 阅卷 + AI 评估报告一体化平台，支持 **约 2000 人并发**在线笔试。

---

## 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| **后端** | Node.js (v22) + Express 4 | 主服务 `backend/server.js`，单进程承载 |
| **数据库** | MySQL 8.x (mysql2) | 双库：`question_management_shared`（主库）+ `shengju`（人才网） |
| **前端** | Vue 3 + Vite 5 + Element Plus 2 | 4 个独立 SPA 子应用 |
| **桌面端** | Tauri 1.5 (Rust) | 试题管理系统桌面应用，内嵌 WebView |
| **实时通信** | WebSocket (ws) | 考试监控：心跳、违规事件、截图推送 |
| **AI** | DeepSeek Chat API | 自动生成考生评估报告 |
| **短信** | 阿里云短信 (POP SDK) | 验证码、业务通知 |
| **人脸识别** | 阿里云视觉智能 (Facebody CompareFace) | 考生 1:1 人脸核验 |
| **支付** | 微信支付 APIv3 (JSAPI/Native) | 测评缴费 |
| **文档处理** | mammoth + cheerio + canvas + Puppeteer | Word/HTML/公式解析与导出 |
| **PDF 导出** | Puppeteer + html2pdf.js | 评估报告、试卷 PDF 生成 |

---

## 项目结构

```
code/
├── backend/                    # 后端服务（Express + MySQL）
│   ├── server.js               # 主入口（1037行），统一挂载所有路由与静态服务
│   ├── routes/                 # 24 个路由模块
│   │   ├── auth.js             # 认证（登录/注册/短信/OAuth）
│   │   ├── questions.js        # 试题 CRUD
│   │   ├── questionBank.js     # 题库管理（Word 导入、分类、搜索）
│   │   ├── examPapers.js       # 试卷管理
│   │   ├── exams.js            # 考试管理（创建/配置/发布）
│   │   ├── examEnrollments.js  # 考生报名（批次导入、缴费）
│   │   ├── examSessions.js     # 考试会话（作答进度、防作弊断线续考）
│   │   ├── examAnswers.js      # 客观题/主观题答案提交与存储
│   │   ├── examMonitor.js      # 监控数据 API（违规事件、截图查询）
│   │   ├── grading.js          # 阅卷（主观题评分、争议处理）
│   │   ├── gradingAccounts.js  # 子阅卷账号管理
│   │   ├── gradingTasks.js     # 阅卷任务分发
│   │   ├── examSummaries.js    # 考试汇总统计
│   │   ├── evaluationReports.js # AI 评估报告
│   │   ├── interview.js        # 面试系统（139KB，最大模块）
│   │   ├── examImports.js      # 考生批次导入
│   │   ├── examInvitations.js  # 考试邀请与通知
│   │   ├── examEnterprise.js   # 对外企业汇总接口（API Key 鉴权）
│   │   ├── enterprises.js      # 企业管理（多租户、认证）
│   │   ├── users.js            # 用户管理
│   │   ├── wechatPayAssessment.js # 微信支付
│   │   ├── talentSiteCompat.js # 人才网 legacy 兼容层（350KB）
│   │   ├── adminCompat.js      # 管理端兼容层
│   │   └── export.js           # 数据导出
│   ├── models/                 # 17 个数据模型
│   │   ├── userModel.js        # 用户（qms_users，含角色/权限/准考证号登录）
│   │   ├── questionModel.js    # 试题
│   │   ├── questionBankModel.js # 题库（60KB，含动态表管理）
│   │   ├── examPaperModel.js   # 试卷（38KB，含动态分表）
│   │   ├── examModel.js        # 考试
│   │   ├── examSessionModel.js # 考试会话
│   │   ├── examEnrollmentModel.js # 报名
│   │   ├── examAnswerModel.js  # 答案
│   │   ├── examSummaryModel.js # 统计汇总
│   │   ├── examEvaluationReportModel.js # 评估报告
│   │   ├── examMonitorEventModel.js # 监控事件
│   │   ├── examAudioRecordingModel.js # 面试录音
│   │   ├── examVideoChunkModel.js # 面试视频
│   │   ├── gradingAccountModel.js # 阅卷账号
│   │   ├── enterpriseModel.js  # 企业
│   │   └── questionBankTableManager.js # 题库动态分表
│   ├── services/               # 11 个业务服务
│   │   ├── examWebSocket.js    # WebSocket 实时监控（心跳/违规/截图广播）
│   │   ├── aiService.js        # DeepSeek AI 评估报告生成
│   │   ├── gradingService.js   # 阅卷逻辑
│   │   ├── evaluationReportService.js # 评估报告服务
│   │   ├── examSummaryService.js # 考试汇总
│   │   ├── aliyunSms.js        # 阿里云短信
│   │   ├── faceIdCompare.js    # 阿里云人脸 1:1 比对
│   │   ├── wechatPayV3Assessment.js # 微信支付 APIv3
│   │   ├── databaseManager.js  # 数据库管理
│   │   ├── questionBankService.js # 题库业务
│   │   └── gradingTaskListHelper.js # 阅卷任务辅助
│   ├── middleware/
│   │   └── auth.js             # JWT 认证中间件（role: admin/enterprise/grader/jobseeker）
│   ├── config/database.js      # MySQL 连接池（主库 50 连接 + 人才网库 10 连接）
│   ├── database/               # 49 个 SQL 迁移脚本
│   ├── scripts/                # 37 个运维/迁移/诊断脚本
│   ├── uploads/                # 上传文件（视频/音频/Word/Excel）
│   └── .env                    # 环境变量（端口/数据库/AI/短信/支付）
│
├── frontend/                   # 前端子应用（各自独立 node_modules）
│   ├── exam-admin/             # 企业端（考试管理） — port 5174
│   ├── exam-student/           # 考生端（在线笔试） — port 5176
│   ├── exam-grader/            # 子阅卷端 — port 5177
│   ├── exam-super-admin/       # 总管理端 — port 5178
│   └── exam-enterprise/        # 企业门户（仅 src，无 node_modules）
│
├── src/                        # Tauri 桌面应用前端（HTML/JS）
│   ├── index.html              # 首页
│   ├── app.html                # 主应用页面（152KB，试题管理桌面端）
│   ├── admin.html              # 管理页面
│   ├── 题库管理.html            # 题库管理页面（102KB）
│   ├── assets/                 # 静态资源
│   └── js/                     # 前端 JS（auth/api/admin/tauri-backend）
│
├── src-tauri/                  # Tauri Rust 后端
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # 窗口 1400x900，权限：fs/dialog/http/shell
│   └── src/main.rs             # Rust 入口
│
├── legacy-shengju/             # 圣举人才网静态站（legacy）
├── deploy/
│   ├── local-docker/           # Docker Compose 本地部署（MySQL + Node）
│   ├── remote-deploy.sh        # 远程部署脚本
│   └── upload-and-deploy.ps1   # Windows 上传部署
├── libs/                       # 前端库（FileSaver/HTML2PDF/Font-Awesome）
├── WXCertUtil/                 # 微信证书工具
└── scripts/                    # 项目级脚本
```

---

## 核心功能模块

### 1. 试题管理系统（桌面端）
- **技术**: Tauri (Rust) + 原生 WebView
- **入口**: `src/app.html` → `http://localhost:3000/src/app.html`
- **功能**: 试题录入（Word 导入/公式解析）、分类管理、题库搜索、试卷组卷

### 2. 在线笔试系统
- **考生端**: `exam-student` — 在线作答、断线续考、切屏检测、摄像头监控
- **监控**: WebSocket 实时推送心跳/违规事件/截图到企业端
- **防作弊**: 页面失焦检测、切屏记录、定时截图上传、人脸核验

### 3. 阅卷系统
- **子账号体系**: 企业可创建阅卷子账号，分发阅卷任务
- **双评机制**: 支持主观题多人阅卷，取平均值或仲裁
- **客观题自动评分**: 与标准答案比对

### 4. 面试系统
- **多阶段面试**: 初试/复试/终试，支持独立配置
- **录音录像**: 音频分片上传、视频分块录制
- **面试评分表**: 自定义评分维度 (interview_rubrics)
- **签到机制**: 抽签/顺序叫号/自助签到

### 5. AI 评估报告
- **模型**: DeepSeek Chat API
- **输出**: 岗位适配度、能力画像、录用建议
- **触发**: 考试结束后自动生成，可手动重新生成

### 6. 企业管理（多租户）
- 企业注册/认证/审核流程
- 企业独立数据隔离（enterprise_id）
- 人才网 legacy 兼容（shengju DB 双向同步）

### 7. 微信支付
- 公众号 JSAPI 支付 + Native 扫码支付
- 测评缴费设置、订单管理
- OAuth 回调获取 openid

---

## 数据库架构

| 数据库 | 用途 |
|--------|------|
| `question_management_shared` | 主库：用户、企业、题库、试卷、考试、报名、会话、答案、阅卷、面试、评估报告 |
| `shengju` | 人才网库：legacy 人才网数据（企业/候选人/项目/岗位/合作），按批次导入到主库 |

**关键表**：`qms_users`（用户）、`enterprises`（企业）、`question_bank_*`（动态分表题库）、`exam_paper_*`（动态分表试卷）、`exam_sessions`（考试会话）、`exam_enrollments`（报名）、`exam_summaries`（汇总）、`grading_accounts`（阅卷账号）、`interview_rubrics`（面试评分维度）

---

## 本地开发部署

### 前置条件
- Node.js v22+
- Docker Desktop（运行 MySQL 容器）
- Rust（仅桌面端需要）

### 快速启动（macOS）

```bash
# ========== 1. 启动 MySQL（Docker）==========
# 项目依赖 Docker 容器提供 MySQL 服务（不安装本机 MySQL）
# 已有 yuexingzu-mysql 容器（端口 3306，root 密码 yuexingzu）
docker ps | grep mysql  # 确认容器运行中

# 如需新装：
# docker run -d --name project-mysql -p 3306:3306 \
#   -e MYSQL_ROOT_PASSWORD=yourpassword \
#   -e TZ=Asia/Shanghai \
#   mysql:8.0

# ========== 2. 创建数据库 ==========
mysql -u root -p -h 127.0.0.1 -P 3306 -e "
CREATE DATABASE IF NOT EXISTS question_management_shared
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS shengju
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
"

# ========== 3. 配置环境变量 ==========
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入 DB_PASSWORD、JWT_SECRET 等

# ========== 4. 安装后端依赖 ==========
cd backend && npm install && cd ..

# ⚠️ 如果 node_modules 是从 Windows 复制过来的，需要重建原生模块：
# cd backend
# rm -rf node_modules/bcrypt && npm install bcrypt
# npm rebuild canvas sharp

# ========== 5. 构建前端资源 ==========
# 安装各前端依赖（首次）
cd frontend/exam-admin && npm install && cd ../..
cd frontend/exam-student && npm install && cd ../..
cd frontend/exam-grader && npm install && cd ../..
cd frontend/exam-super-admin && npm install && cd ../..

# 打包前端
npm run build:all-exam-frontends

# ========== 6. 启动后端 ==========
cd backend && node server.js
# 服务器自动完成数据库表迁移
```

访问地址：
- **圣举人才网首页**：`http://localhost:3000/index.html`
- **人才网管理端**：`http://localhost:3000/admin/login.html`
- **人才网企业端**：`http://localhost:3000/enterprise/login.html`
- **人才网求职者端**：`http://localhost:3000/user/login.html`
- **考试-企业端**：`http://localhost:3000/exam-admin`
- **考试-考生端**：`http://localhost:3000/exam-student`
- **考试-阅卷端**：`http://localhost:3000/exam-grader`
- **考试-总管理端**：`http://localhost:3000/exam-super-admin`
- **试题管理桌面端**：`http://localhost:3000/src/app.html`
- **健康检查**：`http://localhost:3000/api/v1/health`
- **API 根路径**：`http://localhost:3000/api`

### 前端开发模式（HMR）

```bash
# 分别启动各前端 dev server
cd frontend/exam-admin && npm run dev     # http://localhost:5174
cd frontend/exam-student && npm run dev   # http://localhost:5176
cd frontend/exam-grader && npm run dev    # http://localhost:5177
cd frontend/exam-super-admin && npm run dev # http://localhost:5178
```

开发模式下各前端需在各自目录创建 `.env` 文件设置 `VITE_API_PORT=3000` 指向后端。

### Docker 部署

```bash
# 详见 deploy/local-docker/README.md
cd deploy/local-docker
cp .env.example .env
docker compose up --build
```

### 生产部署

详见 `考试子系统-生产部署说明.md`：
- 后端 PM2 进程管理
- Nginx 反代 + 静态文件 aliasing
- 4 个子系统 SPA 路径前缀：`/exam-admin/` `/exam-student/` `/exam-grader/` `/exam-super-admin/`

---

## API 路由结构

所有 API 同时注册 `/api` 和 `/api/v1` 双路径前缀以保证兼容性。

| 路由 | 模块 | 说明 |
|------|------|------|
| `/api/auth` | 认证 | 登录/注册/短信验证码/微信 OAuth |
| `/api/users` | 用户 | 个人信息、权限管理 |
| `/api/questions` | 试题 | CRUD、Word 上传解析 |
| `/api/question-bank` | 题库 | 分类、搜索、批量导入 |
| `/api/exam-papers` | 试卷 | 组卷、共享、版本管理 |
| `/api/exams` | 考试 | 创建/配置/发布/答题系统设置 |
| `/api/exam-enrollments` | 报名 | 批次导入、缴费状态 |
| `/api/exam-sessions` | 会话 | 作答进度、断线续考 |
| `/api/exam-answers` | 答案 | 提交/自动评分 |
| `/api/exam-monitor` | 监控 | 违规事件/截图查询 |
| `/api/grading-accounts` | 阅卷账号 | 子账号 CRUD |
| `/api/grading*` | 阅卷 | 任务分发、主观题评分 |
| `/api/exam-summaries` | 汇总 | 考试统计 |
| `/api/evaluation-reports` | 评估 | AI 报告生成与查询 |
| `/api/interview` | 面试 | 全流程管理 |
| `/api/exam-imports` | 导入 | 考生批次导入 |
| `/api/exam-invitations` | 邀请 | 考试邀请+通知 |
| `/api/exam-enterprise` | 外部接口 | API Key 鉴权的企业汇总 |
| `/api/enterprises` | 企业 | 多租户管理 |
| `/api/pay/wechat` | 支付 | 微信支付（JSAPI/Native） |
| `ws://host:3000/ws/exam` | WebSocket | 考试实时监控 |

---

## 环境变量（backend/.env 关键配置）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 后端端口 | 3000 |
| `DB_HOST/DB_USER/DB_PASSWORD` | MySQL 连接 | localhost/root/— |
| `MAIN_DB_NAME` | 主库名 | question_management_shared |
| `SHENGJU_DB_NAME` | 人才网库名 | shengju |
| `JWT_SECRET` | JWT 密钥 | —（生产务必修改） |
| `DEEPSEEK_API_KEY` | DeepSeek AI | — |
| `ALIYUN_SMS_*` | 阿里云短信 | — |
| `ALIYUN_VIAPI_*` | 阿里云人脸比对 | — |
| `WECHAT_PAY_*` | 微信支付 | — |
| `RATE_LIMIT_*` | API 限流 | 15min/600次每IP |
| `DB_POOL_SIZE` | 主库连接池大小 | 50 |
| `BODY_PARSER_LIMIT` | 请求体大小限制 | 80mb |

---

## 角色权限体系

| 角色 | 标识 | 权限范围 |
|------|------|----------|
| 超级管理员 | `admin` | 全平台管理、企业审核、数据统计 |
| 企业管理员 | `enterprise` | 考试管理、题库、阅卷、面试、支付 |
| 阅卷员 | `grader` | 阅卷任务执行 |
| 求职者/考生 | `jobseeker` | 参加考试、查看成绩报告 |

JWT Token 有效期 7 天，支持 `portal` 字段区分登录门户防止权限提升。

---

## 命令行参考

```bash
# 后端
npm run backend:start          # 启动后端
npm run backend:dev            # 开发模式（nodemon 热重载）

# 前端构建
npm run build:all-exam-frontends   # 打包全部前端
npm run build:exam                 # 打包总管理端
npm run build:exam-admin           # 打包企业端
npm run build:exam-student         # 打包考生端
npm run build:grader               # 打包阅卷端

# 数据库迁移
npm run migrate:online-exam       # 笔试系统表初始化
npm run migrate:exam-papers       # 试卷表迁移
npm run migrate:grading           # 阅卷系统表迁移
npm run migrate:users-candidate   # 用户候选人字段迁移

# Tauri 桌面端
npm run tauri:dev                  # 开发模式
npm run tauri:build                # 构建桌面应用
```
