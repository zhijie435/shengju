-- 为 exam_paper_sub_questions 添加答案与解析字段（题库导入用）
-- 若表由 migrate_exam_papers_shared 创建则无此四列。执行前请 use 你的试卷库。
-- 若列已存在会报错，可忽略；或使用 scripts/run_exam_paper_answer_explanation_migration.js 安全执行。

SET NAMES utf8mb4;

ALTER TABLE exam_paper_sub_questions
ADD COLUMN answer TEXT COMMENT '答案（纯文本，题库/Word导入）',
ADD COLUMN answer_html LONGTEXT COMMENT '答案HTML格式',
ADD COLUMN explanation TEXT COMMENT '解析（纯文本）',
ADD COLUMN explanation_html LONGTEXT COMMENT '解析HTML格式';
