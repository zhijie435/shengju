-- 创建试卷表（用于保存整套试题）
-- 试卷表用于保存完整的试卷信息，包括所有大题和小题

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for exam_papers
-- ----------------------------
DROP TABLE IF EXISTS `exam_papers`;
CREATE TABLE `exam_papers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `paper_name` VARCHAR(255) NOT NULL COMMENT '试卷名称',
  `project_name` VARCHAR(255) COMMENT '项目名称',
  `total_score` INT DEFAULT 0 COMMENT '总分',
  `exam_time` INT DEFAULT 0 COMMENT '考试时长（分钟）',
  `page_size` VARCHAR(50) DEFAULT 'A4' COMMENT '页面大小',
  `content_html` LONGTEXT COMMENT '试卷原始HTML内容',
  `content_text` TEXT COMMENT '试卷纯文本内容',
  `images_base64` LONGTEXT COMMENT 'Base64编码的图片（JSON格式数组）',
  `notes` TEXT COMMENT '备注信息',
  `question_count` INT DEFAULT 0 COMMENT '小题总数',
  `major_question_count` INT DEFAULT 0 COMMENT '大题总数',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_paper_name` (`paper_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷表';

-- ----------------------------
-- Table structure for exam_paper_major_questions
-- ----------------------------
DROP TABLE IF EXISTS `exam_paper_major_questions`;
CREATE TABLE `exam_paper_major_questions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `paper_id` INT NOT NULL COMMENT '关联的试卷ID',
  `major_number` VARCHAR(50) NOT NULL COMMENT '大题号（如：一、二、三等）',
  `question_type` VARCHAR(100) COMMENT '题型（如：选择题、填空题等）',
  `content_html` LONGTEXT COMMENT '大题题干HTML内容',
  `content_text` TEXT COMMENT '大题题干纯文本内容',
  `total_score` INT DEFAULT 0 COMMENT '大题总分值',
  `question_count` INT DEFAULT 0 COMMENT '小题数量',
  `score_per_question` DECIMAL(5,2) DEFAULT 0 COMMENT '每小题分值',
  `display_text` VARCHAR(500) COMMENT '显示文本（题号+题型+分值信息）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`paper_id`) REFERENCES `exam_papers`(`id`) ON DELETE CASCADE,
  INDEX `idx_paper_id` (`paper_id`),
  INDEX `idx_major_number` (`major_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷大题表';

-- ----------------------------
-- Table structure for exam_paper_sub_questions
-- ----------------------------
DROP TABLE IF EXISTS `exam_paper_sub_questions`;
CREATE TABLE `exam_paper_sub_questions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `paper_id` INT NOT NULL COMMENT '关联的试卷ID',
  `major_question_id` INT NOT NULL COMMENT '关联的大题ID',
  `number` VARCHAR(50) NOT NULL COMMENT '小题号（如：1, 2, 3）',
  `sub_number` VARCHAR(50) COMMENT '子题号（如：(1), (2) 或 1.1, 1.2）',
  `content_html` LONGTEXT NOT NULL COMMENT 'HTML格式的小题内容',
  `content_text` TEXT COMMENT '纯文本内容',
  `score` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '分值',
  `full_content` LONGTEXT COMMENT '完整内容（包含题号）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`paper_id`) REFERENCES `exam_papers`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`major_question_id`) REFERENCES `exam_paper_major_questions`(`id`) ON DELETE CASCADE,
  INDEX `idx_paper_id` (`paper_id`),
  INDEX `idx_major_question_id` (`major_question_id`),
  INDEX `idx_number` (`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试卷小题表';

SET FOREIGN_KEY_CHECKS = 1;







