@echo off
chcp 65001 >nul
setlocal
echo ========================================
echo 检查服务状态
echo ========================================
echo.

echo [检查后端服务 - 端口 3000]
netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ 后端服务正在运行
    netstat -ano | findstr ":3000"
) else (
    echo × 后端服务未运行
    echo   请运行: cd backend ^&^& npm start
)
echo.

echo [检查前端服务 - 端口 5174]
netstat -ano | findstr ":5174" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ 前端服务正在运行
    netstat -ano | findstr ":5174"
) else (
    echo × 前端服务未运行
    echo   请运行: cd frontend\exam-grader ^&^& npm run dev
)
echo.

echo [检查 MySQL 服务 - 端口 3306]
netstat -ano | findstr ":3306" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ MySQL 服务正在运行
) else (
    echo × MySQL 服务未运行
    echo   请启动 MySQL 服务
)
echo.

echo ========================================
echo 检查完成
echo ========================================
echo.
echo 访问地址:
echo   前端: http://127.0.0.1:5174
echo   后端: http://127.0.0.1:3000/api
echo.
pause
