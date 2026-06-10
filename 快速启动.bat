@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo Quick Start - start backend and all frontends
echo.

rem Start unified backend
if exist "backend\start.bat" (
  start "Backend" cmd /k ""%ROOT%backend\start.bat""
) else (
  echo backend\start.bat not found.
)

timeout /t 2 /nobreak >nul

rem Start student / enterprise / admin frontends
if exist "frontend\exam-student\start.bat" (
  start "Student" cmd /k ""%ROOT%frontend\exam-student\start.bat""
)
if exist "frontend\exam-admin\start.bat" (
  start "Enterprise" cmd /k ""%ROOT%frontend\exam-admin\start.bat""
)
if exist "frontend\exam-super-admin\start.bat" (
  start "Admin" cmd /k ""%ROOT%frontend\exam-super-admin\start.bat""
)

rem Start sub-account grading system (frontend + its own checks)
if exist "启动子账号阅卷系统.bat" (
  start "Grader" cmd /k ""%ROOT%启动子账号阅卷系统.bat""
) else (
  echo 启动子账号阅卷系统.bat not found.
)

echo Waiting 10s...
timeout /t 10 /nobreak >nul
start "" "http://127.0.0.1:3000/src/app.html"

echo.
echo Main: http://127.0.0.1:3000/src/app.html
pause
endlocal
