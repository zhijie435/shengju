-- 创建表管理表（如果不存在）
USE question_recognition;

CREATE TABLE IF NOT EXISTS question_bank_tables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(200) NOT NULL UNIQUE COMMENT '表名（格式：question_bank_类别_科目）',
    category VARCHAR(100) NOT NULL COMMENT '类别',
    subject VARCHAR(100) NOT NULL COMMENT '科目',
    question_count INT DEFAULT 0 COMMENT '题目数量',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category_subject (category, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库表管理表';









