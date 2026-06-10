-- 面试子抽号与签到：exam_enrollments 抽签号，exam_sessions 签到与刷脸核验时间
-- 执行前请确认 exam_enrollments、exam_sessions 表已存在
-- 若列已存在会报错，可用 run_interview_draw_checkin_migration.js 自动跳过

ALTER TABLE exam_enrollments
  ADD COLUMN draw_number INT NULL COMMENT '抽签号（按岗位随机后的顺序号）' AFTER status;

ALTER TABLE exam_sessions
  ADD COLUMN check_in_at DATETIME NULL COMMENT '签到时间' AFTER submitted_at;

ALTER TABLE exam_sessions
  ADD COLUMN face_verified_at DATETIME NULL COMMENT '刷脸核验通过时间' AFTER check_in_at;
