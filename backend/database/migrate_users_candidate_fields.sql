-- 为 users 表添加考生相关字段
-- 执行前请确保已 use question_management_shared
-- 通过 run_users_candidate_migration.js 执行可自动跳过已存在的列

SET NAMES utf8mb4;

ALTER TABLE users ADD COLUMN phone VARCHAR(20) COMMENT '手机号' AFTER email;
ALTER TABLE users ADD COLUMN id_card VARCHAR(20) COMMENT '身份证号' AFTER phone;
ALTER TABLE users ADD COLUMN exam_number VARCHAR(50) COMMENT '准考证号' AFTER id_card;
ALTER TABLE users ADD COLUMN position VARCHAR(100) COMMENT '岗位' AFTER exam_number;
