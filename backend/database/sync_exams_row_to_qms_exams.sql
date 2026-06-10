-- =============================================================================
-- 将 exams 中一场同步到 qms_exams（解决 qms_exam_sessions.qms_exam_id 外键）
-- =============================================================================
-- 与 exams 的差异：
--   1) qms_exams 无 public_room_code 列，INSERT 须显式列清单，不要 SELECT *。
--   2) qms_exams 外键：enterprise_id -> qms_enterprises；paper_id -> qms_exam_papers；
--      created_by -> qms_users。若 INSERT 报 1452，先在对应表里确认 id 存在。
-- =============================================================================
-- 在 mysql 客户端：USE shengju; 后执行（id=55 可改成你的考试 id）
-- =============================================================================

USE shengju;

INSERT INTO qms_exams (
  id,
  enterprise_id,
  paper_id,
  name,
  description,
  start_time,
  end_time,
  duration_minutes,
  monitor_config,
  answer_system_config,
  candidate_config,
  examiner_config,
  status,
  created_by,
  created_at,
  updated_at,
  interview_current_draw_number
)
SELECT
  id,
  enterprise_id,
  paper_id,
  name,
  description,
  start_time,
  end_time,
  duration_minutes,
  monitor_config,
  answer_system_config,
  candidate_config,
  examiner_config,
  status,
  created_by,
  created_at,
  updated_at,
  interview_current_draw_number
FROM exams
WHERE id = 55;

-- 验证
-- SELECT id, name, enterprise_id, paper_id FROM qms_exams WHERE id = 55;
