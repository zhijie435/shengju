/**
 * 将 Date 或 ISO 字符串格式化为本地时间 "YYYY-MM-DD HH:mm:ss"，
 * 与创建页设置一致，避免 API 返回 UTC ISO 导致前端显示与设置不符
 */
function formatDateTimeLocal(val) {
  if (val == null || val === '') return val;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

module.exports = { formatDateTimeLocal };
