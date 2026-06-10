-- 主库名由 docker-compose 的 MYSQL_DATABASE 创建；此处仅保证人才网库存在（与 backend/.env.example 一致）
CREATE DATABASE IF NOT EXISTS shengju CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
