@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动评分系统前端...
echo.
npm run dev
pause
