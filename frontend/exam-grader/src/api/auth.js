import request from './request';
import { setToken, removeToken } from './request';

export function login(username, password) {
  return request.post('/auth/login-grader', { username, password }).then(res => {
    if (res.success && res.data?.token) {
      setToken(res.data.token);
    }
    return res;
  });
}

export function logout() {
  removeToken();
}
