@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 圣举考试系统 - Windows 打包收尾

rem ================================================================
rem  windows-finalize.bat
rem  在 Windows x64 打包机上执行一次，完成以下工作：
rem    1. 安装后端 Windows 原生依赖（canvas/sharp/bcrypt 等）
rem    2. 配置 Puppeteer 下载 Chromium 到打包目录
rem    3. 引导下载 Node 便携版和 MariaDB ZIP
rem    4. 调用 Inno Setup 生成最终安装包
rem
rem  前提：已在 macOS/Linux 完成前端构建（frontend/*/dist 已存在）
rem  运行：双击本脚本，或 cmd /c windows-finalize.bat
rem ================================================================

set "BUILD_DIR=%~dp0"
if "%BUILD_DIR:~-1%"=="\" set "BUILD_DIR=%BUILD_DIR:~0,-1%"
set "ROOT=%BUILD_DIR%\.."
set "PACKAGING=%ROOT%\packaging"
set "DIST_OUT=%ROOT%\dist"
set "PROJ=%BUILD_DIR%\..\..\..\"

rem 把 PROJ 转为绝对路径
pushd "%PROJ%"
set "PROJ=%CD%"
popd

cls
echo.
echo  ================================================================
echo    圣举考试系统 - Windows 打包收尾向导
echo  ================================================================
echo.
echo  本脚本将引导你完成以下步骤：
echo    Step 1: 安装后端 Windows 原生依赖
echo    Step 2: 下载 Chromium（供 Puppeteer 使用）
echo    Step 3: 下载并放置 Node.js 便携版
echo    Step 4: 下载并放置 MariaDB ZIP
echo    Step 5: 生成安装包 .exe
echo.
echo  按任意键开始...
pause >nul

rem ── Step 1：安装后端 Windows 依赖 ────────────────────────────────────────
echo.
echo  [Step 1/5] 安装后端 Windows 原生依赖...
echo             （canvas / sharp / bcrypt 会下载预编译二进制，需要网络）
echo.

if not exist "%PROJ%\backend\package.json" (
  echo  [错误] 未找到 %PROJ%\backend\package.json
  goto :fatal
)

set "PUPPETEER_CACHE_DIR=%PACKAGING%\runtime\chromium"
set "PUPPETEER_SKIP_DOWNLOAD=false"

cd /d "%PROJ%\backend"
call npm ci --omit=dev
if errorlevel 1 (
  echo.
  echo  [错误] npm ci 失败，请检查网络连接。
  goto :fatal
)
echo.
echo  后端依赖安装完成。

rem ── Step 2：下载 Chromium 到打包目录 ─────────────────────────────────────
echo.
echo  [Step 2/5] 下载 Chromium 到打包目录...
if not exist "%PACKAGING%\runtime\chromium" mkdir "%PACKAGING%\runtime\chromium"

rem Puppeteer v24 使用 @puppeteer/browsers 缓存
rem 通过设置 PUPPETEER_CACHE_DIR 让 postinstall 把 Chromium 装到打包目录
if not exist "%PACKAGING%\runtime\chromium\chrome-win\chrome.exe" (
  cd /d "%PROJ%\backend"
  set "PUPPETEER_CACHE_DIR=%PACKAGING%\runtime\chromium"
  node -e "const p=require('puppeteer');p.executablePath().then(ep=>console.log('Chromium:',ep)).catch(()=>{})"
  rem 强制触发 Chromium 下载（若 postinstall 已执行则跳过）
  node node_modules/puppeteer/install.mjs 2>nul || node -e "require('puppeteer')" 2>nul || true
)

rem 寻找实际的 chrome.exe 位置
for /f "delims=" %%f in ('dir /b /s "%PACKAGING%\runtime\chromium\chrome.exe" 2^>nul') do set "FOUND_CHROME=%%f"
if defined FOUND_CHROME (
  echo  Chromium 路径: !FOUND_CHROME!
  set "CHROMIUM_DIR=!FOUND_CHROME!"
) else (
  echo  [警告] 未找到 chrome.exe，Word导入/公式/PDF 功能将不可用。
  echo         如有需要，请手动复制 chrome.exe 到 packaging\runtime\chromium\chrome-win\
)
echo.

rem ── Step 3：复制后端代码到打包目录 ───────────────────────────────────────
echo  [Step 3/5] 复制后端代码及依赖...
if not exist "%PACKAGING%\app\backend" mkdir "%PACKAGING%\app\backend"
if not exist "%PACKAGING%\app\frontend" mkdir "%PACKAGING%\app\frontend"

rem xcopy 排除 .env、uploads、.git
echo %PROJ%\backend\.env> "%TEMP%\xcopy_exc.txt"
echo node_modules\.cache>> "%TEMP%\xcopy_exc.txt"
echo .git>> "%TEMP%\xcopy_exc.txt"

xcopy /E /I /Y /Q /EXCLUDE:"%TEMP%\xcopy_exc.txt" "%PROJ%\backend" "%PACKAGING%\app\backend" >nul
if errorlevel 1 (
  echo  [错误] 复制后端代码失败。
  goto :fatal
)

rem 复制前端 dist
for %%d in (exam-admin exam-student exam-grader exam-super-admin) do (
  if exist "%PROJ%\frontend\%%d\dist" (
    if not exist "%PACKAGING%\app\frontend\%%d\dist" mkdir "%PACKAGING%\app\frontend\%%d\dist"
    xcopy /E /I /Y /Q "%PROJ%\frontend\%%d\dist" "%PACKAGING%\app\frontend\%%d\dist" >nul
    echo  复制 frontend\%%d\dist 完成。
  ) else (
    echo  [警告] 未找到 frontend\%%d\dist，请先在 macOS/Linux 执行前端构建。
  )
)
echo.

rem ── Step 4：引导下载 Node 便携版和 MariaDB ────────────────────────────────
echo  [Step 4/5] 下载运行时（Node.js 便携版 + MariaDB ZIP）
echo.
echo  请依次完成以下两项手动下载（用浏览器打开链接，下载后解压）：
echo.
echo  ┌─ Node.js v20 LTS Windows x64 ZIP ──────────────────────────────────┐
echo  │  下载：https://nodejs.org/dist/latest-v20.x/node-v20.x.x-win-x64.zip │
echo  │  解压到：%PACKAGING%\runtime\node\              │
echo  │  确保：%PACKAGING%\runtime\node\node.exe 存在   │
echo  └─────────────────────────────────────────────────────────────────────┘
echo.
echo  ┌─ MariaDB 10.11 Windows x64 ZIP（选"Without installer"）─────────────┐
echo  │  下载：https://mariadb.org/download/?t=mariadb^&p=mariadb^&r=10.11  │
echo  │  解压到：%PACKAGING%\runtime\mariadb\           │
echo  │  确保：%PACKAGING%\runtime\mariadb\bin\mysqld.exe 存在              │
echo  └─────────────────────────────────────────────────────────────────────┘
echo.

rem 先打开两个浏览器页面方便下载
start "" "https://nodejs.org/dist/latest-v20.x/"
start "" "https://mariadb.org/download/?t=mariadb&p=mariadb&r=10.11"

echo  下载并解压完成后，按任意键继续...
pause >nul
echo.

rem 验证
if not exist "%PACKAGING%\runtime\node\node.exe" (
  echo  [错误] 未找到 node.exe，请检查 packaging\runtime\node\ 目录。
  goto :fatal
)
echo  Node.js: 已就绪
if not exist "%PACKAGING%\runtime\mariadb\bin\mysqld.exe" (
  echo  [错误] 未找到 mysqld.exe，请检查 packaging\runtime\mariadb\ 目录。
  goto :fatal
)
echo  MariaDB: 已就绪
echo.

rem 验证 Node 版本（必须 >= 20，< 21 for LTS stability）
"%PACKAGING%\runtime\node\node.exe" -e "const v=process.version;const [,maj]=v.match(/^v(\d+)/);if(+maj<20){console.error('Node版本过低（需>=v20），当前:'+v);process.exit(1)}else{console.log('Node版本: '+v)}"
if errorlevel 1 goto :fatal

rem ── Step 5：Inno Setup 打包 ───────────────────────────────────────────────
echo.
echo  [Step 5/5] 生成安装包...
if not exist "%DIST_OUT%" mkdir "%DIST_OUT%"

set "ISCC="
for %%p in (
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
  "C:\Program Files\Inno Setup 6\ISCC.exe"
) do (
  if exist %%p set "ISCC=%%~p"
)

if not defined ISCC (
  echo  [错误] 未找到 Inno Setup 6。
  echo         请从 https://jrsoftware.org/isdl.php 安装后重试。
  goto :fatal
)

"%ISCC%" "%BUILD_DIR%\package.iss"
if errorlevel 1 (
  echo  [错误] Inno Setup 打包失败。
  goto :fatal
)

echo.
echo  ================================================================
echo    打包成功！
echo.
echo    输出文件：
dir "%DIST_OUT%\*.exe" /B 2>nul | findstr /V /C:"" && (
  for %%f in ("%DIST_OUT%\*.exe") do echo    %%~nxf  ^(%%~zf bytes^)
)
echo.
echo    将该 .exe 文件拷贝到目标 Windows 机器，双击安装即可。
echo  ================================================================
echo.
pause
goto :eof

:fatal
echo.
echo  打包未能完成，请检查上方错误信息。
pause
exit /b 1
