import request from './request';

export function listSessions(examId) {
  return request.get(`/exam-sessions/exam/${examId}`);
}
