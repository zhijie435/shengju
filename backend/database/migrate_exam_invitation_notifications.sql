-- 专业测评邀请通知表（笔试发布后通知考生/求职者）
-- 执行前请确保已 use 对应数据库

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS exam_invitation_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '被邀请用户ID（考生/求职者）',
  exam_id INT NOT NULL COMMENT '考试ID',
  exam_name VARCHAR(255) NOT NULL DEFAULT '' COMMENT '考试名称',
  read_at TIMESTAMP NULL COMMENT '已读时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_exam_user (exam_id, user_id),
  INDEX idx_user_id (user_id),
  INDEX idx_exam_id (exam_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='专业测评邀请通知表';

SET FOREIGN_KEY_CHECKS = 1;
