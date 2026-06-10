-- 为 sub_questions 和 question_bank 表添加子小题答案和解析字段
-- 子小题答案和解析以JSON数组格式存储，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, {sub_number: "(2)", explanation: "...", explanation_html: "..."}, ...]
SET NAMES utf8mb4;

-- 为 sub_questions 表添加字段（如果字段不存在）
-- MySQL不支持 IF NOT EXISTS，使用存储过程检查并添加
DELIMITER $$

DROP PROCEDURE IF EXISTS add_sub_answers_fields_to_sub_questions$$
CREATE PROCEDURE add_sub_answers_fields_to_sub_questions()
BEGIN
    DECLARE column_exists INT DEFAULT 0;
    
    -- 检查 sub_answers 字段是否存在
    SELECT COUNT(*) INTO column_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sub_questions'
    AND COLUMN_NAME = 'sub_answers';
    
    IF column_exists = 0 THEN
        ALTER TABLE sub_questions
        ADD COLUMN sub_answers LONGTEXT DEFAULT NULL COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]';
    END IF;
    
    -- 检查 sub_explanations 字段是否存在
    SET column_exists = 0;
    SELECT COUNT(*) INTO column_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sub_questions'
    AND COLUMN_NAME = 'sub_explanations';
    
    IF column_exists = 0 THEN
        ALTER TABLE sub_questions
        ADD COLUMN sub_explanations LONGTEXT DEFAULT NULL COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]';
    END IF;
END$$

DELIMITER ;

CALL add_sub_answers_fields_to_sub_questions();
DROP PROCEDURE IF EXISTS add_sub_answers_fields_to_sub_questions;

-- 为 question_bank 表添加字段（如果表存在且字段不存在）
-- 注意：question_bank 表可能是动态创建的，动态表的字段添加已在 questionBankTableManager.js 中处理
DELIMITER $$

DROP PROCEDURE IF EXISTS add_sub_answers_fields_to_question_bank$$
CREATE PROCEDURE add_sub_answers_fields_to_question_bank()
BEGIN
    DECLARE table_exists INT DEFAULT 0;
    DECLARE column_exists INT DEFAULT 0;
    
    -- 检查 question_bank 表是否存在
    SELECT COUNT(*) INTO table_exists
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'question_bank';
    
    IF table_exists > 0 THEN
        -- 检查 sub_answers 字段是否存在
        SELECT COUNT(*) INTO column_exists
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'question_bank'
        AND COLUMN_NAME = 'sub_answers';
        
        IF column_exists = 0 THEN
            ALTER TABLE question_bank
            ADD COLUMN sub_answers LONGTEXT DEFAULT NULL COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]';
        END IF;
        
        -- 检查 sub_explanations 字段是否存在
        SET column_exists = 0;
        SELECT COUNT(*) INTO column_exists
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'question_bank'
        AND COLUMN_NAME = 'sub_explanations';
        
        IF column_exists = 0 THEN
            ALTER TABLE question_bank
            ADD COLUMN sub_explanations LONGTEXT DEFAULT NULL COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]';
        END IF;
    END IF;
END$$

DELIMITER ;

CALL add_sub_answers_fields_to_question_bank();
DROP PROCEDURE IF EXISTS add_sub_answers_fields_to_question_bank;
