-- 每个人才网企业(talent_company_id)仅对应一条笔试 enterprises 记录，避免重复账号与「已购试卷」错绑。
-- 执行前：USE 你的笔试库（如 question_management_shared）；
-- 若已存在重复 talent_company_id，须先按下列步骤合并，再添加唯一索引。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- 1) 合并 enterprise_package_papers：去掉与保留行重复的包记录，再改 enterprise_id ----------
-- MySQL 不允许 DELETE 本表同时在子查询里再读同一表（ERROR 1093），故先写入临时表再删。
DROP TEMPORARY TABLE IF EXISTS tmp_migrate_epp_dup_rows;
-- 与 enterprise_package_papers.package_id 排序规则一致，避免 utf8mb4_unicode_ci / utf8mb4_general_ci 混用报 ERROR 1267
CREATE TEMPORARY TABLE tmp_migrate_epp_dup_rows (
  enterprise_id INT NOT NULL,
  package_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  paper_id INT NOT NULL,
  PRIMARY KEY (enterprise_id, package_id, paper_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_migrate_epp_dup_rows (enterprise_id, package_id, paper_id)
SELECT epp.enterprise_id, epp.package_id, epp.paper_id
FROM enterprise_package_papers epp
INNER JOIN enterprises e ON e.id = epp.enterprise_id
INNER JOIN (
  SELECT talent_company_id, MIN(id) AS keep_id
  FROM enterprises
  WHERE talent_company_id IS NOT NULL
  GROUP BY talent_company_id
  HAVING COUNT(*) > 1
) g ON e.talent_company_id = g.talent_company_id AND e.id != g.keep_id
INNER JOIN enterprise_package_papers w
  ON w.enterprise_id = g.keep_id
  AND w.package_id = epp.package_id
  AND w.paper_id = epp.paper_id;

DELETE epp FROM enterprise_package_papers epp
INNER JOIN tmp_migrate_epp_dup_rows t
  ON t.enterprise_id = epp.enterprise_id
  AND t.package_id COLLATE utf8mb4_unicode_ci = epp.package_id COLLATE utf8mb4_unicode_ci
  AND t.paper_id = epp.paper_id;

DROP TEMPORARY TABLE IF EXISTS tmp_migrate_epp_dup_rows;

UPDATE enterprise_package_papers epp
INNER JOIN enterprises e ON e.id = epp.enterprise_id
INNER JOIN (
  SELECT talent_company_id, MIN(id) AS keep_id
  FROM enterprises
  WHERE talent_company_id IS NOT NULL
  GROUP BY talent_company_id
  HAVING COUNT(*) > 1
) g ON e.talent_company_id = g.talent_company_id AND e.id != g.keep_id
SET epp.enterprise_id = g.keep_id;

-- ---------- 2) 考试场次 ----------
UPDATE exams ex
INNER JOIN enterprises e ON e.id = ex.enterprise_id
INNER JOIN (
  SELECT talent_company_id, MIN(id) AS keep_id
  FROM enterprises
  WHERE talent_company_id IS NOT NULL
  GROUP BY talent_company_id
  HAVING COUNT(*) > 1
) g ON e.talent_company_id = g.talent_company_id AND e.id != g.keep_id
SET ex.enterprise_id = g.keep_id;

-- ---------- 3) 阅卷子账号：仅当已执行 migrate_grading_system 且存在 grading_accounts 表时取消注释执行 ----------
-- UPDATE grading_accounts ga
-- INNER JOIN enterprises e ON e.id = ga.enterprise_id
-- INNER JOIN (
--   SELECT talent_company_id, MIN(id) AS keep_id
--   FROM enterprises
--   WHERE talent_company_id IS NOT NULL
--   GROUP BY talent_company_id
--   HAVING COUNT(*) > 1
-- ) g ON e.talent_company_id = g.talent_company_id AND e.id != g.keep_id
-- SET ga.enterprise_id = g.keep_id;

-- ---------- 4) 合并 user_id：保留最小 id 的行，若其 user_id 为空则采用同组内任一有值者 ----------
UPDATE enterprises win
INNER JOIN (
  SELECT talent_company_id, MIN(id) AS keep_id
  FROM enterprises
  WHERE talent_company_id IS NOT NULL
  GROUP BY talent_company_id
  HAVING COUNT(*) > 1
) g ON win.id = g.keep_id
SET win.user_id = COALESCE(
  win.user_id,
  (SELECT e2.user_id FROM enterprises e2
   WHERE e2.talent_company_id = g.talent_company_id AND e2.user_id IS NOT NULL
   ORDER BY e2.id ASC LIMIT 1)
);

-- ---------- 5) 删除重复企业行（保留每个 talent_company_id 下 id 最小的一条）----------
DELETE e FROM enterprises e
INNER JOIN (
  SELECT talent_company_id, MIN(id) AS keep_id
  FROM enterprises
  WHERE talent_company_id IS NOT NULL
  GROUP BY talent_company_id
  HAVING COUNT(*) > 1
) g ON e.talent_company_id = g.talent_company_id AND e.id != g.keep_id;

-- ---------- 6) 唯一索引（允许多个 NULL，不冲突）----------
SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enterprises' AND INDEX_NAME = 'uk_enterprises_talent_company_id'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX uk_enterprises_talent_company_id ON enterprises (talent_company_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;
