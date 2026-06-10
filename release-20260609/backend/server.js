// 加载环境变量（必须在其他模块之前）
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { testConnection } = require('./config/database');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const questionsRoutes = require('./routes/questions');
const questionBankRoutes = require('./routes/questionBank');
const examPapersRoutes = require('./routes/examPapers');
const exportRoutes = require('./routes/export');
const enterprisesRoutes = require('./routes/enterprises');
const examsRoutes = require('./routes/exams');
const examEnrollmentsRoutes = require('./routes/examEnrollments');
const examSessionsRoutes = require('./routes/examSessions');
const examAnswersRoutes = require('./routes/examAnswers');
const examMonitorRoutes = require('./routes/examMonitor');
const gradingAccountsRoutes = require('./routes/gradingAccounts');
const gradingTasksRoutes = require('./routes/gradingTasks');
const gradingRoutes = require('./routes/grading');
const examSummariesRoutes = require('./routes/examSummaries');
const examImportsRoutes = require('./routes/examImports');
const evaluationReportsRoutes = require('./routes/evaluationReports');
const interviewRoutes = require('./routes/interview');
const examInvitationsRoutes = require('./routes/examInvitations');
const examEnterpriseRoutes = require('./routes/examEnterprise');
const talentSiteCompatRoutes = require('./routes/talentSiteCompat');
const wechatPayAssessmentPath = path.join(__dirname, 'routes', 'wechatPayAssessment.js');
const wechatPayAssessment = fs.existsSync(wechatPayAssessmentPath)
  ? require('./routes/wechatPayAssessment')
  : null;
if (!wechatPayAssessment) {
  console.warn('[server] 未找到 routes/wechatPayAssessment.js，微信支付相关路由未注册（上传该文件及 services/wechatPayV3Assessment.js 后可启用）');
}
const adminCompatRoutes = require('./routes/adminCompat');
const { getEnterpriseCompatDiag } = require('./utils/adminEnterpriseDiag');
const { attachWebSocket } = require('./services/examWebSocket');

const app = express();
const PORT = process.env.PORT || 3000;

// 前置 Nginx 会传 X-Forwarded-For；未 trust proxy 时 express-rate-limit 会抛 ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// 默认信任第一层代理；本地直连无该头不受影响。若需完全关闭：TRUST_PROXY=0
if (process.env.TRUST_PROXY !== '0' && process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', 1);
}

// 中间件：大 JSON（企业证照 Base64）需与 Nginx client_max_body_size 同时放宽，否则反代先返回 413
const BODY_PARSER_LIMIT = process.env.BODY_PARSER_LIMIT || '80mb';
app.use(cors());

// P1 优化：gzip/brotli 压缩响应（>1KB 才压缩，减少 50-70% 带宽）
app.use(require('compression')({ threshold: 1024 }));
// 微信支付异步通知须使用原始 body 验签，不能先走 json 解析（模块存在时才注册）
if (wechatPayAssessment) {
  app.post(
    '/api/v1/pay/wechat/notify',
    express.raw({ type: 'application/json' }),
    wechatPayAssessment.handleNotify
  );
  app.post('/api/pay/wechat/notify', express.raw({ type: 'application/json' }), wechatPayAssessment.handleNotify);
}
app.use(bodyParser.json({ limit: BODY_PARSER_LIMIT }));
app.use(bodyParser.urlencoded({ extended: true, limit: BODY_PARSER_LIMIT }));

// API 限流：约 2000 人在线时每 IP 每分钟可请求数（按 15 分钟窗口）
const rateLimit = require('express-rate-limit');
const apiLimiterWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;
const apiLimiterMax = parseInt(process.env.RATE_LIMIT_MAX_PER_IP, 10) || 600;
const apiLimiter = rateLimit({
  windowMs: apiLimiterWindowMs,
  max: apiLimiterMax,
  message: { success: false, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  // Vite/Nginx 反代会带 X-Forwarded-For；未配 trust proxy 时 v7 会抛错导致 500
  validate: { xForwardedForHeader: false }
});
app.use('/api/', apiLimiter);

// 须放在所有 app.use('/api/v1/...') 与 app.use('/api', grading*) 之前，否则 /api 前缀会先进入阅卷等全局 authenticate 导致 401
app.get('/api/v1/health', async (req, res) => {
  try {
    const dbConnected = await testConnection();
    res.json({
      success: true,
      message: 'ok',
      status: 'ok',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.json({
      success: true,
      message: 'ok',
      status: 'degraded',
      database: 'unknown',
      timestamp: new Date().toISOString()
    });
  }
});

// 根路径：进入主站登录（试题管理系统）。纯 API 说明见 GET /api 与 /health
app.get('/', (req, res) => {
  res.redirect(302, '/src/index.html');
});

// API根路径
app.get('/api', (req, res) => {
  res.json({
    message: 'API接口列表',
    baseUrl: '/api/questions',
    endpoints: {
      save: {
        method: 'POST',
        path: '/api/questions/save',
        description: '保存大题内容'
      },
      getQuestion: {
        method: 'GET',
        path: '/api/questions/:id',
        description: '获取大题内容'
      },
      getSubQuestions: {
        method: 'GET',
        path: '/api/questions/:id/subquestions',
        description: '获取小题列表'
      },
      updateQuestion: {
        method: 'PUT',
        path: '/api/questions/:id',
        description: '更新大题内容'
      },
      uploadWord: {
        method: 'POST',
        path: '/api/questions/upload-word',
        description: '上传Word文档并解析'
      },
      updateSubQuestion: {
        method: 'PUT',
        path: '/api/questions/subquestions/:id',
        description: '更新小题内容'
      }
    }
  });
});

// API路由（必须在静态文件服务之前）
const { authenticate, optionalAuthenticate, requireRole } = require('./middleware/auth');
const ExamModel = require('./models/examModel');
const EnterpriseModel = require('./models/enterpriseModel');
const { pool } = require('./config/database');

// 从题库同步答案和解析 - 显式注册确保可访问（须在 /api/exams 之前）
const QuestionBankModel = require('./models/questionBankModel');
const { cleanAnswerText } = require('./utils/textCleaner');
app.post('/api/exams/:examId/sync-answers-from-bank', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (exam.enterprise_id !== ent?.id) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.status(400).json({ success: false, message: '该考试未关联试卷' });
    const { category = '未分类', subject = '未分类' } = req.body;

    const [rows] = await pool.execute(
      `SELECT sq.id, sq.content_text, sq.content_html, sq.answer, sq.explanation, sq.sub_answers, sq.sub_explanations
       FROM exam_paper_sub_questions sq
       WHERE sq.paper_id = ?
       ORDER BY sq.id`,
      [paperId]
    );

    let synced = 0;
    for (const r of rows) {
      const needAnswer = !(r.answer && r.answer.trim());
      const needExplanation = !(r.explanation && r.explanation.trim());
      const hasSubAnswers = r.sub_answers && (typeof r.sub_answers !== 'string' || r.sub_answers.trim());
      const hasSubExplanations = r.sub_explanations && (typeof r.sub_explanations !== 'string' || r.sub_explanations.trim());
      const needSubAnswers = !hasSubAnswers;
      const needSubExplanations = !hasSubExplanations;
      if (!needAnswer && !needExplanation && !needSubAnswers && !needSubExplanations) continue;
      const contentText = (r.content_text || '').trim() || String(r.content_html || '').replace(/<[^>]+>/g, '').trim();
      if (!contentText || contentText.length < 5) continue;
      try {
        const match = await QuestionBankModel.findBestMatchWithAnswer(contentText, category, subject, 0.7);
        if (!match) continue;
        const updates = [];
        const params = [];
        if (needAnswer && match.answer && match.answer.trim()) {
          updates.push('answer = ?');
          params.push(match.answer.trim());
        }
        if (needExplanation && match.explanation && match.explanation.trim()) {
          updates.push('explanation = ?');
          params.push(match.explanation.trim());
        }
        if (needAnswer && match.answerHtml && match.answerHtml.trim()) {
          updates.push('answer_html = ?');
          params.push(match.answerHtml.trim());
        }
        if (needExplanation && match.explanationHtml && match.explanationHtml.trim()) {
          updates.push('explanation_html = ?');
          params.push(match.explanationHtml.trim());
        }
        // 同步到阅卷用标准答案：答案一并写入 standard_answer，便于客观题设置与执行阅卷使用
        if (needAnswer && match.answer && match.answer.trim()) {
          updates.push('standard_answer = ?');
          params.push(match.answer.trim());
        }
        // 同步子小题答案和解析（题库更新后子阅卷可显示）
        if (match.sub_answers && Array.isArray(match.sub_answers) && match.sub_answers.length > 0) {
          updates.push('sub_answers = ?');
          params.push(JSON.stringify(match.sub_answers));
        }
        if (match.sub_explanations && Array.isArray(match.sub_explanations) && match.sub_explanations.length > 0) {
          updates.push('sub_explanations = ?');
          params.push(JSON.stringify(match.sub_explanations));
        }
        if (updates.length === 0) continue;
        params.push(r.id);
        await pool.execute(
          `UPDATE exam_paper_sub_questions SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
        synced++;
      } catch (err) {
        console.warn('同步小题失败:', r.id, err.message);
      }
    }
    res.json({ success: true, message: `已从题库同步 ${synced} 道小题的答案/解析`, data: { synced } });
  } catch (e) {
    console.error('[sync-answers-from-bank]', e.message || e);
    res.status(500).json({ success: false, message: e.message || '同步失败' });
  }
});

// 统一自动识别答案选项 - 显式注册确保可访问（须在 /api/exams 之前）
const TYPE_MAP_AUTO = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
const OBJECTIVE_ANSWER_TYPES_AUTO = ['choice', 'multichoice', 'judge', 'blank'];
const getAnswerTypeFromQuestionType = (qt) => {
  if (!qt) return 'text';
  const t = String(qt).trim();
  for (const [k, v] of Object.entries(TYPE_MAP_AUTO)) { if (t.includes(k)) return v; }
  return 'text';
};
app.post('/api/exams/:examId/auto-recognize-answers', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (!ent || exam.enterprise_id !== ent.id) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.status(400).json({ success: false, message: '该考试未关联试卷' });

    const asc = exam.answer_system_config || {};
    const overrides = asc.answerTypeOverrides || {};
    const [rows] = await pool.execute(
      `SELECT sq.id, sq.content_html, sq.content_text, mq.question_type
       FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ?
       ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );

    let recognized = 0;
    const answerPatterns = [
      /[【\[]?答案[：:]\s*([A-F]+(?:[,.、\s]+[A-F]+)*)[】\]]?/i,
      /[【\[]?正确答案[：:]\s*([A-F]+(?:[,.、\s]+[A-F]+)*)[】\]]?/i,
      /[【\[]?标准答案[：:]\s*([A-F]+(?:[,.、\s]+[A-F]+)*)[】\]]?/i,
      /答案[：:]?\s*([A-F])\b/i,
      /正确答案[：:]?\s*([A-F])\b/i,
      /[（(]\s*([A-F])\s*[）)]\s*[为是]?正确/i,
      /选\s*([A-F])\b/i,
      /[。.]\s*([A-F])\s*[。.]/,
      /\b([对错正确错误])\b/
    ];

    for (const r of rows) {
      const answerType = overrides[String(r.id)] || overrides[r.id] || getAnswerTypeFromQuestionType(r.question_type || '');
      if (!OBJECTIVE_ANSWER_TYPES_AUTO.includes(answerType)) continue;

      const raw = ((r.content_text || '').trim() || String(r.content_html || '').replace(/<[^>]+>/g, ' ')).trim();
      if (!raw || raw.length < 3) continue;

      let extracted = null;
      if (answerType === 'judge') {
        const m = raw.match(/(答案|正确答案)[：:]\s*([对错正确错误])/);
        if (m) extracted = /对|正确/.test(m[2]) ? '正确' : '错误';
      } else {
        for (const pat of answerPatterns) {
          const m = raw.match(pat);
          if (m && m[1]) {
            let s = String(m[1]).trim();
            if (/^[对错正确错误]$/.test(s)) {
              extracted = /对|正确/.test(s) ? '正确' : '错误';
            } else {
              s = s.replace(/[,.、\s]+/g, ',').replace(/,+/g, ',').toUpperCase();
              const letters = s.split(',').filter(c => /^[A-F]$/.test(c));
              if (letters.length > 0) extracted = letters.join(',');
            }
            break;
          }
        }
      }

      if (!extracted) continue;
      try {
        await pool.execute('UPDATE exam_paper_sub_questions SET standard_answer = ? WHERE id = ?', [extracted, r.id]);
        recognized++;
      } catch (updateErr) {
        if (/Unknown column 'standard_answer'/.test(updateErr.message || '')) {
          console.error('[auto-recognize-answers] standard_answer 列不存在，请执行 migrate_paper_sub_questions_answer.sql');
          return res.status(500).json({ success: false, message: '数据库缺少 standard_answer 列，请执行 migrate_paper_sub_questions_answer.sql 迁移脚本' });
        }
        throw updateErr;
      }
    }

    res.json({ success: true, message: `已自动识别 ${recognized} 道客观题答案`, data: { recognized } });
  } catch (e) {
    console.error('[auto-recognize-answers]', e.message || e, e.stack);
    res.status(500).json({ success: false, message: e.message || '识别失败' });
  }
});

// 考生导入批次相关接口（双路径：exam-admin 用 /api；人才网 legacy / exam-imports-helper 用 /api/v1）
app.use('/api/exam-imports', examImportsRoutes);
app.use('/api/v1/exam-imports', examImportsRoutes);

// 客观题列表 - 显式注册确保可访问（须在 /api/exams 之前）
app.get('/api/exams/:examId/objective-questions', authenticate, requireRole('enterprise', 'admin'), async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, message: '考试不存在' });
    if (req.user.role === 'enterprise') {
      const ent = await EnterpriseModel.findByUserId(req.user.id);
      if (exam.enterprise_id !== ent?.id) return res.status(403).json({ success: false, message: '无权限' });
    }
    const paperId = exam.paper_id;
    if (!paperId) return res.json({ success: true, data: [] });
    const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
    const TYPE_MAP = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
    const ANSWER_TYPE_LABELS = { choice: '选择题', multichoice: '多选题', judge: '判断题', blank: '填空题' };
    const OBJECTIVE_ANSWER_TYPES = ['choice', 'multichoice', 'judge', 'blank'];
    const getAnswerType = (qt) => {
      if (!qt) return 'text';
      const t = String(qt).trim();
      for (const [k, v] of Object.entries(TYPE_MAP)) { if (t.includes(k)) return v; }
      return 'text';
    };
    const [rows] = await pool.execute(
      `SELECT sq.*, mq.question_type, mq.major_number FROM exam_paper_sub_questions sq
       JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE sq.paper_id = ? ORDER BY mq.major_number, sq.number, sq.sub_number`,
      [paperId]
    );
    const displayNumberOverrides = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
    const list = [];
    let globalIndex = 0;
    let firstLogged = false;
    for (const r of rows) {
      globalIndex++;
      const answerType = overrides[r.id] || getAnswerType(r.question_type);
      if (!OBJECTIVE_ANSWER_TYPES.includes(answerType)) continue;
      // 兼容 answer/Answer、explanation/Explanation 等不同列名
      const rawAnswer = (r.answer != null && r.answer !== '') ? String(r.answer).trim()
        : (r.Answer != null && r.Answer !== '') ? String(r.Answer).trim()
        : (r.answer_html ? String(r.answer_html).replace(/<[^>]+>/g, '').trim() : '') || '';
      const bankAnswer = cleanAnswerText(rawAnswer || (r.standard_answer || '').trim()) || '';
      const rawExplanation = (r.explanation != null && r.explanation !== '') ? String(r.explanation).trim()
        : (r.Explanation != null && r.Explanation !== '') ? String(r.Explanation).trim()
        : (r.explanation_html ? String(r.explanation_html).replace(/<[^>]+>/g, '').trim() : '')
        || (r.answer_analysis ? String(r.answer_analysis).trim() : '') || '';
      const bankExplanation = cleanAnswerText(rawExplanation) || '';
      if (!firstLogged) {
        console.log('[客观题接口] 首条小题 数据库原始: id=%s answer=%s explanation=%s answer_analysis=%s', r.id, r.answer != null ? '(有值)' : '(空)', r.explanation != null ? '(有值)' : '(空)', r.answer_analysis != null ? '(有值)' : '(空)');
        console.log('[客观题接口] 计算后: bankAnswer=%s bankExplanation=%s', bankAnswer || '(空)', bankExplanation ? '(有值)' : '(空)');
        firstLogged = true;
      }
      const displayNum = (displayNumberOverrides[r.id] && String(displayNumberOverrides[r.id]).trim()) || String(globalIndex);
      list.push({
        ...r,
        displayNumber: displayNum,
        answerType,
        answerTypeLabel: ANSWER_TYPE_LABELS[answerType] || answerType,
        bankAnswer,
        bankExplanation,
        standard_answer: r.standard_answer || ''
      });
    }
    // 从题库带出答案/解析：对答案或解析为空的题目从题库匹配并填充（仅返回用，不写库）
    const enrichFromBank = req.query.enrichFromBank === '1' || req.query.enrichFromBank === 'true';
    const bankCategory = (req.query.bankCategory || '').trim();
    const bankSubject = (req.query.bankSubject || '').trim();
    const useAutoFromBank = enrichFromBank && (!bankCategory || !bankSubject || bankCategory === 'auto' || bankSubject === 'auto');
    const useFixedCategory = enrichFromBank && bankCategory && bankSubject && bankCategory !== 'auto' && bankSubject !== 'auto';
    // 题干规范化：仅去掉明显的卷面题号（如 1. 2、 （1）），要求数字后必须有分隔符，避免误删题干中的数字
    function normalizeContentForBankMatch(text) {
      if (!text || typeof text !== 'string') return (text || '').trim();
      const t = String(text).trim();
      const noLeadingNum = t.replace(/^\s*(\d{1,3}(\.\d+)?(\(\d+\))?[\.、．\s]+|[（(]\s*\d+\s*[）)]\s*[\.、．\s]*)/, '').trim();
      return (noLeadingNum.replace(/\s+/g, ' ').trim() || t);
    }
    if ((useAutoFromBank || useFixedCategory) && list.length > 0) {
      const similarityThreshold = 0.4;
      for (const item of list) {
        const needAnswer = !item.bankAnswer || !item.bankAnswer.trim();
        const needExplanation = !item.bankExplanation || !item.bankExplanation.trim();
        if (!needAnswer && !needExplanation) continue;
        try {
          let match = null;
          const qbId = item.question_bank_id ? parseInt(item.question_bank_id, 10) : null;
          const qbCat = (item.question_bank_category || '').trim() || '未分类';
          const qbSub = (item.question_bank_subject || '').trim() || '未分类';
          if (qbId && qbCat && qbSub) {
            try {
              const q = await QuestionBankModel.getQuestionById(qbId, qbCat, qbSub);
              if (q && ((q.answer && q.answer.trim()) || (q.explanation && q.explanation.trim()))) {
                match = {
                  answer: cleanAnswerText(q.answer || (q.answer_html ? String(q.answer_html).replace(/<[^>]+>/g, '').trim() : '') || '') || '',
                  explanation: cleanAnswerText(q.explanation || (q.explanation_html ? String(q.explanation_html).replace(/<[^>]+>/g, '').trim() : '') || '') || ''
                };
                console.log('[客观题接口] 按题库ID直接获取 subId=%s bankId=%s', item.id, qbId);
              }
            } catch (e) { /* 按ID获取失败则走题干匹配 */ }
          }
          if (!match) {
            const rawText = (item.content_text || '').trim() || (item.content_html ? String(item.content_html).replace(/<[^>]+>/g, '').trim() : '') || '';
            if (!rawText || rawText.length < 5) continue;
            const contentText = normalizeContentForBankMatch(rawText) || rawText;
            match = useAutoFromBank
              ? await QuestionBankModel.findBestMatchWithAnswerAcrossAll(rawText, similarityThreshold)
              : await QuestionBankModel.findBestMatchWithAnswer(rawText, bankCategory, bankSubject, similarityThreshold);
            if (!match && contentText !== rawText) {
              match = useAutoFromBank
                ? await QuestionBankModel.findBestMatchWithAnswerAcrossAll(contentText, similarityThreshold)
                : await QuestionBankModel.findBestMatchWithAnswer(contentText, bankCategory, bankSubject, similarityThreshold);
            }
            if (match) console.log('[客观题接口] 题干匹配成功 subId=%s', item.id);
            else console.log('[客观题接口] 未匹配到 subId=%s rawPreview=%s', item.id, rawText.substring(0, 80));
          }
          if (match) {
            if (needAnswer && (match.answer || '').trim()) item.bankAnswer = cleanAnswerText(match.answer || '') || '';
            if (needExplanation && (match.explanation || '').trim()) item.bankExplanation = cleanAnswerText(match.explanation || '') || '';
          }
        } catch (err) {
          console.warn('[客观题接口] 从题库带出失败 subId=%s:', item.id, err.message);
        }
      }
    }
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/v1/question-bank', questionBankRoutes);
app.use('/api/exam-papers', examPapersRoutes);
// legacy 管理端/静态站常请求 /api/v1/exam-papers（同 /api/exam-papers），显式挂载避免落到其它 Router 产生 401/403
app.use('/api/v1/exam-papers', examPapersRoutes);
app.use('/api/v1/exam-packages', examPapersRoutes);
app.use('/api/export', exportRoutes);
// 测评缴费设置：必须在 app.use('/api/v1/enterprises') 之前注册；否则请求先进入 enterprises 子路由，此处永远不会命中（表现为 enterprises 路径 404）
const getAssessmentFeeSettingsHandler =
  typeof talentSiteCompatRoutes.getCompatAssessmentFeeSettings === 'function'
    ? talentSiteCompatRoutes.getCompatAssessmentFeeSettings
    : (req, res) =>
        res.json({
          success: true,
          data: {
            enabled: false,
            amountYuan: 0,
            payStartAt: null,
            payEndAt: null,
            wechatQrcodeUrl: '',
            alipayQrcodeUrl: ''
          }
        });
const putAssessmentFeeSettingsHandler =
  typeof talentSiteCompatRoutes.putCompatAssessmentFeeSettings === 'function'
    ? talentSiteCompatRoutes.putCompatAssessmentFeeSettings
    : (req, res) => res.json({ success: true });
app.get(
  '/api/v1/enterprises/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  getAssessmentFeeSettingsHandler
);
app.get(
  '/api/enterprises/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  getAssessmentFeeSettingsHandler
);
app.put(
  '/api/v1/enterprises/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  putAssessmentFeeSettingsHandler
);
app.put(
  '/api/enterprises/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  putAssessmentFeeSettingsHandler
);
app.use('/api/enterprises', enterprisesRoutes);
app.use('/api/v1/enterprises', enterprisesRoutes);
app.use('/api/exams', examsRoutes);
// 与 /api/exams 相同：避免 Nginx/旧前端只转发 /api/v1 时考试列表、详情 404
app.use('/api/v1/exams', examsRoutes);
app.use('/api/exam-enrollments', examEnrollmentsRoutes);
app.use('/api/v1/exam-enrollments', examEnrollmentsRoutes);
app.use('/api/exam-sessions', examSessionsRoutes);
app.use('/api/exam-answers', examAnswersRoutes);
app.use('/api/exam-monitor', examMonitorRoutes);
app.use('/api/v1/exam-monitor', examMonitorRoutes);
app.use('/api/grading-accounts', gradingAccountsRoutes);
app.use('/api/exam-invitations', examInvitationsRoutes);
// 求职者个人中心 profile.html 的 API_BASE_URL 为 /api/v1，请求 /exam-invitations/mine 会打到 /api/v1/...，须与 /api/... 双挂
app.use('/api/v1/exam-invitations', examInvitationsRoutes);
// 对外系统调用的企业汇总接口（仅使用 API Key 鉴权），需在通用 /api 路由之前注册，以避免被 JWT 中间件拦截
app.use('/api/exam-enterprise', examEnterpriseRoutes);
// 人才网 legacy：须同时在 /api/v1 与 /api 上注册，且整体在 grading* 之前，否则 Nginx 去掉 v1 后请求会先被阅卷全局 authenticate 拦成 401
// 部署自检（无需登录）：能打开说明 80→本 Node 且已更新 server.js；若此处 404 则 Nginx 未反代到本进程或仍是旧构建
app.get('/api/v1/compat-build-marker', (req, res) => {
  res.json({
    ok: true,
    where: 'server.js',
    postCompatProject: typeof talentSiteCompatRoutes.postCompatProject === 'function',
    postCompatJob: typeof talentSiteCompatRoutes.postCompatJob === 'function',
    postCompatAnnouncement: typeof talentSiteCompatRoutes.postCompatAnnouncement === 'function',
    getCompatTalentPoolList: typeof talentSiteCompatRoutes.getCompatTalentPoolList === 'function',
    getCompatCooperations: typeof talentSiteCompatRoutes.getCompatCooperations === 'function',
    getCompatAssessmentFeeSettings: typeof talentSiteCompatRoutes.getCompatAssessmentFeeSettings === 'function',
    getCompatCandidatesList: typeof talentSiteCompatRoutes.getCompatCandidatesList === 'function',
    getCompatEnterpriseReviewerAccounts:
      typeof talentSiteCompatRoutes.getCompatEnterpriseReviewerAccounts === 'function',
    postCreateExamEnterprise: typeof talentSiteCompatRoutes.postCreateExamEnterprise === 'function'
  });
});
// 企业/认证数据诊断（须管理员 Token）；显式双路径，避免仅挂在子 Router 时 Nginx 去 v1 或未命中链导致 404）
app.get('/api/v1/admin/diag/enterprise-compat', authenticate, requireRole('admin'), getEnterpriseCompatDiag);
app.get('/api/admin/diag/enterprise-compat', authenticate, requireRole('admin'), getEnterpriseCompatDiag);
// 显式挂载 POST /projects：企业端 tests.html 等直连 /api/v1/projects，避免仅依赖 Router 挂载时线上仍 404（未重启/旧构建）
if (typeof talentSiteCompatRoutes.postCompatProject === 'function') {
  app.post('/api/v1/projects', authenticate, talentSiteCompatRoutes.postCompatProject);
  app.post('/api/projects', authenticate, talentSiteCompatRoutes.postCompatProject);
}
if (typeof talentSiteCompatRoutes.getCompatProjectsList === 'function') {
  app.get('/api/v1/projects', talentSiteCompatRoutes.getCompatProjectsList);
  app.get('/api/projects', talentSiteCompatRoutes.getCompatProjectsList);
}
if (typeof talentSiteCompatRoutes.getCompatJobs === 'function') {
  app.get('/api/v1/jobs', optionalAuthenticate, talentSiteCompatRoutes.getCompatJobs);
  app.get('/api/jobs', optionalAuthenticate, talentSiteCompatRoutes.getCompatJobs);
}
if (typeof talentSiteCompatRoutes.postCompatJob === 'function') {
  app.post('/api/v1/jobs', authenticate, talentSiteCompatRoutes.postCompatJob);
  app.post('/api/jobs', authenticate, talentSiteCompatRoutes.postCompatJob);
}
if (typeof talentSiteCompatRoutes.putCompatJob === 'function') {
  app.put('/api/v1/jobs/:id', authenticate, talentSiteCompatRoutes.putCompatJob);
  app.put('/api/jobs/:id', authenticate, talentSiteCompatRoutes.putCompatJob);
}
if (typeof talentSiteCompatRoutes.deleteCompatJob === 'function') {
  app.delete('/api/v1/jobs/:id', authenticate, talentSiteCompatRoutes.deleteCompatJob);
  app.delete('/api/jobs/:id', authenticate, talentSiteCompatRoutes.deleteCompatJob);
}
if (typeof talentSiteCompatRoutes.postCompatAnnouncement === 'function') {
  app.post('/api/v1/announcements', authenticate, talentSiteCompatRoutes.postCompatAnnouncement);
  app.post('/api/announcements', authenticate, talentSiteCompatRoutes.postCompatAnnouncement);
}
if (typeof talentSiteCompatRoutes.putCompatAnnouncement === 'function') {
  app.put('/api/v1/announcements/:id', authenticate, talentSiteCompatRoutes.putCompatAnnouncement);
  app.put('/api/announcements/:id', authenticate, talentSiteCompatRoutes.putCompatAnnouncement);
}
if (typeof talentSiteCompatRoutes.deleteCompatAnnouncement === 'function') {
  app.delete('/api/v1/announcements/:id', authenticate, talentSiteCompatRoutes.deleteCompatAnnouncement);
  app.delete('/api/announcements/:id', authenticate, talentSiteCompatRoutes.deleteCompatAnnouncement);
}
if (typeof talentSiteCompatRoutes.getCompatTalentPoolList === 'function') {
  app.get('/api/v1/talent-pool/list', authenticate, talentSiteCompatRoutes.getCompatTalentPoolList);
  app.get('/api/talent-pool/list', authenticate, talentSiteCompatRoutes.getCompatTalentPoolList);
}
if (typeof talentSiteCompatRoutes.getCompatCooperations === 'function') {
  app.get('/api/v1/cooperations', authenticate, talentSiteCompatRoutes.getCompatCooperations);
  app.get('/api/cooperations', authenticate, talentSiteCompatRoutes.getCompatCooperations);
}
// tests.html 审核管理「缴费设置」：/companies/... 须在 app.use('/api/v1', talentSiteCompat) 之前（见上 enterprises 注释）
app.get(
  '/api/v1/companies/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  getAssessmentFeeSettingsHandler
);
app.get(
  '/api/companies/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  getAssessmentFeeSettingsHandler
);
app.put(
  '/api/v1/companies/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  putAssessmentFeeSettingsHandler
);
app.put(
  '/api/companies/me/assessment-fee-settings',
  authenticate,
  requireRole('enterprise', 'admin'),
  putAssessmentFeeSettingsHandler
);
// 企业端候选人列表、子审核账号：须在 app.use('/api/v1', talentSiteCompat) 之前显式注册，避免线上子 Router 未命中时 404 导致「数据全空」
const getCandidatesListHandler =
  typeof talentSiteCompatRoutes.getCompatCandidatesList === 'function'
    ? talentSiteCompatRoutes.getCompatCandidatesList
    : (req, res) => res.json({ success: true, data: [] });
app.get('/api/v1/candidates', authenticate, getCandidatesListHandler);
app.get('/api/candidates', authenticate, getCandidatesListHandler);
const getReviewerAccountsHandler =
  typeof talentSiteCompatRoutes.getCompatEnterpriseReviewerAccounts === 'function'
    ? talentSiteCompatRoutes.getCompatEnterpriseReviewerAccounts
    : (req, res) => res.json({ success: true, data: [] });
app.get(
  '/api/v1/companies/me/reviewer-accounts',
  authenticate,
  requireRole('enterprise', 'admin'),
  getReviewerAccountsHandler
);
app.get(
  '/api/companies/me/reviewer-accounts',
  authenticate,
  requireRole('enterprise', 'admin'),
  getReviewerAccountsHandler
);
// company-center「一键创建并绑定」：显式双路径，避免仅挂在子 Router 时线上 POST 404
if (typeof talentSiteCompatRoutes.postCreateExamEnterprise === 'function') {
  app.post(
    '/api/v1/companies/create-exam-enterprise',
    authenticate,
    requireRole('enterprise', 'admin', 'enterprise_reviewer'),
    talentSiteCompatRoutes.postCreateExamEnterprise
  );
  app.post(
    '/api/companies/create-exam-enterprise',
    authenticate,
    requireRole('enterprise', 'admin', 'enterprise_reviewer'),
    talentSiteCompatRoutes.postCreateExamEnterprise
  );
}
if (wechatPayAssessment) {
  app.get('/api/v1/pay/wechat/assessment/oauth-callback', wechatPayAssessment.mpOAuthCallback);
  app.get('/api/pay/wechat/assessment/oauth-callback', wechatPayAssessment.mpOAuthCallback);
  app.get('/api/v1/pay/wechat/assessment/oauth-url', authenticate, wechatPayAssessment.getMpOAuthUrl);
  app.get('/api/pay/wechat/assessment/oauth-url', authenticate, wechatPayAssessment.getMpOAuthUrl);
  app.get('/api/v1/pay/wechat/assessment/config', optionalAuthenticate, wechatPayAssessment.getPublicConfig);
  app.get('/api/pay/wechat/assessment/config', optionalAuthenticate, wechatPayAssessment.getPublicConfig);
  app.post('/api/v1/pay/wechat/assessment/jsapi-prepay', authenticate, wechatPayAssessment.createJsapiPrepay);
  app.post('/api/pay/wechat/assessment/jsapi-prepay', authenticate, wechatPayAssessment.createJsapiPrepay);
  app.post('/api/v1/pay/wechat/assessment/native-prepay', authenticate, wechatPayAssessment.createNativePrepay);
  app.post('/api/pay/wechat/assessment/native-prepay', authenticate, wechatPayAssessment.createNativePrepay);
}
app.use('/api/v1', talentSiteCompatRoutes);
app.use('/api', talentSiteCompatRoutes);
app.use('/api/v1', adminCompatRoutes);
app.use('/api', adminCompatRoutes);
app.use('/api', gradingTasksRoutes);
app.use('/api', gradingRoutes);
app.use('/api/exam-summaries', examSummariesRoutes);
app.use('/api/evaluation-reports', evaluationReportsRoutes);
app.use('/api/interview', interviewRoutes);

// 提供静态文件服务（HTML文件等）
// 获取项目根目录（backend的父目录）
const projectRoot = path.join(__dirname, '..');

// 静态文件服务选项
const staticOptions = {
  dotfiles: 'ignore',
  etag: true,
  extensions: ['html', 'htm', 'js', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot'],
  index: false,
  maxAge: '1d',
  redirect: false,
  setHeaders: (res, filePath, stat) => {
    // HTML 页面不做强缓存，避免前端 build 后仍加载旧页面
    if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    // 确保JavaScript文件有正确的MIME类型
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
    // 确保字体文件有正确的MIME类型
    else if (filePath.endsWith('.woff2')) {
      res.setHeader('Content-Type', 'font/woff2');
    }
    else if (filePath.endsWith('.woff')) {
      res.setHeader('Content-Type', 'font/woff');
    }
    else if (filePath.endsWith('.ttf')) {
      res.setHeader('Content-Type', 'font/ttf');
    }
    else if (filePath.endsWith('.eot')) {
      res.setHeader('Content-Type', 'application/vnd.ms-fontobject');
    }
    // CSS文件
    else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
};

// 笔试系统总管理端：打包后由后端提供，只启动后端即可在「笔试系统」标签页内打开，无需单独开 5175
const examSuperAdminDist = path.join(projectRoot, 'frontend', 'exam-super-admin', 'dist');
if (fs.existsSync(examSuperAdminDist)) {
  app.use('/exam-super-admin', express.static(examSuperAdminDist, { ...staticOptions, index: false }));
  app.get('/exam-super-admin', (req, res) => res.sendFile(path.join(examSuperAdminDist, 'index.html')));
  app.get(/^\/exam-super-admin\/.+$/, (req, res) => res.sendFile(path.join(examSuperAdminDist, 'index.html')));
} else if (process.env.NODE_ENV !== 'production') {
  console.log('提示: 未找到 frontend/exam-super-admin/dist，笔试系统 iframe 将使用 5175 端口。可在 frontend/exam-super-admin 下执行 npm run build 后由本服务提供。');
}

function mountExamSpaSubapp(routePrefix, frontendFolderName) {
  const distDir = path.join(projectRoot, 'frontend', frontendFolderName, 'dist');
  if (!fs.existsSync(distDir)) return;
  app.use(routePrefix, express.static(distDir, { ...staticOptions, index: false }));
  app.get(routePrefix, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  const escaped = routePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  app.get(new RegExp(`^${escaped}/.+$`), (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}
mountExamSpaSubapp('/exam-admin', 'exam-admin');
mountExamSpaSubapp('/exam-student', 'exam-student');
mountExamSpaSubapp('/exam-grader', 'exam-grader');

// 先提供libs目录的静态文件服务
app.use('/libs', (req, res, next) => {
  // 调试日志：记录请求的静态资源
  if (process.env.NODE_ENV !== 'production') {
    const requestedPath = path.join(projectRoot, 'libs', req.path);
    if (!fs.existsSync(requestedPath)) {
      console.log(`⚠️  404 - 静态资源不存在: /libs${req.path}`);
    }
  }
  next();
}, express.static(path.join(projectRoot, 'libs'), staticOptions));

// 调试：验证静态文件路径（在静态文件服务之前）
if (process.env.NODE_ENV !== 'production') {
  app.use('/src', (req, res, next) => {
    // 解码URL编码的路径
    const decodedPath = decodeURIComponent(req.path);
    const requestedPath = path.join(projectRoot, 'src', decodedPath);
    if (fs.existsSync(requestedPath)) {
      console.log(`✓ 静态文件存在: ${req.path} -> ${requestedPath}`);
    } else {
      console.log(`✗ 静态文件不存在: ${req.path} -> ${requestedPath}`);
    }
    next();
  });
}

// 明确处理题库管理.html（解决中文文件名编码问题，必须在静态文件服务之前）
const questionBankManageHtmlPath = path.join(projectRoot, 'src', '题库管理.html');
function sendQuestionBankManageHtml(req, res) {
  res.sendFile(
    questionBankManageHtmlPath,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    (err) => {
      if (err) {
        console.error('发送题库管理.html失败:', err);
        res.status(404).send('文件未找到');
      }
    }
  );
}
app.get('/src/题库管理.html', sendQuestionBankManageHtml);
app.get('/src/%E9%A2%98%E5%BA%93%E7%AE%A1%E7%90%86.html', sendQuestionBankManageHtml);

// 自定义静态文件服务中间件（处理中文文件名）
app.use('/src', (req, res, next) => {
  // 如果路径包含URL编码的中文字符，先解码
  let filePath = req.path;
  try {
    // 尝试解码URL编码的路径
    filePath = decodeURIComponent(filePath);
  } catch (e) {
    // 如果解码失败，使用原始路径
    filePath = req.path;
  }
  
  // 构建实际文件路径
  const actualPath = path.join(projectRoot, 'src', filePath);
  
  // 检查文件是否存在
  if (fs.existsSync(actualPath) && fs.statSync(actualPath).isFile()) {
    // 文件存在，使用sendFile发送
    res.sendFile(actualPath, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    }, (err) => {
      if (err && !res.headersSent) {
        next();
      }
    });
  } else {
    // 文件不存在，继续到下一个中间件（express.static）
    next();
  }
});

// 提供src目录的静态文件服务（作为备用）
app.use('/src', express.static(path.join(projectRoot, 'src'), staticOptions));

// 线上部分壳页面 iframe 仍使用 /assets/desktab.html（旧版工具栏图标依赖外链字体易空白），统一到已内联 SVG 的 deepseek 编辑器
app.get('/assets/desktab.html', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const qs = i >= 0 ? req.originalUrl.slice(i) : '';
  res.redirect(302, '/src/assets/deepseek_html_20251230_e6f8db.html' + qs);
});

// 圣举人才网 legacy 静态站（与服务器 Nginx 对齐：root 指向 legacy-shengju）
const legacyShengjuDir = path.join(projectRoot, 'legacy-shengju');
if (fs.existsSync(legacyShengjuDir)) {
  app.use(express.static(legacyShengjuDir, { ...staticOptions, index: 'index.html' }));
  console.log('✓ legacy-shengju 静态站已挂载（圣举人才网门户）');
}

// 最后提供根目录的静态文件服务（用于兼容旧路径）
app.use(express.static(projectRoot, staticOptions));

// 提供uploads目录的静态文件服务（用于访问截图）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 健康检查
app.get('/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 笔试系统表初始化（表不存在时创建）
app.get('/api/exam-system/init', async (req, res) => {
  try {
    const run = require('./scripts/run_online_exam_migration.js');
    await run();
    res.json({ success: true, message: 'done' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 阅卷系统表初始化（表不存在时创建）
app.get('/api/grading-system/init', async (req, res) => {
  try {
    const run = require('./scripts/run_grading_system_migration.js');
    await run();
    res.json({ success: true, message: 'done' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 处理favicon请求（避免404错误）
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Chrome DevTools 自动请求，避免 404 日志
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

// 404处理（必须在所有路由之后）
app.use((req, res) => {
  // 记录404请求（用于调试）
  if (process.env.NODE_ENV !== 'production') {
    console.log(`⚠️  404 - 请求的资源不存在: ${req.method} ${req.path}`);
  }
  
  // 如果是API请求，返回JSON错误
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      message: 'API端点不存在',
      path: req.path
    });
  }
  
  // 如果是静态资源请求（.js, .css等），返回404而不是HTML
  const ext = path.extname(req.path).toLowerCase();
  if (['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
    return res.status(404).send(`文件不存在: ${req.path}`);
  }
  
  // 其他请求返回404页面或重定向
  res.status(404).send('页面不存在');
});

// 全局错误处理（捕获未处理的异常，返回 JSON 便于前端显示）
app.use((err, req, res, next) => {
  const path = req.originalUrl || req.url || '';
  const isJson = path.startsWith('/api/') || req.headers.accept?.includes('application/json');
  const tooLarge = err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413);
  if (tooLarge) {
    console.warn('[413]', req.method, path, '-> body too large (Express limit:', BODY_PARSER_LIMIT, ')');
    if (isJson || req.xhr) {
      return res.status(413).json({
        success: false,
        message:
          '上传内容超过服务器允许大小。请压缩图片后重试；若使用 Nginx 反代，请在 server/location 中设置 client_max_body_size 80m;（详见 backend/deploy/nginx-client-max-body.conf.example）'
      });
    }
    return res.status(413).send('Payload Too Large');
  }
  console.error('[500]', req.method, path, '->', err.message || err);
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    console.error(err.stack);
  }
  if (isJson || req.xhr) {
    return res.status(500).json({
      success: false,
      message: err.message || '服务器内部错误',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
  }
  res.status(500).send('服务器内部错误');
});

// 启动服务器
const server = app.listen(PORT, async () => {
  attachWebSocket(server);
  console.log(`========================================`);
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}`);
  console.log(`========================================`);
  console.log('');
  
  // 测试数据库连接
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.log('');
    console.log('⚠️  警告: 数据库连接失败');
    console.log('服务器已启动，但数据库功能可能不可用');
    console.log('请检查: 1. MySQL是否启动 2. .env配置 3. 数据库是否已创建');
    console.log('');
  } else {
    (async () => {
      try {
        const ExamPaperModel = require('./models/examPaperModel');
        await ExamPaperModel.initializeTables();
      } catch (e) { /* ignore */ }
      try {
        require('./scripts/run_online_exam_migration.js');
      } catch (e) { /* ignore */ }
      // 确保专业测评邀请通知表存在（发布考试时为求职者端推送通知用）
      try {
        await pool.execute(`
          CREATE TABLE IF NOT EXISTS exam_invitation_notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL COMMENT '被邀请用户ID',
            exam_id INT NOT NULL COMMENT '考试ID',
            exam_name VARCHAR(255) NOT NULL DEFAULT '' COMMENT '考试名称',
            read_at TIMESTAMP NULL COMMENT '已读时间',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_exam_user (exam_id, user_id),
            INDEX idx_user_id (user_id),
            INDEX idx_exam_id (exam_id),
            INDEX idx_created_at (created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='专业测评邀请通知表'
        `);
        console.log('✓ 专业测评邀请通知表已就绪');
      } catch (e) {
        console.warn('创建 exam_invitation_notifications 表失败:', e.message);
      }
    })();
  }
  console.log('服务器已就绪，等待请求...');
  console.log('按 Ctrl+C 停止服务器');
  console.log('');
});

// 处理服务器启动错误
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('');
    console.error('❌ 错误: 端口', PORT, '已被占用');
    console.error('');
    console.error('解决方案:');
    console.error('  1. 关闭占用端口的其他程序');
    console.error('  2. 或修改 .env 文件中的 PORT 配置');
    if (process.platform === 'win32') {
      console.error('  3. 运行「检查后端服务状态.bat」查看占用端口的进程');
    } else {
      console.error(`  3. Linux 查看占用: ss -tlnp | grep :${PORT}  或  lsof -i :${PORT}`);
    }
    console.error('');
    process.exit(1);
  } else {
    console.error('❌ 服务器启动失败:', error.message);
    process.exit(1);
  }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('');
  console.error('❌ 未捕获的异常:', error);
  console.error('');
  console.error('错误堆栈:');
  console.error(error.stack);
  console.error('');
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('');
  console.error('❌ 未处理的Promise拒绝:', reason);
  console.error('');
});

module.exports = app;

