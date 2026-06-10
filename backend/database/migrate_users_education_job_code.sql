-- 为 users 表添加学历、岗位代码（考生管理与企业端同步展示）
-- 执行前请确保已 use question_management_shared

SET NAMES utf8mb4;

ALTER TABLE users ADD COLUMN education VARCHAR(100) COMMENT '学历' AFTER position;
ALTER TABLE users ADD COLUMN job_code VARCHAR(50) COMMENT '岗位代码' AFTER education;
