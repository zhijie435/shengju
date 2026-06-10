/** 与 legacy-shengju/enterprise/tests.html 共用：批次 → 已创建考试 */
export const SHENGJU_BATCH_EXAM_MAP_KEY = 'shengju_enterprise_batch_exam_map';

export function getBatchExamMap() {
  try {
    const o = JSON.parse(localStorage.getItem(SHENGJU_BATCH_EXAM_MAP_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function batchExamStorageKey(enterpriseId, batchId) {
  return `${String(enterpriseId || '')}::${String(batchId || '')}`;
}

export function getLinkedExamIdForBatch(enterpriseId, batchId) {
  if (batchId == null || String(batchId).trim() === '') return null;
  if (enterpriseId == null || String(enterpriseId).trim() === '') return null;
  const rec = getBatchExamMap()[batchExamStorageKey(enterpriseId, batchId)];
  if (!rec || rec.examId == null) return null;
  return rec.examId;
}

export function setBatchExamLink(enterpriseId, batchId, examId) {
  if (examId == null || batchId == null || enterpriseId == null) return;
  try {
    const key = batchExamStorageKey(enterpriseId, batchId);
    const map = getBatchExamMap();
    map[key] = { examId, at: new Date().toISOString() };
    localStorage.setItem(SHENGJU_BATCH_EXAM_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
