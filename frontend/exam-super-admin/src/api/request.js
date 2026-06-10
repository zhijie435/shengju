import axios from 'axios';

const TOKEN_KEY = 'exam_super_admin_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

const request = axios.create({
  baseURL: '/api',
  timeout: 10000
});

request.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (err) => Promise.reject(err)
);

request.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 404) {
      const url = err.config?.baseURL && err.config?.url
        ? `${err.config.baseURL}${err.config.url}`
        : err.config?.url || err.request?.responseURL || '未知';
      console.warn('[404] 请求的资源不存在:', url);
    }
    if (err.response?.status === 401) {
      removeToken();
      const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';
      window.location.href = base + '/login';
    }
    return Promise.reject(err);
  }
);

export default request;
