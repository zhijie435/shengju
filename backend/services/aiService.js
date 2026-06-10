const https = require('https');
const { URL } = require('url');

/**
 * AI服务：集成DeepSeek API生成评估报告
 */
class AIService {
  /**
   * 生成评估报告
   */
  static async generateEvaluationReport(reportData) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';

    if (!apiKey) {
      throw new Error('DeepSeek API密钥未配置，请在.env文件中设置DEEPSEEK_API_KEY');
    }

    const prompt = this.buildPrompt(reportData);

    return new Promise((resolve, reject) => {
      const url = new URL(apiUrl);
      const postData = JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的考试评估专家和人才评估顾问，擅长分析考生的答题情况，结合题目解析和考生作答内容，生成详细的评估报告，为招聘企业提供参考建议（岗位适配度、能力画像、录用建议等）。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      });

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 60000
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            const content = response?.choices?.[0]?.message?.content;
            if (!content) {
              reject(new Error('AI返回内容为空'));
              return;
            }
            resolve(content);
          } catch (error) {
            console.error('解析AI响应失败:', error);
            reject(new Error(`AI服务响应解析失败: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('DeepSeek API调用失败:', error.message);
        reject(new Error(`AI服务调用失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('AI服务调用超时'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 构建提示词
   */
  static buildPrompt(reportData) {
    const {
      studentName,
      examName,
      totalScore,
      maxScore,
      scoreRate,
      questionTypeStats,
      difficultyStats,
      examPurposeStats,
      knowledgePoints,
      answers
    } = reportData;

    let prompt = `请为以下考生的考试情况生成一份详细的评估报告。

## 考生信息
- 姓名：${studentName}
- 考试名称：${examName}
- 总分：${totalScore} / ${maxScore}（得分率：${scoreRate.toFixed(2)}%）

## 各题型表现
`;

    if (questionTypeStats && Object.keys(questionTypeStats).length > 0) {
      Object.keys(questionTypeStats).forEach(type => {
        const stat = questionTypeStats[type];
        prompt += `- ${type}：得分 ${stat.totalScore.toFixed(2)} / ${stat.maxScore.toFixed(2)}（得分率：${stat.scoreRate.toFixed(2)}%，正确率：${stat.correctRate.toFixed(2)}%）\n`;
      });
    } else {
      prompt += '- 无数据\n';
    }

    prompt += `\n## 各难度表现\n`;

    if (difficultyStats && Object.keys(difficultyStats).length > 0) {
      Object.keys(difficultyStats).forEach(difficulty => {
        const stat = difficultyStats[difficulty];
        prompt += `- ${difficulty}：得分 ${stat.totalScore.toFixed(2)} / ${stat.maxScore.toFixed(2)}（得分率：${stat.scoreRate.toFixed(2)}%，正确率：${stat.correctRate.toFixed(2)}%）\n`;
      });
    } else {
      prompt += '- 无数据\n';
    }

    prompt += `\n## 各考察目的表现\n`;

    if (examPurposeStats && Object.keys(examPurposeStats).length > 0) {
      Object.keys(examPurposeStats).forEach(purpose => {
        const stat = examPurposeStats[purpose];
        prompt += `- ${purpose}：得分 ${stat.totalScore.toFixed(2)} / ${stat.maxScore.toFixed(2)}（得分率：${stat.scoreRate.toFixed(2)}%，正确率：${stat.correctRate.toFixed(2)}%）\n`;
      });
    } else {
      prompt += '- 无数据\n';
    }

    prompt += `\n## 知识点掌握情况\n`;

    if (knowledgePoints && Object.keys(knowledgePoints).length > 0) {
      Object.keys(knowledgePoints).forEach(purpose => {
        const kp = knowledgePoints[purpose];
        prompt += `- ${purpose}：掌握程度 ${kp.masteryLevel}（掌握率：${kp.masteryRate.toFixed(2)}%）\n`;
      });
    } else {
      prompt += '- 无数据\n';
    }

    if (answers && answers.length > 0) {
      prompt += `\n## 详细答题情况（含标准答案、解析、考生答案）\n`;
      answers.forEach((answer, index) => {
        const questionContent = (answer.content_text || answer.content_html || '').replace(/\s+/g, ' ').trim();
        const studentAnswer = answer.answer_text || '未作答';
        const standardAnswer = answer.standard_answer || '';
        const explanation = answer.explanation || '';
        const score = answer.score || 0;
        const maxScore = answer.max_score || 0;
        const examPurpose = answer.exam_purpose || '未设置考察目的';
        prompt += `\n### 第${index + 1}题（${answer.question_type || ''}）\n`;
        prompt += `- 考察目的：${examPurpose}\n`;
        prompt += `- 题目摘要：${questionContent.substring(0, 200)}${questionContent.length > 200 ? '...' : ''}\n`;
        prompt += `- 标准答案：${standardAnswer}\n`;
        if (explanation) prompt += `- 解析：${explanation.substring(0, 300)}${explanation.length > 300 ? '...' : ''}\n`;
        prompt += `- 考生答案：${studentAnswer}\n`;
        prompt += `- 得分：${score} / ${maxScore}\n`;
      });
    }

    prompt += `\n请根据以上信息生成一份详细的评估报告，供企业招聘参考。报告须包含以下部分：

1. **总体评价**：对考生的整体表现进行客观评价
2. **各考察目的表现分析**：结合题目解析与考生作答，详细分析每个考察目的的表现及能力水平
3. **优势与不足**：指出考生的优势和需要改进的地方
4. **面向企业的招聘参考建议**（重要）：
   - 岗位适配度：该考生适合哪些类型的岗位
   - 能力画像：基于答题表现概括的能力特征
   - 录用建议：是否推荐录用及理由，以及录用后建议关注的培养方向

报告要求：
- 语言专业、客观，兼顾鼓励性
- 结构清晰，条理分明
- 针对性强，对招聘决策有实际参考价值
- 字数1500-2500字`;

    return prompt;
  }

  /**
   * 将Markdown转换为HTML
   */
  static markdownToHtml(markdown) {
    if (!markdown) return '';

    let html = markdown
      // 标题
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // 粗体
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      // 斜体
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      // 列表
      .replace(/^\d+\.\s+(.*$)/gim, '<li>$1</li>')
      // 段落
      .replace(/\n\n/gim, '</p><p>')
      // 换行
      .replace(/\n/gim, '<br>');

    // 包装列表项
    html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');

    // 包装段落
    html = '<p>' + html + '</p>';

    return html;
  }
}

module.exports = AIService;
