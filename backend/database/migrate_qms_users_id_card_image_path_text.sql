-- =============================================================================
-- qms_users.id_card_image_path 改为 TEXT（OSS 长签名 URL 常超过 VARCHAR(1024)）
-- =============================================================================
--
-- 在服务器上（把路径换成你实际项目目录），任选一种方式执行：
--
-- 方式 A：重定向 SQL 文件（推荐）
--   cd /var/www/新的/backend
--   mysql -h127.0.0.1 -u shengju -p shengju < database/migrate_qms_users_id_card_image_path_text.sql
--
-- 方式 B：登录 mysql 后 source
--   mysql -h127.0.0.1 -u shengju -p shengju
--   MariaDB [shengju]> SOURCE /var/www/新的/backend/database/migrate_qms_users_id_card_image_path_text.sql;
--
-- 方式 C：只执行这一句（复制粘贴）
--   ALTER TABLE qms_users MODIFY COLUMN id_card_image_path TEXT NULL COMMENT '身份证/人像图URL或相对路径';
--
-- 执行前建议 mysqldump 备份 qms_users；执行后无需改代码。
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE qms_users MODIFY COLUMN id_card_image_path TEXT NULL COMMENT '身份证/人像图URL或相对路径';
