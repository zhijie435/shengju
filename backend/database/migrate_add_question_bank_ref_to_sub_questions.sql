-- 为 exam_paper_sub_questions 添加题库引用字段
-- 当小题来自题库时，可据此直接拉取答案和解析，无需按题干匹配
-- 若列已存在会报错，可忽略
SET NAMES utf8mb4;

ALTER TABLE exam_paper_sub_questions
ADD COLUMN question_bank_id INT DEFAULT NULL COMMENT '题库题目ID（来自试题编辑选择/上传）',
ADD COLUMN question_bank_category VARCHAR(100) DEFAULT NULL COMMENT '题库分类',
ADD COLUMN question_bank_subject VARCHAR(100) DEFAULT NULL COMMENT '题库科目';
