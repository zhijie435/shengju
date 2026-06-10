import request from './request';
import { getToken } from './auth';

export function listEnrollments(examId) {
  return request.get(`/exam-enrollments/exam/${examId}`);
}

export function runDraw(examId) {
  return request.post(`/exam-enrollments/exam/${examId}/draw`);
}

/** 标记该报名是否参与抽签（true=不参与） */
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

/** 修正本条报名绑定的考生登录名（如将高亚军改绑到 gaoyajun） */
export function rebindEnrollmentLogin(enrollmentId, loginUsername, createIfMissing = true) {
  return request.post(`/exam-enrollments/${enrollmentId}/rebind-login`, {
    loginUsername,
    createIfMissing
  });
}

/** 将登录名绑定到指定姓名（如 gaoyajun → 高亚军），并自动把小羊等原占用者改到准考证号账号 */
export function assignLoginToName(examId, loginUsername, realName) {
  return request.post(`/exam-enrollments/exam/${examId}/assign-login-to-name`, {
    loginUsername,
    realName
  });
}

/** 按姓名+手机重新对齐账号与准考证（考号重新分配后使用） */
export function repairCandidateIdentities(examId) {
  return request.post(`/exam-enrollments/exam/${examId}/repair-identities`, null, {
    timeout: 120000
  });
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
  return request.post(`/exam-enrollments/exam/${examId}/import`, formData, {
    timeout: 60000
  });
}

/** 管理员/企业代签 */
export function adminCheckIn(examId, userId) {
  return request.post('/exam-sessions/admin-check-in', { examId, userId });
}

/** 抽签系统：获取当前叫号状态（当前号、下一位进入、待准备） */
export function getCurrentDrawStatus(examId) {
  return request.get(`/interview/interview-exams/${examId}/current-draw-status`);
}

/** 抽签系统：下一位（退出当前考生，下一号进入，通知再下一位准备） */
export function nextCandidateDraw(examId) {
  return request.post(`/interview/interview-exams/${examId}/next-candidate`);
}
