@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title Shengju Exam System - Local

rem -- All paths are based on this script's directory; absolute paths avoid breakage after cd --
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
set "SQL_SEED=%ROOT%\app\backend\database\seeds\qms_production_backup.sql"

set "DB_PORT=3306"
set "APP_PORT=3000"
set "DB_PASS=ShengjuLocal2024"
set "DB_NAME=question_management_shared"
rem -- dynamically locate Chromium (puppeteer cache layout varies by version; avoid hardcoded path) --
set "CHROMIUM_EXE="
for /r "%ROOT%\runtime\chromium" %%F in (chrome.exe) do if not defined CHROMIUM_EXE set "CHROMIUM_EXE=%%F"
if not defined CHROMIUM_EXE set "CHROMIUM_EXE=%ROOT%\runtime\chromium\chrome-win\chrome.exe"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%" 2>nul
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" 2>nul

cls
echo.
echo  ============================================================
echo    Shengju Exam System - Local Edition
echo  ============================================================
echo.

rem -- Environment self-check --
if not exist "%NODE_EXE%" (
  echo  [ERROR] Node.js runtime not found.
  echo          Please reinstall, or manually extract runtime\node.zip
  goto :fatal
)
if not exist "%MYSQLD_EXE%" (
  echo  [ERROR] Database service not found.
  echo          Please reinstall, or manually extract runtime\mariadb.zip
  goto :fatal
)

rem -- Generate my_runtime.ini (PowerShell string replace; avoids paren/bang issues) --
powershell -NoProfile -NonInteractive -Command ^
  "$c=(Get-Content '%CONFIG_TEMPLATE%' -Raw) -replace 'DATA_DIR_PLACEHOLDER','%DATA_DIR:\=\\%' -replace 'LOGS_DIR_PLACEHOLDER','%LOGS_DIR:\=\\%'; [System.IO.File]::WriteAllText('%MY_INI%', $c, (New-Object System.Text.UTF8Encoding($false)))" >nul 2>&1

rem -- Generate app\backend\.env (inject Chromium absolute path) --
powershell -NoProfile -NonInteractive -Command ^
  "$c=(Get-Content '%ENV_TEMPLATE%' -Raw) -replace 'CHROMIUM_PATH_PLACEHOLDER','%CHROMIUM_EXE:\=\\%'; [System.IO.File]::WriteAllText('%ENV_FILE%', $c, (New-Object System.Text.UTF8Encoding($false)))" >nul 2>&1

rem -- Check whether DB port is already in use --
call :port_in_use %DB_PORT%
if "%PORT_USED%"=="1" (
  echo  [i] Database port %DB_PORT% already listening; reusing existing instance.
  goto :check_node_port
)

rem -- First run: initialize MariaDB --
if exist "%DATA_DIR%\mysql" (
  echo  [1/5] Data directory exists, skipping initialization.
  goto :db_bootstrap_done
)
rem -- data dir exists but has no mysql system db = residual/corrupt: wipe and rebuild --
if exist "%DATA_DIR%" rmdir /s /q "%DATA_DIR%"
mkdir "%DATA_DIR%" 2>nul
  echo  [1/5] First run, initializing database...
  echo        ^(about 15-30 seconds, please wait^)
  echo.
  "%MYSQL_INSTALL_EXE%" "--datadir=%DATA_DIR%" "--password=%DB_PASS%" >"%LOGS_DIR%\db_init.log" 2>&1
  if errorlevel 1 (
    echo  [ERROR] Database initialization failed!
    echo.
    echo  ---- db_init.log last 20 lines ----
    powershell -NoProfile -NonInteractive -Command "Get-Content '%LOGS_DIR%\db_init.log' -Tail 20 | ForEach-Object { '  ' + $_ }" 2>nul
    echo  --------------------------------
    echo  Full log path: %LOGS_DIR%\db_init.log
    goto :fatal
  )
  echo        Initialization complete.
:db_bootstrap_done

rem -- Start MariaDB --
echo  [2/5] Starting database service...
start "" /B "%MYSQLD_EXE%" "--defaults-file=%MY_INI%" "--datadir=%DATA_DIR%"

set /a WAIT=0
set /p "=        Waiting for database " <nul
:waitdb
timeout /t 1 /nobreak >nul
"%MYSQLADMIN_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% ping >nul 2>&1
if not errorlevel 1 goto :db_ready
set /p "=." <nul
set /a WAIT+=1
if %WAIT% lss 45 goto :waitdb
echo.
echo  [ERROR] Database start timed out (45s). Details: %LOGS_DIR%\mysql_error.log
goto :fatal
:db_ready
echo  OK

rem -- Create database (idempotent) --
"%MYSQL_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% ^
  -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" >nul 2>&1

:check_node_port
call :port_in_use %APP_PORT%
if "%PORT_USED%"=="1" (
  echo  [i] Backend port %APP_PORT% already listening; service running, opening browser.
  goto :open_browser
)

rem -- Start Node backend (Chromium path injected via process env) --
echo  [3/5] Starting backend service...
set "PUPPETEER_EXECUTABLE_PATH=%CHROMIUM_EXE%"
set "PUPPETEER_SKIP_DOWNLOAD=true"
rem cd into backend so require('dotenv').config() finds .env (dotenv reads process.cwd()/.env)
cd /d "%ROOT%\app\backend"
start "" /B "%NODE_EXE%" "%APP_ENTRY%" 1>"%LOGS_DIR%\node.log" 2>&1
cd /d "%ROOT%"

rem Wait for backend health (up to 55s; PowerShell compatible with pre-Win10 1803)
set /a WAIT=0
set /p "=        Waiting for backend " <nul
:waitnode
timeout /t 2 /nobreak >nul
powershell -NoProfile -NonInteractive -Command "try{$r=(Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/api/v1/health' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop).Content;if($r -match 'connected'){exit 0}else{exit 1}}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto :node_ready
set /p "=." <nul
set /a WAIT+=2
if %WAIT% lss 55 goto :waitnode
echo.
echo  [WARN] Backend timed out, opening browser anyway. If the page is blank, please refresh shortly.
echo         Log: %LOGS_DIR%\node.log
goto :open_browser
:node_ready
echo  OK

echo  [4/5] Checking and initializing database data...
if exist "%SEED_FLAG%" (
  echo        Data already initialized, skipping.
  goto :seed_done
)
rem -- determine import need from real table: count rows in users (treat missing table as 0) --
del "%LOGS_DIR%\user_count.txt" 2>nul
"%MYSQL_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% -N -s -e "SELECT COUNT(*) FROM %DB_NAME%.users" 1>"%LOGS_DIR%\user_count.txt" 2>nul
set "USER_COUNT=0"
if exist "%LOGS_DIR%\user_count.txt" (
  for /f "usebackq delims=" %%C in ("%LOGS_DIR%\user_count.txt") do set "USER_COUNT=%%C"
)
if not defined USER_COUNT set "USER_COUNT=0"
if "%USER_COUNT%"=="0" (
  if exist "%SQL_SEED%" (
    echo        Database is empty, importing production data ^(qms_production_backup.sql^)...
    "%MYSQL_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% %DB_NAME% < "%SQL_SEED%" >"%LOGS_DIR%\sql_import.log" 2>&1
    if errorlevel 1 (
      echo        [WARN] Production data import failed, falling back to default seed script.
      echo               Details: %LOGS_DIR%\sql_import.log
      if exist "%SEED_SCRIPT%" "%NODE_EXE%" "%SEED_SCRIPT%" 1>>"%LOGS_DIR%\seed.log" 2>&1
    ) else (
      echo        Production data import complete.
      echo done> "%SEED_FLAG%"
    )
  ) else (
    echo        [WARN] Production SQL file not found, using default seed script.
    if exist "%SEED_SCRIPT%" "%NODE_EXE%" "%SEED_SCRIPT%" 1>>"%LOGS_DIR%\seed.log" 2>&1
    echo done> "%SEED_FLAG%"
  )
) else (
  echo        Database already has %USER_COUNT% users, skipping import.
  echo done> "%SEED_FLAG%"
)
:seed_done
rem -- ensure qms_users exists (production backup names the user table "users"; backend requires qms_users). idempotent mirror; silently skips if users missing --
"%MYSQL_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% %DB_NAME% -e "CREATE TABLE IF NOT EXISTS qms_users LIKE users; INSERT IGNORE INTO qms_users SELECT * FROM users;" >"%LOGS_DIR%\ensure_qms_users.log" 2>&1
:open_browser
echo  [5/5] Opening browser...
rem Prefer the welcome page (accounts + entry links); fall back to enterprise portal
set "WELCOME=%ROOT%\app\welcome.html"
if exist "%WELCOME%" (
  start "" "%WELCOME%"
) else (
  start "" "http://localhost:%APP_PORT%/exam-admin"
)

rem -- Print access info --
echo.
echo  ============================================================
echo   Service is ready!
echo.
echo   Access URLs:
echo     Enterprise (authoring / exam mgmt) http://localhost:%APP_PORT%/exam-admin
echo     Student    (online exam)           http://localhost:%APP_PORT%/exam-student
echo     Grader                             http://localhost:%APP_PORT%/exam-grader
echo     Super-Admin                        http://localhost:%APP_PORT%/exam-super-admin
echo.
echo   Initial accounts (from production DB import; passwords as in production):
echo     System Admin     username: admin            role: admin
echo     Enterprise Admin username: enterprise       role: enterprise
echo     Enterprise Acct  username: Shengju Pingce (CN)  role: enterprise
echo     Test Candidate   username: candidate        role: candidate
echo     Candidates       username: 2024001-2024016 etc (25 total) role: candidate
echo.
echo   Note: passwords are bcrypt hashes from production; plaintext cannot be shown. Use production passwords to log in.
echo.
echo   LAN access: replace localhost with this machine's IP.
echo.
echo   [!] Keep this window open. Closing it stops all services.
echo  ============================================================
echo.

rem -- Continuous monitor (health check every 15s; warn on crash) --
:monitor
timeout /t 15 /nobreak >nul
powershell -NoProfile -NonInteractive -Command "try{Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/api/v1/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [%time%] WARN: backend not responding, service may have stopped. See logs\node.log
)
goto :monitor

rem -- Subroutine: check whether a TCP port has a listening process --
:port_in_use
set "PORT_USED=0"
netstat -ano 2>nul | findstr /R "[ :]%~1 " | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 set "PORT_USED=1"
goto :eof

:fatal
echo.
echo  Please send the log files under logs\ to technical support.
echo  Press any key to exit...
pause >nul
exit /b 1
