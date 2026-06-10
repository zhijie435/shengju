@echo off
chcp 936 >nul
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "MYSQLADMIN_EXE=%ROOT%\runtime\mariadb\bin\mysqladmin.exe"
set "DB_PASS=ShengjuLocal2024"
set "DB_PORT=3306"

echo 正在停止考试系统服务...

rem 停止 Node
taskkill /f /fi "imagename eq node.exe" /fi "windowtitle eq 圣举考试系统*" >nul 2>&1
rem 如上命令因 windowtitle 不准，再补一次通用停止
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr LISTENING') do (
  taskkill /f /pid %%p >nul 2>&1
)

rem 优雅关闭 MariaDB
"%MYSQLADMIN_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% shutdown >nul 2>&1
if errorlevel 1 (
  rem 强制结束 mysqld
  taskkill /f /im mysqld.exe >nul 2>&1
)

echo 所有服务已停止。
timeout /t 2 /nobreak >nul
