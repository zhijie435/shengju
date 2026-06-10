@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 圣举考试系统

rem ── 所有路径均基于本脚本所在目录，绝对路径避免 cd 后失效 ──────────────────
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "NODE_EXE=%ROOT%\runtime\node\node.exe"
set "MYSQLD_EXE=%ROOT%\runtime\mariadb\bin\mysqld.exe"
set "MYSQL_EXE=%ROOT%\runtime\mariadb\bin\mysql.exe"
set "MYSQLADMIN_EXE=%ROOT%\runtime\mariadb\bin\mysqladmin.exe"
set "MYSQL_INSTALL_EXE=%ROOT%\runtime\mariadb\bin\mysql_install_db.exe"
set "DATA_DIR=%ROOT%\data"
set "LOGS_DIR=%ROOT%\logs"
set "CONFIG_TEMPLATE=%ROOT%\config\my_template.ini"
set "MY_INI=%ROOT%\config\my_runtime.ini"
set "ENV_TEMPLATE=%ROOT%\config\.env_template"
set "ENV_FILE=%ROOT%\app\backend\.env"
set "APP_ENTRY=%ROOT%\app\backend\server.js"
set "SEED_SCRIPT=%ROOT%\app\backend\scripts\seed_initial_data.js"
set "SEED_FLAG=%ROOT%\data\.seed_done"

set "DB_PORT=3306"
set "APP_PORT=3000"
set "DB_PASS=ShengjuLocal2024"
set "DB_NAME=question_management_shared"
set "CHROMIUM_EXE=%ROOT%\runtime\chromium\chrome-win\chrome.exe"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%" 2>nul
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" 2>nul

cls
echo.
echo  ============================================================
echo    圣  举  考  试  系  统  —  本  地  版
echo  ============================================================
echo.

rem ── 环境自检 ─────────────────────────────────────────────────────────────
if not exist "%NODE_EXE%" (
  echo  [错误] 未找到 Node.js 运行时。
  echo         请重新安装本程序，或手动解压 runtime\node.zip
  goto :fatal
)
if not exist "%MYSQLD_EXE%" (
  echo  [错误] 未找到数据库服务。
  echo         请重新安装本程序，或手动解压 runtime\mariadb.zip
  goto :fatal
)

rem ── 生成 my_runtime.ini（PowerShell 字符串替换，避免括号/感叹号问题）────
powershell -NoProfile -NonInteractive -Command ^
  "(Get-Content '%CONFIG_TEMPLATE%') -replace 'DATA_DIR_PLACEHOLDER','%DATA_DIR:\=\\%' -replace 'LOGS_DIR_PLACEHOLDER','%LOGS_DIR:\=\\%' | Set-Content '%MY_INI%' -Encoding UTF8" >nul 2>&1

rem ── 生成 app\backend\.env（注入 Chromium 绝对路径）──────────────────────
powershell -NoProfile -NonInteractive -Command ^
  "(Get-Content '%ENV_TEMPLATE%') -replace 'CHROMIUM_PATH_PLACEHOLDER','%CHROMIUM_EXE:\=\\%' | Set-Content '%ENV_FILE%' -Encoding UTF8" >nul 2>&1

rem ── 检查 DB 端口是否已被占用 ─────────────────────────────────────────────
call :port_in_use %DB_PORT%
if "%PORT_USED%"=="1" (
  echo  [i] 数据库端口 %DB_PORT% 已在监听，复用已有数据库实例。
  goto :check_node_port
)

rem ── 首次：初始化 MariaDB ──────────────────────────────────────────────────
if not exist "%DATA_DIR%\mysql" (
  echo  [1/5] 首次运行，正在初始化数据库...
  echo        ^(约 15-30 秒，请耐心等待^)
  echo.
  "%MYSQL_INSTALL_EXE%" "--datadir=%DATA_DIR%" "--password=%DB_PASS%" --default-user=root >"%LOGS_DIR%\db_init.log" 2>&1
  if errorlevel 1 (
    echo  [错误] 数据库初始化失败！
    echo         详情：%LOGS_DIR%\db_init.log
    goto :fatal
  )
  echo        初始化完成。
) else (
  echo  [1/5] 数据目录已存在，跳过初始化。
)

rem ── 启动 MariaDB ──────────────────────────────────────────────────────────
echo  [2/5] 启动数据库服务...
start "" /B "%MYSQLD_EXE%" "--defaults-file=%MY_INI%" "--datadir=%DATA_DIR%"

set /a WAIT=0
set /p "=        等待数据库就绪 " <nul
:waitdb
timeout /t 1 /nobreak >nul
"%MYSQLADMIN_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% ping >nul 2>&1
if not errorlevel 1 goto :db_ready
set /p "=." <nul
set /a WAIT+=1
if %WAIT% lss 45 goto :waitdb
echo.
echo  [错误] 数据库启动超时（45秒）。详情：%LOGS_DIR%\mysql_error.log
goto :fatal
:db_ready
echo  OK

rem ── 建库（幂等）──────────────────────────────────────────────────────────
"%MYSQL_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% ^
  -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" >nul 2>&1

:check_node_port
call :port_in_use %APP_PORT%
if "%PORT_USED%"=="1" (
  echo  [i] 后端端口 %APP_PORT% 已在监听，服务正在运行，直接打开浏览器。
  goto :open_browser
)

rem ── 启动 Node 后端（Chromium 路径在进程环境变量中注入）────────────────────
echo  [3/5] 启动后端服务...
set "PUPPETEER_EXECUTABLE_PATH=%CHROMIUM_EXE%"
set "PUPPETEER_SKIP_DOWNLOAD=true"
rem cd 到 backend 目录，使 require('dotenv').config() 能找到 .env（dotenv 默认读 process.cwd()/.env）
cd /d "%ROOT%\app\backend"
start "" /B "%NODE_EXE%" "%APP_ENTRY%" 1>"%LOGS_DIR%\node.log" 2>&1
cd /d "%ROOT%"

rem 等待后端健康（最多 55 秒，PowerShell 兼容 Win10 1803 以前）
set /a WAIT=0
set /p "=        等待后端就绪 " <nul
:waitnode
timeout /t 2 /nobreak >nul
powershell -NoProfile -NonInteractive -Command "try{$r=(Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/api/v1/health' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop).Content;if($r -match 'connected'){exit 0}else{exit 1}}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto :node_ready
set /p "=." <nul
set /a WAIT+=2
if %WAIT% lss 55 goto :waitnode
echo.
echo  [警告] 后端超时，将直接打开浏览器。若页面空白请稍候刷新。
echo         日志：%LOGS_DIR%\node.log
goto :open_browser
:node_ready
echo  OK

rem ── 首次运行种子数据（检查标记文件）────────────────────────────────────
echo  [4/5] 初始化默认账号数据...
if exist "%SEED_FLAG%" (
  echo        账号已初始化，跳过。
) else (
  if exist "%SEED_SCRIPT%" (
    "%NODE_EXE%" "%SEED_SCRIPT%" 1>>"%LOGS_DIR%\seed.log" 2>&1
    if errorlevel 1 (
      echo        [警告] 种子数据写入失败，可能影响首次登录。
      echo               详情：%LOGS_DIR%\seed.log
    ) else (
      echo        默认账号创建完成。
    )
  ) else (
    echo        [警告] 未找到种子脚本，跳过。
  )
)

:open_browser
echo  [5/5] 打开浏览器...
rem 优先打开欢迎页（含账号密码和所有入口链接），若不存在则回退到企业端
set "WELCOME=%ROOT%\app\welcome.html"
if exist "%WELCOME%" (
  start "" "%WELCOME%"
) else (
  start "" "http://localhost:%APP_PORT%/exam-admin"
)

rem ── 打印访问信息 ──────────────────────────────────────────────────────────
echo.
echo  ============================================================
echo   服务已就绪！
echo.
echo   访问地址：
echo     企业端（出题/考试管理） http://localhost:%APP_PORT%/exam-admin
echo     考生端（在线答题）      http://localhost:%APP_PORT%/exam-student
echo     阅卷端                  http://localhost:%APP_PORT%/exam-grader
echo     总管理端                http://localhost:%APP_PORT%/exam-super-admin
echo.
echo   初始账号（首次登录后请修改密码）：
echo     超级管理员   用户名: admin        密码: Admin@2024
echo     企业管理员   用户名: enterprise   密码: Enterprise@2024
echo     阅  卷  员   用户名: grader       密码: Grader@2024
echo     测试考生     用户名: student1     密码: Student@2024
echo.
echo   局域网其他设备：将 localhost 替换为本机 IP 即可访问
echo.
echo   [!] 保持本窗口开启。关闭本窗口将停止所有服务。
echo  ============================================================
echo.

rem ── 持续监控（每 15 秒健康检查，崩溃时告警）────────────────────────────
:monitor
timeout /t 15 /nobreak >nul
powershell -NoProfile -NonInteractive -Command "try{Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/api/v1/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [%time%] 警告：后端无响应，服务可能已停止。查看 logs\node.log
)
goto :monitor

rem ── 子程序：检测 TCP 端口是否有进程监听 ─────────────────────────────────
:port_in_use
set "PORT_USED=0"
netstat -ano 2>nul | findstr /R "[ :]%~1 " | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 set "PORT_USED=1"
goto :eof

:fatal
echo.
echo  请将 logs\ 目录下的日志文件发送给技术支持。
echo  按任意键退出...
pause >nul
exit /b 1
