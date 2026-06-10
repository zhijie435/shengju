import request from './request';
import { getToken } from './request';

export function listMonitorEvents(examId) {
  return request.get(`/exam-monitor/events/exam/${examId}`);
}

export function listVideoChunks(sessionId) {
  return request.get(`/exam-monitor/chunks/session/${sessionId}`);
}

export function getLatestChunksByExam(examId) {
  return request.get(`/exam-monitor/chunks/exam/${examId}/latest`);
}

export async function downloadMonitorArchive(examId) {
  const token = getToken();
  const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
  const url = `${base}/exam-monitor/archive/exam/${examId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '导出失败' }));
    throw new Error(err.message || '导出失败');
  }
  const blob = await res.blob();
  const filename = res.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?([^;]+)/)?.[1]
    ?.replace(/^["']|["']$/g, '') || `monitor_archive_exam${examId}.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = decodeURIComponent(filename);
  a.click();
  URL.revokeObjectURL(a.href);
}
