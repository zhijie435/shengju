import request from './request';

export function getSystemConfig() {
  return request.get('/system-config');
}

export function updateSystemConfig(data) {
  return request.put('/system-config', data);
}

export function getOperationLogs(params) {
  return request.get('/operation-logs', { params });
}
