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
echo   [警告] 重置数据库
echo ============================================================
echo.
echo   此操作将删除所有考试数据，包括：
echo   - 所有试题、题库、试卷
echo   - 所有考生报名和答题记录
echo   - 所有用户账号
echo.
echo   此操作不可撤销！
echo.
set /p "CONFIRM=确认重置？请输入 YES 并回车（其他任意键取消）: "
if /i not "%CONFIRM%"=="YES" (
  echo 已取消。
  pause
  exit /b 0
)

echo.
echo 正在停止数据库服务...
"%MYSQLADMIN_EXE%" -u root "--password=%DB_PASS%" -h 127.0.0.1 -P 3306 shutdown >nul 2>&1
taskkill /f /im mysqld.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo 正在删除数据目录...
if exist "%DATA_DIR%" (
  rd /s /q "%DATA_DIR%"
  mkdir "%DATA_DIR%"
)

echo 正在清理日志...
if exist "%LOGS_DIR%\mysql_error.log" del /f /q "%LOGS_DIR%\mysql_error.log"
if exist "%LOGS_DIR%\node.log" del /f /q "%LOGS_DIR%\node.log"

echo.
echo 重置完成。请重新运行「启动考试系统.bat」完成初始化。
pause
