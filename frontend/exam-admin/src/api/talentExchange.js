/**
 * 人才网 JWT → 笔试企业端 JWT（与 router / Login 共用）
 * 双路径：部分线上 Nginx 只转发 /api/v1/*
 */
export async function exchangeTalentJwtForExam(talentJwt) {
  const paths = ['/api/v1/auth/login-by-talent-network', '/api/auth/login-by-talent-network'];
  let lastMsg = '换票失败';
  for (const p of paths) {
    try {
      const res = await fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: talentJwt })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.success && data.token) return String(data.token);
      lastMsg = (data && data.message) || res.statusText || lastMsg;
    } catch (e) {
      lastMsg = (e && e.message) || lastMsg;
    }
  }
  throw new Error(lastMsg);
}

export function firstQueryVal(q) {
  if (q == null) return '';
  if (Array.isArray(q)) return String(q[0] || '').trim();
  return String(q).trim();
}
