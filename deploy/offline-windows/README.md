# 圣举考试系统 Windows 离线安装包构建说明

## 目录结构

```
offline-windows/
├── build/
│   ├── build-package.bat     ← 在打包机上执行此脚本
│   ├── package.iss           ← Inno Setup 打包配置
│   └── xcopy_exclude.txt     ← 打包时排除的文件
├── packaging/                ← 最终打包内容（由 build 脚本填充）
│   ├── app/                  ← 后端代码 + 前端 dist
│   ├── runtime/              ← Node + MariaDB + Chromium（手动下载）
│   ├── config/               ← 配置模板（.env_template, my_template.ini）
│   ├── data/                 ← 数据库数据目录（首次启动自动初始化）
│   ├── logs/
│   ├── 启动考试系统.bat
│   ├── 停止考试系统.bat
│   └── 重置数据库.bat
└── dist/                     ← 输出的安装包 .exe
```

## 兼容性说明

| 系统 | 是否支持 | 说明 |
|------|----------|------|
| Windows 11 x64 | ✅ | 完全支持 |
| Windows 10 x64 (1803+) | ✅ | 完全支持 |
| Windows 10 x64 (1803 以前) | ✅ | 支持，PowerShell 健康检查正常 |
| Windows 7 / 8 / 8.1 | ❌ | 不支持（Node v20 最低要求 Win10） |
| 32 位系统（任意版本） | ❌ | 不支持（所有运行时均为 64 位）|

> **Win7 机器作为考生端**：可通过局域网浏览器访问 Win10 服务器的 `/exam-student`，不需要在 Win7 上安装任何东西。

## 打包步骤（在联网的 Windows 10/11 x64 机器上执行一次）

### 前置条件

1. 安装 **Node.js v20 LTS**（从 https://nodejs.org 下载安装版本，打包机用）
2. 安装 **Inno Setup 6**（从 https://jrsoftware.org/isdl.php 下载）
3. 安装 **Git**（用于拉取代码）

### 执行打包

```
双击 build\build-package.bat
```

脚本会：
1. 自动构建 4 个前端 dist
2. 自动安装 Windows 版后端依赖（含预编译原生模块）
3. 暂停，提示你手动下载 Node 便携版和 MariaDB ZIP
4. 继续完成 Inno Setup 打包
5. 输出 `dist\圣举考试系统_安装包_v1.0.0.exe`

### 手动下载的运行时

**Node.js v20 LTS 便携版（ZIP，不是安装包）**
- 地址：https://nodejs.org/dist/latest-v20.x/node-v20.x.x-win-x64.zip
- 解压到：`packaging/runtime/node/`（确保 `runtime/node/node.exe` 存在）

**MariaDB 10.11 Windows x64（ZIP，选 "Without installer"）**
- 地址：https://mariadb.org/download/?t=mariadb&p=mariadb&r=10.11
- 解压到：`packaging/runtime/mariadb/`（确保 `runtime/mariadb/bin/mysqld.exe` 存在）

## 预估安装包体积

| 组件 | 大小 |
|------|------|
| Node v20 便携版 | ~50 MB |
| MariaDB 10.11 | ~60 MB |
| Chromium（Puppeteer 随包）| ~170 MB |
| 后端 + node_modules | ~250 MB |
| 4 个前端 dist | ~30 MB |
| **安装包压缩后（lzma2/ultra64）** | **约 280–350 MB** |

## 目标机安装步骤（用户操作）

1. 双击 `圣举考试系统_安装包_v1.0.0.exe`
2. 中文向导 → 选安装路径（默认 `C:\Program Files\ShengjuExam`）→ 下一步 → 安装
3. 安装完成，勾选"立即启动"或桌面双击图标
4. **首次启动**：约 20-30 秒初始化数据库，窗口有进度提示
5. 浏览器自动打开 `http://localhost:3000/exam-admin`

## 常见问题

**Q: 防病毒软件提示风险？**
A: mysqld.exe 和 node.exe 从非标准路径运行会触发部分国产杀软（360/火绒）的行为拦截。
解决方案：将安装目录加入杀软白名单，或在安装前临时关闭实时防护。

**Q: 启动后浏览器白页？**
A: 后端启动较慢（首次约 30 秒），等窗口出现"后端服务已就绪"提示后刷新页面。

**Q: 端口 3000 或 3306 被占用？**
A: 修改 `config\.env_template` 中的 `PORT` 和 `config\my_template.ini` 中的 `port`，
保持两者一致后重启。

**Q: 如何备份数据？**
A: 复制 `data\` 目录即可完整备份所有数据库数据。

**Q: 如何局域网多人考试？**
A: 服务器机器正常启动后，考生用浏览器访问 `http://[服务器IP]:3000/exam-student`。
确保 Windows 防火墙允许 3000 端口的入站连接。
