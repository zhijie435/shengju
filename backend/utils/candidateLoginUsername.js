const crypto = require('crypto');

/**
 * 从导入行 / sj 表 / 考试分配 payload 中提取考生端登录名（非准考证号）。
 */
function pickLoginUsernameFromRow(r, ex, examNo) {
  const exam = (examNo || '').toString().trim();
  const tryVal = (v) => {
    const s = v != null ? String(v).trim() : '';
    if (!s) return '';
    if (exam && s === exam) return '';
    if (isExamTicketLikeUsername(s)) return '';
    return s;
  };
  const keys = [
    'login_username',
    'loginUsername',
    'login_name',
    'loginName',
    'candidate_username',
    'candidateUsername',
    'portal_username',
    'portalUsername',
    'account',
    'account_name',
    'accountName',
    '用户名',
    '登录名',
    '登录账号'
  ];
  for (const src of [r, ex]) {
    if (!src || typeof src !== 'object') continue;
    for (const k of keys) {
      const s = tryVal(src[k]);
      if (s) return s;
    }
    const s = tryVal(src.username);
    if (s) return s;
  }
  return '';
}

/** 纯数字长串，多为准考证号，不宜作为稳定登录名 */
function isExamTicketLikeUsername(s) {
  const t = String(s || '').trim();
  return /^\d{6,}$/.test(t);
}

function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[·•．.]/g, '')
    .toLowerCase();
}

/**
 * 生成与姓名绑定的稳定登录名（同姓名+手机始终相同；不随准考证变更）。
 */
function stableCandidateUsername(realName, phone, explicitUsername) {
  const explicit = (explicitUsername || '').trim();
  if (explicit && !isExamTicketLikeUsername(explicit)) return explicit;
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length >= 10) return p;
  const key = normalizeNameKey(realName);
  if (!key) return '';
  const h = crypto.createHash('md5').update(key).digest('hex').slice(0, 10);
  return `cand_${h}`;
}

module.exports = {
  pickLoginUsernameFromRow,
  isExamTicketLikeUsername,
  stableCandidateUsername,
  normalizeNameKey
};
