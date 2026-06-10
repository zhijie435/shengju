@echo off
setlocal

rem Root directory of the project (this script's directory)
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ========================================
echo Starting Exam Grader Sub-account System
echo ========================================
echo.

rem [1/3] Start backend on port 3000 if not running
echo [1/3] Checking backend service (port 3000)...
netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Backend service is already running on port 3000.
) else (
    echo Backend service is not running. Starting backend...
    start "Backend Service" cmd /k cd /d "%ROOT%backend" ^&^& npm start
    echo Waiting 5 seconds for backend to start...
    timeout /t 5 /nobreak >nul
)

echo.
echo [2/3] Checking frontend dependencies (exam-grader)...
if not exist "frontend\exam-grader\node_modules" (
    echo Frontend dependencies not installed. Running npm install...
    cd /d "%ROOT%frontend\exam-grader"
    call npm install
    cd /d "%ROOT%"
) else (
    echo Frontend dependencies already installed.
)

echo.
echo [3/3] Starting frontend dev server (exam-grader)...
start "Exam Grader Frontend" cmd /k cd /d "%ROOT%frontend\exam-grader" ^&^& npm run dev

echo.
echo ========================================
echo All services started.
echo Frontend: http://127.0.0.1:5177
echo Backend : http://127.0.0.1:3000
echo ========================================
echo.

echo Opening browser in 5 seconds...
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:5177"

echo.
pause
endlocal
