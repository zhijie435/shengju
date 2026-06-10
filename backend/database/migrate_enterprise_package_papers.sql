-- 企业测评包与试卷关联表：用于「新建考试」时只显示该企业购买的测评包下的试卷
-- 人才网或管理端同步「已购买测评包」时写入此表，或由管理员维护
CREATE TABLE IF NOT EXISTS enterprise_package_papers (
  enterprise_id INT NOT NULL COMMENT '笔试系统企业ID',
  package_id VARCHAR(128) NOT NULL COMMENT '测评包ID（与人才网一致）',
  paper_id INT NOT NULL COMMENT '试卷ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (enterprise_id, package_id, paper_id),
  KEY idx_ent_pkg (enterprise_id, package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业购买的测评包关联试卷';
