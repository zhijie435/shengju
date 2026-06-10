@echo off
chcp 65001 >nul
echo 正在运行阅卷系统数据库迁移...
node backend/scripts/run_grading_system_migration.js
pause
