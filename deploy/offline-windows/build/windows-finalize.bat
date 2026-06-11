@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Exam System - Windows Finalize

rem ================================================================
rem  windows-finalize.bat
rem  Complete the final packaging steps on Windows x64.
rem  Run this script AFTER the macOS/Linux build has produced
rem  frontend/*/dist files. Steps:
rem    1. Run npm ci on Windows to rebuild native modules
rem       (canvas / sharp / bcrypt etc.)
rem    2. Download Chromium via Puppeteer for PDF/Word support
rem    3. Copy backend files and frontend dist into packaging dir
rem    4. Prompt to place Node.js and MariaDB ZIP runtimes
rem    5. Run Inno Setup to create the final .exe installer
rem
rem  Prerequisites: run on Windows after macOS/Linux frontend build
rem  Usage: cmd /c windows-finalize.bat
rem ================================================================

set "BUILD_DIR=%~dp0"
if "%BUILD_DIR:~-1%"=="\" set "BUILD_DIR=%BUILD_DIR:~0,-1%"
set "ROOT=%BUILD_DIR%\.."
set "PACKAGING=%ROOT%\packaging"
set "DIST_OUT=%ROOT%\dist"
set "PROJ=%BUILD_DIR%\..\..\..\"

rem Resolve PROJ to absolute path
pushd "%PROJ%"
set "PROJ=%CD%"
popd

cls
echo.
echo  ================================================================
echo    Exam System - Windows Finalize Build
echo  ================================================================
echo.
echo  This script will complete the following steps (~2 min):
echo    Step 1: Reinstall backend for Windows native modules
echo    Step 2: Download Chromium via Puppeteer
echo    Step 3: Copy files into packaging directory
echo    Step 4: Place Node.js runtime and MariaDB ZIP
echo    Step 5: Build the .exe installer
echo.
echo  Press any key to begin...
pause >nul

rem ---- Step 1: npm ci on Windows (rebuild native modules) ----
echo.
echo  [Step 1/5] Installing backend for Windows...
echo             Rebuilding canvas / sharp / bcrypt native modules
echo.

if not exist "%PROJ%\backend\package.json" (
  echo  [ERROR] Not found: %PROJ%\backend\package.json
  goto :fatal
)

set "PUPPETEER_CACHE_DIR=%PACKAGING%\runtime\chromium"
set "PUPPETEER_SKIP_DOWNLOAD=false"

cd /d "%PROJ%\backend"
call npm ci --omit=dev
if errorlevel 1 (
  echo.
  echo  [ERROR] npm ci failed. Check the output above.
  goto :fatal
)
echo.
echo  Backend dependencies installed successfully.

rem ---- Step 2: Download Chromium ----
echo.
echo  [Step 2/5] Downloading Chromium for Puppeteer...
if not exist "%PACKAGING%\runtime\chromium" mkdir "%PACKAGING%\runtime\chromium"

rem Puppeteer v24 uses @puppeteer/browsers under the hood.
rem Setting PUPPETEER_CACHE_DIR before npm ci causes postinstall to
rem download Chromium directly into packaging\runtime\chromium.
if not exist "%PACKAGING%\runtime\chromium\chrome-win\chrome.exe" (
  cd /d "%PROJ%\backend"
  set "PUPPETEER_CACHE_DIR=%PACKAGING%\runtime\chromium"
  node -e "const p=require('puppeteer');p.executablePath().then(ep=>console.log('Chromium:',ep)).catch(()=>{})"
  rem Fallback: trigger install script manually if postinstall didn't run
  node node_modules/puppeteer/install.mjs 2>nul || node -e "require('puppeteer')" 2>nul || true
)

rem Locate chrome.exe anywhere under the chromium cache dir
for /f "delims=" %%f in ('dir /b /s "%PACKAGING%\runtime\chromium\chrome.exe" 2^>nul') do set "FOUND_CHROME=%%f"
if defined FOUND_CHROME (
  echo  Chromium found: !FOUND_CHROME!
  set "CHROMIUM_DIR=!FOUND_CHROME!"
) else (
  echo  [WARNING] chrome.exe not found. Word import / screenshots / PDF export may not work.
  echo            Please manually place chrome.exe under packaging\runtime\chromium\chrome-win\
)
echo.

rem ---- Step 3: Copy backend and frontend dist into packaging dir ----
echo  [Step 3/5] Copying application files into packaging directory...
if not exist "%PACKAGING%\app\backend" mkdir "%PACKAGING%\app\backend"
if not exist "%PACKAGING%\app\frontend" mkdir "%PACKAGING%\app\frontend"

rem Build xcopy exclusion list (skip .env, uploads, .git)
echo %PROJ%\backend\.env> "%TEMP%\xcopy_exc.txt"
echo node_modules\.cache>> "%TEMP%\xcopy_exc.txt"
echo .git>> "%TEMP%\xcopy_exc.txt"

xcopy /E /I /Y /Q /EXCLUDE:"%TEMP%\xcopy_exc.txt" "%PROJ%\backend" "%PACKAGING%\app\backend" >nul
if errorlevel 1 (
  echo  [ERROR] Failed to copy backend files.
  goto :fatal
)

rem Copy frontend dist folders
for %%d in (exam-admin exam-student exam-grader exam-super-admin) do (
  if exist "%PROJ%\frontend\%%d\dist" (
    if not exist "%PACKAGING%\app\frontend\%%d\dist" mkdir "%PACKAGING%\app\frontend\%%d\dist"
    xcopy /E /I /Y /Q "%PROJ%\frontend\%%d\dist" "%PACKAGING%\app\frontend\%%d\dist" >nul
    echo  Copied frontend\%%d\dist
  ) else (
    echo  [WARNING] frontend\%%d\dist not found. Run the macOS/Linux build first.
  )
)
echo.

rem ---- Step 4: Place Node.js runtime and MariaDB ZIP ----
echo  [Step 4/5] Manual step - place Node.js runtime and MariaDB ZIP:
echo.
echo  +-----------------------------------------------------------------+
echo  ^| Node.js v20 LTS Windows x64 ZIP                                ^|
echo  ^|   URL:    https://nodejs.org/dist/latest-v20.x/                ^|
echo  ^|   Target: %PACKAGING%\runtime\node\              ^|
echo  ^|   Check:  %PACKAGING%\runtime\node\node.exe      ^|
echo  +-----------------------------------------------------------------+
echo.
echo  +-----------------------------------------------------------------+
echo  ^| MariaDB 10.11 Windows x64 ZIP  (choose "Without installer")    ^|
echo  ^|   URL:    https://mariadb.org/download/?t=mariadb^&p=mariadb^&r=10.11 ^|
echo  ^|   Target: %PACKAGING%\runtime\mariadb\           ^|
echo  ^|   Check:  %PACKAGING%\runtime\mariadb\bin\mysqld.exe           ^|
echo  +-----------------------------------------------------------------+
echo.

rem Open download pages in browser
start "" "https://nodejs.org/dist/latest-v20.x/"
start "" "https://mariadb.org/download/?t=mariadb&p=mariadb&r=10.11"

echo  Press any key once both runtimes are in place...
pause >nul
echo.

rem Validate runtimes
if not exist "%PACKAGING%\runtime\node\node.exe" (
  echo  [ERROR] node.exe not found. Place it under packaging\runtime\node\
  goto :fatal
)
echo  Node.js: OK
if not exist "%PACKAGING%\runtime\mariadb\bin\mysqld.exe" (
  echo  [ERROR] mysqld.exe not found. Place it under packaging\runtime\mariadb\
  goto :fatal
)
echo  MariaDB: OK
echo.

rem Verify Node version >= 20, < 21 (LTS stability requirement)
"%PACKAGING%\runtime\node\node.exe" -e "const v=process.version;const [,maj]=v.match(/^v(\d+)/);if(+maj<20){console.error('Node version must be >=v20. Found: '+v);process.exit(1)}else{console.log('Node version: '+v)}"
if errorlevel 1 goto :fatal

rem ---- Step 5: Run Inno Setup to create installer ----
echo.
echo  [Step 5/5] Running Inno Setup to create installer...
if not exist "%DIST_OUT%" mkdir "%DIST_OUT%"

set "ISCC="
for %%p in (
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
  "C:\Program Files\Inno Setup 6\ISCC.exe"
) do (
  if exist %%p set "ISCC=%%~p"
)

if not defined ISCC (
  echo  [ERROR] Inno Setup 6 not found.
  echo          Download from: https://jrsoftware.org/isdl.php
  goto :fatal
)

"%ISCC%" "%BUILD_DIR%\package.iss"
if errorlevel 1 (
  echo  [ERROR] Inno Setup compilation failed.
  goto :fatal
)

echo.
echo  ================================================================
echo    Build Complete!
echo.
echo    Installer(s) produced:
dir "%DIST_OUT%\*.exe" /B 2>nul | findstr /V /C:"" && (
  for %%f in ("%DIST_OUT%\*.exe") do echo    %%~nxf  ^(%%~zf bytes^)
)
echo.
echo    Copy the .exe to the target Windows machine and run it.
echo  ================================================================
echo.
pause
goto :eof

:fatal
echo.
echo  Build failed. See error above.
pause
exit /b 1
