import request from './request';

export function listExams(params) {
  return request.get('/exams', { params });
}

export function getExam(id) {
  return request.get(`/exams/${id}`);
}

export function createExam(data) {
  return request.post('/exams', data);
}

export function updateExam(id, data) {
  return request.put(`/exams/${id}`, data);
}

export function deleteExam(id) {
  return request.delete(`/exams/${id}`);
}

export function listPapers(params) {
  return request.get('/exam-papers', { params });
}

export function getPaper(id) {
  return request.get(`/exam-papers/${id}`);
}

export function importExamFromPaper(paperId, name, enterpriseId) {
  return request.post('/exams/import-from-paper', { paperId, name, enterpriseId });
}

export function gradeExam(examId) {
  return request.post(`/exams/${examId}/grade`);
}

export function getGradingData(examId, params = {}) {
  return request.get(`/exams/${examId}/grading-data`, { params });
}

export function updateAnswerScore(answerId, score) {
  return request.put(`/exam-answers/${answerId}/score`, { score });
}

export function getReport(examId, sessionId) {
  return request.get(`/exams/${examId}/sessions/${sessionId}/report`);
}

export function getExamineeStatus(examId) {
  return request.get(`/exams/${examId}/examinee-status`);
}

export function getObjectiveSettingsCheck(examId) {
  return request.get(`/exams/${examId}/objective-settings-check`);
}

/** 检查客观题阅卷是否已完成（阅卷系统列表「已完成/未完成」） */
export function getObjectiveGradedStatus(examId) {
  return request.get(`/exams/${examId}/objective-graded-status`);
}

export function getObjectiveResults(examId, withDetail = true) {
  return request.get(`/exams/${examId}/objective-results`, { params: withDetail ? { detail: '1' } : {} });
}

/** 同步所有考生客观题答案：从 exam_objective_answers 表提取到阅卷表，便于按显示题号匹配 */
export function syncObjectiveAnswers(examId) {
  return request.post(`/exams/${examId}/sync-objective-answers`);
}

export async function exportObjectiveResults(examId, examName, withDetail = true) {
  const baseURL = request.defaults.baseURL || '/api';
  const q = withDetail ? '?detail=1' : '';
  const url = (baseURL.startsWith('http') ? baseURL : (window.location.origin + baseURL)) + `/exams/${examId}/objective-results/export${q}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${localStorage.getItem('exam_super_admin_token')}` }
  });
  if (!res.ok) throw new Error('导出失败');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `客观题阅卷结果_${(examName || '考试').replace(/[/\\?*|:<>"]/g, '_')}_${Date.now()}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 获取非客观题小题列表（用于主观题任务分配）
export function getSubjectiveQuestions(examId) {
  return request.get(`/exams/${examId}/subjective-questions`);
}

// 同步考生答案到任务分配系统（仅统计）
export function syncStudentAnswers(examId) {
  return request.post(`/exams/${examId}/sync-student-answers`);
}

// 同步主观题答案：从主观题答案表写入阅卷表（与客观题阅卷方式一致，同步后主观题列表显示考生答案）
export function syncSubjectiveAnswers(examId) {
  return request.post(`/exams/${examId}/sync-subjective-answers`);
}

// 从题库同步答案和解析到试卷小题（按内容匹配，同步后主观题列表展示）
export function syncAnswersFromBank(examId, body = {}) {
  return request.post(`/exams/${examId}/sync-answers-from-bank`, body);
}

/** 面试考试设置是否已完成（开启考试前校验） */
export function getInterviewSettingsComplete(examId) {
  return request.get(`/interview/interview-exams/${examId}/settings-complete`);
}

/** 面试成绩汇总（各考官总分、去高低后平均分、签字状态） */
export function getInterviewStaffSummary(examId) {
  return request.get(`/interview/interview-exams/${examId}/staff/summary`);
}

/** 面试考官数据汇总表（打印用） */
export function getInterviewGradingTable(examId) {
  return request.get(`/interview/interview-exams/${examId}/staff/grading-table`);
}
