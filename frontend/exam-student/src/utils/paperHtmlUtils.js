/**
 * 从 preview_html 中移除首页（封面）和注意事项页，仅保留试题正文
 * @param {string} html - 原始 preview_html
 * @returns {string} 过滤后的 HTML
 */
export function stripCoverAndNotesPages(html) {
  if (!html || typeof html !== 'string') return html || '';
  if (typeof document === 'undefined') return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const wrapper = doc.querySelector('.a4-pages-wrapper');
  if (!wrapper) return html;
  const pages = wrapper.querySelectorAll('.a4-page, .a3-page, .cover-page, .notes-page');
  const kept = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.classList.contains('cover-page') || p.classList.contains('notes-page')) continue;
    kept.push(p.outerHTML);
  }
  return '<div class="a4-pages-wrapper">' + kept.join('') + '</div>';
}
