-- 为 exam_papers 表增加 project_info 字段（考试项目设置：指导语、结束语、评分要素、考官题本等）
-- 若字段已存在会报错，可忽略。执行前请确保已选择正确的数据库（如 question_management_shared）。

SET NAMES utf8mb4;

ALTER TABLE exam_papers
  ADD COLUMN project_info JSON DEFAULT NULL
  COMMENT '考试项目设置：指导语、结束语、评分要素、考官题本等';
