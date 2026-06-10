const mammoth = require('mammoth');
const JSZip = require('jszip');
const fs = require('fs').promises;
const path = require('path');
const xml2js = require('xml2js');
const katex = require('katex');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

// 尝试加载OMML转换库（可选）
let omml2mathml = null;
let mathmlToLatex = null;
try {
  omml2mathml = require('omml2mathml');
  mathmlToLatex = require('mathml-to-latex');
} catch (e) {
  console.log('OMML转换库未找到，将使用内置转换器');
}

/**
 * 处理Word文档，提取内容（包括图片、数学公式等）
 * @param {string} filePath - Word文档路径
 * @param {string} uploadsDir - 上传文件目录（用于保存截图）
 * @returns {Promise<Object>} { html, images, messages, screenshotUrls }
 */
async function processWordDocument(filePath, uploadsDir = null) {
  try {
    // 如果没有指定uploads目录，使用默认路径
    if (!uploadsDir) {
      uploadsDir = path.join(__dirname, '../uploads');
      await fs.mkdir(uploadsDir, { recursive: true });
    }
    
    // 使用mammoth转换Word文档为HTML
    const result = await mammoth.convertToHtml(
      { path: filePath },
      {
        convertImage: mammoth.images.imgElement(function(image) {
          return image.read('base64').then(function(imageBuffer) {
            return {
              src: 'data:' + image.contentType + ';base64,' + imageBuffer.toString('base64')
            };
          });
        }),
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1.title:fresh",
          "r[style-name='Strong'] => strong",
          "p[style-name='Normal'] => p"
        ]
      }
    );
    
    let html = result.value;
    const messages = result.messages;
    
    // 提取所有Base64图片
    const images = [];
    const imageRegex = /<img[^>]+src="(data:image\/[^;]+;base64,[^"]+)"/g;
    let match;
    while ((match = imageRegex.exec(html)) !== null) {
      images.push(match[1]);
    }
    
    // 提取并转换OMML数学公式为图片，并在HTML中替换
    try {
      html = await processOMMLFormulasInHtml(html, filePath, images);
    } catch (error) {
      console.warn('处理数学公式时出错:', error.message);
      // 继续处理，不中断整个流程
    }
    
    // 处理文本格式的分数（传递images数组以便添加新图片）
    html = await processTextFractions(html, images);
    
    // 检测并处理无法转换的内容（如数学公式、特殊格式），生成截图
    const screenshotResult = await processUnrecognizedContent(html, uploadsDir);
    html = screenshotResult.html;
    const screenshotUrls = screenshotResult.screenshotUrls || [];
    
    // 清理HTML，确保格式正确
    html = cleanWordHtml(html);
    
    return {
      html: html,
      images: images,
      messages: messages,
      screenshotUrls: screenshotUrls
    };
  } catch (error) {
    console.error('处理Word文档失败:', error);
    throw new Error('Word文档处理失败: ' + error.message);
  }
}

/**
 * 从Word文档中提取OMML公式并转换为图片
 * @param {string} filePath - Word文档路径
 * @returns {Promise<Array>} 公式图片数组（Base64）
 */
async function extractAndConvertOMMLFormulas(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    
    const documentXml = await zip.file('word/document.xml').async('string');
    const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
    const documentObj = await parser.parseStringPromise(documentXml);
    
    const formulas = [];
    // 递归查找所有OMML公式节点（m:oMath）
    function findOMMLNodes(node, path = '') {
      if (!node || typeof node !== 'object') return;
      
      if (node['m:oMath']) {
        const ommlXml = xml2js.Builder().buildObject({ 'm:oMath': node['m:oMath'] });
        formulas.push({
          omml: ommlXml,
          path: path
        });
      }
      
      for (const key in node) {
        if (node.hasOwnProperty(key) && typeof node[key] === 'object') {
          findOMMLNodes(node[key], path ? `${path}.${key}` : key);
        }
      }
    }
    
    findOMMLNodes(documentObj);
    
    // 转换每个公式为图片
    const formulaImages = [];
    for (const formula of formulas) {
      try {
        const latex = ommlToLatex(formula.omml);
        if (latex) {
          const imageBase64 = await renderLatexToImage(latex);
          if (imageBase64) {
            formulaImages.push(imageBase64);
          }
        }
      } catch (error) {
        console.warn('转换公式失败:', error.message);
      }
    }
    
    return formulaImages;
  } catch (error) {
    console.error('提取OMML公式失败:', error);
    return [];
  }
}

/**
 * 处理HTML中的OMML公式，转换为图片
 * @param {string} html - HTML内容
 * @param {string} filePath - Word文档路径
 * @param {Array} images - 图片数组（用于添加新图片）
 * @returns {Promise<string>} 处理后的HTML
 */
async function processOMMLFormulasInHtml(html, filePath, images) {
  try {
    // 从Word文档提取OMML公式
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml').async('string');
    
    // 提取所有OMML公式（使用正则表达式直接匹配）
    const ommlMatches = [];
    const ommlRegex = /<m:oMath[^>]*>[\s\S]*?<\/m:oMath>/g;
    let ommlMatch;
    while ((ommlMatch = ommlRegex.exec(documentXml)) !== null) {
      ommlMatches.push(ommlMatch[0]);
    }
    
    if (ommlMatches.length === 0) {
      return html; // 没有公式，直接返回
    }
    
    // 转换每个公式为图片
    const formulaImages = [];
    for (const ommlXml of ommlMatches) {
      try {
        const latex = ommlToLatex(ommlXml);
        if (latex && latex.trim()) {
          const imageBase64 = await renderLatexToImage(latex);
          if (imageBase64) {
            formulaImages.push(imageBase64);
            images.push(imageBase64); // 添加到图片数组
          }
        }
      } catch (error) {
        console.warn('转换OMML公式失败:', error.message);
      }
    }
    
    // 由于无法精确映射公式在HTML中的位置，我们采用以下策略：
    // 1. 查找HTML中可能的公式占位符（mammoth可能会插入某些标记）
    // 2. 或者在段落末尾插入公式图片
    // 这里我们使用一个实用方法：在每个段落后面按顺序插入公式图片
    
    // 如果公式图片数量与预期匹配，尝试在HTML中插入
    // 由于mammoth可能没有正确处理公式，我们采用保守策略：
    // 在文档末尾添加公式图片，或者使用特殊标记
    
    if (formulaImages.length > 0) {
      // 使用cheerio解析HTML
      const $ = cheerio.load(html);
      
      // 尝试在每个段落后插入公式图片（按顺序）
      let formulaIndex = 0;
      $('p').each(function() {
        if (formulaIndex < formulaImages.length) {
          const imgTag = `<img src="${formulaImages[formulaIndex]}" alt="公式" style="max-width: 100%; height: auto; margin: 5px 0; display: inline-block; vertical-align: middle;">`;
          $(this).append(' ' + imgTag);
          formulaIndex++;
        }
      });
      
      // 如果还有未插入的公式，在文档末尾添加
      if (formulaIndex < formulaImages.length) {
        for (let i = formulaIndex; i < formulaImages.length; i++) {
          const imgTag = `<p><img src="${formulaImages[i]}" alt="公式" style="max-width: 100%; height: auto; margin: 5px 0; display: block;"></p>`;
          // 如果存在body标签，添加到body；否则添加到根元素
          const body = $('body');
          if (body.length > 0) {
            body.append(imgTag);
          } else {
            // mammoth生成的HTML可能没有body标签，直接追加到根元素
            $.root().append(imgTag);
          }
        }
      }
      
      return $.html();
    }
    
    return html;
  } catch (error) {
    console.warn('处理OMML公式失败:', error.message);
    return html;
  }
}

/**
 * OMML转换为LaTeX（优先使用库，失败则使用内置转换器）
 * @param {string} ommlXml - OMML XML字符串
 * @returns {string|null} LaTeX字符串
 */
function ommlToLatex(ommlXml) {
  try {
    if (!ommlXml || !ommlXml.trim()) {
      return null;
    }
    
    // 首先尝试使用库进行转换
    if (omml2mathml && mathmlToLatex) {
      try {
        const mathml = omml2mathml(ommlXml);
        if (mathml) {
          const latex = mathmlToLatex.convert(mathml);
          if (latex && latex.trim()) {
            return latex.trim();
          }
        }
      } catch (error) {
        console.warn('使用库转换OMML失败，使用内置转换器:', error.message);
      }
    }
    
    // 如果库转换失败或库不可用，使用内置转换器
    return ommlToLatexFallback(ommlXml);
  } catch (error) {
    console.warn('OMML转LaTeX失败:', error.message);
    return null;
  }
}

/**
 * OMML转换为LaTeX（内置转换器，处理常见数学公式）
 * @param {string} ommlXml - OMML XML字符串
 * @returns {string|null} LaTeX字符串
 */
function ommlToLatexFallback(ommlXml) {
  try {
    // OMML到LaTeX的转换是一个复杂的任务
    // 这里实现一个基本的转换器，处理常见情况
    
    // 移除XML命名空间前缀以便处理
    let processedXml = ommlXml.replace(/m:/g, '');
    
    // 处理分数：<f>...</f> with <num> and <den>
    processedXml = processedXml.replace(
      /<f>[\s\S]*?<num>([\s\S]*?)<\/num>[\s\S]*?<den>([\s\S]*?)<\/den>[\s\S]*?<\/f>/g,
      (match, num, den) => {
        const numerator = extractTextFromOMML(num).trim();
        const denominator = extractTextFromOMML(den).trim();
        if (numerator && denominator) {
          return `\\frac{${numerator}}{${denominator}}`;
        }
        return match;
      }
    );
    
    // 处理上标：<sSup>...</sSup>
    processedXml = processedXml.replace(
      /<sSup>[\s\S]*?<e>([\s\S]*?)<\/e>[\s\S]*?<sup>([\s\S]*?)<\/sup>[\s\S]*?<\/sSup>/g,
      (match, base, sup) => {
        const baseText = extractTextFromOMML(base).trim();
        const supText = extractTextFromOMML(sup).trim();
        if (baseText && supText) {
          return `${baseText}^{${supText}}`;
        }
        return match;
      }
    );
    
    // 处理下标：<sSub>...</sSub>
    processedXml = processedXml.replace(
      /<sSub>[\s\S]*?<e>([\s\S]*?)<\/e>[\s\S]*?<sub>([\s\S]*?)<\/sub>[\s\S]*?<\/sSub>/g,
      (match, base, sub) => {
        const baseText = extractTextFromOMML(base).trim();
        const subText = extractTextFromOMML(sub).trim();
        if (baseText && subText) {
          return `${baseText}_{${subText}}`;
        }
        return match;
      }
    );
    
    // 处理根号：<rad>...</rad>
    processedXml = processedXml.replace(
      /<rad>[\s\S]*?<deg>([\s\S]*?)<\/deg>[\s\S]*?<e>([\s\S]*?)<\/e>[\s\S]*?<\/rad>/g,
      (match, deg, content) => {
        const degree = extractTextFromOMML(deg).trim();
        const contentText = extractTextFromOMML(content).trim();
        if (contentText) {
          if (degree && degree !== '2' && degree !== '') {
            return `\\sqrt[${degree}]{${contentText}}`;
          }
          return `\\sqrt{${contentText}}`;
        }
        return match;
      }
    );
    
    // 处理简单根号（无度数）
    processedXml = processedXml.replace(
      /<rad>[\s\S]*?<e>([\s\S]*?)<\/e>[\s\S]*?<\/rad>/g,
      (match, content) => {
        const contentText = extractTextFromOMML(content).trim();
        if (contentText) {
          return `\\sqrt{${contentText}}`;
        }
        return match;
      }
    );
    
    // 处理上下标组合：<sSubSup>
    processedXml = processedXml.replace(
      /<sSubSup>[\s\S]*?<e>([\s\S]*?)<\/e>[\s\S]*?<sub>([\s\S]*?)<\/sub>[\s\S]*?<sup>([\s\S]*?)<\/sup>[\s\S]*?<\/sSubSup>/g,
      (match, base, sub, sup) => {
        const baseText = extractTextFromOMML(base).trim();
        const subText = extractTextFromOMML(sub).trim();
        const supText = extractTextFromOMML(sup).trim();
        if (baseText) {
          let result = baseText;
          if (subText) result += `_{${subText}}`;
          if (supText) result += `^{${supText}}`;
          return result;
        }
        return match;
      }
    );
    
    // 处理矩阵：<m>...</m> (简化处理)
    // 注意：完整的矩阵转换需要更复杂的逻辑
    
    // 处理求和、积分等运算符：<nary>...</nary>
    processedXml = processedXml.replace(/<naryPr><limLoc[^>]*value="undOvr"/g, '\\sum_');
    processedXml = processedXml.replace(/<naryPr><limLoc[^>]*value="sub"/g, '\\int_');
    
    // 提取最终文本
    let latex = extractTextFromOMML(processedXml);
    
    // 处理一些常见的数学符号和运算符
    latex = latex
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/×/g, '\\times')
      .replace(/÷/g, '\\div')
      .replace(/±/g, '\\pm')
      .replace(/∓/g, '\\mp')
      .replace(/≤/g, '\\leq')
      .replace(/≥/g, '\\geq')
      .replace(/≠/g, '\\neq')
      .replace(/≈/g, '\\approx')
      .replace(/∞/g, '\\infty')
      .replace(/∑/g, '\\sum')
      .replace(/∫/g, '\\int')
      .replace(/∏/g, '\\prod')
      .replace(/α/g, '\\alpha')
      .replace(/β/g, '\\beta')
      .replace(/γ/g, '\\gamma')
      .replace(/π/g, '\\pi')
      .replace(/θ/g, '\\theta')
      .replace(/λ/g, '\\lambda')
      .replace(/μ/g, '\\mu')
      .replace(/σ/g, '\\sigma');
    
    // 清理多余的空格，但保留必要的空格
    latex = latex.replace(/\s+/g, ' ').trim();
    
    // 如果结果为空或太短，返回null
    if (!latex || latex.length < 1) {
      return null;
    }
    
    return latex;
  } catch (error) {
    console.warn('内置OMML转LaTeX失败:', error.message);
    return null;
  }
}

/**
 * 从OMML XML中提取文本内容
 * @param {string} ommlXml - OMML XML片段
 * @returns {string} 提取的文本
 */
function extractTextFromOMML(ommlXml) {
  if (!ommlXml) return '';
  
  // 提取<t>标签中的文本（OMML中的文本节点）
  const textMatches = ommlXml.match(/<t[^>]*>([^<]*)<\/t>/g);
  if (textMatches && textMatches.length > 0) {
    return textMatches.map(match => {
      const textMatch = match.match(/<t[^>]*>([^<]*)<\/t>/);
      if (textMatch && textMatch[1]) {
        // 处理XML实体
        return textMatch[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
      }
      return '';
    }).filter(t => t.length > 0).join('');
  }
  
  // 如果没有<t>标签，尝试提取纯文本（去除所有XML标签）
  let text = ommlXml.replace(/<[^>]+>/g, '');
  // 处理XML实体
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  
  return text.trim();
}

// Puppeteer浏览器实例（单例模式，避免重复启动）
let browserInstance = null;

/**
 * 获取或创建Puppeteer浏览器实例
 * @returns {Promise<Object>} 浏览器实例
 */
async function getBrowser() {
  if (!browserInstance) {
    try {
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu'
        ]
      };
      // 离线打包模式：通过环境变量指定随包 Chromium 路径（必须在 Node 进程启动前由启动脚本注入）
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      browserInstance = await puppeteer.launch(launchOptions);
      console.log('Puppeteer浏览器实例已创建');
    } catch (error) {
      console.error('创建Puppeteer浏览器实例失败:', error);
      throw error;
    }
  }
  return browserInstance;
}

/**
 * 关闭Puppeteer浏览器实例（可在应用关闭时调用）
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
      browserInstance = null;
      console.log('Puppeteer浏览器实例已关闭');
    } catch (error) {
      console.error('关闭Puppeteer浏览器实例失败:', error);
    }
  }
}

/**
 * 使用KaTeX和Puppeteer将LaTeX渲染为Base64图片
 * @param {string} latex - LaTeX字符串
 * @returns {Promise<string>} Base64图片字符串
 */
async function renderLatexToImage(latex) {
  let page = null;
  
  try {
    if (!latex || !latex.trim()) {
      return null;
    }
    
    // 使用KaTeX渲染HTML
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      output: 'html'
    });
    
    // 创建包含KaTeX的完整HTML页面
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
        <style>
          body {
            margin: 0;
            padding: 10px;
            background: white;
            display: inline-block;
          }
          .katex {
            font-size: 1.2em;
            font-family: "KaTeX_Main", "Times New Roman", serif;
          }
          .katex-display {
            display: block;
            margin: 0;
          }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;
    
    // 使用Puppeteer渲染
    const browser = await getBrowser();
    page = await browser.newPage();
    
    try {
      // 设置超时时间
      page.setDefaultNavigationTimeout(15000);
      page.setDefaultTimeout(15000);
      
      await page.setContent(fullHtml, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      
      // 等待KaTeX渲染完成（KaTeX通常是同步的，但给一点时间确保渲染）
      await page.waitForSelector('.katex, .katex-display', { timeout: 5000 });
      await page.waitForTimeout(300); // 额外等待确保渲染完成
      
      // 获取公式元素
      const element = await page.$('.katex, .katex-display');
      if (!element) {
        throw new Error('无法找到公式元素');
      }
      
      // 截图，设置合适的选项以优化图片质量
      const screenshot = await element.screenshot({
        type: 'png',
        encoding: 'base64',
        omitBackground: false, // 保留白色背景
        clip: null // 自动裁剪到元素大小
      });
      
      return `data:image/png;base64,${screenshot}`;
    } finally {
      // 确保页面总是被关闭
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.warn('关闭Puppeteer页面失败:', e.message);
        }
      }
    }
  } catch (error) {
    console.error('渲染LaTeX失败:', error.message, latex);
    // 如果渲染失败，返回null，调用者可以处理
    return null;
  }
}

/**
 * 处理文本格式的分数，转换为图片
 * @param {string} html - HTML内容
 * @param {Array} images - 图片数组（用于添加新图片）
 * @returns {Promise<string>} 处理后的HTML
 */
async function processTextFractions(html, images = []) {
  try {
    const $ = cheerio.load(html);
    
    // 匹配文本中的分数格式：
    // 1. 简单分数：1/2, 3/4, 等
    // 2. 带整数部分：1 1/2, 2 3/4, 等
    // 3. Unicode分数：½, ¾, ¼, 等
    
    // 处理Unicode分数
    const unicodeFractions = {
      '½': '\\frac{1}{2}',
      '⅓': '\\frac{1}{3}',
      '⅔': '\\frac{2}{3}',
      '¼': '\\frac{1}{4}',
      '¾': '\\frac{3}{4}',
      '⅕': '\\frac{1}{5}',
      '⅖': '\\frac{2}{5}',
      '⅗': '\\frac{3}{5}',
      '⅘': '\\frac{4}{5}',
      '⅙': '\\frac{1}{6}',
      '⅚': '\\frac{5}{6}',
      '⅛': '\\frac{1}{8}',
      '⅜': '\\frac{3}{8}',
      '⅝': '\\frac{5}{8}',
      '⅞': '\\frac{7}{8}'
    };
    
    // 处理文本节点中的分数
    $('*').contents().each(function() {
      if (this.type === 'text') {
        let text = $(this).text();
        let modified = false;
        let newText = text;
        
        // 替换Unicode分数
        for (const [unicode, latex] of Object.entries(unicodeFractions)) {
          if (newText.includes(unicode)) {
            newText = newText.replace(new RegExp(unicode, 'g'), `[FRAC:${latex}]`);
            modified = true;
          }
        }
        
        // 匹配简单分数：数字/数字（不在公式中的）
        newText = newText.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, (match, num, den) => {
          modified = true;
          return `[FRAC:\\frac{${num}}{${den}}]`;
        });
        
        // 匹配带整数部分的分数：数字 数字/数字
        newText = newText.replace(/\b(\d+)\s+(\d+)\s*\/\s*(\d+)\b/g, (match, whole, num, den) => {
          modified = true;
          return `${whole}\\frac{${num}}{${den}}`;
        });
        
        if (modified) {
          $(this).replaceWith(newText);
        }
      }
    });
    
    // 将标记的分数转换为图片
    const htmlString = $.html();
    const fracRegex = /\[FRAC:(.*?)\]/g;
    let fracMatch;
    const replacements = [];
    
    while ((fracMatch = fracRegex.exec(htmlString)) !== null) {
      const latex = fracMatch[1];
      try {
        const imageBase64 = await renderLatexToImage(latex);
        if (imageBase64) {
          // 添加到图片数组
          if (images && !images.includes(imageBase64)) {
            images.push(imageBase64);
          }
          replacements.push({
            match: fracMatch[0],
            replacement: `<img src="${imageBase64}" alt="分数" style="max-width: 100%; height: auto; margin: 2px 0; vertical-align: middle; display: inline-block;">`
          });
        }
      } catch (error) {
        console.warn('渲染分数失败:', error.message);
      }
    }
    
    // 执行替换
    let finalHtml = htmlString;
    for (const replacement of replacements) {
      finalHtml = finalHtml.replace(replacement.match, replacement.replacement);
    }
    
    return finalHtml;
  } catch (error) {
    console.error('处理文本分数失败:', error);
    return html;
  }
}

/**
 * 清理Word转换后的HTML
 * @param {string} html - HTML内容
 * @returns {string} 清理后的HTML
 */
function cleanWordHtml(html) {
  // 确保段落格式正确
  html = html.replace(/<p>\s*<\/p>/g, '<br>');
  html = html.replace(/<p([^>]*)>/g, (match, attrs) => {
    if (!attrs || !attrs.includes('style=')) {
      return '<p style="margin: 5px 0;">';
    }
    return match;
  });
  
  // 处理表格
  html = html.replace(/<table([^>]*)>/g, (match, attrs) => {
    if (!attrs || !attrs.includes('style=')) {
      return '<table style="border-collapse: collapse; width: 100%; margin: 10px 0;">';
    }
    return match;
  });
  html = html.replace(/<td([^>]*)>/g, (match, attrs) => {
    if (!attrs || !attrs.includes('style=')) {
      return '<td style="border: 1px solid #ddd; padding: 8px;">';
    }
    return match;
  });
  html = html.replace(/<th([^>]*)>/g, (match, attrs) => {
    if (!attrs || !attrs.includes('style=')) {
      return '<th style="border: 1px solid #ddd; padding: 8px; background: #f2f2f2;">';
    }
    return match;
  });
  
  // 处理图片样式，确保图片可以正常显示
  // 注意：保留已有的截图样式，只对没有样式的图片添加默认样式
  html = html.replace(/<img([^>]+)>/g, (match, attrs) => {
    // 如果图片已经包含/uploads/路径（截图），保持原样
    if (attrs.includes('/uploads/')) {
      return match;
    }
    if (!attrs.includes('style=')) {
      return `<img${attrs} style="max-width: 100%; height: auto; margin: 10px 0; display: block;">`;
    } else if (!attrs.includes('max-width')) {
      // 如果已有style但没有max-width，添加
      return match.replace(/style="([^"]*)"/, 'style="$1; max-width: 100%; height: auto; margin: 10px 0; display: block;"');
    }
    return match;
  });
  
  return html;
}

/**
 * 从Word文档中提取数学公式（如果存在）
 * @param {string} filePath - Word文档路径
 * @returns {Promise<Array>} 数学公式数组
 */
async function extractMathFormulas(filePath) {
  try {
    // 读取Word文档的ZIP结构
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    
    const formulas = [];
    
    // 查找文档中的公式（通常在document.xml中）
    const documentXml = await zip.file('word/document.xml').async('string');
    
    // 这里可以添加更复杂的公式提取逻辑
    // Word中的公式通常是OMML格式，需要转换为LaTeX或MathML
    
    return formulas;
  } catch (error) {
    console.error('提取数学公式失败:', error);
    return [];
  }
}

/**
 * 检测并处理无法转换的内容（如数学公式、特殊格式），生成截图保存到服务器
 * 保持原有的格式和行数，在原来的位置显示截图
 * @param {string} html - HTML内容
 * @param {string} uploadsDir - 上传文件目录
 * @returns {Promise<Object>} { html: 处理后的HTML, screenshotUrls: 截图URL数组 }
 */
async function processUnrecognizedContent(html, uploadsDir) {
  const screenshotUrls = [];
  let page = null;
  
  try {
    const $ = cheerio.load(html);
    const unrecognizedElements = [];
    
    // 检测无法转换的内容：
    // 1. 包含特殊字符或数学符号的段落（可能是公式）
    // 2. 空的或格式异常的图片标签
    // 3. mammoth转换时产生的警告标记
    // 4. 包含复杂数学表达式的文本
    
    console.log('开始检测无法转换的内容...');
    
    // 检测可能包含公式或特殊内容的段落和行内元素
    $('p, div, span, td, th, li').each((index, element) => {
      const $el = $(element);
      const text = $el.text().trim();
      const htmlContent = $el.html() || '';
      const elementTag = ($el[0] && $el[0].tagName) ? $el[0].tagName.toLowerCase() : 'div';
      
      // 跳过已经包含图片的元素（可能已经处理过）
      if ($el.find('img[src*="data:image"], img[src*="/uploads/"]').length > 0) {
        return;
      }
      
      // 跳过空元素
      if (!text || text.length === 0) {
        return;
      }
      
      // 检测数学符号和特殊字符（扩展字符集）
      const mathPattern = /[∑∫∏√∞±×÷≤≥≠≈αβγπθλμσ∠°²³⁴⁵⁶⁷⁸⁹⁰]/;
      const hasMathSymbols = mathPattern.test(text);
      
      // 检测可能的公式格式（包含分数、上标、下标、根号等）
      const hasFormulaPattern = /[\/\^_]\d+|\d+\/\d+|\([^)]*\)[²³⁴⁵⁶⁷⁸⁹⁰]|\\frac|\\sqrt|\\sum|\\int/.test(text);
      
      // 检测包含几何图形描述的内容（如射线、角度等）
      const hasGeometryPattern = /射线|角度|∠|°|图形|图表|OA|OB|OC|OD/.test(text);
      
      // 检测空图片或损坏的图片标签
      const hasBrokenImage = htmlContent.includes('<img') && !htmlContent.match(/src=["'][^"']+["']/);
      
      // 检测mammoth转换警告标记
      const hasWarning = htmlContent.includes('mammoth-warning') || htmlContent.includes('无法转换');
      
      // 如果包含数学符号、公式模式、几何图形，且没有对应的图片，标记为需要截图
      // 放宽检测条件，确保能检测到所有相关内容
      if ((hasMathSymbols || hasFormulaPattern || hasGeometryPattern) && text.length > 0) {
        // 检查是否已经有对应的图片（可能是之前转换的）
        const hasImage = $el.find('img[src*="data:image"], img[src*="/uploads/"]').length > 0;
        
        // 放宽条件：只要包含数学符号或几何图形，就进行截图（长度限制放宽到1000字符）
        if (!hasImage && text.length > 0 && text.length < 1000) {
          console.log(`检测到可能需要截图的内容 (${elementTag}): ${text.substring(0, 50)}...`);
          // 记录需要截图的内容
          unrecognizedElements.push({
            element: element,
            $el: $el,
            type: 'formula_or_graphic',
            index: index,
            originalHtml: htmlContent,
            originalText: text,
            tagName: $el[0].tagName || 'div'
          });
        }
      }
      
      // 检测损坏的图片标签
      if (hasBrokenImage) {
        console.log(`检测到损坏的图片标签: ${text.substring(0, 50)}...`);
        unrecognizedElements.push({
          element: element,
          $el: $el,
          type: 'broken_image',
          index: index,
          originalHtml: htmlContent,
          originalText: text,
          tagName: $el[0].tagName || 'div'
        });
      }
      
      // 检测转换警告
      if (hasWarning) {
        console.log(`检测到转换警告: ${text.substring(0, 50)}...`);
        unrecognizedElements.push({
          element: element,
          $el: $el,
          type: 'warning',
          index: index,
          originalHtml: htmlContent,
          originalText: text,
          tagName: $el[0].tagName || 'div'
        });
      }
    });
    
    // 如果没有需要处理的内容，直接返回
    if (unrecognizedElements.length === 0) {
      console.log('未检测到需要截图的内容');
      return { html: $.html(), screenshotUrls: [] };
    }
    
    console.log(`检测到 ${unrecognizedElements.length} 个需要截图的内容`);
    
    // 使用puppeteer生成截图
    const browser = await getBrowser();
    
    // 为每个需要截图的内容生成截图
    for (const item of unrecognizedElements) {
      try {
        // 获取原始HTML内容和属性
        const elementHtml = item.originalHtml || item.$el.html() || item.$el.text();
        const elementTag = item.tagName.toLowerCase();
        const originalStyle = item.$el.attr('style') || '';
        const originalClass = item.$el.attr('class') || '';
        
        // 创建新页面用于截图
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // 创建完整的HTML文档用于截图，保持原始样式
        const fullHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body {
                margin: 0;
                padding: 20px;
                background: white;
                font-family: "Times New Roman", "宋体", "SimSun", serif;
                font-size: 16px;
                line-height: 1.6;
              }
              ${elementTag} {
                display: inline-block;
                max-width: 100%;
                ${originalStyle}
              }
              img {
                max-width: 100%;
                height: auto;
              }
              table {
                border-collapse: collapse;
                margin: 10px 0;
              }
              td, th {
                border: 1px solid #ddd;
                padding: 8px;
              }
            </style>
          </head>
          <body>
            <${elementTag}${originalClass ? ` class="${originalClass}"` : ''}${originalStyle ? ` style="${originalStyle}"` : ''}>${elementHtml}</${elementTag}>
          </body>
          </html>
        `;
        
        await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(800); // 等待渲染完成
        
        // 截图该元素
        const element = await page.$('body > *');
        if (element) {
          // 获取元素的边界框
          const boundingBox = await element.boundingBox();
          if (boundingBox && boundingBox.width > 0 && boundingBox.height > 0) {
            const screenshot = await element.screenshot({
              type: 'png',
              encoding: 'base64',
              omitBackground: false
            });
            
            // 保存截图到服务器
            const timestamp = Date.now();
            const randomSuffix = Math.round(Math.random() * 1E9);
            const filename = `screenshot-${timestamp}-${randomSuffix}.png`;
            const filepath = path.join(uploadsDir, filename);
            
            // 将base64转换为buffer并保存
            const buffer = Buffer.from(screenshot, 'base64');
            await fs.writeFile(filepath, buffer);
            
            // 生成URL路径（相对于uploads目录）
            const screenshotUrl = `/uploads/${filename}`;
            screenshotUrls.push(screenshotUrl);
            
            console.log(`成功生成截图: ${screenshotUrl}`);
            
            // 在HTML中替换原内容为图片，保持原有的标签和样式
            const isBlockElement = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th'].includes(elementTag);
            
            if (isBlockElement) {
              // 块级元素：保持原有标签和样式，只替换内容为图片
              const imgStyle = `max-width: 100%; height: auto; margin: 0; vertical-align: middle; display: block;`;
              const imgTag = `<img src="${screenshotUrl}" alt="无法转换的内容" style="${imgStyle}">`;
              
              // 保持原有标签，只替换内容
              item.$el.html(imgTag);
            } else {
              // 行内元素：保持行内显示
              const imgStyle = `max-width: 100%; height: auto; margin: 0; vertical-align: middle; display: inline-block;`;
              const imgTag = `<img src="${screenshotUrl}" alt="无法转换的内容" style="${imgStyle}">`;
              
              // 替换为行内图片
              item.$el.replaceWith(imgTag);
            }
          } else {
            console.warn(`元素 ${item.index} 边界框无效`);
          }
        }
        
        // 关闭页面
        await page.close();
        page = null;
      } catch (error) {
        console.error(`生成截图失败 (元素 ${item.index}, 类型: ${item.type}):`, error.message);
        if (page) {
          try {
            await page.close();
          } catch (e) {
            // 忽略关闭错误
          }
          page = null;
        }
        // 如果截图失败，保留原内容
      }
    }
    
    const finalHtml = $.html();
    console.log(`处理完成，生成 ${screenshotUrls.length} 个截图`);
    
    return {
      html: finalHtml,
      screenshotUrls: screenshotUrls
    };
  } catch (error) {
    console.error('处理无法转换内容失败:', error);
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // 忽略关闭错误
      }
    }
    return { html: html, screenshotUrls: [] };
  }
}

/**
 * 将 Word 文档按「小题之间空两行」解析为小题列表（含答案、解析、难易程度）
 * 格式：题号. 内容 + 答案：xxx + 解析：xxx + 难易程度：xxx
 * @param {string} filePath - Word 文档路径
 * @returns {Promise<Object>} { success, subQuestions: [...], error? }
 */
async function parseWordDocumentAsSubQuestions(filePath) {
  const { recognizeQuestions } = require('./questionRecognizer');
  try {
    const result = await mammoth.convertToHtml(
      { path: filePath },
      {
        convertImage: mammoth.images.imgElement(function(image) {
          return image.read('base64').then(function(imageBuffer) {
            return {
              src: 'data:' + image.contentType + ';base64,' + imageBuffer.toString('base64')
            };
          });
        })
      }
    );
    const html = result.value;
    const $ = cheerio.load(html);
    const paragraphs = [];
    $('p, div, h1, h2, h3').each(function() {
      const text = $(this).text().trim();
      paragraphs.push(text);
    });
    if (paragraphs.length === 0) {
      const lines = html.replace(/<[^>]+>/g, '\n').split(/\n/).map(s => s.trim()).filter(Boolean);
      paragraphs.push(...lines);
    }
    const fullText = paragraphs.join('\n');
    const blocks = fullText.split(/\n\s*\n\s*\n+/).map(s => s.trim()).filter(Boolean);
    const subQuestions = [];
    for (const block of blocks) {
      if (!block.trim()) continue;
      const blockHtml = block.split(/\n/).map(line => `<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('');
      const recognized = recognizeQuestions(blockHtml);
      if (!recognized.success || !recognized.majorQuestions) continue;
      for (const major of recognized.majorQuestions) {
        if (major.subQuestions && major.subQuestions.length > 0) {
          for (const sub of major.subQuestions) {
            subQuestions.push({
              number: sub.number || '',
              content: sub.content || '',
              contentHtml: sub.contentHtml || sub.content || '',
              answer: sub.answer || null,
              answerHtml: sub.answerHtml || sub.answer || null,
              explanation: sub.explanation || null,
              explanationHtml: sub.explanationHtml || sub.explanation || null,
              difficulty: sub.difficulty || '中等',
              score: sub.score || 0,
              fullContent: (sub.fullContent || sub.contentHtml || sub.content || '')
            });
          }
        }
      }
    }
    return { success: true, subQuestions };
  } catch (error) {
    console.error('parseWordDocumentAsSubQuestions 失败:', error);
    return { success: false, subQuestions: [], error: error.message };
  }
}

module.exports = {
  processWordDocument,
  parseWordDocumentAsSubQuestions,
  cleanWordHtml,
  extractMathFormulas,
  extractAndConvertOMMLFormulas,
  ommlToLatex,
  renderLatexToImage,
  processTextFractions,
  processUnrecognizedContent,
  closeBrowser // 导出关闭浏览器函数，供应用关闭时调用
};
