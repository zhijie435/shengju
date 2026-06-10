-- 为已存在的 sub_questions 表添加 difficulty 字段
-- 如果字段已存在，此语句会报错，可以忽略

ALTER TABLE sub_questions 
ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) DEFAULT '中等' COMMENT '难度：简单、中等、困难' AFTER score;

-- 添加索引
ALTER TABLE sub_questions 
ADD INDEX IF NOT EXISTS idx_difficulty (difficulty);
