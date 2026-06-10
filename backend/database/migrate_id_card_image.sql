-- 为 users 表添加身份证照片路径字段（用于扫脸核验）
-- 执行前请确保已 use question_management_shared

SET NAMES utf8mb4;

ALTER TABLE users ADD COLUMN id_card_image_path VARCHAR(512) COMMENT '身份证照片存储路径（相对路径，用于人脸核验）' AFTER id_card;
