import axios from 'axios';
import { getToken, removeToken } from './auth';
import { ElMessage } from 'element-plus';

/**
 * 换票/账密登录失败时也会返回 401，但绝不等于「已登录态过期」。
 * 对这类请求整页跳 /login 会到主站门户，必须只 reject 给页面自己提示。
 * err.config 在少数场景可能不完整，故用路径再兜底：仍在 exam-admin 登录页时绝不整页跳主站。
 */
function isLoginOrTokenExchangeRequest(config) {
  if (!config) return false;
  const base = String(config.baseURL || '');
  const u = String(config.url || '');
  const full = (base + u) || u;
  if (full.includes('login-by-talent')) return true;
  if (/\/auth\/login/.test(u || full) && (String(config.method || 'get').toLowerCase() === 'post')) {
    return true;
  }
  return false;
}

function shouldSkip401FullPageRedirect() {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname || '';
  return p.includes('exam-admin') && /\/login\/?$/.test(p);
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
  (res) => {
    const { success, message } = res.data;
    if (success === false) {
      ElMessage.error(message || '请求失败');
      return Promise.reject(new Error(message));
    }
    return res.data;
  },
  (err) => {
    if (err.response?.status === 401) {
      if (isLoginOrTokenExchangeRequest(err.config) || shouldSkip401FullPageRedirect()) {
        return Promise.reject(err);
      }
      removeToken();
      ElMessage.warning('登录已过期，请重新登录');
      // BASE_URL 在少数部署/构建异常时可能为空，若用根路径 /login 会整页跳到主站门户（shengjuceping.cn/login），
      // 与笔试 /exam-admin/login 完全不是同一应用。开发环境 Vite base 为 / 时仍用 /login。
      const appBase = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      if (appBase) {
        window.location.href = `${appBase}/login`;
      } else if (import.meta.env.DEV) {
        window.location.href = '/login';
      } else {
        window.location.href = '/exam-admin/login';
      }
    } else {
      ElMessage.error(err.response?.data?.message || err.message || '网络错误');
    }
    return Promise.reject(err);
  }
);

export default request;
