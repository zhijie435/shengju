-- 为 exam_paper_sub_questions 表添加 exam_purpose 字段（考察目的）
-- 如果字段已存在则跳过
-- 执行前请确保已 use question_management_shared

SET NAMES utf8mb4;

-- 检查字段是否存在，如果不存在则添加
SET @dbname = DATABASE();
SET @tablename = 'exam_paper_sub_questions';
SET @columnname = 'exam_purpose';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(255) COMMENT ''考察目的'' AFTER score')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
