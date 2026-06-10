@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ========================================
echo   Startup - Saint Talent Network
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js:
node --version
echo.

if not exist "backend" (
    echo [ERROR] backend folder not found
    pause
    exit /b 1
)

if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    cd backend
    call npm install
    if errorlevel 1 (
        echo [ERROR] Backend install failed
        cd ..
        pause
        exit /b 1
    )
    cd ..
)

if exist "backend\scripts\run_online_exam_migration.js" (
    echo Checking database...
    cd backend
    node scripts/run_online_exam_migration.js 2>nul
    cd ..
)

if exist "frontend" (
    for %%d in (exam-student exam-admin exam-super-admin) do (
        if exist "frontend\%%d\package.json" (
            if not exist "frontend\%%d\node_modules" (
                echo Installing %%d...
                cd frontend\%%d
                call npm install
                cd "%ROOT%"
            )
        )
    )
)

if not exist "backend\.env" (
    echo.
    echo [WARN] backend\.env not found
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env" >nul
        echo Created .env from .env.example - please edit with your DB password
    )
    echo.
)

echo Checking ports...
for %%p in (3000 5174 5175 5176) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p" ^| findstr "LISTENING" 2^>nul') do (
        taskkill /F /PID %%a >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
)

echo Starting backend...
start "Backend" cmd /k "call "%ROOT%backend\start.bat""

if exist "frontend\exam-student\start.bat" (
    start "Student" cmd /k "call "%ROOT%frontend\exam-student\start.bat""
)
if exist "frontend\exam-admin\start.bat" (
    start "Enterprise" cmd /k "call "%ROOT%frontend\exam-admin\start.bat""
)
if exist "frontend\exam-super-admin\start.bat" (
    start "Admin" cmd /k "call "%ROOT%frontend\exam-super-admin\start.bat""
)

echo Waiting...
timeout /t 8 /nobreak >nul

start "" "http://127.0.0.1:3000/src/app.html"

echo.
echo ========================================
echo   Ready
echo ========================================
echo Main:    http://127.0.0.1:3000/src/app.html
echo Backend: http://127.0.0.1:3000
echo Student: http://127.0.0.1:5176
echo Enterprise: http://127.0.0.1:5174
echo Admin:   http://127.0.0.1:5175
echo ========================================
pause
