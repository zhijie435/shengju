-- 笔试系统 - 为 enterprises 增加人才网企业ID，用于批次隔离与数据共享
-- 在 question_management_shared 库中执行（与线上笔试系统 enterprises 表同库）
USE question_management_shared;

SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_talent_company_id_to_enterprises$$
CREATE PROCEDURE add_talent_company_id_to_enterprises()
BEGIN
    DECLARE column_count INT DEFAULT 0;
    DECLARE index_count INT DEFAULT 0;

    -- 检查 talent_company_id 字段是否存在
    SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'enterprises'
      AND COLUMN_NAME = 'talent_company_id';

    IF column_count = 0 THEN
        ALTER TABLE enterprises
          ADD COLUMN talent_company_id INT NULL COMMENT '人才网企业ID(sj_companies.id)，用于批次隔离与数据共享' AFTER user_id;
    END IF;

    SET index_count = 0;

    -- 为 talent_company_id 建索引，便于按企业过滤批次
    SELECT COUNT(*) INTO index_count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'enterprises'
      AND INDEX_NAME = 'idx_talent_company_id';

    IF index_count = 0 THEN
        CREATE INDEX idx_talent_company_id ON enterprises(talent_company_id);
    END IF;
END$$

DELIMITER ;

CALL add_talent_company_id_to_enterprises();
DROP PROCEDURE IF EXISTS add_talent_company_id_to_enterprises;
