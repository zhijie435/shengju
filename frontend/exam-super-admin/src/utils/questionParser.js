/**
 * 从 content_html 解析题型和选项
 */

const TYPE_MAP = {
  选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice',
  填空题: 'blank', 简答题: 'text', 论述题: 'text', 解答题: 'text', 综合题: 'text',
  写作题: 'essay', 作文题: 'essay', 作图题: 'drawing', 画图题: 'drawing'
};

export function getAnswerType(questionType) {
  if (!questionType) return 'text';
  const t = String(questionType).trim();
  for (const [key, val] of Object.entries(TYPE_MAP)) {
    if (t.includes(key)) return val;
  }
  return 'text';
}

const JUDGE_OPTIONS = [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }];

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** 选择题/多选题：生成固定选项（仅 key，不显示内容） */
export function parseOptions(contentHtml, answerType, optionCount = 4) {
  if (answerType === 'judge') return JUDGE_OPTIONS;
  if (answerType !== 'choice' && answerType !== 'multichoice') return [];
  const count = Math.min(Math.max(parseInt(optionCount, 10) || 4, 3), 6);
  return OPTION_KEYS.slice(0, count).map(key => ({ key }));
}

export function parseBlankCount(contentHtml) {
  if (!contentHtml || typeof document === 'undefined') return 1;
  const div = document.createElement('div');
  div.innerHTML = contentHtml;
  return div.querySelectorAll('u').length || 1;
}

/**
 * 去掉题目内容开头的题号（如 1. 10. 2(1). (1)、等），用于答题预览中与全局连续题号保持一致
 * @param {string} html - content_html 或 full_content
 * @returns {string}
 */
export function stripLeadingQuestionNumber(html) {
  if (!html || typeof html !== 'string') return html || '';
  return html.replace(
    /(^|>)\s*(\d+(\.\d+)?(\(\d+\))?|[（(]\d+[）)])\s*[\.、．、]?\s*/,
    (m, prefix) => prefix
  );
}

/**
 * 将新题号插入题目内容，使题号与试题紧挨显示（支持块级元素内的首行）
 * @param {string} html - content_html 或 full_content
 * @param {string} displayNumber - 全局连续题号
 * @returns {string}
 */
export function prependQuestionNumberTight(html, displayNumber) {
  if (!html || typeof html !== 'string') return html || '';
  const stripped = stripLeadingQuestionNumber(html);
  const numSpan = `<span class="question-number-preview" style="color:#333;font-weight:500">${displayNumber}.</span>`;
  const m = stripped.match(/^(<[a-z][^>]*>)/i);
  if (m) {
    return stripped.replace(/^(<[a-z][^>]*>)/i, `$1${numSpan}`);
  }
  return numSpan + stripped;
}

/** 判断大题题干是否含题号（一、二、1、2、(1) 等），不含题号的题干在答题预览中不显示 */
export function hasQuestionNumberInStem(html) {
  if (!html || typeof html !== 'string') return false;
  const text = html.replace(/<[^>]+>/g, '').trim();
  return /^[一二三四五六七八九十]+[、．.．\s]|^\d+[、．.．\s]|^[（(]\s*\d+\s*[）)]|^\d+[-～~]\d+/.test(text) || /\d+[、．.．]\s*/.test(text);
}
