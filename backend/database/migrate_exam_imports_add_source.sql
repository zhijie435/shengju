-- 笔试系统 - 为 exam_import_batches 增加来源企业与来源系统字段
-- 在 question_management_shared 库中执行（先确保已执行 migrate_exam_imports.sql）
USE question_management_shared;

SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_source_fields_to_exam_import_batches$$
CREATE PROCEDURE add_source_fields_to_exam_import_batches()
BEGIN
    DECLARE column_count INT DEFAULT 0;

    -- 检查 source_company_id 字段是否存在
    SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'exam_import_batches'
      AND COLUMN_NAME = 'source_company_id';

    IF column_count = 0 THEN
        ALTER TABLE exam_import_batches
          ADD COLUMN source_company_id INT NULL COMMENT '来源人才网企业ID（sj_companies.id）' AFTER enterprise_name;
    END IF;

    SET column_count = 0;

    -- 检查 source_system 字段是否存在
    SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'exam_import_batches'
      AND COLUMN_NAME = 'source_system';

    IF column_count = 0 THEN
        ALTER TABLE exam_import_batches
          ADD COLUMN source_system VARCHAR(50) NULL COMMENT '来源系统标识，如 shengju_talent' AFTER source_company_id;
    END IF;

    -- 为 source_company_id 建索引，便于后续按企业来源统计
    SELECT COUNT(*) INTO column_count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'exam_import_batches'
      AND INDEX_NAME = 'idx_source_company_id';

    IF column_count = 0 THEN
        CREATE INDEX idx_source_company_id ON exam_import_batches(source_company_id);
    END IF;
END$$

DELIMITER ;

CALL add_source_fields_to_exam_import_batches();
DROP PROCEDURE IF EXISTS add_source_fields_to_exam_import_batches;

