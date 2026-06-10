-- 面试顺序入场与工作人员端：exams 当前叫号、exam_sessions 签字确认
-- 执行前请确保 exam_enrollments 已有 draw_number（run_interview_draw_checkin_migration）

SET NAMES utf8mb4;

-- exams: 当前允许进入考场的签号（顺序入场时使用）
-- ALTER TABLE exams ADD COLUMN interview_current_draw_number INT NULL COMMENT '当前允许进入考场的抽签号（顺序入场）' AFTER duration_minutes;

-- exam_sessions: 考生签字确认成绩时间与确认人
-- ALTER TABLE exam_sessions ADD COLUMN score_confirmed_at TIMESTAMP NULL COMMENT '成绩签字确认时间' AFTER total_score;
-- ALTER TABLE exam_sessions ADD COLUMN score_confirmed_by INT NULL COMMENT '确认人user_id（考生本人或工作人员）' AFTER score_confirmed_at;
