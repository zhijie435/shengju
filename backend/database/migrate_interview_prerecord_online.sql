-- 面试提前录制 / 线上模式：闸门、候考室时间、录像上传状态、面试录像表
-- 执行 node backend/scripts/run_interview_prerecord_online_migration.js 可自动跳过已存在列

ALTER TABLE exams
  ADD COLUMN interview_prerecord_gate_open_at DATETIME NULL COMMENT '提前录制：统一开放正式答题时间' AFTER interview_current_draw_number;

ALTER TABLE exams
  ADD COLUMN interview_prerecord_confirm_pending TINYINT(1) NOT NULL DEFAULT 0 COMMENT '提前录制：定时已到待人工确认开考' AFTER interview_prerecord_gate_open_at;

ALTER TABLE exam_sessions
  ADD COLUMN interview_waiting_room_at DATETIME NULL COMMENT '进入面试候考室时间' AFTER submitted_at;

ALTER TABLE exam_sessions
  ADD COLUMN interview_prerecord_video_status VARCHAR(32) NULL COMMENT '提前录制录像上传: pending|ok|partial|fail' AFTER interview_waiting_room_at;

CREATE TABLE IF NOT EXISTS interview_session_videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  session_id INT NOT NULL,
  kind VARCHAR(16) NOT NULL COMMENT 'front|side',
  file_path VARCHAR(512) NOT NULL,
  duration_seconds INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_interview_session_video (session_id, kind),
  KEY idx_exam_session (exam_id, session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
