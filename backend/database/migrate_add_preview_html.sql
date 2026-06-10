-- 添加预览HTML字段到exam_papers表
-- 用于保存完整的预览HTML（包括所有格式、样式、布局）

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 检查字段是否已存在，如果不存在则添加
SET @dbname = DATABASE();
SET @tablename = 'exam_papers';
SET @columnname = 'preview_html';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' LONGTEXT COMMENT ''完整的预览HTML内容（包括所有格式、样式、布局）''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET FOREIGN_KEY_CHECKS = 1;


