# 阅卷系统数据库迁移说明

## 迁移脚本位置
`backend/database/migrate_grading_system.sql`

## 运行迁移

### 方法一：使用Node.js脚本（推荐）
```bash
node backend/scripts/run_grading_system_migration.js
```

或在Windows上：
```bash
backend\scripts\run_grading_system_migration.bat
```

### 方法二：使用API接口
访问：`http://localhost:3000/api/grading-system/init`

### 方法三：手动执行SQL
1. 打开MySQL客户端（如Navicat、MySQL Workbench等）
2. 连接到数据库：`question_management_shared`
3. 执行 `backend/database/migrate_grading_system.sql` 文件中的SQL语句

## 创建的表

迁移脚本会创建以下表：

1. **grading_accounts** - 子阅卷账号表
2. **grading_tasks** - 阅卷任务分配表
3. **grading_records** - 阅卷记录表

## 注意事项

- 执行前请确保 `exams` 和 `exam_answers` 表已存在
- 如果表已存在，迁移脚本会跳过创建（使用 `CREATE TABLE IF NOT EXISTS`）
- 迁移脚本会自动扩展 `users` 表的 `role` 字段以支持 `grader` 角色
