-- 扩展题库表，添加使用次数和科目字段
USE question_recognition;

-- 添加科目字段
ALTER TABLE question_bank 
ADD COLUMN IF NOT EXISTS subject VARCHAR(100) DEFAULT '未分类' COMMENT '科目（如：数学、语文、英语、物理、化学等）' AFTER category,
ADD COLUMN IF NOT EXISTS use_count INT DEFAULT 0 COMMENT '使用次数' AFTER difficulty,
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP NULL COMMENT '最后使用时间' AFTER use_count;

-- 添加索引
ALTER TABLE question_bank 
ADD INDEX IF NOT EXISTS idx_subject (subject),
ADD INDEX IF NOT EXISTS idx_use_count (use_count);









