import { createRouter, createWebHistory } from 'vue-router';
import ExamRoom from '../views/ExamRoom.vue';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { guest: true } },
  { path: '/face-verify', name: 'FaceVerify', component: () => import('../views/FaceVerify.vue'), meta: { guest: true } },
  { path: '/', redirect: '/exams' },
  { path: '/exams', name: 'ExamList', component: () => import('../views/ExamList.vue'), meta: { auth: true } },
  { path: '/invitations', name: 'ExamInvitations', component: () => import('../views/ExamInvitations.vue'), meta: { auth: true } },
  { path: '/exam/:id/instructions', name: 'ExamInstructions', component: () => import('../views/ExamInstructions.vue'), meta: { auth: true } },
  { path: '/exam/:id', name: 'ExamRoom', component: ExamRoom, meta: { auth: true } },
  { path: '/side-camera', name: 'SideCamera', component: () => import('../views/SideCamera.vue'), meta: { guest: true } },
  { path: '/invite/:code', name: 'InviteEntry', component: () => import('../views/InviteEntry.vue'), meta: { guest: true } }
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL || '/'), routes });

// 仅 Vite 开发服务器为 true；npm run build 后 DEV=false，避免公网 IP 打开跳到本机 127.0.0.1
const forceLocalHost =
  import.meta.env.DEV &&
  import.meta.env.VITE_FORCE_LOCAL_HOST !== '0' &&
  import.meta.env.VITE_FORCE_LOCAL_HOST !== 'false';

function hasPendingFaceVerify() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    return !!window.sessionStorage.getItem('pending_face_verify');
  } catch (e) {
    return false;
  }
}

router.beforeEach((to, from, next) => {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const port = typeof window !== 'undefined' ? window.location.port : '';
  if (forceLocalHost && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    const basePrefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    window.location.replace(`http://127.0.0.1:${port || '5176'}${basePrefix}${to.fullPath}`);
    return;
  }
  let token = null;
  try {
    token = sessionStorage.getItem('exam_student_token') || localStorage.getItem('exam_student_token');
  } catch (e) {
    token = null;
  }
  const hasAuth = !!token;
  if (to.meta.auth && !hasAuth) return next('/login');
  if (to.meta.guest && hasAuth && to.name === 'Login') return next('/exams');
  if (to.name === 'FaceVerify' && hasAuth && !hasPendingFaceVerify()) return next('/exams');
  next();
});

router.onError((err) => {
  console.error('[Vue Router] 导航错误:', err);
});

export default router;
