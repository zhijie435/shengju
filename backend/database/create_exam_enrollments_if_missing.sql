-- =============================================================================
-- 仅补建 exam_enrollments（解决：Table 'shengju.exam_enrollments' doesn't exist）
-- =============================================================================
-- 使用前：
--   1. 确认已选中正确业务库，例如：USE shengju;
--   2. 库中需已存在 users、exams 表（考试模块依赖）
--
-- 命令行示例：
--   mysql -h127.0.0.1 -u你的用户 -p shengju < backend/database/create_exam_enrollments_if_missing.sql
--
-- 说明：默认不添加外键，避免与旧库表引擎/类型不一致导致建表失败。
--       若你希望加强约束，可在表创建成功后自行执行下方「可选外键」段落。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS exam_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL COMMENT '考试ID',
  user_id INT NOT NULL COMMENT '考生用户ID',
  invite_code VARCHAR(50) NULL COMMENT '邀请码',
  status VARCHAR(20) DEFAULT 'invited' COMMENT 'invited/confirmed/started/submitted/absent',
  draw_number INT NULL COMMENT '抽签号（面试/按岗位抽签）',
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL,
  UNIQUE KEY uk_exam_user (exam_id, user_id),
  UNIQUE KEY uk_invite_code (invite_code),
  INDEX idx_exam_id (exam_id),
  INDEX idx_user_id (user_id),
  INDEX idx_invite_code (invite_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试报名/邀请';

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 若表是早期脚本建的、缺少 draw_number，执行下面一句（列已存在会报错，可忽略）
-- -----------------------------------------------------------------------------
-- ALTER TABLE exam_enrollments ADD COLUMN draw_number INT NULL COMMENT '抽签号' AFTER status;

-- -----------------------------------------------------------------------------
-- 可选：添加外键（要求 exams.id、users.id 存在且类型兼容；失败则保持无 FK 即可）
-- -----------------------------------------------------------------------------
-- ALTER TABLE exam_enrollments
--   ADD CONSTRAINT fk_exam_enrollments_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
--   ADD CONSTRAINT fk_exam_enrollments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
