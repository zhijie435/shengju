-- =============================================================================
-- 将 exam_enrollments 同步到 qms_exam_enrollments（解决 qms_exam_sessions.enrollment_id 外键）
-- 错误：CONSTRAINT qms_exam_sessions_ibfk_3 ... REFERENCES qms_exam_enrollments (id)
-- =============================================================================
-- 先执行（把列名记下来）：
--   SHOW CREATE TABLE qms_exam_enrollments\G
--
-- 若 qms 表列名与 exam_enrollments 一致（均为 exam_id / user_id），用「方式 A」。
-- 若 qms 表为 qms_exam_id / qms_user_id，用「方式 B」。
-- 若还有其它列差异，按 SHOW CREATE 结果增删列。
-- =============================================================================

USE shengju;

-- 方式 A：列名与 exam_enrollments 一致时
/*
INSERT INTO qms_exam_enrollments (
  id,
  exam_id,
  user_id,
  invite_code,
  status,
  draw_number,
  enrolled_at,
  confirmed_at
)
SELECT
  id,
  exam_id,
  user_id,
  invite_code,
  status,
  draw_number,
  enrolled_at,
  confirmed_at
FROM exam_enrollments
WHERE exam_id = 55;
*/

-- 方式 B：qms 表使用 qms_exam_id / qms_user_id 时（常见镜像命名；与方式 A 二选一取消注释）
/*
INSERT INTO qms_exam_enrollments (
  id,
  qms_exam_id,
  qms_user_id,
  invite_code,
  status,
  draw_number,
  enrolled_at,
  confirmed_at
)
SELECT
  id,
  exam_id,
  user_id,
  invite_code,
  status,
  draw_number,
  enrolled_at,
  confirmed_at
FROM exam_enrollments
WHERE exam_id = 55;
*/

-- 验证（列名按你表实际调整）
-- SELECT * FROM qms_exam_enrollments WHERE exam_id = 55 OR qms_exam_id = 55 LIMIT 10;
