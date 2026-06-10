-- 主观题答案表：统一提交时考生端上传的主观题答案（按显示题号，与客观题阅卷方式一致，同步到 exam_answers 后供主观题列表展示）
-- 执行前请确保：已 use 对应数据库；exam_sessions 表已存在

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS exam_subjective_answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL COMMENT '考试会话ID',
  question_number VARCHAR(50) NOT NULL COMMENT '显示题号（与答题预览一致，用于同步到阅卷）',
  answer_text TEXT COMMENT '答案文本',
  answer_data JSON COMMENT '结构化答案（如图片 base64）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES exam_sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uk_session_question (session_id, question_number),
  INDEX idx_session_id (session_id),
  INDEX idx_question_number (question_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='主观题答案表（统一提交时上传，同步到 exam_answers）';

SET FOREIGN_KEY_CHECKS = 1;
