@echo off
chcp 936 >nul
setlocal
rem ================================================================
rem  圣举考试系统 - 打包脚本（在联网的 Windows 打包机上执行一次）
rem  执行前提：Node v20 LTS、Git、Inno Setup 6 已安装
rem ================================================================

set "BUILD_DIR=%~dp0"
if "%BUILD_DIR:~-1%"=="\" set "BUILD_DIR=%BUILD_DIR:~0,-1%"

set "ROOT=%BUILD_DIR%\.."
set "PROJ_ROOT=%ROOT%\..\..\.."
set "PACKAGING=%ROOT%\packaging"
set "DIST=%ROOT%\dist"

echo ============================================================
echo   圣举考试系统 - 打包构建
echo ============================================================
echo.

rem ── Step 1：构建前端 ────────────────────────────────────────────
echo [Step 1/6] 构建前端（4 个子端）...
cd /d "%PROJ_ROOT%\frontend\exam-admin"
call npm install && call npm run build
if errorlevel 1 goto :build_fail

cd /d "%PROJ_ROOT%\frontend\exam-student"
call npm install && call npm run build
if errorlevel 1 goto :build_fail

cd /d "%PROJ_ROOT%\frontend\exam-grader"
call npm install && call npm run build
if errorlevel 1 goto :build_fail

cd /d "%PROJ_ROOT%\frontend\exam-super-admin"
call npm install && call npm run build
if errorlevel 1 goto :build_fail

echo       前端构建完成。

rem ── Step 2：安装后端依赖（Windows x64 预编译原生模块）────────────
echo [Step 2/6] 安装后端依赖（Windows 版原生模块）...
cd /d "%PROJ_ROOT%\backend"
call npm install
if errorlevel 1 goto :build_fail
echo       后端依赖安装完成。

rem ── Step 3：准备 packaging 目录 ──────────────────────────────────
echo [Step 3/6] 准备打包目录结构...
if not exist "%PACKAGING%\app\backend" mkdir "%PACKAGING%\app\backend"
if not exist "%PACKAGING%\app\frontend" mkdir "%PACKAGING%\app\frontend"
if not exist "%PACKAGING%\runtime" mkdir "%PACKAGING%\runtime"
if not exist "%PACKAGING%\config" mkdir "%PACKAGING%\config"
if not exist "%PACKAGING%\data" mkdir "%PACKAGING%\data"
if not exist "%PACKAGING%\logs" mkdir "%PACKAGING%\logs"
if not exist "%DIST%" mkdir "%DIST%"

rem 复制后端（排除 .env 避免泄露生产配置）
xcopy /E /I /Y /Q /EXCLUDE:"%BUILD_DIR%\xcopy_exclude.txt" "%PROJ_ROOT%\backend" "%PACKAGING%\app\backend"

rem 复制前端 dist
for %%d in (exam-admin exam-student exam-grader exam-super-admin) do (
  if not exist "%PACKAGING%\app\frontend\%%d\dist" mkdir "%PACKAGING%\app\frontend\%%d\dist"
  xcopy /E /I /Y /Q "%PROJ_ROOT%\frontend\%%d\dist" "%PACKAGING%\app\frontend\%%d\dist"
)

echo       目录准备完成。

rem ── Step 4：复制 Chromium ─────────────────────────────────────────
echo [Step 4/6] 复制 Chromium...
rem Puppeteer v24 默认下载路径
set "CHROMIUM_SRC=%PROJ_ROOT%\backend\node_modules\puppeteer\.local-chromium"
if not exist "%CHROMIUM_SRC%" (
  rem 新版 Puppeteer 的缓存路径
  set "CHROMIUM_SRC=%USERPROFILE%\.cache\puppeteer"
)
if exist "%CHROMIUM_SRC%" (
  xcopy /E /I /Y /Q "%CHROMIUM_SRC%" "%PACKAGING%\runtime\chromium"
  echo       Chromium 复制完成。
) else (
  echo [警告] 未找到 Chromium，Word导入/公式/PDF功能在目标机将不可用。
  echo        如需此功能，请手动复制 Chromium 到 packaging\runtime\chromium\
)

rem ── Step 5：说明 Node 和 MariaDB 需手动下载 ──────────────────────
echo.
echo [Step 5/6] 请手动下载以下运行时（仅需一次）：
echo.
echo   Node.js v20 LTS Windows x64 ZIP：
echo   https://nodejs.org/dist/latest-v20.x/
echo   -> 解压到：%PACKAGING%\runtime\node\
echo      （确保 %PACKAGING%\runtime\node\node.exe 存在）
echo.
echo   MariaDB 10.11 Windows x64 ZIP（选 "Without installer"）：
echo   https://mariadb.org/download/?t=mariadb&o=true&p=mariadb&r=10.11
echo   -> 解压到：%PACKAGING%\runtime\mariadb\
echo      （确保 %PACKAGING%\runtime\mariadb\bin\mysqld.exe 存在）
echo.
echo   下载完成后按任意键继续打包...
pause >nul

rem 验证
if not exist "%PACKAGING%\runtime\node\node.exe" (
  echo [错误] 未找到 node.exe，请重新检查。
  goto :build_fail
)
if not exist "%PACKAGING%\runtime\mariadb\bin\mysqld.exe" (
  echo [错误] 未找到 mysqld.exe，请重新检查。
  goto :build_fail
)

rem ── Step 6：Inno Setup 打包 ────────────────────────────────────────
echo [Step 6/6] 调用 Inno Setup 打包...
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo [错误] 未找到 Inno Setup 6，请安装后重试。
  goto :build_fail
)
"%ISCC%" "%BUILD_DIR%\package.iss"
if errorlevel 1 goto :build_fail

echo.
echo ============================================================
echo   打包成功！
echo   输出文件：%DIST%\圣举考试系统_安装包_v1.0.0.exe
echo ============================================================
goto :eof

:build_fail
echo.
echo [错误] 构建失败，请查看上方错误信息。
pause
exit /b 1
