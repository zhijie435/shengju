import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
});

// 在部分浏览器/安全策略下，直接访问 storage 可能抛出 SecurityError，这里统一做一层安全封装
function safeGetSessionItem(key) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeGetLocalItem(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeRemoveBoth(key) {
  try { window.sessionStorage && sessionStorage.removeItem(key); } catch (e) {}
  try { window.localStorage && localStorage.removeItem(key); } catch (e) {}
}

const isLoginRequest = (url) => {
  const u = (url || '').toString();
  return u.includes('/auth/login') || u.includes('/auth/login-by-phone');
};

api.interceptors.request.use(
  (config) => {
    // 登录接口不携带 token，避免旧/过期 token 干扰或导致误判 401
    if (isLoginRequest(config.url)) return config;
    // 路由守卫允许 localStorage / sessionStorage 任一存在即视为已登录，这里也保持一致
    const studentToken = safeGetSessionItem('exam_student_token') || safeGetLocalItem('exam_student_token');
    const guestToken = safeGetSessionItem('exam_guest_token') || safeGetLocalItem('exam_guest_token');
    // 须优先正式登录态：若先打开过「邀请进入」，guest 曾写在 exam_guest_token，旧逻辑 guest||student 会长期盖住 /exam-invitations/mine 的 Bearer
    const token = studentToken || guestToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (err) => Promise.reject(err)
);

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      // 登录接口返回 401 表示账号/密码错误，不清理本地 token（避免误清）
      if (!isLoginRequest(err.config?.url)) {
        safeRemoveBoth('exam_student_token');
        safeRemoveBoth('exam_student_user');
      }
    }
    return Promise.reject(err);
  }
);

export default api;
