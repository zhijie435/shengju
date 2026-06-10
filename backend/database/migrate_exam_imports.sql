-- 考生导入批次与导入明细表
-- 依赖主数据库 question_management_shared（与线上笔试系统共用）
-- 执行前请先在 MySQL 中执行: USE question_management_shared;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 导入批次表：记录从外部候选人系统同步过来的批次信息
CREATE TABLE IF NOT EXISTS exam_import_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_batch_id VARCHAR(64) NOT NULL COMMENT '外部候选人系统批次ID（如 B + 时间戳）',
  batch_name VARCHAR(255) NOT NULL COMMENT '批次名称',
  exam_time DATETIME DEFAULT NULL COMMENT '统一考试时间（可选）',
  exam_location VARCHAR(255) DEFAULT NULL COMMENT '统一考试地点（可选）',
  candidate_count INT UNSIGNED DEFAULT 0 COMMENT '本批次导入考生数量',
  status ENUM('INIT', 'IMPORTED', 'CANCELLED') DEFAULT 'INIT' COMMENT '状态：INIT-待导入，IMPORTED-已导入，CANCELLED-作废',
  enterprise_name VARCHAR(200) DEFAULT NULL COMMENT '来源企业名称（可选，仅用于展示）',
  imported_exam_id INT DEFAULT NULL COMMENT '已导入到的考试ID（exams.id，可选）',
  imported_at DATETIME DEFAULT NULL COMMENT '完成导入时间',
  remark VARCHAR(255) DEFAULT NULL COMMENT '备注信息',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_candidate_batch_id (candidate_batch_id),
  KEY idx_status (status),
  KEY idx_created_at (created_at),
  KEY idx_imported_exam (imported_exam_id),
  CONSTRAINT fk_eib_ref_exams_id FOREIGN KEY (imported_exam_id) REFERENCES exams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='外部候选人系统导入批次表';

-- 导入考生表：记录每个批次中的考生基础信息
CREATE TABLE IF NOT EXISTS exam_import_candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  import_batch_id INT NOT NULL COMMENT '关联 exam_import_batches.id',
  exam_no VARCHAR(64) DEFAULT NULL COMMENT '考号/准考证号（可为空，导入时可重新生成）',
  name VARCHAR(100) NOT NULL COMMENT '姓名',
  id_number VARCHAR(50) DEFAULT NULL COMMENT '证件号（如身份证）',
  mobile VARCHAR(50) DEFAULT NULL COMMENT '手机号',
  email VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
  gender VARCHAR(10) DEFAULT NULL COMMENT '性别',
  position_name VARCHAR(200) DEFAULT NULL COMMENT '应聘岗位名称',
  extra_info JSON DEFAULT NULL COMMENT '扩展信息（JSON，如学校、专业等）',
  import_status ENUM('PENDING', 'SUCCESS', 'FAILED') DEFAULT 'PENDING' COMMENT '导入状态',
  error_msg VARCHAR(255) DEFAULT NULL COMMENT '导入失败原因',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_import_batch_id (import_batch_id),
  KEY idx_exam_no (exam_no),
  KEY idx_name (name),
  CONSTRAINT fk_eic_ref_eib_id FOREIGN KEY (import_batch_id) REFERENCES exam_import_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='外部候选人系统导入考生表';

SET FOREIGN_KEY_CHECKS = 1;

