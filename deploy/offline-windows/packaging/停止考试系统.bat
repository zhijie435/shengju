@echo off
chcp 936 >nul
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "MYSQLADMIN_EXE=%ROOT%\runtime\mariadb\bin\mysqladmin.exe"
set "DB_PASS=ShengjuLocal2024"
set "DB_PORT=3306"

echo Stopping exam system services...

rem Stop Node by window title
taskkill /f /fi "imagename eq node.exe" /fi "windowtitle eq Shengju Exam System*" >nul 2>&1
rem If the window-title filter misses, also kill whatever listens on port 3000
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr LISTENING') do (
  taskkill /f /pid %%p >nul 2>&1
)

rem Gracefully shut down MariaDB
"%MYSQLADMIN_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P %DB_PORT% shutdown >nul 2>&1
if errorlevel 1 (
  rem Force-kill mysqld
  taskkill /f /im mysqld.exe >nul 2>&1
)

echo All services stopped.
timeout /t 2 /nobreak >nul
