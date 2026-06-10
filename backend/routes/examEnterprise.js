const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// 供外部系统（如人才网企业端）按企业获取考试考生汇总数据的接口
// 使用与邀请/同步密码相同的 API Key 做简单鉴权
const EXAM_INVITATIONS_API_KEY = process.env.EXAM_INVITATIONS_API_KEY || 'shengju-exam-invitations-key';

router.get('/candidates-summary', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (apiKey !== EXAM_INVITATIONS_API_KEY) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const enterpriseName = (req.query.enterpriseName || '').toString().trim();
    const enterpriseIdRaw = req.query.enterpriseId;
    const candidateBatchIdRaw = req.query.candidateBatchId;

    const enterpriseId = enterpriseIdRaw != null ? parseInt(enterpriseIdRaw, 10) : NaN;
    const candidateBatchId = candidateBatchIdRaw != null ? String(candidateBatchIdRaw).trim() : '';

    // 以已交卷的 exam_sessions 为主，LEFT JOIN exam_summaries，确保无汇总记录时也能返回成绩（与阅卷统计一致）
    let sql = `
      SELECT 
        s.id AS session_id,
        s.exam_id,
        s.user_id,
        COALESCE(es.total_score, s.total_score) AS total_score,
        COALESCE(es.max_score, 0) AS max_score,
        COALESCE(es.score_rate, 0) AS score_rate,
        COALESCE(es.objective_score, 0) AS objective_score,
        COALESCE(es.subjective_score, 0) AS subjective_score,
        COALESCE(es.correct_count, 0) AS correct_count,
        COALESCE(es.wrong_count, 0) AS wrong_count,
        COALESCE(es.answer_time_seconds, 0) AS answer_time_seconds,
        COALESCE(es.submitted_at, s.submitted_at) AS submitted_at,
        e.name AS exam_name,
        e.start_time,
        e.end_time,
        u.username,
        u.real_name,
        u.phone,
        u.email,
        u.education,
        u.position,
        u.id_card,
        u.exam_number,
        ent.id AS enterprise_id,
        ent.name AS enterprise_name,
        ib.candidate_batch_id AS import_batch_code,
        ib.batch_name AS import_batch_name
      FROM exam_sessions s
      JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
      JOIN exams e ON e.id = s.exam_id
      JOIN users u ON u.id = s.user_id
      JOIN enterprises ent ON e.enterprise_id = ent.id
      LEFT JOIN exam_summaries es ON es.session_id = s.id
    `;
    // 批次：有 candidateBatchId 时按该批次过滤考试并关联批次信息，否则取每个考试一个批次（用于展示）
    if (candidateBatchId) {
      sql += `
      JOIN exam_import_batches ib ON ib.imported_exam_id = e.id AND ib.candidate_batch_id = ?
      `;
    } else {
      sql += `
      LEFT JOIN (
        SELECT imported_exam_id, MAX(id) AS mid FROM exam_import_batches GROUP BY imported_exam_id
      ) ib0 ON ib0.imported_exam_id = e.id
      LEFT JOIN exam_import_batches ib ON ib.imported_exam_id = ib0.imported_exam_id AND ib.id = ib0.mid
      `;
    }
    sql += ` WHERE s.status IN ('submitted', 'force_submitted')`;
    const params = [];
    if (candidateBatchId) params.push(candidateBatchId);

    // 若传入 enterpriseId，则优先按企业ID精确过滤
    if (enterpriseId && Number.isFinite(enterpriseId) && enterpriseId > 0) {
      sql += ' AND e.enterprise_id = ?';
      params.push(enterpriseId);
    } else if (enterpriseName) {
      // 企业名称过滤：TRIM 后精确匹配（人才网企业名称需与笔试系统 enterprises.name 一致）
      sql += ' AND TRIM(ent.name) = ?';
      params.push(enterpriseName.trim());
    }

    sql += ' ORDER BY e.start_time DESC, COALESCE(es.submitted_at, s.submitted_at) DESC';

    const [rows] = await pool.execute(sql, params);
    const list = rows || [];
    if (list.length === 0) {
      console.log('[exam-enterprise candidates-summary] 无匹配记录', { enterpriseId, enterpriseName: enterpriseName || '(未传)', candidateBatchId: candidateBatchId || '(未传)' });
    }

    res.json({
      success: true,
      data: list
    });
  } catch (e) {
    console.error('examEnterprise candidates-summary error:', e);
    res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
});

module.exports = router;

