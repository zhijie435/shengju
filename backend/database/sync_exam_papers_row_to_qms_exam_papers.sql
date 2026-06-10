-- =============================================================================
-- 将 exam_papers 一行同步到 qms_exam_papers（列名不一致，禁止 SELECT *）
-- =============================================================================
-- exam_papers.exam_time        -> qms_exam_papers.qms_exam_time
-- exam_papers.exam_type        -> qms_exam_papers.qms_exam_type
-- exam_papers.content_json     -> qms 表无此列，丢弃（若需可后续加列再迁）
-- visible_side / is_enabled 等两表均有，按源表写入
-- =============================================================================
-- 将 id=2 换成你的 paper_id 后执行

USE shengju;

INSERT INTO qms_exam_papers (
  id,
  paper_name,
  project_name,
  total_score,
  qms_exam_time,
  page_size,
  content_html,
  content_text,
  images_base64,
  notes,
  question_count,
  major_question_count,
  created_at,
  updated_at,
  qms_exam_type,
  preview_html,
  is_enabled,
  visible_side,
  project_info
)
SELECT
  id,
  paper_name,
  project_name,
  total_score,
  exam_time,
  page_size,
  content_html,
  content_text,
  images_base64,
  notes,
  question_count,
  major_question_count,
  created_at,
  updated_at,
  exam_type,
  preview_html,
  is_enabled,
  visible_side,
  project_info
FROM exam_papers
WHERE id = 2;

-- 验证
-- SELECT id, paper_name, qms_exam_time, qms_exam_type FROM qms_exam_papers WHERE id = 2;
