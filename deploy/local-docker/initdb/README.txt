【首次启动 MySQL 空数据卷时】会自动执行本目录下所有 .sql / .sh（按文件名排序）。

从服务器迁数据到本地（示例）：
1. 在服务器上导出主库（库名与线上一致，例如 question_management_shared）：
   mysqldump -h127.0.0.1 -uroot -p --single-transaction --routines --triggers question_management_shared > main.sql
2. 若使用人才网库 shengju，再导出：
   mysqldump -h127.0.0.1 -uroot -p --single-transaction --routines --triggers shengju > shengju.sql
3. 将 main.sql、shengju.sql 放入本目录，并改名为：
   01-main.sql
   02-shengju.sql
   （必须晚于 00-create-shengju-db.sql 执行；若 dump 内已含 CREATE DATABASE，请先编辑去掉或改用 --databases 单独导出）

注意：若 data 卷已存在且有数据，initdb 不会再次执行；需 docker compose down -v 清空卷后再导入。
