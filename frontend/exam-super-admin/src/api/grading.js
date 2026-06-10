import request from './request';

// 子阅卷账号管理
export function listGradingAccounts(params) {
  return request.get('/grading-accounts', { params });
}

export function createGradingAccount(data) {
  return request.post('/grading-accounts', data);
}

export function updateGradingAccount(id, data) {
  return request.put(`/grading-accounts/${id}`, data);
}

export function deleteGradingAccount(id) {
  return request.delete(`/grading-accounts/${id}`);
}

export function resetGradingAccountPassword(id, newPassword) {
  return request.post(`/grading-accounts/${id}/reset-password`, { newPassword });
}

// 任务分配
export function listGradingTasks(examId) {
  return request.get(`/exams/${examId}/grading-tasks`);
}

export function createGradingTask(examId, data) {
  return request.post(`/exams/${examId}/grading-tasks`, data);
}

export function updateGradingTask(taskId, data) {
  return request.put(`/grading-tasks/${taskId}`, data);
}

export function deleteGradingTask(taskId) {
  return request.delete(`/grading-tasks/${taskId}`);
}

// 阅卷操作
export function getTaskAnswers(taskId) {
  return request.get(`/grading-tasks/${taskId}/answers`);
}

export function submitGradingRecord(data) {
  return request.post('/grading-records', data);
}

export function updateGradingRecord(recordId, data) {
  return request.put(`/grading-records/${recordId}`, data);
}

export function getTaskProgress(taskId) {
  return request.get(`/grading-tasks/${taskId}/progress`);
}

export function getTaskDetails(taskId) {
  return request.get(`/grading-tasks/${taskId}/details`);
}

// 考试汇总数据
export function getExamSummary(sessionId) {
  return request.get(`/exam-summaries/${sessionId}`);
}

export function getExamSummaries(examId, params) {
  return request.get(`/exam-summaries/exam/${examId}`, { params });
}

export function generateExamSummary(sessionId) {
  return request.post(`/exam-summaries/generate/${sessionId}`);
}

export function getExamStatistics(examId) {
  return request.get(`/exam-summaries/exam/${examId}/statistics`);
}

// 评估报告
export function getEvaluationReport(sessionId) {
  return request.get(`/evaluation-reports/${sessionId}`);
}

export function generateEvaluationReport(sessionId) {
  return request.post(`/evaluation-reports/generate/${sessionId}`);
}

export function getEvaluationReports(examId, params) {
  return request.get(`/evaluation-reports/exam/${examId}`, { params });
}

export function downloadEvaluationReport(sessionId) {
  return request.get(`/evaluation-reports/${sessionId}/download`, { responseType: 'blob' });
}
