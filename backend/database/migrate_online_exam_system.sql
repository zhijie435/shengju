-- 线上笔试系统数据库迁移
-- 新增 enterprises、exams、exam_enrollments、exam_sessions、exam_answers、exam_monitor_events、exam_video_chunks
-- 执行前请确保：1. 已 use question_management_shared；2. exam_papers 表已存在（运行 migrate_exam_papers_shared.sql）

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 扩展 users 表 role 字段（支持 admin/enterprise/candidate/user）
ALTER TABLE users MODIFY COLUMN role VARCHAR(20) DEFAULT 'user' 
  COMMENT '角色：admin-总管理，enterprise-企业，candidate-考生，user-普通用户';

-- 2. 企业表
CREATE TABLE IF NOT EXISTS enterprises (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL COMMENT '企业名称',
  contact_name VARCHAR(100) COMMENT '联系人',
  contact_phone VARCHAR(50) COMMENT '联系电话',
  contact_email VARCHAR(100) COMMENT '联系邮箱',
  address VARCHAR(500) COMMENT '企业地址',
  user_id INT COMMENT '关联的用户ID（企业端登录账号）',
  status ENUM('pending', 'approved', 'rejected', 'disabled') DEFAULT 'pending' COMMENT '状态：pending-待审核，approved-已通过，rejected-已拒绝，disabled-已禁用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业表';

-- 3. 考试场次表
CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enterprise_id INT NOT NULL COMMENT '企业ID',
  paper_id INT NOT NULL COMMENT '试卷ID',
  name VARCHAR(255) NOT NULL COMMENT '考试名称',
  description TEXT COMMENT '考试说明',
  start_time DATETIME NOT NULL COMMENT '考试开始时间',
  end_time DATETIME NOT NULL COMMENT '考试结束时间',
  duration_minutes INT NOT NULL DEFAULT 90 COMMENT '答题时长（分钟）',
  monitor_config JSON COMMENT '监控配置：{dual_camera:bool, screen_share:bool, lock_screen:bool, max_violations:int}',
  status ENUM('draft', 'published', 'ongoing', 'ended', 'cancelled') DEFAULT 'draft' COMMENT '状态',
  created_by INT COMMENT '创建人',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (enterprise_id) REFERENCES enterprises(id) ON DELETE CASCADE,
  FOREIGN KEY (paper_id) REFERENCES exam_papers(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_enterprise_id (enterprise_id),
  INDEX idx_paper_id (paper_id),
  INDEX idx_start_time (start_time),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试场次表';

-- 4. 考试报名/邀请表
CREATE TABLE IF NOT EXISTS exam_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL COMMENT '考试ID',
  user_id INT NOT NULL COMMENT '考生用户ID',
  invite_code VARCHAR(50) UNIQUE COMMENT '邀请码（用于免登录进入）',
  status ENUM('invited', 'confirmed', 'started', 'submitted', 'absent') DEFAULT 'invited' COMMENT '状态',
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL COMMENT '确认时间',
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_exam_user (exam_id, user_id),
  INDEX idx_exam_id (exam_id),
  INDEX idx_user_id (user_id),
  INDEX idx_invite_code (invite_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考试报名/邀请表';

-- 5. 考生考试会话表
CREATE TABLE IF NOT EXISTS exam_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL COMMENT '考试ID',
  user_id INT NOT NULL COMMENT '考生用户ID',
  enrollment_id INT COMMENT '报名记录ID',
  status ENUM('pending', 'ongoing', 'submitted', 'abnormal', 'force_submitted') DEFAULT 'pending' COMMENT '状态',
  started_at TIMESTAMP NULL COMMENT '开始答题时间',
  submitted_at TIMESTAMP NULL COMMENT '交卷时间',
  violation_count INT DEFAULT 0 COMMENT '违规次数',
  total_score DECIMAL(10,2) DEFAULT NULL COMMENT '得分（阅卷后填充）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (enrollment_id) REFERENCES exam_enrollments(id) ON DELETE SET NULL,
  UNIQUE KEY uk_exam_user_session (exam_id, user_id),
  INDEX idx_exam_id (exam_id),
  INDEX idx_user_id (user_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考生考试会话表';

-- 6. 考生作答表
CREATE TABLE IF NOT EXISTS exam_answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL COMMENT '考试会话ID',
  sub_question_id INT COMMENT '试卷小题ID（exam_paper_sub_questions）',
  question_number VARCHAR(50) COMMENT '题号',
  answer_text TEXT COMMENT '答案内容',
  answer_data JSON COMMENT '结构化答案（选择题选项等）',
  score DECIMAL(10,2) DEFAULT NULL COMMENT '得分（阅卷后填充）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES exam_sessions(id) ON DELETE CASCADE,
  INDEX idx_session_id (session_id),
  INDEX idx_sub_question_id (sub_question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考生作答表';

-- 7. 监控事件表
CREATE TABLE IF NOT EXISTS exam_monitor_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL COMMENT '考试会话ID',
  event_type VARCHAR(50) NOT NULL COMMENT '事件类型：tab_leave/fullscreen_exit/copy_attempt/paste_attempt/right_click/devtools/face_missing/multi_person',
  metadata JSON COMMENT '附加信息',
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES exam_sessions(id) ON DELETE CASCADE,
  INDEX idx_session_id (session_id),
  INDEX idx_event_type (event_type),
  INDEX idx_occurred_at (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='监控事件表';

-- 8. 视频/截图分片元数据表
CREATE TABLE IF NOT EXISTS exam_video_chunks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL COMMENT '考试会话ID',
  chunk_type ENUM('camera', 'screen') NOT NULL COMMENT '类型：camera-摄像头，screen-屏幕共享',
  file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
  file_size INT DEFAULT 0 COMMENT '文件大小(字节)',
  duration_seconds DECIMAL(10,2) DEFAULT 0 COMMENT '时长(秒)',
  start_time TIMESTAMP NULL COMMENT '录制开始时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES exam_sessions(id) ON DELETE CASCADE,
  INDEX idx_session_id (session_id),
  INDEX idx_chunk_type (chunk_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频/截图分片元数据表';

SET FOREIGN_KEY_CHECKS = 1;
