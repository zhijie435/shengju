# 后端服务配置指南

## 快速开始

### 1. 初始化环境配置

运行以下命令之一：

**Windows:**
```bash
快速初始化环境.bat
```

**或手动创建:**
```bash
# 复制模板文件
copy backend\.env.example backend\.env

# 编辑配置文件
notepad backend\.env
```

### 2. 配置数据库连接

编辑 `backend/.env` 文件，设置数据库连接信息：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
MAIN_DB_NAME=question_management_shared
```

### 3. 初始化数据库

运行数据库初始化脚本：

```bash
初始化数据库.bat
```

### 4. 启动服务器

**开发模式（自动重启）:**
```bash
cd backend
npm run dev
```

**生产模式:**
```bash
cd backend
npm start
```

**或使用批处理文件:**
```bash
启动后端服务.bat
```

## 环境变量说明

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `DB_HOST` | 数据库主机 | localhost | 是 |
| `DB_PORT` | 数据库端口 | 3306 | 是 |
| `DB_USER` | 数据库用户名 | root | 是 |
| `DB_PASSWORD` | 数据库密码 | (空) | 是 |
| `MAIN_DB_NAME` | 主数据库名称 | question_management_shared | 是 |
| `JWT_SECRET` | JWT密钥 | your-secret-key-change-in-production | 是 |
| `PORT` | 服务器端口 | 3000 | 否 |
| `NODE_ENV` | 运行环境 | development | 否 |

## 验证配置

启动服务器后，你应该看到：

```
✓ 主数据库连接成功
  - 数据库: question_management_shared
  - 主机: localhost:3306
服务器运行在端口 3000
```

如果看到错误，请检查：
1. MySQL 服务是否启动
2. `.env` 文件中的配置是否正确
3. 数据库是否已创建

## 常见问题

### 1. 数据库连接失败

**错误信息:** `数据库连接失败`

**解决方案:**
- 检查 MySQL 服务是否启动
- 验证 `.env` 文件中的数据库配置
- 确认数据库用户有足够的权限
- 检查防火墙设置

### 2. 端口被占用

**错误信息:** `Error: listen EADDRINUSE: address already in use :::3000`

**解决方案:**
- 修改 `.env` 文件中的 `PORT` 配置
- 或停止占用端口的其他服务

### 3. JWT密钥警告

**警告信息:** 使用默认的 JWT_SECRET

**解决方案:**
- 在生产环境中，必须修改 `JWT_SECRET` 为强密码
- 使用随机字符串生成器生成安全的密钥

## 生产环境部署

### 安全建议

1. **修改 JWT_SECRET**
   ```env
   JWT_SECRET=your-very-long-and-random-secret-key-here
   ```

2. **使用强密码**
   - 数据库密码应该足够复杂
   - 不要使用默认密码

3. **设置 NODE_ENV**
   ```env
   NODE_ENV=production
   ```

4. **保护 .env 文件**
   - 确保 `.env` 文件不在版本控制中
   - 设置适当的文件权限

5. **使用 HTTPS**
   - 在生产环境中使用 HTTPS
   - 配置 SSL 证书

## 配置文件位置

- 环境配置: `backend/.env`
- 配置模板: `backend/.env.example`
- 服务器配置: `backend/server.js`
- 数据库配置: `backend/config/database.js`

## 相关文档

- [环境配置说明](./环境配置说明.md)
- [数据库初始化指南](../初始化数据库-手动方式.md)
