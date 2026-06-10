import request, { getToken } from './request';

export function searchUsers(q) {
  return request.get('/users/search', { params: { q } });
}

export function uploadIdCardImage(userId, file) {
  const formData = new FormData();
  formData.append('file', file);
  return request.put(`/users/${userId}/id-card-image`, formData);
}

/** 带登录态拉取服务器上的身份证文件（用于预览；不依赖网关是否暴露 /uploads） */
export async function fetchIdCardImageBlobUrl(userId) {
  const token = getToken();
  if (!token) throw new Error('未登录或登录已过期');
  const baseURL = request.defaults.baseURL || '/api';
  const prefix = baseURL.startsWith('http') ? baseURL.replace(/\/?$/, '') : `${window.location.origin}${baseURL.replace(/\/?$/, '')}`;
  const url = `${prefix}/users/${encodeURIComponent(userId)}/id-card-image`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `加载失败（${res.status}）`;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try {
        const j = await res.json();
        if (j.message) msg = j.message;
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('图片为空');
  return URL.createObjectURL(blob);
}
