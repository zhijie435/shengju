@echo off
chcp 65001 >nul
setlocal
rem ================================================================
rem  build-package.bat - Build all 4 frontend apps and package for Windows
rem  Prerequisites: Node v20 LTS, Git, Inno Setup 6
rem ================================================================

set "BUILD_DIR=%~dp0"
if "%BUILD_DIR:~-1%"=="\" set "BUILD_DIR=%BUILD_DIR:~0,-1%"

set "ROOT=%BUILD_DIR%\.."
set "PROJ_ROOT=%ROOT%\..\..\.."
set "PACKAGING=%ROOT%\packaging"
set "DIST=%ROOT%\dist"

echo ============================================================
echo   Exam System - Build and Package
echo ============================================================
echo.

rem ---- Step 1: Build all 4 frontend apps ----
echo [Step 1/6] Building 4 frontend apps...
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

echo       Frontend build complete.

rem ---- Step 2: Install backend dependencies for Windows x64 ----
echo [Step 2/6] Installing backend dependencies for Windows...
cd /d "%PROJ_ROOT%\backend"
call npm install
if errorlevel 1 goto :build_fail
echo       Backend dependencies installed.

rem ---- Step 3: Create packaging directory structure ----
echo [Step 3/6] Creating packaging directories...
if not exist "%PACKAGING%\app\backend" mkdir "%PACKAGING%\app\backend"
if not exist "%PACKAGING%\app\frontend" mkdir "%PACKAGING%\app\frontend"
if not exist "%PACKAGING%\runtime" mkdir "%PACKAGING%\runtime"
if not exist "%PACKAGING%\config" mkdir "%PACKAGING%\config"
if not exist "%PACKAGING%\data" mkdir "%PACKAGING%\data"
if not exist "%PACKAGING%\logs" mkdir "%PACKAGING%\logs"
if not exist "%DIST%" mkdir "%DIST%"

rem Copy backend (excluding .env and other sensitive files)
xcopy /E /I /Y /Q /EXCLUDE:"%BUILD_DIR%\xcopy_exclude.txt" "%PROJ_ROOT%\backend" "%PACKAGING%\app\backend"

rem Copy frontend dist folders
for %%d in (exam-admin exam-student exam-grader exam-super-admin) do (
  if not exist "%PACKAGING%\app\frontend\%%d\dist" mkdir "%PACKAGING%\app\frontend\%%d\dist"
  xcopy /E /I /Y /Q "%PROJ_ROOT%\frontend\%%d\dist" "%PACKAGING%\app\frontend\%%d\dist"
)

echo       Packaging directories ready.

rem ---- Step 4: Copy Chromium (for Puppeteer PDF/Word support) ----
echo [Step 4/6] Copying Chromium...
rem Puppeteer v24 may store Chromium in different locations
set "CHROMIUM_SRC=%PROJ_ROOT%\backend\node_modules\puppeteer\.local-chromium"
if not exist "%CHROMIUM_SRC%" (
  rem Fallback to user-level Puppeteer cache
  set "CHROMIUM_SRC=%USERPROFILE%\.cache\puppeteer"
)
if exist "%CHROMIUM_SRC%" (
  xcopy /E /I /Y /Q "%CHROMIUM_SRC%" "%PACKAGING%\runtime\chromium"
  echo       Chromium copied successfully.
) else (
  echo [WARNING] Chromium not found. Word import / screenshots / PDF export may not work.
  echo           Please manually copy Chromium to packaging\runtime\chromium\
)

rem ---- Step 5: Manual step - download Node and MariaDB runtimes ----
echo.
echo [Step 5/6] Manual step required - download runtime dependencies:
echo.
echo   Node.js v20 LTS Windows x64 ZIP:
echo   https://nodejs.org/dist/latest-v20.x/
echo   -> Extract to: %PACKAGING%\runtime\node\
echo      Verify:      %PACKAGING%\runtime\node\node.exe exists
echo.
echo   MariaDB 10.11 Windows x64 ZIP (choose "Without installer"):
echo   https://mariadb.org/download/?t=mariadb&o=true&p=mariadb&r=10.11
echo   -> Extract to: %PACKAGING%\runtime\mariadb\
echo      Verify:      %PACKAGING%\runtime\mariadb\bin\mysqld.exe exists
echo.
echo   Press any key when both runtimes are in place...
pause >nul

rem Validate runtimes
if not exist "%PACKAGING%\runtime\node\node.exe" (
  echo [ERROR] node.exe not found. Aborting.
  goto :build_fail
)
if not exist "%PACKAGING%\runtime\mariadb\bin\mysqld.exe" (
  echo [ERROR] mysqld.exe not found. Aborting.
  goto :build_fail
)

rem ---- Step 6: Run Inno Setup to create installer ----
echo [Step 6/6] Running Inno Setup to create installer...
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo [ERROR] Inno Setup 6 not found. Please install it first.
  goto :build_fail
)
"%ISCC%" "%BUILD_DIR%\package.iss"
if errorlevel 1 goto :build_fail

echo.
echo ============================================================
echo   Build Complete!
echo   Installer: %DIST%\sjrcw-installer-v1.0.0.exe
echo ============================================================
goto :eof

:build_fail
echo.
echo [ERROR] Build failed. See output above for details.
pause
exit /b 1
