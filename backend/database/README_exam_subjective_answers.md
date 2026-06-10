# 主观题答案表迁移说明

出现「主观题答案表不存在，请先执行 migrate_exam_subjective_answers.sql」时，需要先创建 `exam_subjective_answers` 表。

## 方式一：用脚本执行（推荐）

在项目根目录执行（会读取 `backend/.env` 中的数据库配置）：

```bash
node backend/scripts/run_exam_subjective_answers_migration.js
```

或在 backend 目录下执行：

```bash
cd backend
node scripts/run_exam_subjective_answers_migration.js
```

## 方式二：在 MySQL 中手动执行 SQL

1. 打开 MySQL 客户端（Navicat、MySQL Workbench 或命令行 `mysql -u 用户名 -p`）。
2. 选择与考试系统相同的数据库（如 `question_management_shared` 或你项目中的库名）。
3. 执行 `backend/database/migrate_exam_subjective_answers.sql` 中的全部 SQL。

或命令行一行执行：

```bash
mysql -u 你的用户名 -p 你的数据库名 < backend/database/migrate_exam_subjective_answers.sql
```

执行成功后即可在阅卷系统主观题列表中点击「同步考生答案」正常使用。
