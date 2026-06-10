-- 为 exam_paper_sub_questions 添加标准答案、解析、评分要点
-- 通过 run_migration 或 run_grading_migration.js 执行

SET NAMES utf8mb4;

ALTER TABLE exam_paper_sub_questions 
ADD COLUMN standard_answer TEXT COMMENT '标准答案',
ADD COLUMN answer_analysis LONGTEXT COMMENT '答案解析',
ADD COLUMN grading_points JSON COMMENT '主观题评分要点';
