import request from './request';

// 获取子账号可访问的项目列表
export function getProjects() {
  return request.get('/grading/projects');
}

// 获取我的任务列表
export function getMyTasks() {
  return request.get('/grading-tasks/my-tasks');
}

// 获取任务下的答案列表；review=1 时含已阅卷（回评模式）
export function getTaskAnswers(taskId, params = {}) {
  return request.get(`/grading-tasks/${taskId}/answers`, { params });
}

// 提交阅卷结果
export function submitGradingRecord(data) {
  return request.post('/grading-records', data);
}

// 更新阅卷结果
export function updateGradingRecord(recordId, data) {
  return request.put(`/grading-records/${recordId}`, data);
}

// 获取任务进度
export function getTaskProgress(taskId) {
  return request.get(`/grading-tasks/${taskId}/progress`);
}

// 获取每道题的阅卷进度
export function getQuestionProgress(taskId) {
  return request.get(`/grading-tasks/${taskId}/question-progress`);
}

// 面试考试（结构化面试）相关
export function getMyInterviewExams() {
  return request.get('/interview/my-exams');
}

export function getInterviewSessions(examId) {
  return request.get(`/interview/interview-exams/${examId}/sessions`);
}

export function getInterviewRubric(examId) {
  return request.get(`/interview/interview-exams/${examId}/rubric`);
}

export function getInterviewRecordings(examId, sessionId) {
  return request.get(`/interview/interview-exams/${examId}/sessions/${sessionId}/recordings`);
}

export function getInterviewPrerecordVideos(examId, sessionId) {
  return request.get(`/interview/interview-exams/${examId}/sessions/${sessionId}/prerecord-videos`);
}

export function getInterviewGrades(examId, sessionId) {
  return request.get(`/interview/interview-exams/${examId}/sessions/${sessionId}/grades`);
}

export function saveInterviewGrades(examId, sessionId, grades) {
  return request.post(`/interview/interview-exams/${examId}/sessions/${sessionId}/grades`, { grades });
}

export function allowStartInterview(examId, sessionId) {
  return request.post(`/interview/interview-exams/${examId}/sessions/${sessionId}/allow-start`);
}

export function nextCandidate(examId, body = {}) {
  return request.post(`/interview/interview-exams/${examId}/next-candidate`, body);
}

/** 叫号回退（计时计分员；须监督确认） */
export function previousCandidate(examId, body = {}) {
  return request.post(`/interview/interview-exams/${examId}/previous-candidate`, body);
}

/** 获取当前叫号状态（当前号、下一位、待准备号） */
export function getCurrentDrawStatus(examId) {
  return request.get(`/interview/interview-exams/${examId}/current-draw-status`);
}

/** 提前录制：闸门状态（计时计分/企业/总管理/考官） */
export function getInterviewPrerecordStatus(examId) {
  return request.get(`/interview/interview-exams/${examId}/prerecord/status`);
}

/** 提前录制：立即开放答题 */
export function openInterviewPrerecordGate(examId) {
  return request.post(`/interview/interview-exams/${examId}/prerecord/open-gate`);
}

/** 提前录制：定时策略下「确认开放」 */
export function confirmInterviewPrerecordGate(examId) {
  return request.post(`/interview/interview-exams/${examId}/prerecord/confirm-scheduled`);
}

/** 考官端：获取当前考官在本场考试的序号标签（考官一、考官二等） */
export function getMyExaminerLabel(examId) {
  return request.get(`/interview/interview-exams/${examId}/my-examiner-label`);
}

/** 工作人员：面试成绩汇总（仅整体打分与汇总，无试题） */
export function getInterviewStaffSummary(examId) {
  return request.get(`/interview/interview-exams/${examId}/staff/summary`);
}

/** 工作人员：面试考官数据汇总表（打印/导出用） */
export function getInterviewGradingTable(examId) {
  return request.get(`/interview/interview-exams/${examId}/staff/grading-table`);
}

/** 获取监督员签字 */
export function getSupervisorSignature(examId) {
  return request.get(`/interview/interview-exams/${examId}/supervisor-signature`);
}

/** 提交监督员签字 */
export function postSupervisorSignature(examId, data) {
  return request.post(`/interview/interview-exams/${examId}/supervisor-signature`, data);
}

// 获取考试详情（用于考官题本使用说明等）
export function getExam(examId) {
  return request.get(`/exams/${examId}`);
}

// 获取试卷详情（含 project_info，用于考官题本使用说明）
export function getPaper(paperId) {
  return request.get(`/exam-papers/${paperId}`);
}
