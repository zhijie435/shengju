-- 创建考试评估报告表
-- 用于存储AI生成的考生评估报告
-- 执行前请确保已 use question_management_shared

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS exam_evaluation_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL COMMENT '考试会话ID',
  exam_id INT NOT NULL COMMENT '考试ID',
  user_id INT NOT NULL COMMENT '考生用户ID',
  report_content LONGTEXT COMMENT '评估报告内容（Markdown格式）',
  report_html LONGTEXT COMMENT '评估报告HTML格式',
  generation_status ENUM('pending', 'generating', 'completed', 'failed') DEFAULT 'pending' COMMENT '生成状态',
  generated_at TIMESTAMP NULL COMMENT '生成时间',
  error_message TEXT COMMENT '错误信息',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 不使用外键：与 exam_summaries 一致，避免 user_id→users 在 qms_users 合并库中报 errno 150
  UNIQUE KEY uk_session_id (session_id),
  INDEX idx_exam_id (exam_id),
  INDEX idx_user_id (user_id),
  INDEX idx_generation_status (generation_status),
  INDEX idx_generated_at (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试评估报告表';

SET FOREIGN_KEY_CHECKS = 1;
