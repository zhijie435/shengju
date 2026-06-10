-- 小题分值支持小数（如 1.15）。历史库中 exam_paper_sub_questions.score 多为 INT，会导致入库截断为 1，
-- 客观阅卷按 sq.score 给分/显示满分时也只能按 1 分计算。
-- 执行后请在试卷编辑中重新保存各小题分值（或 UPDATE），以修正已被截断的数据。

SET NAMES utf8mb4;

ALTER TABLE exam_paper_sub_questions
  MODIFY COLUMN score DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '分值';
