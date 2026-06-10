const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const https = require('https');
const http = require('http');

/**
 * 从HTML内容中提取所有Base64图片
 * @param {string} htmlContent - HTML内容
 * @returns {Array} Base64图片数组
 */
function extractImagesFromHtml(htmlContent) {
  const images = [];
  const $ = cheerio.load(htmlContent);
  
  $('img').each((index, element) => {
    const src = $(element).attr('src');
    // 只提取Base64格式的图片，忽略本地文件路径（file://）和其他URL
    if (src && src.startsWith('data:image')) {
      images.push({
        index: index,
        src: src,
        alt: $(element).attr('alt') || ''
      });
    } else if (src && (src.startsWith('file:///') || src.startsWith('file://'))) {
      // 如果是本地文件路径，记录警告但不提取
      console.warn(`检测到本地文件路径图片，已忽略: ${src.substring(0, 50)}...`);
    }
  });

  return images;
}

/**
 * 从HTML中移除图片，返回纯文本
 * @param {string} htmlContent - HTML内容
 * @returns {string} 移除图片后的HTML
 */
function removeImagesFromHtml(htmlContent) {
  const $ = cheerio.load(htmlContent);
  $('img').remove();
  return $.html();
}

/**
 * 提取纯文本内容（去除HTML标签）
 * @param {string} htmlContent - HTML内容
 * @returns {string} 纯文本
 */
function extractTextFromHtml(htmlContent) {
  const $ = cheerio.load(htmlContent);
  return $.text().trim();
}

/**
 * 处理HTML内容，提取图片和文本
 * @param {string} htmlContent - HTML内容
 * @returns {Object} { images, textContent, htmlWithoutImages }
 */
function processHtmlContent(htmlContent) {
  // 先清理本地文件路径的图片
  const $ = cheerio.load(htmlContent);
  $('img').each((index, element) => {
    const src = $(element).attr('src') || '';
    // 如果是本地文件路径，移除图片标签或替换为提示
    if (src.startsWith('file:///') || src.startsWith('file://')) {
      const $img = $(element);
      $img.replaceWith('<span style="color: #856404; background: #fff3cd; padding: 2px 6px; border-radius: 3px;">[图片需要重新上传]</span>');
    }
  });
  const cleanedHtml = $.html();
  
  const images = extractImagesFromHtml(cleanedHtml);
  const htmlWithoutImages = removeImagesFromHtml(cleanedHtml);
  const textContent = extractTextFromHtml(cleanedHtml);
  
  // 提取图片的Base64数据
  const imagesBase64 = images.map(img => img.src);

  return {
    images: images,
    imagesBase64: imagesBase64,
    textContent: textContent,
    htmlWithoutImages: htmlWithoutImages
  };
}

// Puppeteer浏览器实例（单例模式）
let browserInstance = null;

/**
 * 获取或创建Puppeteer浏览器实例
 * @returns {Promise<Object>} 浏览器实例
 */
async function getBrowserInstance() {
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
    } catch (error) {
      console.error('创建Puppeteer浏览器实例失败:', error);
      throw error;
    }
  }
  return browserInstance;
}

/**
 * 下载图片并转换为Base64
 * @param {string} url - 图片URL
 * @returns {Promise<string|null>} Base64图片字符串
 */
function downloadImageToBase64(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载图片失败: ${response.statusCode}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = response.headers['content-type'] || 'image/png';
        const base64 = buffer.toString('base64');
        resolve(`data:${contentType};base64,${base64}`);
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * 使用Puppeteer截图无法显示的图片区域
 * @param {string} htmlContent - HTML内容
 * @param {number} imgIndex - 图片索引
 * @returns {Promise<string|null>} Base64图片字符串
 */
async function screenshotImageElement(htmlContent, imgIndex) {
  let page = null;
  try {
    const browser = await getBrowserInstance();
    page = await browser.newPage();
    
    // 设置viewport大小
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 创建完整的HTML文档
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            margin: 0;
            padding: 20px;
            background: white;
            font-family: Arial, sans-serif;
          }
          img {
            max-width: 100%;
            height: auto;
          }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
      </html>
    `;
    
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 10000 });
    
    // 等待页面加载
    await page.waitForTimeout(500);
    
    // 查找指定索引的图片元素
    const imgElements = await page.$$('img');
    if (imgIndex >= imgElements.length) {
      return null;
    }
    
    const imgElement = imgElements[imgIndex];
    
    // 截图该图片元素
    const screenshot = await imgElement.screenshot({
      type: 'png',
      encoding: 'base64'
    });
    
    return `data:image/png;base64,${screenshot}`;
  } catch (error) {
    console.warn('截图图片元素失败:', error.message);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // 忽略关闭错误
      }
    }
  }
}

/**
 * 处理粘贴的HTML内容，将无法显示的图片转换为Base64
 * @param {string} htmlContent - HTML内容
 * @returns {Promise<Object>} { html: 处理后的HTML, images: Base64图片数组, needsUpload: 需要重新上传的图片信息 }
 */
async function processPastedContent(htmlContent) {
  const $ = cheerio.load(htmlContent);
  const images = [];
  const needsUpload = []; // 记录需要重新上传的图片
  
  // 收集所有需要处理的图片
  const imgElements = [];
  $('img').each((index, element) => {
    const $img = $(element);
    const src = $img.attr('src');
    
    // 如果已经是Base64，直接添加到images数组
    if (src && src.startsWith('data:image')) {
      images.push(src);
      return;
    }
    
    // 如果src为空，跳过
    if (!src || !src.trim()) {
      return;
    }
    
    imgElements.push({
      index: index,
      element: element,
      $img: $img,
      src: src
    });
  });
  
  // 并行处理所有图片
  const replacementPromises = imgElements.map(async ({ index, $img, src }) => {
    try {
      // 处理file://路径（服务器无法访问客户端本地文件）
      if (src.startsWith('file:///') || src.startsWith('file://')) {
        // 记录需要重新上传的图片信息
        needsUpload.push({
          index: index,
          src: src,
          alt: $img.attr('alt') || '',
          reason: '本地文件路径，服务器无法访问，需要前端转换为base64后重新处理'
        });
        
        // 使用占位符，但保留原始信息以便前端处理
        return {
          index: index,
          newSrc: null,
          placeholder: true,
          needsUpload: true,
          originalSrc: src
        };
      }
      
      // 处理外部URL（http/https）
      if (src.startsWith('http://') || src.startsWith('https://')) {
        try {
          const base64Image = await downloadImageToBase64(src);
          if (base64Image) {
            return {
              index: index,
              newSrc: base64Image,
              placeholder: false,
              needsUpload: false
            };
          }
        } catch (error) {
          console.warn(`下载图片失败 (${src.substring(0, 50)}...):`, error.message);
          // 下载失败，记录需要重新上传
          needsUpload.push({
            index: index,
            src: src,
            alt: $img.attr('alt') || '',
            reason: `下载失败: ${error.message}`
          });
          
          return {
            index: index,
            newSrc: null,
            placeholder: true,
            needsUpload: true,
            originalSrc: src
          };
        }
      }
      
      // 其他情况，记录需要重新上传
      needsUpload.push({
        index: index,
        src: src,
        alt: $img.attr('alt') || '',
        reason: '未知的图片路径格式'
      });
      
      return {
        index: index,
        newSrc: null,
        placeholder: true,
        needsUpload: true,
        originalSrc: src
      };
    } catch (error) {
      console.warn(`处理图片失败 (${src.substring(0, 50)}...):`, error.message);
      needsUpload.push({
        index: index,
        src: src,
        alt: $img.attr('alt') || '',
        reason: `处理失败: ${error.message}`
      });
      
      return {
        index: index,
        newSrc: null,
        placeholder: true,
        needsUpload: true,
        originalSrc: src
      };
    }
  });
  
  const replacements = await Promise.all(replacementPromises);
  
  // 应用所有替换
  replacements.forEach(({ index, newSrc, placeholder, needsUpload: needUpload, originalSrc }) => {
    const imgInfo = imgElements[index];
    if (!imgInfo) return;
    
    const $img = imgInfo.$img;
    
    if (newSrc) {
      // 替换为Base64图片
      $img.attr('src', newSrc);
      images.push(newSrc);
    } else if (placeholder) {
      // 使用占位符替换，但保留data-original-src以便前端处理
      $img.attr('src', '');
      $img.attr('data-placeholder', 'true');
      if (originalSrc) {
        $img.attr('data-original-src', originalSrc);
      }
      $img.after('<span style="color: #856404; background: #fff3cd; padding: 2px 6px; border-radius: 3px; display: inline-block;">[图片需要重新上传]</span>');
    }
  });
  
  return {
    html: $.html(),
    images: images,
    needsUpload: needsUpload // 返回需要重新上传的图片信息
  };
}

/**
 * 从数据库内容恢复HTML（将Base64图片恢复）
 * @param {string} contentHtml - 数据库中的HTML内容
 * @param {Array} imagesBase64 - Base64图片数组
 * @returns {string} 恢复后的HTML内容
 */
function restoreContentFromDatabase(contentHtml, imagesBase64) {
  if (!imagesBase64 || imagesBase64.length === 0) {
    return contentHtml;
  }
  
  const $ = cheerio.load(contentHtml, null, false);
  let imageIndex = 0;
  
  // 查找所有图片标签
  $('img').each((index, element) => {
    const $img = $(element);
    const currentSrc = $img.attr('src') || '';
    
    // 如果图片src不是Base64格式，或者为空，则替换为Base64
    if (!currentSrc.startsWith('data:image')) {
      if (imageIndex < imagesBase64.length) {
        $img.attr('src', imagesBase64[imageIndex]);
        imageIndex++;
      } else {
        // 如果Base64数组用完了，但还有图片标签，保留原src或移除
        console.warn(`图片数量不匹配: 需要恢复的图片数量超过Base64数组长度`);
      }
    } else {
      // 已经是Base64格式，跳过
      imageIndex++;
    }
  });
  
  // 如果HTML中没有img标签，但Base64数组有数据，可能是图片丢失了
  // 这种情况下，我们保留原HTML不变
  
  return $.html();
}

module.exports = {
  extractImagesFromHtml,
  removeImagesFromHtml,
  extractTextFromHtml,
  processHtmlContent,
  processPastedContent,
  restoreContentFromDatabase
};

