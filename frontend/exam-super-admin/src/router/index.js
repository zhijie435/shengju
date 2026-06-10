import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { guest: true } },
  { path: '/', component: () => import('../layouts/MainLayout.vue'), meta: { auth: true }, children: [
    { path: '', redirect: '/enterprises' },
    { path: 'enterprises', name: 'EnterpriseList', component: () => import('../views/EnterpriseList.vue') },
    { path: 'answer-system', name: 'AnswerSystemConfig', component: () => import('../views/AnswerSystemConfig.vue') },
    { path: 'exams', name: 'ExamList', component: () => import('../views/ExamList.vue') },
    { path: 'exams/import', name: 'ExamImport', component: () => import('../views/ExamImport.vue') },
    { path: 'exams/create', name: 'ExamCreate', component: () => import('../views/ExamCreate.vue') },
    { path: 'exams/:id/edit', name: 'ExamEdit', component: () => import('../views/ExamCreate.vue') },
    { path: 'exams/:id/interview-settings', name: 'InterviewExamSettings', component: () => import('../views/InterviewExamSettings.vue') },
    { path: 'exams/:id/enrollments', name: 'ExamEnrollments', component: () => import('../views/ExamEnrollments.vue') },
    { path: 'exams/:id/draw-checkin', name: 'InterviewDrawCheckin', component: () => import('../views/InterviewDrawCheckin.vue') },
    { path: 'exams/:id/monitor', name: 'ExamMonitor', component: () => import('../views/ExamMonitor.vue') },
    { path: 'exams/:id/answer-preview', name: 'ExamAnswerPreview', component: () => import('../views/ExamAnswerPreview.vue') },
    { path: 'exams/:id/interview-answer-preview', name: 'InterviewAnswerPreview', component: () => import('../views/ExamAnswerPreview.vue') },
    { path: 'exams/:id/grading', name: 'ExamGrading', component: () => import('../views/ExamGrading.vue') },
    { path: 'exams/:id/report/:sessionId', name: 'ExamReport', component: () => import('../views/ExamReport.vue') },
    { path: 'exams/:id/monitor-global', name: 'GlobalMonitor', component: () => import('../views/GlobalMonitor.vue') },
    { path: 'grading-system', name: 'GradingSystem', component: () => import('../views/GradingSystem.vue') },
    { path: 'grading-system/accounts', name: 'GradingAccounts', component: () => import('../views/GradingAccounts.vue') },
    { path: 'grading-system/subjective/:examId', name: 'SubjectiveGradingManagement', component: () => import('../views/SubjectiveGradingManagement.vue') },
    { path: 'grading-system/tasks/:examId', name: 'GradingTaskAssignment', redirect: to => ({ name: 'SubjectiveGradingManagement', params: { examId: to.params.examId } }) },
    { path: 'grading-system/task-details/:id', name: 'TaskDetails', component: () => import('../views/TaskDetails.vue') },
    { path: 'grading-system/statistics/:examId', name: 'GradingStatistics', component: () => import('../views/GradingStatistics.vue') },
    { path: 'grading-system/interview-summary/:examId', name: 'InterviewScoreSummary', component: () => import('../views/InterviewScoreSummary.vue') }
  ]}
];

function resolveHistoryBase() {
  const base = (import.meta.env.BASE_URL || '/').trim();
  // Vite build 若用 base: './'，这里会变成 './'，但 SPA history 在子路径下会导致空白。
  // 我们部署是挂载在 /exam-super-admin/，因此当 base 为相对路径时自动回退到该挂载点。
  if (!base || base === './' || base === '.') return '/exam-super-admin/';
  return base.endsWith('/') ? base : `${base}/`;
}

const router = createRouter({ history: createWebHistory(resolveHistoryBase()), routes });

// 仅 Vite 开发服务器 (DEV)：非 127.0.0.1 时可跳回本机。生产 build / 公网部署切勿跳转。
const forceLocalHost =
  import.meta.env.DEV &&
  import.meta.env.VITE_FORCE_LOCAL_HOST !== '0' &&
  import.meta.env.VITE_FORCE_LOCAL_HOST !== 'false';

router.beforeEach((to, from, next) => {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const port = typeof window !== 'undefined' ? window.location.port : '';
  if (forceLocalHost && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    const basePrefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    window.location.replace(`http://127.0.0.1:${port || '5178'}${basePrefix}${to.fullPath}`);
    return;
  }
  const token = localStorage.getItem('exam_super_admin_token');
  if (to.meta.auth && !token) return next('/login');
  if (to.meta.guest && token && to.name === 'Login') return next('/');
  next();
});

export default router;
