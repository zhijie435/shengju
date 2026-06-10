# 如何执行数据库迁移

迁移脚本位于 `backend/database/` 目录，用于给表增加字段或新建表。执行前请确认 MySQL 已启动，且使用的数据库与后端一致（默认主库为 `question_management_shared`）。

---

## 一、命令行执行（推荐）

在项目根目录或 `backend` 目录下打开终端，按你的环境选择一种方式。

### 1. 指定数据库名执行（默认主库）

```bash
mysql -u root -p question_management_shared < backend/database/migrate_exam_answers_slot_submitted.sql
```

按提示输入 MySQL 的 root 密码。若 root 无密码：

```bash
mysql -u root question_management_shared < backend/database/migrate_exam_answers_slot_submitted.sql
```

### 2. 与后端 .env 保持一致

若在 `backend/.env` 里配置了数据库，请用相同的主机、端口、用户、密码和**数据库名**执行。例如：

```bash
mysql -h localhost -P 3306 -u root -p
```

登录后执行：

```sql
USE question_management_shared;   -- 或你的 MAIN_DB_NAME
SOURCE D:/高亚军工作资料/圣举人才网/新的/backend/database/migrate_exam_answers_slot_submitted.sql;
```

`SOURCE` 路径请改成你电脑上该 SQL 文件的**绝对路径**（Windows 可用 `/` 或 `\`）。

### 3. Windows 下路径示例

若在「新的」目录下执行，且 MySQL 在 PATH 中：

```bash
mysql -u root -p question_management_shared < database/migrate_exam_answers_slot_submitted.sql
```

---

## 二、Navicat / 其他图形化工具

1. 连接到你的 MySQL 服务。
2. 选中主库（如 `question_management_shared`）。
3. 打开「查询」或「SQL 编辑器」。
4. 打开文件：`backend/database/migrate_exam_answers_slot_submitted.sql`，或把其内容复制进编辑器。
5. 执行该 SQL（运行/执行按钮）。

---

## 三、本次迁移说明（slot_submitted）

- **脚本**：`migrate_exam_answers_slot_submitted.sql`
- **作用**：在 `exam_answers` 表增加字段 `slot_submitted`，用于记录小题是否被考生点击「提交」。
- **仅需执行一次**。若该字段已存在，再次执行会报错（可忽略，表示已迁移过）。

执行成功后，考生端掉线重进或统一提交后再次进入，已提交的小题会正确显示为「已提交」并保留原内容。

---

## 四、执行后仍不生效时请排查

1. **确认迁移在「当前后端使用的库」执行**  
   后端连接的是 `.env` 里的 `MAIN_DB_NAME`（默认 `question_management_shared`）。若在 Navicat 里执行迁移时选错了库，会出现“已执行但仍不生效”。

2. **运行校验脚本（推荐）**  
   在 **backend** 目录下执行：
   ```bash
   node scripts/check_slot_submitted_migration.js
   ```
   - 输出「迁移校验通过」表示当前连接库中 `exam_answers.slot_submitted` 已存在。
   - 若提示「未找到 slot_submitted 列」，说明当前连接库尚未执行迁移，请在该脚本显示的库中执行 `migrate_exam_answers_slot_submitted.sql`。

3. **重启后端**  
   修改数据库或执行迁移后，请重启 Node 后端服务，再在考生端重新进入考试测试。

4. **清缓存再测**  
   考生端可尝试硬刷新（Ctrl+F5）或清除站点数据后重新登录，再进入考试查看是否恢复已提交内容。

---

## 五、考生管理显示学历/岗位/身份证照（笔试系统）

若在「考生管理」列表中**学历、岗位、岗位代码、身份证照**等列为空，说明 `users` 表尚未添加考生扩展字段。请按顺序执行以下脚本（在 **backend** 目录下）：

```bash
node scripts/run_users_candidate_migration.js
node scripts/run_id_card_image_migration.js
node scripts/run_education_job_code_migration.js
```

- 三个脚本均会自动跳过已存在的列，可重复执行。
- 执行完成后，**重新从企业端导入一次考生**（或重新执行「按批次从企业导入」），数据会写入 `users` 表，考生管理列表即可正常显示学历、报考岗位名称、岗位代码、身份证照等。
