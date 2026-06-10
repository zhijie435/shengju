-- 创建考试汇总数据表
-- 用于存储考生的考试汇总统计信息
-- 执行前请确保已 use question_management_shared

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS exam_summaries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL COMMENT '考试会话ID',
  exam_id INT NOT NULL COMMENT '考试ID（冗余字段，便于查询）',
  user_id INT NOT NULL COMMENT '考生用户ID（冗余字段）',
  total_score DECIMAL(10,2) DEFAULT 0 COMMENT '总分',
  max_score DECIMAL(10,2) DEFAULT 0 COMMENT '满分',
  score_rate DECIMAL(5,2) DEFAULT 0 COMMENT '得分率（百分比）',
  answer_time_seconds INT DEFAULT 0 COMMENT '答题时长（秒）',
  submitted_at TIMESTAMP NULL COMMENT '交卷时间',
  objective_score DECIMAL(10,2) DEFAULT 0 COMMENT '客观题得分',
  subjective_score DECIMAL(10,2) DEFAULT 0 COMMENT '主观题得分',
  question_type_stats JSON COMMENT '各题型得分统计',
  difficulty_stats JSON COMMENT '各难度得分统计',
  exam_purpose_stats JSON COMMENT '各考察目的得分统计',
  correct_count INT DEFAULT 0 COMMENT '正确题数',
  wrong_count INT DEFAULT 0 COMMENT '错误题数',
  unanswered_count INT DEFAULT 0 COMMENT '未答题数',
  knowledge_points JSON COMMENT '知识点掌握情况',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 不使用外键：合并库考生可能在 qms_users 而非 users，且 id 类型可能与 INT 不完全一致，会导致 errno 150
  UNIQUE KEY uk_session_id (session_id),
  INDEX idx_exam_id (exam_id),
  INDEX idx_user_id (user_id),
  INDEX idx_submitted_at (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试汇总数据表';

SET FOREIGN_KEY_CHECKS = 1;
