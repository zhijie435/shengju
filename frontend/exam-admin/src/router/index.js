import { createRouter, createWebHistory } from 'vue-router';
import { getToken, removeToken, setToken } from '../api/auth';
import { exchangeTalentJwtForExam, firstQueryVal } from '../api/talentExchange';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { guest: true } },
  { path: '/', component: () => import('../layouts/MainLayout.vue'), children: [
    { path: '', redirect: '/exams' },
    { path: 'exams', name: 'ExamList', component: () => import('../views/ExamList.vue') },
    { path: 'answer-system', name: 'AnswerSystemConfig', component: () => import('../views/AnswerSystemConfig.vue') },
    { path: 'exams/create', name: 'ExamCreate', component: () => import('../views/ExamCreate.vue') },
    { path: 'exams/import', name: 'ExamImport', component: () => import('../views/ExamImport.vue') },
    { path: 'exams/:id/edit', name: 'ExamEdit', component: () => import('../views/ExamCreate.vue') },
    { path: 'exams/:id/interview-settings', name: 'InterviewExamSettings', component: () => import('../views/InterviewExamSettings.vue') },
    { path: 'exams/:id/enrollments', name: 'ExamEnrollments', component: () => import('../views/ExamEnrollments.vue') },
    { path: 'exams/:id/draw-checkin', name: 'InterviewDrawCheckin', component: () => import('../views/InterviewDrawCheckin.vue') },
    { path: 'exams/:id/interview-score-summary', name: 'InterviewScoreSummary', component: () => import('../views/InterviewScoreSummary.vue') },
    { path: 'exams/:id/monitor', name: 'ExamMonitor', component: () => import('../views/ExamMonitor.vue') },
    { path: 'exams/:id/answer-preview', name: 'ExamAnswerPreview', component: () => import('../views/ExamAnswerPreview.vue') },
    { path: 'exams/:id/interview-answer-preview', name: 'InterviewAnswerPreview', component: () => import('../views/ExamAnswerPreview.vue') },
    { path: 'exams/:id/grading', name: 'ExamGrading', component: () => import('../views/ExamGrading.vue') },
    { path: 'exams/:id/report/:sessionId', name: 'ExamReport', component: () => import('../views/ExamReport.vue') },
    { path: 'grading-system', name: 'GradingSystem', component: () => import('../views/GradingSystem.vue') },
    { path: 'grading-system/accounts', name: 'GradingAccounts', component: () => import('../views/GradingAccounts.vue') },
    { path: 'grading-system/subjective/:examId', name: 'SubjectiveGradingManagement', component: () => import('../views/SubjectiveGradingManagement.vue') },
    { path: 'grading-system/tasks/:examId', name: 'GradingTaskAssignment', redirect: to => ({ name: 'SubjectiveGradingManagement', params: { examId: to.params.examId } }) },
    { path: 'grading-system/task-details/:id', name: 'TaskDetails', component: () => import('../views/TaskDetails.vue') },
    { path: 'grading-system/statistics/:examId', name: 'GradingStatistics', component: () => import('../views/GradingStatistics.vue') }
  ]}
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL || '/'), routes });

// 仅 Vite 开发 (DEV) 时启用。生产 build 后 DEV=false，公网访问不会跳到 127.0.0.1。
const forceLocalHost =
  import.meta.env.DEV &&
  import.meta.env.VITE_FORCE_LOCAL_HOST !== '0' &&
  import.meta.env.VITE_FORCE_LOCAL_HOST !== 'false';

router.beforeEach(async (to, from, next) => {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const port = typeof window !== 'undefined' ? window.location.port : '';
  if (forceLocalHost && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    const basePrefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    window.location.replace(`http://127.0.0.1:${port || '5174'}${basePrefix}${to.fullPath}`);
    return;
  }

  // 人才网跳转带来的 JWT 在 query.token：必须先完成登录页内的换票。若不清掉旧的 exam_enterprise_token，
  // 下面「已登录进 /login → 进首页」会把用户踢走，导致新 token 永远无法执行 login-by-talent-network，随后用旧票请求接口 → 403。
  const isLogin = to.name === 'Login' || to.path === '/login' || /\/login\/?$/.test(String(to.path || ''));
  const incomingRaw =
    to.query && (firstQueryVal(to.query.token) || firstQueryVal(to.query.Token));
  if (isLogin && incomingRaw) {
    try {
      removeToken();
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * 直达 /exams/create?token=人才网JWT 时：清旧票后在此 **同步换票** 再进入（不依赖是否先进 Login、也不依赖旧部署）。
   * 否则本地旧 exam_enterprise_token 仍发往 /enterprises/me →「未关联企业」；且换票成功后应去掉 URL 里的 token。
   */
  if (incomingRaw && !isLogin) {
    try {
      removeToken();
      const examTok = await exchangeTalentJwtForExam(incomingRaw);
      setToken(examTok);
      const q = { ...to.query };
      delete q.token;
      delete q.Token;
      return next({ path: to.path, query: q, params: to.params, hash: to.hash, replace: true });
    } catch (e) {
      try {
        removeToken();
      } catch (_) {}
      console.warn('[exam-admin] 人才网换票失败，转入登录页', e);
      return next({ path: '/login', query: { ...to.query } });
    }
  }

  const token = getToken();
  const isGuest = to.meta.guest === true;
  if (!token && !isGuest) {
    if (incomingRaw) {
      return next({ path: '/login', query: to.query });
    }
    return next('/login');
  }
  // 保留 query.token 时让 Login 页先换票
  if (token && isLogin && !incomingRaw) {
    return next('/');
  }
  next();
});

export default router;
