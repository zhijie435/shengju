-- 在 question_management_shared 中创建试卷相关表（若不存在）
-- 用于保存整套试题、试卷管理。执行前请确保已 use question_management_shared。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 试卷表
CREATE TABLE IF NOT EXISTS exam_papers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paper_name VARCHAR(255) NOT NULL COMMENT '试卷名称',
  project_name VARCHAR(255) DEFAULT NULL COMMENT '项目名称',
  total_score INT DEFAULT 0 COMMENT '总分',
  exam_time INT DEFAULT 0 COMMENT '考试时长（分钟）',
  page_size VARCHAR(50) DEFAULT 'A4' COMMENT '页面大小',
  content_html LONGTEXT COMMENT '试卷原始HTML内容',
  content_text TEXT COMMENT '试卷纯文本内容',
  images_base64 LONGTEXT COMMENT 'Base64编码的图片（JSON格式数组）',
  notes TEXT COMMENT '备注信息',
  question_count INT DEFAULT 0 COMMENT '小题总数',
  major_question_count INT DEFAULT 0 COMMENT '大题总数',
  preview_html LONGTEXT COMMENT '完整的预览HTML内容（包括所有格式、样式、布局）',
  exam_type VARCHAR(20) DEFAULT 'written' COMMENT '考试类型：written-笔试，interview-面试',
  is_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用：0-禁用，1-启用',
  visible_side ENUM('candidate','enterprise') DEFAULT 'enterprise' COMMENT '显示端：candidate-求职者端, enterprise-企业端',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_created_at (created_at),
  INDEX idx_paper_name (paper_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷表';

-- 试卷大题表
CREATE TABLE IF NOT EXISTS exam_paper_major_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paper_id INT NOT NULL COMMENT '关联的试卷ID',
  major_number VARCHAR(50) NOT NULL COMMENT '大题号（如：一、二、三等）',
  question_type VARCHAR(100) DEFAULT NULL COMMENT '题型',
  content_html LONGTEXT COMMENT '大题题干HTML内容',
  content_text TEXT COMMENT '大题题干纯文本内容',
  total_score INT DEFAULT 0 COMMENT '大题总分值',
  question_count INT DEFAULT 0 COMMENT '小题数量',
  score_per_question DECIMAL(5,2) DEFAULT 0 COMMENT '每小题分值',
  display_text VARCHAR(500) DEFAULT NULL COMMENT '显示文本',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_paper_id (paper_id),
  INDEX idx_major_number (major_number),
  CONSTRAINT fk_major_paper FOREIGN KEY (paper_id) REFERENCES exam_papers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷大题表';

-- 试卷小题表
CREATE TABLE IF NOT EXISTS exam_paper_sub_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paper_id INT NOT NULL COMMENT '关联的试卷ID',
  major_question_id INT NOT NULL COMMENT '关联的大题ID',
  number VARCHAR(50) NOT NULL COMMENT '小题号',
  sub_number VARCHAR(50) DEFAULT NULL COMMENT '子题号',
  content_html LONGTEXT NOT NULL COMMENT 'HTML格式的小题内容',
  content_text TEXT COMMENT '纯文本内容',
  score DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '分值',
  full_content LONGTEXT COMMENT '完整内容（包含题号）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_paper_id (paper_id),
  INDEX idx_major_question_id (major_question_id),
  INDEX idx_number (number),
  CONSTRAINT fk_sub_paper FOREIGN KEY (paper_id) REFERENCES exam_papers (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_major FOREIGN KEY (major_question_id) REFERENCES exam_paper_major_questions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷小题表';

SET FOREIGN_KEY_CHECKS = 1;
