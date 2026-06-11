@echo off
chcp 936 >nul
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "DATA_DIR=%ROOT%\data"
set "LOGS_DIR=%ROOT%\logs"
set "MYSQLADMIN_EXE=%ROOT%\runtime\mariadb\bin\mysqladmin.exe"
set "DB_PASS=ShengjuLocal2024"

echo ============================================================
echo   [WARNING] Reset database
echo ============================================================
echo.
echo   This will delete ALL exam data, including:
echo   - all questions, question banks, papers
echo   - all candidate enrollments and answer records
echo   - all user accounts
echo.
echo   This operation cannot be undone!
echo.
set /p "CONFIRM=Confirm reset? Type YES and press Enter (anything else cancels): "
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled.
  pause
  exit /b 0
)

echo.
echo Stopping database service...
"%MYSQLADMIN_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P 3306 shutdown >nul 2>&1
taskkill /f /im mysqld.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Deleting data directory...
if exist "%DATA_DIR%" (
  rd /s /q "%DATA_DIR%"
  mkdir "%DATA_DIR%"
)

echo Cleaning logs...
if exist "%LOGS_DIR%\mysql_error.log" del /f /q "%LOGS_DIR%\mysql_error.log"
if exist "%LOGS_DIR%\node.log" del /f /q "%LOGS_DIR%\node.log"

echo.
echo Reset complete. Please re-run the Start Exam System shortcut to re-initialize.
pause
