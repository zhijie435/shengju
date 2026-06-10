/**
 * 试题识别核心模块
 * 用于识别试题内容中的大题、小题、子小题和分值
 * 支持Node.js和浏览器环境
 */

// 检查运行环境
const isNode = typeof window === 'undefined';
let cheerio;

if (isNode) {
    // Node.js环境，使用cheerio
    try {
        cheerio = require('cheerio');
    } catch (e) {
        console.warn('cheerio未安装');
    }
}

/**
 * 判断题目难度
 * @param {string} content - 题目内容
 * @param {number} score - 题目分值
 * @returns {string} 难度等级：'简单'、'中等'、'困难'
 */
function assessDifficulty(content, score = 0) {
    if (!content) return '中等';
    
    const text = content.replace(/<[^>]*>/g, '').trim(); // 去除HTML标签
    const length = text.length;
    
    // 难度关键词
    const easyKeywords = ['填空', '选择', '判断', '单选', '多选', '是', '否', '对', '错'];
    const hardKeywords = ['证明', '推导', '分析', '论述', '计算', '求解', '设计', '综合', '应用', '创新'];
    
    let difficultyScore = 0;
    
    // 根据长度判断（简单题通常较短）
    if (length < 100) {
        difficultyScore -= 1;
    } else if (length > 500) {
        difficultyScore += 1;
    }
    
    // 根据关键词判断
    const lowerText = text.toLowerCase();
    easyKeywords.forEach(keyword => {
        if (lowerText.includes(keyword)) {
            difficultyScore -= 0.5;
        }
    });
    
    hardKeywords.forEach(keyword => {
        if (lowerText.includes(keyword)) {
            difficultyScore += 1;
        }
    });
    
    // 根据分值判断（高分值可能是困难题）
    if (score > 10) {
        difficultyScore += 0.5;
    } else if (score <= 2) {
        difficultyScore -= 0.5;
    }
    
    // 根据题目数量判断（如果题目很长且包含多个步骤，可能是困难题）
    const stepIndicators = ['步骤', '过程', '方法', '原理', '原因', '结果'];
    let stepCount = 0;
    stepIndicators.forEach(indicator => {
        if (lowerText.includes(indicator)) {
            stepCount++;
        }
    });
    if (stepCount >= 3) {
        difficultyScore += 0.5;
    }
    
    // 根据难度分数判断
    if (difficultyScore <= -1) {
        return '简单';
    } else if (difficultyScore >= 1.5) {
        return '困难';
    } else {
        return '中等';
    }
}

/**
 * 识别试题内容
 * @param {string} htmlContent - HTML格式的试题内容
 * @returns {Object} 识别结果，包含大题列表
 */
function recognizeQuestions(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
        return {
            success: false,
            error: '内容不能为空',
            majorQuestions: []
        };
    }

    try {
        let paragraphs = [];
        let getText, getHtml;

        if (isNode && cheerio) {
            // Node.js环境，使用cheerio
            const $ = cheerio.load(htmlContent);
            const elements = $('p, div, h1, h2, h3, h4, h5, h6, li').toArray();
            
            paragraphs = elements.map(elem => {
                const $elem = $(elem);
                return {
                    text: $elem.text().trim(),
                    html: $.html(elem)
                };
            });

            // 如果没有找到段落，按换行符分割
            if (paragraphs.length === 0) {
                const lines = htmlContent.split(/\n|<br\s*\/?>/i);
                paragraphs = lines.map(line => {
                    const trimmed = line.replace(/<[^>]*>/g, '').trim();
                    return {
                        text: trimmed,
                        html: line
                    };
                });
            }
        } else {
            // 浏览器环境
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            
            const elements = tempDiv.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li');
            
            if (elements.length > 0) {
                paragraphs = Array.from(elements).map(elem => ({
                    text: (elem.textContent || elem.innerText || '').trim(),
                    html: elem.outerHTML || elem.innerHTML || ''
                }));
            } else {
                // 如果没有段落标签，按换行符分割
                const lines = htmlContent.split(/\n|<br\s*\/?>/i);
                paragraphs = lines.map(line => {
                    const temp = document.createElement('div');
                    temp.innerHTML = line;
                    return {
                        text: (temp.textContent || temp.innerText || '').trim(),
                        html: line
                    };
                });
            }
        }

        // 识别结果
        const majorQuestions = [];
        let currentMajorQuestion = null;
        let currentSubQuestion = null;
        let majorQuestionIndex = 0; // 大题序号（用于生成题号：一、二、三等）

        // 中文数字映射
        const chineseNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

        // 正则表达式模式
        const majorQuestionPattern = /^[一二三四五六七八九十]+[、．.]/; // 大题题号
        const subQuestionPattern = /^\d+[\.。、]/; // 小题题号：1. 2. 3.
        const subSubQuestionPattern = /[（(]\d+[）)]/; // 子小题题号：（1）（2）（3）
        const scorePattern = /[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]/; // 分值：（1分）（2分）（5分）

        /**
         * 论述/综合题常见写法：题干里已有「要求：」，下列若干行无（1）（2）编号。
         * 原逻辑只认带括号的子小题，导致预览不加题号；此处将符合「作答指令」的独立段自动拆成子小题并前缀（n）。
         */
        function shouldAutoNumberAsRequirementSub(trimmedText, subContentSoFar) {
            if (!trimmedText || trimmedText.length < 12) return false;
            if (!subContentSoFar || !subContentSoFar.includes('要求')) return false;
            if (/^\s*\d+[\.。、]/.test(trimmedText)) return false;
            if (/^[一二三四五六七八九十]+[、．.]/.test(trimmedText)) return false;
            if (/^\s*[（(]\s*\d+\s*[）)]/.test(trimmedText)) return false;
            if (/答案\s*[：:]/.test(trimmedText)) return false;
            if (/^解析/.test(trimmedText)) return false;
            const t = trimmedText.trim();
            const looksInstruction =
                /[；;]$/.test(t) ||
                /不少于\s*\d+\s*字/.test(t) ||
                /^(?:简要|概括|分析|说明|结合|阐述|论述|列举|比较|评价|归纳|指出|简述)/.test(t);
            if (looksInstruction) return true;
            if (t.length >= 45) return true;
            return false;
        }

        function pushAutoNumberedRequirementSub(currentSubQuestion, trimmedText, paraHtml) {
            const idx = currentSubQuestion.subSubQuestions.length + 1;
            const prefix = `（${idx}）`;
            let contentHtmlP = paraHtml || '';
            const trimmedHtml = contentHtmlP.trim();
            if (/^<p(\s[^>]*)?>/i.test(trimmedHtml)) {
                contentHtmlP = trimmedHtml.replace(/^<p(\s[^>]*)?>/i, `<p$1>${prefix}`);
            } else {
                contentHtmlP = `<p>${prefix}</p>${contentHtmlP}`;
            }
            currentSubQuestion.subSubQuestions.push({
                number: String(idx),
                score: 0,
                content: prefix + trimmedText,
                contentHtml: contentHtmlP,
                difficulty: assessDifficulty(trimmedText, 0),
                autoNumberedRequirement: true
            });
        }

        // 遍历每个段落
        paragraphs.forEach((para) => {
            const trimmedText = para.text;

            if (!trimmedText) return;

            // 检查是否是大题题号
            if (majorQuestionPattern.test(trimmedText)) {
                // 开始新的大题
                majorQuestionIndex++;
                const majorNumber = chineseNumbers[majorQuestionIndex - 1] || majorQuestionIndex.toString();

                // 提取题型和分值信息
                let questionType = '';
                let totalScore = 0;
                let questionCount = 0;
                let scorePerQuestion = 0;

                // 尝试从题干中提取题型和分值信息
                // 格式：一、选择题（每小题5分，共3小题，总分值15分）
                const typeMatch = trimmedText.match(/^[一二三四五六七八九十]+[、．.]\s*([^（(]+)/);
                if (typeMatch) {
                    questionType = typeMatch[1].trim();
                }

                // 提取分值信息
                const scoreInfoMatch = trimmedText.match(/[（(]([^）)]+)[）)]/);
                if (scoreInfoMatch) {
                    const scoreInfo = scoreInfoMatch[1];
                    // 提取每小题分值
                    const perScoreMatch = scoreInfo.match(/每[小]?题\s*(\d+(?:\.\d+)?)\s*分/);
                    if (perScoreMatch) {
                        scorePerQuestion = parseFloat(perScoreMatch[1]) || 0;
                    }
                    // 提取小题数量
                    const countMatch = scoreInfo.match(/共\s*(\d+)\s*[小]?题/);
                    if (countMatch) {
                        questionCount = parseInt(countMatch[1]) || 0;
                    }
                    // 提取总分值
                    const totalScoreMatch = scoreInfo.match(/总[分]?值\s*(\d+(?:\.\d+)?)\s*分/);
                    if (totalScoreMatch) {
                        totalScore = parseFloat(totalScoreMatch[1]) || 0;
                    } else if (scorePerQuestion > 0 && questionCount > 0) {
                        // 如果没有总分值，计算总分值
                        totalScore = scorePerQuestion * questionCount;
                    }
                }

                // 创建新的大题
                currentMajorQuestion = {
                    number: majorNumber,
                    type: questionType || '未命名题型',
                    content: trimmedText,
                    contentHtml: para.html,
                    score: totalScore,
                    questionCount: questionCount,
                    scorePerQuestion: scorePerQuestion,
                    autoGenerated: !questionType, // 如果没有识别到题型，标记为自动生成
                    subQuestions: []
                };

                // 重置当前小题
                currentSubQuestion = null;

                majorQuestions.push(currentMajorQuestion);
            }
            // 检查是否是小题题号
            else if (subQuestionPattern.test(trimmedText)) {
                // 如果没有当前大题，创建一个默认大题
                if (!currentMajorQuestion) {
                    majorQuestionIndex++;
                    const majorNumber = chineseNumbers[majorQuestionIndex - 1] || majorQuestionIndex.toString();
                    currentMajorQuestion = {
                        number: majorNumber,
                        type: '未命名题型',
                        content: '',
                        contentHtml: '',
                        score: 0,
                        questionCount: 0,
                        scorePerQuestion: 0,
                        autoGenerated: true,
                        subQuestions: []
                    };
                    majorQuestions.push(currentMajorQuestion);
                }

                // 提取小题题号和分值
                const subNumberMatch = trimmedText.match(/^(\d+)[\.。、]/);
                const subNumber = subNumberMatch ? subNumberMatch[1] : '';

                // 提取分值
                let score = 0;
                const scoreMatch = trimmedText.match(scorePattern);
                if (scoreMatch) {
                    score = parseFloat(scoreMatch[1]) || 0;
                }

                // 提取答案、解析和难易程度
                let answer = null;
                let answerHtml = null;
                let explanation = null;
                let explanationHtml = null;
                let recognizedDifficulty = null;
                
                // 提取难易程度（优先从标记中识别）
                const difficultyMatch = trimmedText.match(/(?:难易程度|难度)[：:\s]*\s*(简单|中等|困难)/);
                if (difficultyMatch) {
                    recognizedDifficulty = difficultyMatch[1];
                }
                
                // 评估难度（如果没有识别到，则使用自动评估）
                const difficulty = recognizedDifficulty || assessDifficulty(trimmedText, score);
                
                // 优先检查HTML中是否有标黄内容（黄色背景）作为答案
                if (isNode && cheerio) {
                    const $ = cheerio.load(para.html);
                    // 扩展黄色背景的匹配模式，支持更多格式
                    const yellowElements = $('[style*="background-color: yellow"], [style*="background: yellow"], [style*="background-color:#ffff00"], [style*="background:#ffff00"], [style*="background-color:yellow"], [style*="background:yellow"], [bgcolor="yellow"], [bgcolor="#ffff00"]');
                    if (yellowElements.length > 0) {
                        answerHtml = yellowElements.map((i, el) => $(el).html()).get().join(' ');
                        answer = yellowElements.map((i, el) => $(el).text()).get().join(' ').trim();
                    }
                } else if (typeof document !== 'undefined') {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = para.html;
                    // 扩展黄色背景的匹配模式
                    const yellowElements = tempDiv.querySelectorAll('[style*="background-color: yellow"], [style*="background: yellow"], [style*="background-color:#ffff00"], [style*="background:#ffff00"], [style*="background-color:yellow"], [style*="background:yellow"], [bgcolor="yellow"], [bgcolor="#ffff00"]');
                    if (yellowElements.length > 0) {
                        answerHtml = Array.from(yellowElements).map(el => el.innerHTML).join(' ');
                        answer = Array.from(yellowElements).map(el => el.textContent || el.innerText).join(' ').trim();
                    }
                }
                
                // 检查是否有"答案："或"解析："标记（支持多种格式：答案：、答案:、答案 :、答案 :等）
                // 如果已有标黄答案，则不再从标记中提取答案
                const answerMatch = trimmedText.match(/答案[：:\s]*\s*(.+)/);
                if (answerMatch && !answer) {
                    answer = answerMatch[1].trim();
                    // 从HTML中提取答案部分（"答案："之后的内容）
                    if (isNode && cheerio) {
                        const $ = cheerio.load(para.html);
                        // 尝试找到包含"答案"标记的元素，提取其后的内容
                        const bodyHtml = $('body').html() || para.html;
                        const answerIndex = bodyHtml.search(/答案[：:\s]*/i);
                        if (answerIndex >= 0) {
                            // 提取"答案："之后的所有内容
                            answerHtml = bodyHtml.substring(answerIndex).replace(/答案[：:\s]*/i, '').trim();
                        } else {
                            answerHtml = bodyHtml;
                        }
                    } else {
                        // 浏览器环境
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = para.html;
                        const textContent = tempDiv.textContent || tempDiv.innerText || '';
                        const answerIndex = textContent.search(/答案[：:\s]*/i);
                        if (answerIndex >= 0) {
                            const afterAnswer = textContent.substring(answerIndex).replace(/答案[：:\s]*/i, '').trim();
                            // 尝试从原始HTML中提取对应部分
                            answerHtml = para.html;
                        } else {
                            answerHtml = para.html;
                        }
                    }
                }
                
                // 检查是否有"解析："标记（支持多种格式）
                const explanationMatch = trimmedText.match(/解析[：:\s]*\s*(.+)/);
                if (explanationMatch) {
                    explanation = explanationMatch[1].trim();
                    // 从HTML中提取解析部分（"解析："之后的内容）
                    if (isNode && cheerio) {
                        const $ = cheerio.load(para.html);
                        const bodyHtml = $('body').html() || para.html;
                        const explanationIndex = bodyHtml.search(/解析[：:\s]*/i);
                        if (explanationIndex >= 0) {
                            // 提取"解析："之后的所有内容
                            explanationHtml = bodyHtml.substring(explanationIndex).replace(/解析[：:\s]*/i, '').trim();
                        } else {
                            explanationHtml = bodyHtml;
                        }
                    } else {
                        // 浏览器环境
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = para.html;
                        const textContent = tempDiv.textContent || tempDiv.innerText || '';
                        const explanationIndex = textContent.search(/解析[：:\s]*/i);
                        if (explanationIndex >= 0) {
                            explanationHtml = para.html;
                        } else {
                            explanationHtml = para.html;
                        }
                    }
                }
                
                // 从内容中移除答案、解析、难易程度标记和内容
                let cleanedContent = trimmedText;
                let cleanedContentHtml = para.html;
                
                // 移除答案标记和内容
                if (answer) {
                    cleanedContent = cleanedContent.replace(/答案[：:\s]*\s*[^\n]*/g, '').trim();
                    if (isNode && cheerio) {
                        const $ = cheerio.load(cleanedContentHtml);
                        $('*').each(function() {
                            const text = $(this).text();
                            if (text.match(/答案[：:\s]*/i)) {
                                $(this).remove();
                            }
                        });
                        cleanedContentHtml = $('body').html() || cleanedContentHtml;
                        // 也尝试直接替换HTML中的答案标记
                        cleanedContentHtml = cleanedContentHtml.replace(/答案[：:\s]*[^<]*/gi, '');
                    } else {
                        cleanedContentHtml = cleanedContentHtml.replace(/答案[：:\s]*[^<]*/gi, '');
                    }
                }
                
                // 移除解析标记和内容
                if (explanation) {
                    cleanedContent = cleanedContent.replace(/解析[：:\s]*\s*[^\n]*/g, '').trim();
                    if (isNode && cheerio) {
                        const $ = cheerio.load(cleanedContentHtml);
                        $('*').each(function() {
                            const text = $(this).text();
                            if (text.match(/解析[：:\s]*/i)) {
                                $(this).remove();
                            }
                        });
                        cleanedContentHtml = $('body').html() || cleanedContentHtml;
                        cleanedContentHtml = cleanedContentHtml.replace(/解析[：:\s]*[^<]*/gi, '');
                    } else {
                        cleanedContentHtml = cleanedContentHtml.replace(/解析[：:\s]*[^<]*/gi, '');
                    }
                }
                
                // 移除难易程度标记和内容
                if (recognizedDifficulty) {
                    cleanedContent = cleanedContent.replace(/(?:难易程度|难度)[：:\s]*\s*(?:简单|中等|困难)[^\n]*/g, '').trim();
                    if (isNode && cheerio) {
                        const $ = cheerio.load(cleanedContentHtml);
                        $('*').each(function() {
                            const text = $(this).text();
                            if (text.match(/(?:难易程度|难度)[：:\s]*/i)) {
                                $(this).remove();
                            }
                        });
                        cleanedContentHtml = $('body').html() || cleanedContentHtml;
                        cleanedContentHtml = cleanedContentHtml.replace(/(?:难易程度|难度)[：:\s]*[^<]*/gi, '');
                    } else {
                        cleanedContentHtml = cleanedContentHtml.replace(/(?:难易程度|难度)[：:\s]*[^<]*/gi, '');
                    }
                }
                
                // 创建新的小题
                currentSubQuestion = {
                    number: subNumber,
                    score: score,
                    content: cleanedContent,
                    contentHtml: cleanedContentHtml,
                    difficulty: difficulty,
                    answer: answer,
                    answerHtml: answerHtml,
                    explanation: explanation,
                    explanationHtml: explanationHtml,
                    subSubQuestions: []
                };

                currentMajorQuestion.subQuestions.push(currentSubQuestion);
            }
            // 检查是否是子小题题号
            else if (subSubQuestionPattern.test(trimmedText)) {
                // 如果没有当前小题，创建一个默认小题
                if (!currentSubQuestion) {
                    if (!currentMajorQuestion) {
                        majorQuestionIndex++;
                        const majorNumber = chineseNumbers[majorQuestionIndex - 1] || majorQuestionIndex.toString();
                        currentMajorQuestion = {
                            number: majorNumber,
                            type: '未命名题型',
                            content: '',
                            contentHtml: '',
                            score: 0,
                            questionCount: 0,
                            scorePerQuestion: 0,
                            autoGenerated: true,
                            subQuestions: []
                        };
                        majorQuestions.push(currentMajorQuestion);
                    }

                    // 创建默认小题
                    currentSubQuestion = {
                        number: (currentMajorQuestion.subQuestions.length + 1).toString(),
                        score: 0,
                        content: '',
                        contentHtml: '',
                        difficulty: '中等',
                        subSubQuestions: []
                    };
                    currentMajorQuestion.subQuestions.push(currentSubQuestion);
                }

                // 提取子小题题号和分值
                const subSubNumberMatch = trimmedText.match(/[（(](\d+)[）)]/);
                const subSubNumber = subSubNumberMatch ? subSubNumberMatch[1] : '';

                // 提取分值
                let score = 0;
                const scoreMatch = trimmedText.match(scorePattern);
                if (scoreMatch) {
                    score = parseFloat(scoreMatch[1]) || 0;
                }

                // 提取难易程度（优先从标记中识别）
                let recognizedSubSubDifficulty = null;
                const difficultyMatch = trimmedText.match(/(?:难易程度|难度)[：:\s]*\s*(简单|中等|困难)/);
                if (difficultyMatch) {
                    recognizedSubSubDifficulty = difficultyMatch[1];
                }
                
                // 评估难度（如果没有识别到，则使用自动评估）
                const subSubDifficulty = recognizedSubSubDifficulty || assessDifficulty(trimmedText, score);
                
                // 从内容中移除难易程度标记和内容
                let cleanedSubSubContent = trimmedText;
                let cleanedSubSubContentHtml = para.html;
                if (recognizedSubSubDifficulty) {
                    cleanedSubSubContent = cleanedSubSubContent.replace(/(?:难易程度|难度)[：:\s]*\s*(?:简单|中等|困难)[^\n]*/g, '').trim();
                    if (isNode && cheerio) {
                        const $ = cheerio.load(cleanedSubSubContentHtml);
                        $('*').each(function() {
                            const text = $(this).text();
                            if (text.match(/(?:难易程度|难度)[：:\s]*/i)) {
                                $(this).remove();
                            }
                        });
                        cleanedSubSubContentHtml = $('body').html() || cleanedSubSubContentHtml;
                        cleanedSubSubContentHtml = cleanedSubSubContentHtml.replace(/(?:难易程度|难度)[：:\s]*[^<]*/gi, '');
                    } else {
                        cleanedSubSubContentHtml = cleanedSubSubContentHtml.replace(/(?:难易程度|难度)[：:\s]*[^<]*/gi, '');
                    }
                }
                
                // 创建新的子小题
                const subSubQuestion = {
                    number: subSubNumber,
                    score: score,
                    content: cleanedSubSubContent,
                    contentHtml: cleanedSubSubContentHtml,
                    difficulty: subSubDifficulty
                };

                currentSubQuestion.subSubQuestions.push(subSubQuestion);
            }
            // 普通内容，添加到当前小题或子小题
            else {
                // 检查是否是答案或解析标记
                const answerMatch = trimmedText.match(/答案[：:]\s*(.+)/);
                const explanationMatch = trimmedText.match(/解析[：:]\s*(.+)/);
                
                if (currentSubQuestion && currentSubQuestion.subSubQuestions.length > 0) {
                    // 如果有子小题，添加到最后一个子小题
                    const lastSubSub = currentSubQuestion.subSubQuestions[currentSubQuestion.subSubQuestions.length - 1];
                    
                    // 优化答案、解析和难易程度的匹配
                    const answerMatch = trimmedText.match(/答案[：:\s]*\s*(.+)/);
                    const explanationMatch = trimmedText.match(/解析[：:\s]*\s*(.+)/);
                    const difficultyMatch = trimmedText.match(/(?:难易程度|难度)[：:\s]*\s*(简单|中等|困难)/);
                    
                    if (answerMatch) {
                        lastSubSub.answer = answerMatch[1].trim();
                        // 提取HTML中的答案部分
                        if (isNode && cheerio) {
                            const $ = cheerio.load(para.html);
                            const bodyHtml = $('body').html() || para.html;
                            const answerIndex = bodyHtml.search(/答案[：:\s]*/i);
                            if (answerIndex >= 0) {
                                lastSubSub.answerHtml = bodyHtml.substring(answerIndex).replace(/答案[：:\s]*/i, '').trim();
                            } else {
                                lastSubSub.answerHtml = bodyHtml;
                            }
                        } else {
                            lastSubSub.answerHtml = para.html;
                        }
                        // 从内容中移除答案
                        lastSubSub.content = lastSubSub.content.replace(/答案[：:\s]*\s*[^\n]*/g, '').trim();
                        lastSubSub.contentHtml = lastSubSub.contentHtml.replace(/答案[：:\s]*[^<]*/gi, '');
                    } else if (explanationMatch) {
                        lastSubSub.explanation = explanationMatch[1].trim();
                        // 提取HTML中的解析部分
                        if (isNode && cheerio) {
                            const $ = cheerio.load(para.html);
                            const bodyHtml = $('body').html() || para.html;
                            const explanationIndex = bodyHtml.search(/解析[：:\s]*/i);
                            if (explanationIndex >= 0) {
                                lastSubSub.explanationHtml = bodyHtml.substring(explanationIndex).replace(/解析[：:\s]*/i, '').trim();
                            } else {
                                lastSubSub.explanationHtml = bodyHtml;
                            }
                        } else {
                            lastSubSub.explanationHtml = para.html;
                        }
                        // 从内容中移除解析
                        lastSubSub.content = lastSubSub.content.replace(/解析[：:\s]*\s*[^\n]*/g, '').trim();
                        lastSubSub.contentHtml = lastSubSub.contentHtml.replace(/解析[：:\s]*[^<]*/gi, '');
                    } else if (difficultyMatch) {
                        lastSubSub.difficulty = difficultyMatch[1];
                        // 从内容中移除难易程度
                        lastSubSub.content = lastSubSub.content.replace(/(?:难易程度|难度)[：:\s]*\s*(?:简单|中等|困难)[^\n]*/g, '').trim();
                        lastSubSub.contentHtml = lastSubSub.contentHtml.replace(/(?:难易程度|难度)[：:\s]*[^<]*/gi, '');
                    } else {
                        lastSubSub.content += '\n' + trimmedText;
                        lastSubSub.contentHtml += para.html;
                    }
                } else if (currentSubQuestion) {
                    // 添加到当前小题
                    // 优化答案、解析和难易程度的匹配，支持更多格式
                    const answerMatch = trimmedText.match(/答案[：:\s]*\s*(.+)/);
                    const explanationMatch = trimmedText.match(/解析[：:\s]*\s*(.+)/);
                    const difficultyMatch = trimmedText.match(/(?:难易程度|难度)[：:\s]*\s*(简单|中等|困难)/);
                    
                    if (answerMatch) {
                        currentSubQuestion.answer = answerMatch[1].trim();
                        // 提取HTML中的答案部分
                        if (isNode && cheerio) {
                            const $ = cheerio.load(para.html);
                            const bodyHtml = $('body').html() || para.html;
                            const answerIndex = bodyHtml.search(/答案[：:\s]*/i);
                            if (answerIndex >= 0) {
                                currentSubQuestion.answerHtml = bodyHtml.substring(answerIndex).replace(/答案[：:\s]*/i, '').trim();
                            } else {
                                currentSubQuestion.answerHtml = bodyHtml;
                            }
                        } else {
                            currentSubQuestion.answerHtml = para.html;
                        }
                        // 从内容中移除答案
                        currentSubQuestion.content = currentSubQuestion.content.replace(/答案[：:\s]*\s*[^\n]*/g, '').trim();
                        currentSubQuestion.contentHtml = currentSubQuestion.contentHtml.replace(/答案[：:\s]*[^<]*/gi, '');
                    } else if (explanationMatch) {
                        currentSubQuestion.explanation = explanationMatch[1].trim();
                        // 提取HTML中的解析部分
                        if (isNode && cheerio) {
                            const $ = cheerio.load(para.html);
                            const bodyHtml = $('body').html() || para.html;
                            const explanationIndex = bodyHtml.search(/解析[：:\s]*/i);
                            if (explanationIndex >= 0) {
                                currentSubQuestion.explanationHtml = bodyHtml.substring(explanationIndex).replace(/解析[：:\s]*/i, '').trim();
                            } else {
                                currentSubQuestion.explanationHtml = bodyHtml;
                            }
                        } else {
                            currentSubQuestion.explanationHtml = para.html;
                        }
                        // 从内容中移除解析
                        currentSubQuestion.content = currentSubQuestion.content.replace(/解析[：:\s]*\s*[^\n]*/g, '').trim();
                        currentSubQuestion.contentHtml = currentSubQuestion.contentHtml.replace(/解析[：:\s]*[^<]*/gi, '');
                    } else if (difficultyMatch) {
                        currentSubQuestion.difficulty = difficultyMatch[1];
                        // 从内容中移除难易程度
                        currentSubQuestion.content = currentSubQuestion.content.replace(/(?:难易程度|难度)[：:\s]*\s*(?:简单|中等|困难)[^\n]*/g, '').trim();
                        currentSubQuestion.contentHtml = currentSubQuestion.contentHtml.replace(/(?:难易程度|难度)[：:\s]*[^<]*/gi, '');
                    } else {
                        // 检查是否有标黄内容（优先识别为答案）
                        let hasYellow = false;
                        if (isNode && cheerio) {
                            const $ = cheerio.load(para.html);
                            // 扩展黄色背景的匹配模式
                            const yellowElements = $('[style*="background-color: yellow"], [style*="background: yellow"], [style*="background-color:#ffff00"], [style*="background:#ffff00"], [style*="background-color:yellow"], [style*="background:yellow"], [bgcolor="yellow"], [bgcolor="#ffff00"]');
                            if (yellowElements.length > 0 && !currentSubQuestion.answer) {
                                currentSubQuestion.answerHtml = yellowElements.map((i, el) => $(el).html()).get().join(' ');
                                currentSubQuestion.answer = yellowElements.map((i, el) => $(el).text()).get().join(' ').trim();
                                hasYellow = true;
                            }
                        } else if (typeof document !== 'undefined') {
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = para.html;
                            // 扩展黄色背景的匹配模式
                            const yellowElements = tempDiv.querySelectorAll('[style*="background-color: yellow"], [style*="background: yellow"], [style*="background-color:#ffff00"], [style*="background:#ffff00"], [style*="background-color:yellow"], [style*="background:yellow"], [bgcolor="yellow"], [bgcolor="#ffff00"]');
                            if (yellowElements.length > 0 && !currentSubQuestion.answer) {
                                currentSubQuestion.answerHtml = Array.from(yellowElements).map(el => el.innerHTML).join(' ');
                                currentSubQuestion.answer = Array.from(yellowElements).map(el => el.textContent || el.innerText).join(' ').trim();
                                hasYellow = true;
                            }
                        }
                        
                        if (!hasYellow) {
                            if (shouldAutoNumberAsRequirementSub(trimmedText, currentSubQuestion.content)) {
                                pushAutoNumberedRequirementSub(currentSubQuestion, trimmedText, para.html);
                            } else {
                                currentSubQuestion.content += '\n' + trimmedText;
                                currentSubQuestion.contentHtml += para.html;
                            }
                        }
                    }
                } else if (currentMajorQuestion) {
                    // 添加到当前大题
                    currentMajorQuestion.content += '\n' + trimmedText;
                    currentMajorQuestion.contentHtml += para.html;
                }
            }
        });

        // 验证分值一致性并计算缺失的分值
        majorQuestions.forEach(major => {
            let totalSubScore = 0;
            
            major.subQuestions.forEach(sub => {
                let subScore = sub.score || 0;
                
                // 如果有子小题，验证子小题分值之和
                if (sub.subSubQuestions && sub.subSubQuestions.length > 0) {
                    const subSubTotalScore = sub.subSubQuestions.reduce((sum, subSub) => {
                        return sum + (subSub.score || 0);
                    }, 0);
                    
                    // 如果小题分值未设置，使用子小题分值之和
                    if (subScore === 0 && subSubTotalScore > 0) {
                        subScore = subSubTotalScore;
                        sub.score = subSubTotalScore;
                    }
                    
                    // 标记分值不一致
                    if (subScore > 0 && subSubTotalScore > 0 && subScore !== subSubTotalScore) {
                        sub.scoreMismatch = true;
                        sub.expectedScore = subScore;
                        sub.actualSubSubScore = subSubTotalScore;
                    }
                }
                
                totalSubScore += subScore;
            });
            
            // 如果大题分值未设置，使用小题分值之和
            if (major.score === 0 && totalSubScore > 0) {
                major.score = totalSubScore;
            }
            
            // 更新小题数量
            if (major.questionCount === 0) {
                major.questionCount = major.subQuestions.length;
            }
            
            // 计算每小题分值
            if (major.scorePerQuestion === 0 && major.questionCount > 0 && totalSubScore > 0) {
                major.scorePerQuestion = totalSubScore / major.questionCount;
            }
            
            // 标记分值不一致
            if (major.score > 0 && totalSubScore > 0 && major.score !== totalSubScore) {
                major.scoreMismatch = true;
                major.expectedScore = major.score;
                major.actualSubScore = totalSubScore;
            }
        });

        return {
            success: true,
            majorQuestions: majorQuestions,
            totalMajorQuestions: majorQuestions.length,
            totalSubQuestions: majorQuestions.reduce((sum, m) => sum + m.subQuestions.length, 0)
        };
    } catch (error) {
        console.error('识别试题失败:', error);
        return {
            success: false,
            error: error.message || '识别失败',
            majorQuestions: []
        };
    }
}

// 如果是Node.js环境，导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { recognizeQuestions };
}

// 如果是浏览器环境，将函数挂载到全局
if (typeof window !== 'undefined') {
    window.QuestionRecognizer = { recognizeQuestions };
}
