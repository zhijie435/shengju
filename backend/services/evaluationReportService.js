const { pool } = require('../config/database');
const ExamEvaluationReportModel = require('../models/examEvaluationReportModel');
const ExamSummaryModel = require('../models/examSummaryModel');
const ExamSessionModel = require('../models/examSessionModel');
const AIService = require('./aiService');
const ExamSummaryService = require('./examSummaryService');

/**
 * 评估报告服务
 */
class EvaluationReportService {
  /**
   * 生成评估报告
   */
  static async generateReport(sessionId) {
    // 检查是否已有报告
    let report = await ExamEvaluationReportModel.findBySessionId(sessionId);
    
    if (report && report.generation_status === 'completed') {
      return report;
    }

    // 获取会话信息
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) {
      throw new Error('考试会话不存在');
    }

    // 确保汇总数据已生成
    let summary = await ExamSummaryModel.findBySessionId(sessionId);
    if (!summary) {
      summary = await ExamSummaryService.generateSummary(sessionId);
    }

    // 创建或更新报告记录
    if (!report) {
      const reportId = await ExamEvaluationReportModel.create({
        sessionId,
        examId: session.exam_id,
        userId: session.user_id,
        generationStatus: 'generating'
      });
      report = await ExamEvaluationReportModel.findById(reportId);
    } else {
      await ExamEvaluationReportModel.updateStatus(sessionId, 'generating');
    }

    try {
      // 获取详细答案信息（含标准答案、解析、考生答案）
      const [answers] = await pool.execute(
        `SELECT a.*, sq.content_html, sq.content_text, sq.score as max_score,
                sq.exam_purpose, sq.difficulty, mq.question_type,
                sq.standard_answer, sq.answer, sq.answer_html,
                sq.explanation, sq.explanation_html, sq.answer_analysis
         FROM exam_answers a
         LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
         LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
         WHERE a.session_id = ?
         ORDER BY sq.number, sq.sub_number`,
        [sessionId]
      );

      // 格式化考生答案（含 answer_data 解析）
      const formatStudentAnswer = (a) => {
        if (a.answer_text && String(a.answer_text).trim()) return String(a.answer_text).trim();
        if (a.answer_data) {
          try {
            const d = typeof a.answer_data === 'string' ? JSON.parse(a.answer_data) : a.answer_data;
            if (d.selected) return Array.isArray(d.selected) ? d.selected.join(',') : String(d.selected);
            if (d.blanks) return Array.isArray(d.blanks) ? d.blanks.join(',') : String(d.blanks);
            if (d.text) return String(d.text);
            if (d.imageBase64) return '[图片作答]';
          } catch (_) {}
        }
        return '';
      };

      // 准备报告数据
      const reportData = {
        studentName: session.real_name || session.username,
        examName: session.exam_name || '未知考试',
        totalScore: parseFloat(summary.total_score || 0),
        maxScore: parseFloat(summary.max_score || 0),
        scoreRate: parseFloat(summary.score_rate || 0),
        questionTypeStats: summary.question_type_stats || {},
        difficultyStats: summary.difficulty_stats || {},
        examPurposeStats: summary.exam_purpose_stats || {},
        knowledgePoints: summary.knowledge_points || {},
        answers: answers.map(a => {
          const stdAns = (a.standard_answer != null && String(a.standard_answer).trim())
            ? String(a.standard_answer).trim()
            : (a.answer || (a.answer_html ? String(a.answer_html).replace(/<[^>]+>/g, '').trim() : ''));
          const expl = (a.explanation != null && String(a.explanation).trim())
            ? String(a.explanation).trim()
            : (a.explanation_html || (a.answer_analysis != null && String(a.answer_analysis).trim()) ? String(a.answer_analysis).trim() : '');
          return {
            content_text: a.content_text || '',
            content_html: a.content_html || '',
            answer_text: formatStudentAnswer(a) || a.answer_text || '',
            standard_answer: stdAns,
            explanation: expl,
            score: parseFloat(a.score || 0),
            max_score: parseFloat(a.max_score || 0),
            exam_purpose: a.exam_purpose || '未设置考察目的',
            question_type: a.question_type || ''
          };
        })
      };

      // 调用AI生成报告
      const reportContent = await AIService.generateEvaluationReport(reportData);
      const reportHtml = AIService.markdownToHtml(reportContent);

      // 更新报告
      await ExamEvaluationReportModel.update(report.id, {
        reportContent,
        reportHtml,
        generationStatus: 'completed'
      });

      return await ExamEvaluationReportModel.findById(report.id);
    } catch (error) {
      console.error('生成评估报告失败:', error);
      await ExamEvaluationReportModel.update(report.id, {
        generationStatus: 'failed',
        errorMessage: error.message
      });
      throw error;
    }
  }

  /**
   * 准备报告数据
   */
  static async prepareReportData(sessionId) {
    const session = await ExamSessionModel.findById(sessionId);
    if (!session) {
      throw new Error('考试会话不存在');
    }

    const summary = await ExamSummaryModel.findBySessionId(sessionId);
    if (!summary) {
      throw new Error('汇总数据不存在，请先生成汇总数据');
    }

    const [answers] = await pool.execute(
      `SELECT a.*, sq.content_html, sq.content_text, sq.score as max_score,
              sq.exam_purpose, sq.difficulty, mq.question_type,
              sq.standard_answer, sq.answer, sq.answer_html,
              sq.explanation, sq.explanation_html, sq.answer_analysis
       FROM exam_answers a
       LEFT JOIN exam_paper_sub_questions sq ON a.sub_question_id = sq.id
       LEFT JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id
       WHERE a.session_id = ?
       ORDER BY sq.number, sq.sub_number`,
      [sessionId]
    );

    const formatStudentAnswer = (a) => {
      if (a.answer_text && String(a.answer_text).trim()) return String(a.answer_text).trim();
      if (a.answer_data) {
        try {
          const d = typeof a.answer_data === 'string' ? JSON.parse(a.answer_data) : a.answer_data;
          if (d.selected) return Array.isArray(d.selected) ? d.selected.join(',') : String(d.selected);
          if (d.blanks) return Array.isArray(d.blanks) ? d.blanks.join(',') : String(d.blanks);
          if (d.text) return String(d.text);
          if (d.imageBase64) return '[图片作答]';
        } catch (_) {}
      }
      return '';
    };

    return {
      studentName: session.real_name || session.username,
      examName: session.exam_name || '未知考试',
      totalScore: parseFloat(summary.total_score || 0),
      maxScore: parseFloat(summary.max_score || 0),
      scoreRate: parseFloat(summary.score_rate || 0),
      questionTypeStats: summary.question_type_stats || {},
      difficultyStats: summary.difficulty_stats || {},
      examPurposeStats: summary.exam_purpose_stats || {},
      knowledgePoints: summary.knowledge_points || {},
      answers: answers.map(a => {
        const stdAns = (a.standard_answer != null && String(a.standard_answer).trim())
          ? String(a.standard_answer).trim()
          : (a.answer || (a.answer_html ? String(a.answer_html).replace(/<[^>]+>/g, '').trim() : ''));
        const expl = (a.explanation != null && String(a.explanation).trim())
          ? String(a.explanation).trim()
          : (a.explanation_html || (a.answer_analysis != null && String(a.answer_analysis).trim()) ? String(a.answer_analysis).trim() : '');
        return {
          content_text: a.content_text || '',
          content_html: a.content_html || '',
          answer_text: formatStudentAnswer(a) || a.answer_text || '',
          standard_answer: stdAns,
          explanation: expl,
          score: parseFloat(a.score || 0),
          max_score: parseFloat(a.max_score || 0),
          exam_purpose: a.exam_purpose || '未设置考察目的',
          question_type: a.question_type || ''
        };
      })
    };
  }
}

module.exports = EvaluationReportService;
