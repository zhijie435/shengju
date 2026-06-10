-- 主数据库初始化脚本
-- 用于存储用户信息、权限、共享题库等

CREATE DATABASE IF NOT EXISTS question_management_shared CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE question_management_shared;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
    password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
    role ENUM('admin', 'user') DEFAULT 'user' COMMENT '角色：admin-管理员，user-普通用户',
    email VARCHAR(100) COMMENT '邮箱',
    real_name VARCHAR(100) COMMENT '真实姓名',
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL COMMENT '最后登录时间',
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 用户数据库映射表
CREATE TABLE IF NOT EXISTS user_databases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL COMMENT '用户ID',
    database_name VARCHAR(100) NOT NULL UNIQUE COMMENT '用户数据库名称',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_database_name (database_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户数据库映射表';

-- 用户权限表
CREATE TABLE IF NOT EXISTS user_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL COMMENT '用户ID',
    can_contribute BOOLEAN DEFAULT TRUE COMMENT '可以向共享题库贡献题目',
    can_edit_shared BOOLEAN DEFAULT FALSE COMMENT '可以编辑共享题库（仅管理员）',
    can_manage_users BOOLEAN DEFAULT FALSE COMMENT '可以管理用户（仅管理员）',
    can_view_all_data BOOLEAN DEFAULT FALSE COMMENT '可以查看所有用户数据（仅管理员）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_user_id (user_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户权限表';

-- 共享题库表（扩展现有结构）
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
    notes TEXT COMMENT '备注信息',
    created_by INT COMMENT '创建者用户ID',
    status ENUM('approved', 'pending', 'rejected') DEFAULT 'pending' COMMENT '状态：approved-已审核，pending-待审核，rejected-已拒绝',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_category (category),
    INDEX idx_difficulty (difficulty),
    INDEX idx_status (status),
    INDEX idx_created_by (created_by),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='共享题库表';

-- 题库贡献审核表
CREATE TABLE IF NOT EXISTS question_bank_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL COMMENT '题目ID',
    contributor_id INT NOT NULL COMMENT '贡献者用户ID',
    reviewer_id INT COMMENT '审核者用户ID（管理员）',
    status ENUM('approved', 'rejected', 'pending') DEFAULT 'pending' COMMENT '审核状态',
    comment TEXT COMMENT '审核意见',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL COMMENT '审核时间',
    FOREIGN KEY (question_id) REFERENCES question_bank(id) ON DELETE CASCADE,
    FOREIGN KEY (contributor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_question_id (question_id),
    INDEX idx_contributor_id (contributor_id),
    INDEX idx_reviewer_id (reviewer_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库贡献审核表';

-- 创建默认管理员账号（密码：admin123，需要首次登录后修改）
-- 密码哈希使用bcrypt，这里先占位，实际创建时由代码生成
INSERT INTO users (username, password_hash, role, real_name, status) 
VALUES ('admin', '$2b$10$placeholder', 'admin', '系统管理员', 'active')
ON DUPLICATE KEY UPDATE username=username;

-- 为管理员创建权限记录
INSERT INTO user_permissions (user_id, can_contribute, can_edit_shared, can_manage_users, can_view_all_data)
SELECT id, TRUE, TRUE, TRUE, TRUE FROM users WHERE username = 'admin'
ON DUPLICATE KEY UPDATE user_id=user_id;
