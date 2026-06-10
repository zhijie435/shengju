import { createRouter, createWebHistory } from 'vue-router';
import { getToken } from '../api/request';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { guest: true } },
  { path: '/', component: () => import('../layouts/MainLayout.vue'), meta: { auth: true }, children: [
    { path: '', redirect: '/tasks' },
    { path: 'projects', name: 'ProjectList', component: () => import('../views/ProjectList.vue') },
    { path: 'tasks', name: 'TaskList', component: () => import('../views/TaskList.vue') },
    { path: 'grading/:taskId', name: 'Grading', component: () => import('../views/Grading.vue') },
    { path: 'interview-exams/:examId', name: 'InterviewGrading', component: () => import('../views/InterviewGrading.vue') }
  ]}
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL || '/'), routes });

router.beforeEach((to, from, next) => {
  const token = getToken();
  if (to.meta.auth && !token) return next('/login');
  if (to.meta.guest && token && to.name === 'Login') return next('/');
  next();
});

export default router;
