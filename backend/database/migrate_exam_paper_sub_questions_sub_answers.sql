-- 为 exam_paper_sub_questions 表添加子小题答案和解析字段
-- 子小题答案和解析以JSON数组格式存储，格式：[{sub_number: "(1)", answer: "...", answer_html: "...", explanation: "...", explanation_html: "..."}, ...]
SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_sub_answers_fields_to_exam_paper_sub_questions$$
CREATE PROCEDURE add_sub_answers_fields_to_exam_paper_sub_questions()
BEGIN
    DECLARE column_exists INT DEFAULT 0;
    
    -- 检查 sub_answers 字段是否存在
    SELECT COUNT(*) INTO column_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'exam_paper_sub_questions'
    AND COLUMN_NAME = 'sub_answers';
    
    IF column_exists = 0 THEN
        ALTER TABLE exam_paper_sub_questions
        ADD COLUMN sub_answers LONGTEXT DEFAULT NULL COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]';
    END IF;
    
    -- 检查 sub_explanations 字段是否存在
    SET column_exists = 0;
    SELECT COUNT(*) INTO column_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'exam_paper_sub_questions'
    AND COLUMN_NAME = 'sub_explanations';
    
    IF column_exists = 0 THEN
        ALTER TABLE exam_paper_sub_questions
        ADD COLUMN sub_explanations LONGTEXT DEFAULT NULL COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]';
    END IF;
END$$

DELIMITER ;

CALL add_sub_answers_fields_to_exam_paper_sub_questions();
DROP PROCEDURE IF EXISTS add_sub_answers_fields_to_exam_paper_sub_questions;
