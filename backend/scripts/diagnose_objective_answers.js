/**
 * 诊断客观题答案同步问题
 * 用法: node backend/scripts/diagnose_objective_answers.js <examId> [sessionId]
 * 若不传 sessionId，则检查该考试下所有已交卷 session
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../config/database');

async function main() {
  const examId = process.argv[2];
  const sessionId = process.argv[3];
  if (!examId) {
    console.log('用法: node backend/scripts/diagnose_objective_answers.js <examId> [sessionId]');
    process.exit(1);
  }

  const [exams] = await pool.execute('SELECT id, name, paper_id, answer_system_config FROM exams WHERE id = ?', [examId]);
  const exam = exams[0];
  if (!exam) {
    console.log('考试不存在:', examId);
    process.exit(1);
  }
  console.log('考试:', exam.name, 'paper_id:', exam.paper_id);

  const paperId = exam.paper_id;
  if (!paperId) {
    console.log('该考试未关联试卷');
    process.exit(1);
  }

  let sessions;
  if (sessionId) {
    const [rows] = await pool.execute(
      'SELECT s.id, s.user_id, s.status, u.real_name FROM exam_sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.exam_id = ?',
      [sessionId, examId]
    );
    sessions = rows;
  } else {
    const [rows] = await pool.execute(
      `SELECT s.id, s.user_id, s.status, u.real_name FROM exam_sessions s 
       JOIN exam_enrollments en ON en.exam_id = s.exam_id AND en.user_id = s.user_id
       JOIN users u ON s.user_id = u.id 
       WHERE s.exam_id = ? AND s.status IN ('submitted', 'force_submitted')`,
      [examId]
    );
    sessions = rows;
  }

  if (sessions.length === 0) {
    console.log('无已交卷会话');
    process.exit(0);
  }

  const overrides = (exam.answer_system_config && exam.answer_system_config.answerTypeOverrides) || {};
  const displayOverrides = (exam.answer_system_config && exam.answer_system_config.displayNumberOverrides) || {};
  const [sqRows] = await pool.execute(
    `SELECT sq.id, sq.number, sq.sub_number, mq.question_type 
     FROM exam_paper_sub_questions sq 
     JOIN exam_paper_major_questions mq ON sq.major_question_id = mq.id 
     WHERE sq.paper_id = ? ORDER BY sq.id`,
    [paperId]
  );
  const typeMap = { 选择题: 'choice', 单选题: 'choice', 判断题: 'judge', 多选题: 'multichoice', 填空题: 'blank' };
  const OBJECTIVE = ['choice', 'multichoice', 'judge', 'blank'];
  const getType = (qt) => {
    if (!qt) return 'text';
    const t = String(qt).trim();
    for (const [k, v] of Object.entries(typeMap)) { if (t.includes(k)) return v; }
    return 'text';
  };

  const objectiveSqs = sqRows.map((r, idx) => {
    const t = overrides[r.id] || getType(r.question_type);
    const displayNum = (displayOverrides[r.id] && String(displayOverrides[r.id]).trim()) || String(idx + 1);
    return { ...r, answerType: t, globalDisplayNumber: displayNum, isObjective: OBJECTIVE.includes(t) };
  });

  console.log('\n客观题小题列表 (exam_paper_sub_questions):');
  objectiveSqs.filter(s => s.isObjective).forEach(s => {
    console.log(`  id=${s.id} number=${s.number} sub_number=${s.sub_number} display=${s.globalDisplayNumber} type=${s.answerType}`);
  });

  for (const sess of sessions) {
    console.log('\n--- Session', sess.id, sess.real_name, 'status:', sess.status, '---');
    const [ansRows] = await pool.execute(
      'SELECT id, sub_question_id, question_number, answer_text, answer_data FROM exam_answers WHERE session_id = ?',
      [sess.id]
    );
    if (ansRows.length === 0) {
      console.log('  ⚠ 无 exam_answers 记录');
      continue;
    }
    console.log('  exam_answers 共', ansRows.length, '条:');
    ansRows.forEach(a => {
      let preview = a.answer_text || '';
      if (a.answer_data) {
        try {
          const d = typeof a.answer_data === 'string' ? JSON.parse(a.answer_data) : a.answer_data;
          if (d.selected) preview = 'selected:' + (Array.isArray(d.selected) ? d.selected.join(',') : d.selected);
          else if (d.blanks) preview = 'blanks:' + (Array.isArray(d.blanks) ? d.blanks.join(',') : d.blanks);
        } catch (_) {}
      }
      console.log(`    sub_question_id=${a.sub_question_id} question_number="${a.question_number}" -> ${preview}`);
    });
    console.log('  匹配情况:');
    objectiveSqs.filter(s => s.isObjective).forEach(sq => {
      const bySq = ansRows.find(a => a.sub_question_id != null && (Number(a.sub_question_id) === Number(sq.id) || String(a.sub_question_id) === String(sq.id)));
      const byNum = ansRows.find(a => a.question_number && String(a.question_number).trim() === String(sq.globalDisplayNumber).trim());
      const matched = bySq || byNum;
      console.log(`    sq.id=${sq.id} display=${sq.globalDisplayNumber}: ${matched ? '✓' : '✗ 未匹配'}`);
    });
  }
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
