-- 为题库表添加新字段：question_type（题型）、exam_purpose（考察目的）、grade（年级）
-- 本脚本会为所有动态题库表添加这些字段

USE question_recognition;

-- 获取所有动态题库表并添加字段
-- 注意：MySQL不支持在存储过程中使用动态SQL直接执行ALTER TABLE，需要手动或通过脚本执行

-- 为所有以 question_bank_ 开头的表添加新字段（如果不存在）
-- 由于MySQL的限制，这里提供模板，实际执行需要通过存储过程或应用层代码

-- 方案：通过存储过程批量添加字段

DELIMITER $$

DROP PROCEDURE IF EXISTS add_question_bank_fields$$

CREATE PROCEDURE add_question_bank_fields()
BEGIN
    DECLARE done INT DEFAULT 0;
    DECLARE table_name VARCHAR(255);
    DECLARE cur CURSOR FOR 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
        AND table_name LIKE 'question_bank_%';
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO table_name;
        IF done THEN
            LEAVE read_loop;
        END IF;

        -- 检查并添加 question_type 字段
        SET @sql = CONCAT(
            'ALTER TABLE `', table_name, '` ',
            'ADD COLUMN IF NOT EXISTS question_type VARCHAR(100) COMMENT ''题型（如：单选题、填空题等）'' AFTER tags'
        );
        SET @sql_check = CONCAT(
            'SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS ',
            'WHERE TABLE_SCHEMA = DATABASE() ',
            'AND TABLE_NAME = ''', table_name, ''' ',
            'AND COLUMN_NAME = ''question_type'''
        );
        
        -- 由于MySQL不支持IF NOT EXISTS语法在ALTER TABLE中，我们需要先检查
        PREPARE stmt_check FROM @sql_check;
        EXECUTE stmt_check;
        DEALLOCATE PREPARE stmt_check;

        IF @col_exists = 0 THEN
            SET @sql_alter = CONCAT(
                'ALTER TABLE `', table_name, '` ',
                'ADD COLUMN question_type VARCHAR(100) COMMENT ''题型（如：单选题、填空题等）'' AFTER tags'
            );
            PREPARE stmt FROM @sql_alter;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;

        -- 添加索引
        SET @sql_index1 = CONCAT(
            'ALTER TABLE `', table_name, '` ',
            'ADD INDEX IF NOT EXISTS idx_question_type (question_type)'
        );
        -- MySQL不支持IF NOT EXISTS在索引中，需要先检查
        SET @index_check = CONCAT(
            'SELECT COUNT(*) INTO @idx_exists FROM information_schema.STATISTICS ',
            'WHERE TABLE_SCHEMA = DATABASE() ',
            'AND TABLE_NAME = ''', table_name, ''' ',
            'AND INDEX_NAME = ''idx_question_type'''
        );
        PREPARE stmt_idx_check FROM @index_check;
        EXECUTE stmt_idx_check;
        DEALLOCATE PREPARE stmt_idx_check;

        IF @idx_exists = 0 THEN
            SET @sql_idx = CONCAT('ALTER TABLE `', table_name, '` ADD INDEX idx_question_type (question_type)');
            PREPARE stmt_idx FROM @sql_idx;
            EXECUTE stmt_idx;
            DEALLOCATE PREPARE stmt_idx;
        END IF;

        -- 检查并添加 exam_purpose 字段
        SET @sql_check2 = CONCAT(
            'SELECT COUNT(*) INTO @col_exists2 FROM information_schema.COLUMNS ',
            'WHERE TABLE_SCHEMA = DATABASE() ',
            'AND TABLE_NAME = ''', table_name, ''' ',
            'AND COLUMN_NAME = ''exam_purpose'''
        );
        PREPARE stmt_check2 FROM @sql_check2;
        EXECUTE stmt_check2;
        DEALLOCATE PREPARE stmt_check2;

        IF @col_exists2 = 0 THEN
            SET @sql_alter2 = CONCAT(
                'ALTER TABLE `', table_name, '` ',
                'ADD COLUMN exam_purpose VARCHAR(255) COMMENT ''考察目的'' AFTER question_type'
            );
            PREPARE stmt2 FROM @sql_alter2;
            EXECUTE stmt2;
            DEALLOCATE PREPARE stmt2;
        END IF;

        -- 检查并添加 grade 字段（如果不存在）
        SET @sql_check3 = CONCAT(
            'SELECT COUNT(*) INTO @col_exists3 FROM information_schema.COLUMNS ',
            'WHERE TABLE_SCHEMA = DATABASE() ',
            'AND TABLE_NAME = ''', table_name, ''' ',
            'AND COLUMN_NAME = ''grade'''
        );
        PREPARE stmt_check3 FROM @sql_check3;
        EXECUTE stmt_check3;
        DEALLOCATE PREPARE stmt_check3;

        IF @col_exists3 = 0 THEN
            SET @sql_alter3 = CONCAT(
                'ALTER TABLE `', table_name, '` ',
                'ADD COLUMN grade VARCHAR(50) COMMENT ''年级（仅教育类）'' AFTER subject'
            );
            PREPARE stmt3 FROM @sql_alter3;
            EXECUTE stmt3;
            DEALLOCATE PREPARE stmt3;
        END IF;

        -- 添加 grade 索引（如果不存在）
        SET @grade_idx_check = CONCAT(
            'SELECT COUNT(*) INTO @grade_idx_exists FROM information_schema.STATISTICS ',
            'WHERE TABLE_SCHEMA = DATABASE() ',
            'AND TABLE_NAME = ''', table_name, ''' ',
            'AND INDEX_NAME = ''idx_grade'''
        );
        PREPARE stmt_grade_idx_check FROM @grade_idx_check;
        EXECUTE stmt_grade_idx_check;
        DEALLOCATE PREPARE stmt_grade_idx_check;

        IF @grade_idx_exists = 0 THEN
            SET @sql_grade_idx = CONCAT('ALTER TABLE `', table_name, '` ADD INDEX idx_grade (grade)');
            PREPARE stmt_grade_idx FROM @sql_grade_idx;
            EXECUTE stmt_grade_idx;
            DEALLOCATE PREPARE stmt_grade_idx;
        END IF;

    END LOOP;

    CLOSE cur;
END$$

DELIMITER ;

-- 执行存储过程
CALL add_question_bank_fields();

-- 删除存储过程
DROP PROCEDURE IF EXISTS add_question_bank_fields;
