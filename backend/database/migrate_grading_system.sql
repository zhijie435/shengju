-- 阅卷系统数据库迁移
-- 新增 grading_accounts、grading_tasks、grading_records 表
-- 执行前请确保：1. 已 use question_management_shared；2. exams、exam_answers 表已存在

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 扩展 users 表 role 字段（支持 grader 角色）
ALTER TABLE users MODIFY COLUMN role VARCHAR(20) DEFAULT 'user' 
  COMMENT '角色：admin-总管理，enterprise-企业，candidate-考生，grader-阅卷员，user-普通用户';

-- 2. 子阅卷账号表
CREATE TABLE IF NOT EXISTS grading_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
  real_name VARCHAR(100) COMMENT '真实姓名',
  email VARCHAR(100) COMMENT '邮箱',
  phone VARCHAR(50) COMMENT '手机号',
  status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态：active-启用，inactive-禁用',
  created_by INT COMMENT '创建者ID（总管理员或企业管理员）',
  enterprise_id INT COMMENT '所属企业ID（可选，用于企业端）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL COMMENT '最后登录时间',
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (enterprise_id) REFERENCES enterprises(id) ON DELETE SET NULL,
  INDEX idx_username (username),
  INDEX idx_status (status),
  INDEX idx_created_by (created_by),
  INDEX idx_enterprise_id (enterprise_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='子阅卷账号表';

-- 3. 阅卷任务分配表
CREATE TABLE IF NOT EXISTS grading_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL COMMENT '考试ID',
  grading_account_id INT NOT NULL COMMENT '子阅卷账号ID',
  task_type ENUM('content', 'question_type') NOT NULL COMMENT '任务类型：content-按内容，question_type-按题型',
  task_config JSON NOT NULL COMMENT '任务配置（JSON格式，存储具体分配的内容或题型）',
  status ENUM('pending', 'assigned', 'in_progress', 'completed') DEFAULT 'pending' COMMENT '状态：pending-待分配，assigned-已分配，in_progress-进行中，completed-已完成',
  assigned_at TIMESTAMP NULL COMMENT '分配时间',
  completed_at TIMESTAMP NULL COMMENT '完成时间',
  created_by INT COMMENT '创建者ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_exam_id (exam_id),
  INDEX idx_grading_account_id (grading_account_id),
  INDEX idx_status (status),
  INDEX idx_task_type (task_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阅卷任务分配表';

-- 4. 阅卷记录表
CREATE TABLE IF NOT EXISTS grading_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL COMMENT '任务ID',
  answer_id INT NOT NULL COMMENT '答案ID',
  grading_account_id INT NOT NULL COMMENT '阅卷账号ID',
  score DECIMAL(10,2) COMMENT '得分',
  grading_comment TEXT COMMENT '阅卷评语',
  graded_at TIMESTAMP NULL COMMENT '阅卷时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES grading_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (answer_id) REFERENCES exam_answers(id) ON DELETE CASCADE,
  FOREIGN KEY (grading_account_id) REFERENCES grading_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY uk_task_answer (task_id, answer_id),
  INDEX idx_task_id (task_id),
  INDEX idx_answer_id (answer_id),
  INDEX idx_grading_account_id (grading_account_id),
  INDEX idx_graded_at (graded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阅卷记录表';

SET FOREIGN_KEY_CHECKS = 1;
