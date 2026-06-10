/**
 * 清洗答案/解析文本中的 HTML 实体，使按原样显示时不出现 &nbsp; 等实体字符
 * @param {string} text - 原始文本
 * @returns {string} 清洗后的纯文本
 */
function cleanAnswerText(text) {
  if (text == null || text === '') return '';
  let s = String(text).trim();
  if (!s) return '';
  // 将常见 HTML 实体解码为对应字符，避免显示成 "&nbsp;" 等字样
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  return s.trim();
}

module.exports = { cleanAnswerText };
