# 服务器部署说明

## 1. 确保后端文件完整上传

本后端**入口文件是根目录的 `server.js`**，不是 `src/` 下的文件。若在服务器上执行 `ls` 只有 `src`、没有 `server.js`，说明部署不完整。

请将以下内容完整上传到服务器 `backend` 目录（与 `package.json` 同级）：

- **入口**：`server.js`
- **配置**：`config/`（如 database.js、userDatabase.js）
- **路由**：`routes/`
- **模型**：`models/`
- **服务**：`services/`
- **中间件**：`middleware/`
- **工具**：`utils/`
- **脚本**：`scripts/`

上传后目录应类似：

```
/var/www/shengju/backend/
├── server.js          ← 必须有
├── package.json
├── package-lock.json
├── config/
├── routes/
├── models/
├── services/
├── middleware/
├── utils/
├── scripts/
├── node_modules/
└── ...
```

## 2. 安装依赖（在服务器上）

```bash
cd /var/www/shengju/backend
npm install --production
```

若需在**当前服务器环境**重新编译 bcrypt（解决 invalid ELF header）：

```bash
rm -rf node_modules/bcrypt
npm install bcrypt@5.1.1 --save
```

然后给可执行权限再试（若曾报 Permission denied）：

```bash
chmod -R u+x node_modules/.bin
```

## 3. 使用 PM2 启动

在**有 `server.js` 的目录**执行：

```bash
cd /var/www/shengju/backend
pm2 delete shengju-api || true
pm2 start server.js --name shengju-api
pm2 save
```

若你的 `package.json` 里 start 是 `node server.js`，也可以：

```bash
pm2 start npm --name shengju-api -- start
```

## 4. 健康检查

```bash
curl http://127.0.0.1:3000/health
```

应返回 `{"status":"ok",...}`。

---

**总结**：`pm2 start server.js` 报 “Script not found” 是因为服务器上的 `backend` 里没有 `server.js`。请按上面清单把本地的 `server.js` 及整份 backend 上传后再执行 `pm2 start server.js --name shengju-api`。
