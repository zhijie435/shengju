@echo off
title Shengju Talent
cd /d "%~dp0"
set "BACKEND_DIR=%~dp0backend"

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/ and run again.
    pause
    exit /b 1
)

REM Copy .env from .env.example if missing
if not exist "%BACKEND_DIR%\.env" (
    if exist "%BACKEND_DIR%\.env.example" (
        copy "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
        echo [INFO] Created .env. Edit backend\.env for DB password if needed.
    )
)

REM npm install when node_modules missing
if not exist "%BACKEND_DIR%\node_modules" (
    echo [INFO] Installing dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check network or Node.js.
        cd /d "%~dp0"
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

echo [1/2] Starting backend on port 3001...
REM cd to backend first, then start new window - new process inherits current directory, so no Chinese path in start
cd /d "%BACKEND_DIR%"
start "Shengju-API" cmd /k "node src/index.js & pause"
cd /d "%~dp0"
timeout /t 3 /nobreak >nul

echo [2/2] Opening browser...
echo   API:  http://127.0.0.1:3001
echo   Site: http://127.0.0.1:3001/index.html
echo Do not close the Shengju-API window.
start "" "http://127.0.0.1:3001/index.html"
echo If browser did not open, visit: http://127.0.0.1:3001/index.html
pause
