import { defineStore } from 'pinia';
import { ref } from 'vue';
import { login as loginApi, loginByPhone as loginByPhoneApi, faceVerify as faceVerifyApi } from '../api/exam';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(sessionStorage.getItem('exam_student_token') || '');
  const user = ref(JSON.parse(sessionStorage.getItem('exam_student_user') || 'null'));

  const isAuthenticated = ref(!!token.value);

  const saveAuth = (resToken, resUser) => {
    token.value = resToken;
    user.value = resUser;
    sessionStorage.setItem('exam_student_token', resToken);
    sessionStorage.setItem('exam_student_user', JSON.stringify(resUser));
    try {
      sessionStorage.removeItem('exam_guest_token');
    } catch (e) {}
    isAuthenticated.value = true;
  };

  const login = async (username, password, options = {}) => {
    const res = await loginApi({
      username: String(username || '').trim(),
      password,
      userType: 'jobseeker',
      announcementId: options.announcementId != null ? options.announcementId : undefined
    });
    if (res.success && !res.needFaceVerify) {
      saveAuth(res.token, res.user);
    }
    return res;
  };

  const loginByPhone = async (phone, code) => {
    const res = await loginByPhoneApi(phone, code);
    if (res.success && !res.needFaceVerify) {
      saveAuth(res.token, res.user);
    }
    return res;
  };

  const completeFaceVerify = async (tempToken, faceImageBase64) => {
    const res = await faceVerifyApi(tempToken, faceImageBase64);
    if (res.success && res.token && res.user) {
      saveAuth(res.token, res.user);
    }
    return res;
  };

  const logout = () => {
    token.value = '';
    user.value = null;
    isAuthenticated.value = false;
    sessionStorage.removeItem('exam_student_token');
    sessionStorage.removeItem('exam_student_user');
  };

  return { token, user, isAuthenticated, login, loginByPhone, completeFaceVerify, saveAuth, logout };
});
