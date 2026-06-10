-- 创建数据库
CREATE DATABASE IF NOT EXISTS question_recognition CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE question_recognition;

-- 大题表
CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_html LONGTEXT NOT NULL COMMENT 'HTML格式的完整内容',
    content_text TEXT COMMENT '纯文本内容',
    images_base64 LONGTEXT COMMENT 'Base64编码的图片（JSON格式数组）',
    project_name VARCHAR(255) COMMENT '项目名称',
    total_score INT DEFAULT 0 COMMENT '总分',
    exam_time INT DEFAULT 0 COMMENT '考试时长（分钟）',
    page_size VARCHAR(50) DEFAULT 'A4' COMMENT '页面大小',
    notes TEXT COMMENT '备注信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大题内容表';

-- 小题表
CREATE TABLE IF NOT EXISTS sub_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL COMMENT '关联的大题ID',
    number VARCHAR(50) NOT NULL COMMENT '题号（如：1, 2, 3）',
    sub_number VARCHAR(50) COMMENT '子题号（如：(1), (2) 或 1.1, 1.2）',
    content_html LONGTEXT NOT NULL COMMENT 'HTML格式的小题内容',
    content_text TEXT COMMENT '纯文本内容',
    score INT DEFAULT 0 COMMENT '分值',
    difficulty VARCHAR(20) DEFAULT '中等' COMMENT '难度：简单、中等、困难',
    type ENUM('parent', 'child') DEFAULT 'child' COMMENT '类型：parent-大题，child-小题',
    full_content LONGTEXT COMMENT '完整内容（包含题号）',
    answer TEXT COMMENT '答案',
    answer_html LONGTEXT COMMENT '答案HTML格式',
    explanation TEXT COMMENT '解析',
    explanation_html LONGTEXT COMMENT '解析HTML格式',
    sub_answers LONGTEXT COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]',
    sub_explanations LONGTEXT COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    INDEX idx_question_id (question_id),
    INDEX idx_number (number),
    INDEX idx_difficulty (difficulty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小题表';

-- 题库表（独立的小题库）
CREATE TABLE IF NOT EXISTS question_bank (
    id INT AUTO_INCREMENT PRIMARY KEY,
    number VARCHAR(50) NOT NULL COMMENT '题号（如：1, 2, 3）',
    sub_number VARCHAR(50) COMMENT '子题号（如：(1), (2) 或 1.1, 1.2）',
    content_html LONGTEXT NOT NULL COMMENT 'HTML格式的小题内容',
    content_text TEXT COMMENT '纯文本内容',
    score INT DEFAULT 0 COMMENT '分值',
    category VARCHAR(100) DEFAULT '未分类' COMMENT '分类（如：数学、语文、英语等）',
    tags VARCHAR(255) COMMENT '标签（逗号分隔）',
    difficulty VARCHAR(20) DEFAULT '中等' COMMENT '难度：简单、中等、困难',
    images_base64 LONGTEXT COMMENT 'Base64编码的图片（JSON格式数组）',
    full_content LONGTEXT COMMENT '完整内容（包含题号）',
    answer TEXT COMMENT '答案',
    answer_html LONGTEXT COMMENT '答案HTML格式',
    explanation TEXT COMMENT '解析',
    explanation_html LONGTEXT COMMENT '解析HTML格式',
    sub_answers LONGTEXT COMMENT '子小题答案JSON数组，格式：[{sub_number: "(1)", answer: "...", answer_html: "..."}, ...]',
    sub_explanations LONGTEXT COMMENT '子小题解析JSON数组，格式：[{sub_number: "(1)", explanation: "...", explanation_html: "..."}, ...]',
    notes TEXT COMMENT '备注信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_difficulty (difficulty),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库表';




