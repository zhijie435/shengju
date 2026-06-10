import request from './request';

/** 默认 axios baseURL 为 /api；此处用 /v1/... 拼成 /api/v1/enterprises/me（不依赖 per-request baseURL，避免旧构建/合并差异仍打到 /api/enterprises/me） */
export function getEnterpriseMe() {
  return request.get('/v1/enterprises/me');
}

export function listEnterprises(params) {
  return request.get('/enterprises', { params });
}

export function getEnterprise(id) {
  return request.get(`/enterprises/${id}`);
}

export function approveEnterprise(id) {
  return request.post(`/enterprises/${id}/approve`);
}

export function rejectEnterprise(id, reason) {
  return request.post(`/enterprises/${id}/reject`, { reason });
}

export function updateEnterprise(id, data) {
  return request.put(`/enterprises/${id}`, data);
}
