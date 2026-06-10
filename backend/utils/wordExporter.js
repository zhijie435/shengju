const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, WidthType, Table, TableRow, TableCell, BorderStyle, ImageRun, Media } = require('docx');
const cheerio = require('cheerio');

/**
 * 将HTML内容导出为Word文档
 * @param {string} htmlContent - 预览HTML内容
 * @param {string} paperSize - 纸张大小 'A4' 或 'A3'
 * @param {Object} options - 额外选项
 * @returns {Promise<Buffer>} Word文档Buffer
 */
async function exportHtmlToWord(htmlContent, paperSize = 'A4', options = {}) {
  try {
    const $ = cheerio.load(htmlContent);
    const children = [];
    const mediaArray = []; // 用于存储图片媒体对象

    // 处理所有页面
    const pages = $('.a4-page, .a3-page, .cover-page, .notes-page');
    
    pages.each((pageIndex, pageElement) => {
      const $page = $(pageElement);
      
      // 如果不是第一页，添加分页符
      if (pageIndex > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }

      // 处理封面页
      if ($page.hasClass('cover-page')) {
        children.push(...processCoverPage($page, mediaArray));
      }
      // 处理注意事项页
      else if ($page.hasClass('notes-page')) {
        children.push(...processNotesPage($page, mediaArray));
      }
      // 处理试题内容页
      else {
        children.push(...processQuestionPage($page, mediaArray));
      }
    });

    // 如果没有找到页面，尝试直接处理内容
    if (pages.length === 0) {
      children.push(...processQuestionPage($('body'), mediaArray));
    }

    // 创建Word文档
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: {
              width: paperSize === 'A3' ? 16838 : 11906, // A3: 420mm, A4: 297mm (单位：twips, 1mm = 56.7 twips)
              height: 11906 // 297mm
            },
            margin: {
              top: 963, // 1.7cm = 963 twips
              right: 1191, // 2.1cm = 1191 twips
              bottom: 963, // 1.7cm = 963 twips
              left: 1191 // 2.1cm = 1191 twips
            }
          }
        },
        children: children
      }]
    });

    // 生成Word文档Buffer
    const buffer = await Packer.toBuffer(doc);
    return buffer;
  } catch (error) {
    console.error('Word导出失败:', error);
    throw new Error(`Word导出失败: ${error.message}`);
  }
}

/**
 * 处理封面页
 */
function processCoverPage($page, mediaArray) {
  const children = [];

  // 密封线
  const secretLine = $page.find('.cover-secret').text().trim();
  if (secretLine) {
    children.push(new Paragraph({
      text: secretLine,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    }));
  }

  // 标题
  const title = $page.find('.cover-title').text().trim();
  if (title) {
    children.push(new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 400 }
    }));
  }

  // 副标题
  const subtitle = $page.find('.cover-subtitle').text().trim();
  if (subtitle) {
    children.push(new Paragraph({
      text: subtitle,
      alignment: AlignmentType.CENTER,
      spacing: { after: 1200 }
    }));
  }

  // 底部信息
  const bottomInfo = $page.find('.cover-bottom');
  bottomInfo.find('.cover-info-line').each((index, element) => {
    const $line = cheerio.load(element);
    const text = $line.text().trim();
    if (text) {
      children.push(new Paragraph({
        text: text,
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 }
      }));
    }
  });

  return children;
}

/**
 * 处理注意事项页
 */
function processNotesPage($page, mediaArray) {
  const children = [];

  // 标题
  const title = $page.find('.notes-page-title').text().trim();
  if (title) {
    children.push(new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 600 }
    }));
  }

  // 注意事项内容
  $page.find('.notes-item').each((index, element) => {
    const $item = cheerio.load(element);
    const text = $item.text().trim();
    if (text) {
      children.push(new Paragraph({
        text: text,
        spacing: { after: 300 },
        indent: { firstLine: 0 }
      }));
    }
  });

  // 底部警告
  const bottomWarning = $page.find('.notes-content-bottom').text().trim();
  if (bottomWarning) {
    children.push(new Paragraph({
      text: bottomWarning,
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 400 },
      run: {
        bold: true
      }
    }));
  }

  return children;
}

/**
 * 处理试题内容页
 */
function processQuestionPage($page, images) {
  const children = [];

  // 先处理大题（.preview-question）
  $page.find('.preview-question').each((index, questionElement) => {
    const $question = cheerio.load(questionElement);
    
    // 处理大题标题
    const header = $question.find('.question-preview-header');
    if (header.length > 0) {
      const headerText = header.text().trim();
      if (headerText) {
        children.push(new Paragraph({
          text: headerText,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }));
      }
    }
    
    // 处理小题内容（直接查找div，因为小题没有特定的class）
    $question('div').each((divIndex, divElement) => {
      const $div = cheerio.load(divElement);
      const tagName = divElement.tagName?.toLowerCase();
      
      // 跳过大题标题div
      if ($div.hasClass('question-preview-header')) {
        return;
      }
      
      // 处理表格
      if (tagName === 'table') {
        const table = processTable($div);
        if (table) {
          children.push(table);
        }
        return;
      }
      
      // 处理包含文本的div
      const text = $div.text().trim();
      if (text && text.length > 0) {
        const paragraphChildren = processElementContent($div, divElement, images);
        if (paragraphChildren.length > 0) {
          children.push(new Paragraph({
            children: paragraphChildren,
            spacing: { after: 200 }
          }));
        }
      }
    });
  });

  // 如果没有找到.preview-question，直接处理所有div和p
  if (children.length === 0) {
    $page.find('div, p').each((index, element) => {
      const $el = cheerio.load(element);
      const tagName = element.tagName?.toLowerCase();
      
      // 跳过空元素
      const text = $el.text().trim();
      if (!text || text.length === 0) {
        return;
      }
      
      // 处理表格
      if (tagName === 'table') {
        const table = processTable($el);
        if (table) {
          children.push(table);
        }
        return;
      }
      
      // 处理段落
      const paragraphChildren = processElementContent($el, element, images);
      if (paragraphChildren.length > 0) {
        children.push(new Paragraph({
          children: paragraphChildren,
          spacing: { after: 200 }
        }));
      }
    });
  }

  // 如果还是没有内容，直接处理文本
  if (children.length === 0) {
    const text = $page.text().trim();
    if (text) {
      children.push(new Paragraph({
        text: text,
        spacing: { after: 200 }
      }));
    }
  }

  return children;
}

/**
 * 处理元素内容（包括文本、图片、格式等）
 */
function processElementContent($el, element, images) {
  const children = [];
  const $ = cheerio.load(element);

  // 递归处理节点
  function processNode(node) {
    if (node.type === 'text') {
      const text = node.data;
      if (text && text.trim()) {
        // 检查父元素的格式
        let parent = node.parent;
        let isBold = false;
        let isUnderline = false;
        
        while (parent && parent.type === 'tag') {
          const tagName = parent.tagName?.toLowerCase();
          if (tagName === 'strong' || tagName === 'b') {
            isBold = true;
          }
          if (tagName === 'u') {
            isUnderline = true;
          }
          parent = parent.parent;
        }

        children.push(new TextRun({
          text: text,
          bold: isBold,
          underline: isUnderline ? { type: 'single' } : undefined
        }));
      }
    } else if (node.type === 'tag') {
      const tagName = node.tagName?.toLowerCase();

      if (tagName === 'img') {
        const src = $(node).attr('src');
        if (src) {
          // 处理base64图片
          if (src.startsWith('data:image')) {
            const imageData = processBase64Image(src, images);
            if (imageData && imageData.buffer) {
              try {
                // ImageRun需要width和height（单位：EMU，1px = 9525 EMU）
                const widthEmu = Math.round((imageData.width || 400) * 9525);
                const heightEmu = Math.round((imageData.height || 300) * 9525);
                
                children.push(new ImageRun({
                  data: imageData.buffer,
                  transformation: {
                    width: widthEmu,
                    height: heightEmu
                  }
                }));
              } catch (imageError) {
                console.error('添加图片失败:', imageError);
                // 如果图片添加失败，添加占位文本
                children.push(new TextRun({ text: '[图片]' }));
              }
            }
          }
        }
      } else if (tagName === 'strong' || tagName === 'b') {
        const text = $(node).text();
        if (text && text.trim()) {
          children.push(new TextRun({
            text: text,
            bold: true
          }));
        }
      } else if (tagName === 'u') {
        const text = $(node).text();
        if (text && text.trim()) {
          children.push(new TextRun({
            text: text,
            underline: { type: 'single' }
          }));
        }
      } else if (tagName === 'br') {
        // Word中换行通过段落实现
        children.push(new TextRun({ text: '\n' }));
      } else if (tagName === 'span' || tagName === 'div' || tagName === 'p') {
        // 递归处理子节点
        $(node).contents().each((index, childNode) => {
          processNode(childNode);
        });
      } else {
        // 其他标签，提取文本
        const text = $(node).text();
        if (text && text.trim()) {
          children.push(new TextRun({ text: text }));
        }
      }
    }
  }

  // 处理所有子节点
  $(element).contents().each((index, node) => {
    processNode(node);
  });

  // 如果没有处理到任何内容，直接提取文本
  if (children.length === 0) {
    const text = $(element).text().trim();
    if (text) {
      children.push(new TextRun({ text: text }));
    }
  }

  return children;
}

/**
 * 处理表格
 */
function processTable($table) {
  try {
    const rows = [];
    $table.find('tr').each((rowIndex, rowElement) => {
      const $row = cheerio.load(rowElement);
      const cells = [];

      $row.find('td, th').each((cellIndex, cellElement) => {
        const $cell = cheerio.load(cellElement);
        const cellText = $cell.text().trim();

        cells.push(new TableCell({
          children: [new Paragraph({
            text: cellText
          })],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1 },
            bottom: { style: BorderStyle.SINGLE, size: 1 },
            left: { style: BorderStyle.SINGLE, size: 1 },
            right: { style: BorderStyle.SINGLE, size: 1 }
          }
        }));
      });

      if (cells.length > 0) {
        rows.push(new TableRow({ children: cells }));
      }
    });

    if (rows.length > 0) {
      return new Table({
        rows: rows,
        width: {
          size: 100,
          type: WidthType.PERCENTAGE
        }
      });
    }
  } catch (error) {
    console.error('处理表格失败:', error);
  }

  return null;
}

/**
 * 处理Base64图片
 */
function processBase64Image(src, images) {
  try {
    const matches = src.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return null;

    const imageType = matches[1].toLowerCase();
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 使用sharp库获取图片尺寸（如果可用）
    let width = 400;
    let height = 300;
    
    try {
      const sharp = require('sharp');
      const metadata = sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        // 限制最大宽度为500px，保持比例
        const maxWidth = 500;
        if (metadata.width > maxWidth) {
          const ratio = maxWidth / metadata.width;
          width = maxWidth;
          height = Math.round(metadata.height * ratio);
        } else {
          width = metadata.width;
          height = metadata.height;
        }
      }
    } catch (sharpError) {
      // sharp不可用，使用默认尺寸
      console.warn('无法获取图片尺寸，使用默认值:', sharpError.message);
    }

    return {
      buffer: buffer,
      width: width,
      height: height,
      type: imageType
    };
  } catch (error) {
    console.error('处理Base64图片失败:', error);
    return null;
  }
}

module.exports = {
  exportHtmlToWord
};
