import axios from 'axios';

const TOKEN_KEY = 'exam_grader_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

const loginPath = (() => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  return base ? `${base}/login` : '/login';
})();

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
    // 只在「已登录状态且收到 401」时才自动跳转登录页，避免在登录页造成刷新死循环
    if (err.response?.status === 401) {
      const token = getToken();
      // 有 token 且当前不在登录页，才执行登出 + 跳转
      if (token && window.location.pathname !== loginPath) {
        removeToken();
        window.location.href = loginPath;
      }
    }
    return Promise.reject(err);
  }
);

export default request;
