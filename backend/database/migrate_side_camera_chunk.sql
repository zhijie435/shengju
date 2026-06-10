-- 扩展 exam_video_chunks.chunk_type 支持侧面摄像头（手机端上传）
-- 若表结构为 ENUM 则需执行此迁移；若为 VARCHAR(20) 则无需执行
ALTER TABLE exam_video_chunks
  MODIFY COLUMN chunk_type ENUM('camera', 'screen', 'side_camera') NOT NULL
  COMMENT '类型：camera-正面摄像头，screen-屏幕共享，side_camera-侧面摄像头(手机)';
