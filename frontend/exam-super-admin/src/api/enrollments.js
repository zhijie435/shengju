import request, { getToken } from './request';

export function listEnrollments(examId) {
  return request.get(`/exam-enrollments/exam/${examId}`);
}

export function runDraw(examId) {
  return request.post(`/exam-enrollments/exam/${examId}/draw`);
}

export function setEnrollmentExcludeFromDraw(enrollmentId, excluded) {
  return request.patch(`/exam-enrollments/${enrollmentId}/exclude-from-draw`, { excluded });
}

export function addEnrollment(examId, userId) {
  return request.post(`/exam-enrollments/exam/${examId}`, { userId });
}

export function bulkAddEnrollments(examId, userIds) {
  return request.post(`/exam-enrollments/exam/${examId}/bulk`, { userIds });
}

export function removeEnrollment(id) {
  return request.delete(`/exam-enrollments/${id}`);
}

export async function downloadCandidateTemplate() {
  const baseURL = request.defaults.baseURL || '/api';
  const url = baseURL.startsWith('http') ? baseURL : (window.location.origin + baseURL);
  const res = await fetch(`${url}/exam-enrollments/template`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  if (!res.ok) throw new Error('下载失败');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '考生导入模板.xlsx';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importCandidates(examId, file) {
  const formData = new FormData();
  formData.append('file', file);
  // 不要手动设置 Content-Type，让浏览器自动带 boundary，否则服务端无法解析文件
  return request.post(`/exam-enrollments/exam/${examId}/import`, formData, {
    timeout: 60000
  });
}

/** 管理员/企业代签：按 examId + userId 标记签到 */
export function adminCheckIn(examId, userId) {
  return request.post('/exam-sessions/admin-check-in', { examId, userId });
}

/** 抽签系统：获取当前叫号状态 */
export function getCurrentDrawStatus(examId) {
  return request.get(`/interview/interview-exams/${examId}/current-draw-status`);
}

/** 抽签系统：下一位（退出当前考生，下一号进入，通知再下一位准备） */
export function nextCandidateDraw(examId) {
  return request.post(`/interview/interview-exams/${examId}/next-candidate`);
}
