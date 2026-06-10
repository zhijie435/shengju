const puppeteer = require('puppeteer');
const { getBrowserInstance } = require('./imageProcessor');

/**
 * 将HTML内容导出为PDF
 * @param {string} htmlContent - 完整的HTML内容（包含样式）
 * @param {string} paperSize - 纸张大小 'A4' 或 'A3'
 * @param {Object} options - 额外选项
 * @returns {Promise<Buffer>} PDF文件Buffer
 */
async function exportHtmlToPdf(htmlContent, paperSize = 'A4', options = {}) {
  let browser = null;
  let page = null;

  try {
    // 获取浏览器实例（复用）
    browser = await getBrowserInstance();
    page = await browser.newPage();

    // 设置视口大小（匹配纸张大小）
    const viewportSizes = {
      A4: { width: 794, height: 1123 },
      A3: { width: 1587, height: 1123 }
    };
    const viewport = viewportSizes[paperSize] || viewportSizes.A4;
    await page.setViewport(viewport);

    // 设置内容
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // 等待所有图片加载完成
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = resolve; // 即使失败也继续
            setTimeout(resolve, 3000); // 3秒超时
          });
        })
      );
    });

    // 生成PDF
    const pdfBuffer = await page.pdf({
      format: paperSize,
      printBackground: true, // 确保背景色和阴影显示
      preferCSSPageSize: false, // 使用format参数而不是CSS页面大小
      margin: {
        top: '1.7cm',
        right: '2.1cm',
        bottom: '1.7cm',
        left: '2.1cm'
      },
      displayHeaderFooter: false, // 不使用页眉页脚（预览中已包含）
      scale: 1
    });

    return pdfBuffer;
  } catch (error) {
    console.error('PDF导出失败:', error);
    throw new Error(`PDF导出失败: ${error.message}`);
  } finally {
    // 关闭页面，但不关闭浏览器（复用）
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * 构建完整的HTML文档（包含样式）
 * @param {string} previewHtml - 预览内容HTML
 * @param {string} paperSize - 纸张大小
 * @returns {string} 完整的HTML文档
 */
function buildFullHtmlDocument(previewHtml, paperSize = 'A4') {
  // 提取预览HTML中的所有样式和内联样式
  const pageClass = paperSize === 'A4' ? 'a4-page' : 'a3-page';
  const pageWidth = paperSize === 'A4' ? '794px' : '1587px';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>试题导出</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Microsoft YaHei', 'SimSun', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.8;
            color: #333;
            background: white;
        }
        
        .a4-pages-wrapper {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            gap: 40px !important;
            padding: 30px 0;
            width: 100%;
        }
        
        .a4-page {
            width: 794px !important;
            height: 1123px !important;
            padding: 1.7cm 2.1cm;
            padding-bottom: 1.7cm;
            background: white;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
            position: relative;
            page-break-after: always;
            box-sizing: border-box;
            overflow: hidden !important;
            margin: 0 auto;
            flex-shrink: 0;
            display: block;
            word-wrap: break-word !important;
            word-break: break-word !important;
            overflow-wrap: break-word !important;
            max-width: 794px !important;
            font-family: 'Microsoft YaHei', 'SimSun', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.8;
        }
        
        .a3-page {
            width: 1587px !important;
            height: 1123px !important;
            padding: 1.7cm 2.1cm;
            padding-bottom: 1.7cm;
            background: white;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
            position: relative;
            page-break-after: always;
            box-sizing: border-box;
            overflow: hidden !important;
            margin: 0 auto;
            flex-shrink: 0;
            word-wrap: break-word !important;
            word-break: break-word !important;
            overflow-wrap: break-word !important;
            max-width: 1587px !important;
            font-family: 'Microsoft YaHei', 'SimSun', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.8;
        }
        
        .cover-page {
            display: flex !important;
            flex-direction: column !important;
            height: 100% !important;
            position: relative !important;
            page-break-after: always !important;
            page-break-inside: avoid !important;
            break-after: page !important;
            break-inside: avoid !important;
        }
        
        .cover-secret {
            font-size: 16px !important;
            font-weight: bold !important;
            color: #333 !important;
            line-height: 1.8 !important;
            text-align: center !important;
            margin-bottom: 20px !important;
        }
        
        .cover-title {
            font-size: 32px !important;
            font-weight: bold !important;
            margin-bottom: 20px !important;
            color: #2c3e50 !important;
            text-align: center !important;
            width: 100% !important;
        }
        
        .cover-subtitle {
            font-size: 24px !important;
            color: #666 !important;
            text-align: center !important;
            width: 100% !important;
        }
        
        .cover-bottom {
            text-align: center !important;
            margin-top: auto !important;
            padding-bottom: 30px !important;
            width: 100% !important;
            flex-shrink: 0 !important;
        }
        
        .cover-info-line {
            margin: 15px 0 !important;
            font-size: 18px !important;
            line-height: 2 !important;
        }
        
        .cover-underline {
            display: inline-block !important;
            min-width: 200px !important;
            text-decoration: underline !important;
            text-underline-position: under !important;
            text-decoration-thickness: 1px !important;
            text-underline-offset: 2px !important;
            border-bottom: none !important;
        }
        
        .notes-page {
            display: flex !important;
            flex-direction: column !important;
            position: relative !important;
            padding-top: 64.25px !important;
            padding-bottom: 1.7cm !important;
            page-break-before: always !important;
            page-break-after: always !important;
            page-break-inside: avoid !important;
            break-before: page !important;
            break-after: page !important;
            break-inside: avoid !important;
            overflow: visible !important;
        }
        
        .notes-page-title {
            font-size: 24px !important;
            font-weight: bold !important;
            text-align: center !important;
            margin-bottom: 30px !important;
            color: #2c3e50 !important;
        }
        
        .notes-content {
            display: flex !important;
            flex-direction: column !important;
            flex: 1 !important;
        }
        
        .notes-item {
            font-size: 16px !important;
            line-height: 2 !important;
            margin-bottom: 15px !important;
            color: #333 !important;
        }
        
        .notes-content-bottom {
            font-weight: bold !important;
            text-align: center !important;
            color: #333 !important;
            font-size: 16px !important;
            line-height: 2 !important;
            margin-top: auto !important;
            padding-top: 30px !important;
            padding-bottom: 20px !important;
        }
        
        .preview-question {
            margin-bottom: 0;
            word-wrap: break-word;
            word-break: break-word;
            overflow-wrap: break-word;
            font-size: 14px;
            line-height: 1.8;
        }
        
        .question-preview-header {
            font-size: 14px;
            line-height: 1.8;
            margin-bottom: 10px;
        }
        
        img {
            max-width: 100%;
            height: auto;
            display: block;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
        }
        
        table td, table th {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        
        u {
            text-decoration: underline;
            text-underline-position: under;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
        }
        
        @media print {
            .a4-page, .a3-page {
                box-shadow: none !important;
                margin: 0 !important;
            }
        }
    </style>
</head>
<body>
    <div class="a4-pages-wrapper">
        ${previewHtml}
    </div>
</body>
</html>`;
}

module.exports = {
  exportHtmlToPdf,
  buildFullHtmlDocument
};
