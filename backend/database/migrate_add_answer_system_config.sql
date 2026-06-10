-- 添加答题系统配置到 exams 表
-- 执行前请确保 exams 表已存在
-- 若 answer_system_config 列已存在则会报错，可忽略

SET NAMES utf8mb4;

ALTER TABLE exams 
ADD COLUMN answer_system_config JSON 
COMMENT '答题系统配置：{essayWordCount:800, drawingEnabled:true, drawingWidth:500, drawingHeight:300}' 
AFTER monitor_config;
