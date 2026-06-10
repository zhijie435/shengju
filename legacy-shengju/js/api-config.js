/**
 * 统一 API 基础地址：按当前访问页面的 origin 设置，保证「其他电脑」通过服务器 IP 访问时，所有接口请求到同一台后端。
 * 后端只需在一台电脑上启动，其他电脑通过该电脑的 IP:3001 访问即可注册、登录并正常显示数据。
 * 同时修正「圣举测评系统」等指向笔试系统(3000端口)的链接，使用当前主机名，以便其他电脑可访问。
 */
(function () {
  /** 本地打开 user/*.html、考生端只在公网时，填完整基址，例如 'http://39.105.98.161/exam-student'；线上用 IP 访问可留空 */
  var EXAM_STUDENT_BASE_ABSOLUTE = '';
  var o = typeof window !== 'undefined' && window.location && window.location.origin;
  if (o && (o.indexOf('http://') === 0 || o.indexOf('https://') === 0)) {
    window.BACKEND_BASE_URL = o.replace(/\/$/, '');
    window.API_BASE_URL = window.BACKEND_BASE_URL + '/api/v1';
  } else {
    window.BACKEND_BASE_URL = (loc && loc.origin) ? loc.origin.replace(/\/$/, "") : "";
    window.API_BASE_URL = window.BACKEND_BASE_URL ? (window.BACKEND_BASE_URL + "/api/v1") : "/api/v1";
  }
  // 圣举测评系统/笔试系统前端地址：优先使用 EXAM_FRONTEND_URL，其次使用当前 3001 服务下的 /exam
  var loc = typeof window !== 'undefined' && window.location;
  (function initExamFrontendConfig() {
    var envUrl = (typeof window.EXAM_FRONTEND_URL === 'string' && window.EXAM_FRONTEND_URL) || null;
    if (!envUrl && loc && loc.origin) {
      envUrl = loc.origin.replace(/\/+$/, '') + '/exam';
    }
    if (!envUrl) {
      envUrl = "/exam";
    }
    window.EXAM_SYSTEM_BASE_URL = envUrl.replace(/\/+$/, '');
    window.EXAM_SYSTEM_APP_URL = window.EXAM_SYSTEM_BASE_URL + '/src/app.html#examSystem';
    // 考试系统-企业端（frontend/exam-admin，开发通常为 5174）：与总管理端 /exam 下 app.html 不是同一套页面
    var entBase = (typeof window.EXAM_ENTERPRISE_FRONTEND_URL === 'string' && window.EXAM_ENTERPRISE_FRONTEND_URL) || null;
    if (!entBase && loc && loc.origin) {
      entBase = loc.origin.replace(/\/+$/, '') + '/exam-admin';
    }
    if (!entBase) {
      entBase = 'http://127.0.0.1:5174';
    }
    window.EXAM_ENTERPRISE_BASE_URL = String(entBase).replace(/\/+$/, '');
    // 笔试「总管理端」Vue 应用（frontend/exam-super-admin），与人才网企业招聘中心 /enterprise/ 不是同一套
    var supBase = (loc && loc.origin ? loc.origin.replace(/\/+$/, '') : '') + '/exam-super-admin';
    window.EXAM_SUPER_ADMIN_BASE_URL = supBase;
    // 笔试「总管理端」默认入口（保留给需要考试列表的页面）
    window.EXAM_SUPER_ADMIN_ENTRY_URL = supBase + '/exams';
    // 管理后台「圣举测评系统」当前期望：直达 app.html 的题库编辑页
    window.EXAM_QUESTION_BANK_ENTRY_URL = window.EXAM_SYSTEM_BASE_URL + '/src/app.html#questionBank/questions';
    // 试卷 REST：人才库同时提供 /api/v1/exam-papers 与 /api/exam-papers（建议与 exam-packages 一样走 /api/v1/ 以便 Nginx 统一转发）
    window.EXAM_REST_API_BASE = window.BACKEND_BASE_URL;
    // 兼容旧命名：页面若误用 EXAM_API_BASE 请求接口，应落到 REST 基址而非 /exam 静态目录
    window.EXAM_API_BASE = window.EXAM_REST_API_BASE;
  })();

  // 笔试考生端（/exam-student/login）：与当前访问的人才网同域，避免误跳 localhost:5176。
  // 若你只用 Live Server 打开本地 HTML、考生端只在公网服务器上，把下面改成完整地址，例如 'http://39.105.98.161/exam-student'
  (function initExamStudentBaseUrl() {
    if (typeof window.EXAM_STUDENT_BASE_URL === 'string' && window.EXAM_STUDENT_BASE_URL.length) return;
    if (typeof EXAM_STUDENT_BASE_ABSOLUTE === 'string' && EXAM_STUDENT_BASE_ABSOLUTE.length) {
      window.EXAM_STUDENT_BASE_URL = EXAM_STUDENT_BASE_ABSOLUTE.replace(/\/$/, '');
      return;
    }
    var force = '';
    try {
      force = (typeof window.EXAM_STUDENT_BASE_FORCE === 'string' && window.EXAM_STUDENT_BASE_FORCE) || '';
    } catch (e1) {}
    if (force) {
      window.EXAM_STUDENT_BASE_URL = force.replace(/\/$/, '');
      return;
    }
    var loc = typeof window !== 'undefined' && window.location;
    if (loc && loc.origin && (loc.origin.indexOf('http://') === 0 || loc.origin.indexOf('https://') === 0)) {
      window.EXAM_STUDENT_BASE_URL = loc.origin.replace(/\/$/, '') + '/exam-student';
    } else {
      window.EXAM_STUDENT_BASE_URL = 'http://127.0.0.1:5176';
    }
  })();

  function rewriteExamSystemLinks() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    var base = window.EXAM_SYSTEM_BASE_URL || ((typeof location !== "undefined" && location.origin) ? location.origin.replace(/\/+$/, "") + "/exam" : "/exam");
    var appPath = base.replace(/\/+$/, '') + '/src/app.html';
    // 统一重写原来写死到 localhost:3000 的圣举测评系统链接
    document.querySelectorAll('a[href^="http://localhost:3000/src/app.html"]').forEach(function (a) {
      try {
        var rest = a.getAttribute('href').replace(/^https?:\/\/[^/]+\/src\/app\.html/, '');
        a.href = appPath + (rest || '#examSystem');
      } catch (e) {}
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', rewriteExamSystemLinks);
    } else {
      rewriteExamSystemLinks();
    }
  }
})();
