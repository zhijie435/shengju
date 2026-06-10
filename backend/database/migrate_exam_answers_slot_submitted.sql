-- 为 exam_answers 表增加小题「已提交」状态字段，用于掉线重进后恢复界面
-- 执行前请确保已 use 主库（如 question_management_shared）

SET NAMES utf8mb4;

ALTER TABLE exam_answers
  ADD COLUMN slot_submitted TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '小题是否已提交：0-仅保存未提交，1-考生点击过提交该小题'
  AFTER answer_data;
