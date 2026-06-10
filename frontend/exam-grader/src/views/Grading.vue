<template>
  <div>
    <el-page-header @back="$router.back()" :title="task?.exam_name || '阅卷操作'" />

    <!-- 顶部统计栏 -->
    <div class="stats-bar">
      <div class="stats-item">
        <span class="stats-label">剩余数量：</span>
        <span class="stats-value remaining">{{ progressData.pending || 0 }}</span>
        <span class="stats-unit">题</span>
      </div>
      <div class="stats-item">
        <span class="stats-label">总进度：</span>
        <el-progress
          :percentage="progressData.progress || 0"
          :status="progressData.progress === 100 ? 'success' : ''"
          :stroke-width="20"
          style="width: 200px; display: inline-block; vertical-align: middle; margin-left: 10px;"
        />
        <span class="stats-value" style="margin-left: 10px;">
          {{ progressData.graded || 0 }} / {{ progressData.total || 0 }}
        </span>
      </div>
      <el-switch
        v-model="reviewMode"
        active-text="回评模式"
        inactive-text="待阅卷"
        @change="load"
      />
      <el-button @click="load" :loading="loading">刷新</el-button>
    </div>

    <div v-loading="loading" class="grading-content">
      <template v-if="!loading && answers.length">
        <div v-for="answer in answers" :key="answer.id" class="answer-item">
          <!-- 题号 -->
          <div class="answer-header">
            <div class="question-info">
              <span class="question-number">第 {{ answer.question_number || answer.number || '-' }} 题</span>
              <span v-if="answer.max_score" class="max-score-hint">（满分 {{ answer.max_score }} 分）</span>
              <span v-if="getQuestionProgress(answer.sub_question_id)" class="question-progress">
                已阅 {{ getQuestionProgress(answer.sub_question_id).graded }} / {{ getQuestionProgress(answer.sub_question_id).total }}
              </span>
            </div>
            <el-tag v-if="answer.grading_record" type="success" size="small">已阅卷</el-tag>
            <el-tag v-else type="warning" size="small">待阅卷</el-tag>
          </div>

          <!-- 左右两栏：考生答案 | 题库答案与解析 -->
          <div class="answer-reference-row">
            <!-- 考生答案（答题框） -->
            <div class="answer-student-section">
              <div class="section-title">考生答案</div>
              <!-- 如果有子小题答案框，按子题号显示考生答案 -->
              <template v-if="answer.sub_answers && answer.sub_answers.length > 0">
                <div v-for="(subAnswer, idx) in answer.sub_answers" :key="idx" class="sub-answer-student-block" style="margin-bottom: 15px; padding: 10px; background: #fff7e6; border-left: 3px solid #ffc107; border-radius: 4px;">
                  <div style="font-weight: bold; color: #856404; margin-bottom: 8px;">子小题 {{ subAnswer.sub_number || `(${idx + 1})` }} 答案：</div>
                  <div class="answer-student">{{ formatStudentAnswerForSub(answer, subAnswer.sub_number) || '（未作答）' }}</div>
                </div>
              </template>
              <!-- 如果没有子小题答案框，显示主答案 -->
              <template v-else>
                <div class="answer-student">{{ formatStudentAnswer(answer) || '（未作答）' }}</div>
              </template>
            </div>
            <!-- 题库答案和解析（对应位置） -->
            <div class="reference-section">
              <div class="section-title">参考答案</div>
              
              <!-- 如果有子小题答案和解析，按子题号显示 -->
              <template v-if="answer.sub_answers && answer.sub_answers.length > 0">
                <div v-for="(subAnswer, idx) in answer.sub_answers" :key="idx" class="ref-block sub-answer-block" style="margin-bottom: 15px; padding: 10px; background: #f0f9ff; border-left: 3px solid #409eff; border-radius: 4px;">
                  <div style="font-weight: bold; color: #409eff; margin-bottom: 8px;">子小题 {{ subAnswer.sub_number || `(${idx + 1})` }}</div>
                  <div v-if="subAnswer.answer || subAnswer.answer_html" class="standard-answer" style="margin-bottom: 8px;">
                    <span class="ref-label">答案：</span>
                    <span class="ref-value" v-html="formatHtml(subAnswer.answer_html || subAnswer.answer)"></span>
                  </div>
                  <div v-if="getSubExplanation(answer, subAnswer.sub_number)" class="ref-block">
                    <span class="ref-label">解析：</span>
                    <span class="ref-value" v-html="formatHtml(getSubExplanation(answer, subAnswer.sub_number))"></span>
                  </div>
                </div>
              </template>
              
              <!-- 如果没有子小题答案，显示主答案和解析（与主观题列表一致：优先 standard_answer，否则 answer/answer_html；解析优先 answer_analysis，否则 explanation/explanation_html） -->
              <template v-else>
                <div v-if="refAnswerText(answer)" class="ref-block standard-answer">
                  <span class="ref-label">答案：</span>
                  <span class="ref-value" v-html="formatHtml(refAnswerHtml(answer))"></span>
                </div>
                <div v-else class="ref-block standard-answer empty-hint">（无标准答案）</div>
                <div v-if="answer.grading_points" class="ref-block">
                  <span class="ref-label">评分要点：</span>
                  <span class="ref-value">{{ answer.grading_points }}</span>
                </div>
                <div v-if="refExplanationText(answer)" class="ref-block">
                  <span class="ref-label">解析：</span>
                  <span class="ref-value" v-html="formatHtml(refExplanationHtml(answer))"></span>
                </div>
                <div v-else-if="!refAnswerText(answer) && !answer.grading_points" class="ref-block empty-hint">（无解析）</div>
              </template>
            </div>
          </div>

          <!-- 打分：小键盘 + 得分显示 + 评语 + 保存 -->
          <div class="grading-section">
            <div class="section-title">评分</div>
            <div class="grading-row">
              <!-- 小键盘 -->
              <div class="numpad">
                <div class="numpad-display">{{ scoreStrMap[answer.id] || '0' }}</div>
                <div class="numpad-keys">
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '7')">7</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '8')">8</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '9')">9</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '4')">4</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '5')">5</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '6')">6</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '1')">1</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '2')">2</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '3')">3</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '0')">0</button>
                  <button type="button" class="numpad-btn" @click="numpadInput(answer, '.')">.</button>
                  <button type="button" class="numpad-btn numpad-btn-op" @click="numpadBackspace(answer)">⌫</button>
                  <button type="button" class="numpad-btn numpad-btn-op" @click="numpadHalf(answer)">半分</button>
                  <button type="button" class="numpad-btn numpad-btn-op" @click="numpadFull(answer)">满分</button>
                  <button type="button" class="numpad-btn numpad-btn-clear" @click="numpadClear(answer)">清空</button>
                </div>
              </div>
              <!-- 得分/评语/保存 -->
              <div class="score-actions">
                <div class="score-display-row">
                  <span class="score-label">得分：</span>
                  <span class="score-value">{{ displayScore(answer) }}</span>
                  <span v-if="answer.max_score" class="max-score">/ {{ answer.max_score }} 分</span>
                </div>
                <div class="score-input-row">
                  <span class="score-label">手动输入：</span>
                  <el-input-number
                    :model-value="scoreInputs[answer.id]"
                    @update:model-value="(v) => onManualScoreChange(answer, v)"
                    :min="0"
                    :max="getMaxScore(answer)"
                    :step="0.5"
                    size="default"
                    controls-position="right"
                    placeholder="输入分数"
                  />
                </div>
                <el-input
                  v-model="commentInputs[answer.id]"
                  placeholder="评语（可选）"
                  size="default"
                  class="comment-input"
                  @keyup.enter="saveScore(answer)"
                />
                <el-button
                  type="primary"
                  size="default"
                  @click="saveScore(answer)"
                  :disabled="scoreInputs[answer.id] == null || isNaN(scoreInputs[answer.id])"
                >
                  保存
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
      <el-empty v-else-if="!loading" description="暂无待阅卷的答案" />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getTaskAnswers, submitGradingRecord, updateGradingRecord, getTaskProgress, getQuestionProgress as fetchQuestionProgress } from '../api/grading';

// 根据子题号获取对应的解析
function getSubExplanation(answer, subNumber) {
  if (!answer.sub_explanations || !Array.isArray(answer.sub_explanations) || !subNumber) {
    return null;
  }
  const subExp = answer.sub_explanations.find(item => item.sub_number === subNumber);
  if (subExp) {
    return subExp.explanation_html || subExp.explanation || null;
  }
  return null;
}

const route = useRoute();
const taskId = parseInt(route.params.taskId);
const loading = ref(true);
const reviewMode = ref(false); // 回评模式：显示已阅卷并可修改
const task = ref(null);
const answers = ref([]);
const sessions = ref([]);
const scoreInputs = reactive({});
const scoreStrMap = reactive({}); // 小键盘当前输入的字符串
const commentInputs = reactive({});
const progressData = ref({
  total: 0,
  graded: 0,
  pending: 0,
  progress: 0
});
const questionProgressMap = ref({});

function getMaxScore(a) {
  const m = a.max_score != null ? parseFloat(a.max_score) : NaN;
  return isNaN(m) ? 100 : m;
}

function numpadInput(answer, key) {
  const id = answer.id;
  const maxScore = getMaxScore(answer);
  if (!scoreStrMap[id]) scoreStrMap[id] = '';
  if (key === '.') {
    if (scoreStrMap[id].indexOf('.') !== -1) return;
    scoreStrMap[id] += '.';
  } else {
    scoreStrMap[id] += key;
  }
  let num = parseFloat(scoreStrMap[id]);
  if (isNaN(num)) num = 0;
  if (num > maxScore) {
    num = maxScore;
    scoreStrMap[id] = String(maxScore);
  }
  scoreInputs[id] = num;
}

function numpadBackspace(answer) {
  const id = answer.id;
  if (!scoreStrMap[id]) return;
  scoreStrMap[id] = scoreStrMap[id].slice(0, -1);
  if (scoreStrMap[id] === '' || scoreStrMap[id] === '-') {
    scoreInputs[id] = null;
    return;
  }
  const num = parseFloat(scoreStrMap[id]);
  scoreInputs[id] = isNaN(num) ? null : num;
}

function numpadClear(answer) {
  const id = answer.id;
  scoreStrMap[id] = '';
  scoreInputs[id] = null;
}

function numpadHalf(answer) {
  const maxScore = getMaxScore(answer);
  const half = Math.round(maxScore * 50) / 100;
  scoreStrMap[answer.id] = String(half);
  scoreInputs[answer.id] = half;
}

function numpadFull(answer) {
  const maxScore = getMaxScore(answer);
  scoreStrMap[answer.id] = String(maxScore);
  scoreInputs[answer.id] = maxScore;
}

function onManualScoreChange(answer, v) {
  const id = answer.id;
  if (v == null || (typeof v === 'number' && isNaN(v))) {
    scoreInputs[id] = null;
    scoreStrMap[id] = '';
    return;
  }
  const num = typeof v === 'number' ? v : parseFloat(v);
  const maxScore = getMaxScore(answer);
  const clamped = Math.min(maxScore, Math.max(0, num));
  scoreInputs[id] = clamped;
  scoreStrMap[id] = String(clamped);
}

async function load() {
  loading.value = true;
  try {
    const res = await getTaskAnswers(taskId, reviewMode.value ? { review: '1' } : {});
    task.value = res.data?.task;
    answers.value = res.data?.answers || [];

    answers.value.forEach(a => {
      const rec = a.grading_record;
      if (rec) {
        scoreInputs[a.id] = rec.score != null ? parseFloat(rec.score) : null;
        scoreStrMap[a.id] = rec.score != null ? String(rec.score) : '';
        commentInputs[a.id] = rec.grading_comment || '';
      } else {
        scoreInputs[a.id] = null;
        scoreStrMap[a.id] = '';
        commentInputs[a.id] = '';
      }
    });

    try {
      const progressRes = await getTaskProgress(taskId);
      progressData.value = {
        total: progressRes.data?.total || 0,
        graded: progressRes.data?.graded || 0,
        pending: progressRes.data?.pending || 0,
        progress: progressRes.data?.progress || 0
      };
    } catch (e) {
      console.error('Get progress error:', e);
    }

    try {
      const questionProgressRes = await fetchQuestionProgress(taskId);
      questionProgressMap.value = questionProgressRes.data || {};
    } catch (e) {
      console.error('Get question progress error:', e);
    }
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

function getQuestionProgress(questionId) {
  if (!questionId) return null;
  return questionProgressMap.value[questionId] || null;
}

function formatStudentAnswer(a) {
  if (a.answer_data) {
    try {
      const d = typeof a.answer_data === 'string' ? JSON.parse(a.answer_data) : a.answer_data;
      if (d.selected) return Array.isArray(d.selected) ? d.selected.join(',') : d.selected;
      if (d.blanks) return Array.isArray(d.blanks) ? d.blanks.join(',') : d.blanks;
      if (d.imageBase64) return '[已上传图片]';
    } catch (_) {}
  }
  return a.answer_text || '-';
}

// 根据子题号格式化考生答案
function formatStudentAnswerForSub(answer, subNumber) {
  if (!subNumber) return formatStudentAnswer(answer);
  
  // 尝试从answer_data中查找对应子题号的答案
  if (answer.answer_data) {
    try {
      const d = typeof answer.answer_data === 'string' ? JSON.parse(answer.answer_data) : answer.answer_data;
      
      // 如果answer_data是数组，尝试按索引匹配
      if (Array.isArray(d)) {
        // 尝试从question_number中提取子题号索引
        const questionNumber = answer.question_number || '';
        const match = questionNumber.match(/--(\d+)$/);
        if (match) {
          const subIdx = parseInt(match[1]);
          if (d[subIdx] !== undefined) {
            const subData = d[subIdx];
            if (subData.selected) return Array.isArray(subData.selected) ? subData.selected.join(',') : subData.selected;
            if (subData.blanks) return Array.isArray(subData.blanks) ? subData.blanks.join(',') : subData.blanks;
            if (subData.imageBase64) return '[已上传图片]';
            if (subData.text) return subData.text;
          }
        }
      }
      
      // 如果answer_data是对象，尝试查找子题号字段
      if (typeof d === 'object' && !Array.isArray(d)) {
        // 尝试查找以子题号为key的字段
        const subKey = `sub_${subNumber}` || `sub_${subNumber.replace(/[()]/g, '')}`;
        if (d[subKey] !== undefined) {
          const subData = d[subKey];
          if (typeof subData === 'string') return subData;
          if (subData.selected) return Array.isArray(subData.selected) ? subData.selected.join(',') : subData.selected;
          if (subData.blanks) return Array.isArray(subData.blanks) ? subData.blanks.join(',') : subData.blanks;
          if (subData.imageBase64) return '[已上传图片]';
        }
      }
    } catch (_) {}
  }
  
  // 如果answer_text包含子题号标识，尝试提取
  if (answer.answer_text) {
    const text = answer.answer_text;
    // 尝试匹配子题号格式的答案
    const subPattern = new RegExp(`${subNumber.replace(/[()]/g, '\\$&')}[：:]([^\\n]+)`, 'i');
    const match = text.match(subPattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  // 回退到显示全部答案
  return formatStudentAnswer(answer);
}

/** 主答案/解析展示与主观题列表一致：答案优先 standard_answer，否则 answer_html/answer；解析优先 answer_analysis，否则 explanation_html/explanation */
function refAnswerText(answer) {
  if (!answer) return '';
  return (answer.standard_answer && answer.standard_answer.trim()) || (answer.answer_html && answer.answer_html.trim()) || (answer.answer && answer.answer.trim()) || '';
}
function refAnswerHtml(answer) {
  if (!answer) return '';
  return (answer.standard_answer && answer.standard_answer.trim()) || (answer.answer_html && answer.answer_html.trim()) || (answer.answer && answer.answer.trim()) || '';
}
function refExplanationText(answer) {
  if (!answer) return '';
  return (answer.answer_analysis && answer.answer_analysis.trim()) || (answer.explanation_html && answer.explanation_html.trim()) || (answer.explanation && answer.explanation.trim()) || '';
}
function refExplanationHtml(answer) {
  if (!answer) return '';
  return (answer.answer_analysis && answer.answer_analysis.trim()) || (answer.explanation_html && answer.explanation_html.trim()) || (answer.explanation && answer.explanation.trim()) || '';
}

function formatHtml(html) {
  if (!html) return '';
  const s = String(html);
  if (s.indexOf('<') === -1) return s.replace(/\n/g, '<br/>');
  return s;
}

/** 得分显示：优先显示已保存的分数（grading_record），否则显示当前输入（评分区与得分区一致） */
function displayScore(answer) {
  if (answer.grading_record != null && answer.grading_record.score != null && !isNaN(Number(answer.grading_record.score))) {
    return Number(answer.grading_record.score);
  }
  const v = scoreInputs[answer.id];
  if (v != null && !isNaN(v)) return v;
  return '—';
}

async function saveScore(a) {
  const score = scoreInputs[a.id];
  const comment = commentInputs[a.id];

  if (score == null || isNaN(score)) {
    ElMessage.warning('请输入分数后保存');
    return;
  }

  try {
    if (a.grading_record) {
      await updateGradingRecord(a.grading_record.id, { score, grading_comment: comment });
    } else {
      await submitGradingRecord({
        task_id: taskId,
        answer_id: a.id,
        score: score,
        grading_comment: comment
      });
    }
    ElMessage.success('保存成功');
    await load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败');
  }
}

onMounted(load);
</script>

<style scoped>
.stats-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: #f5f7fa;
  border-radius: 8px;
  margin: 16px 0;
}

.stats-item {
  display: flex;
  align-items: center;
}

.stats-label { font-size: 14px; color: #606266; margin-right: 8px; }
.stats-value { font-size: 18px; font-weight: bold; color: #303133; }
.stats-value.remaining { color: #e6a23c; font-size: 24px; }
.stats-unit { font-size: 14px; color: #909399; margin-left: 4px; }

.grading-content {
  min-height: 200px;
}

.answer-item {
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.answer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #ebeef5;
}

.question-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.question-number {
  font-weight: bold;
  font-size: 18px;
  color: #409eff;
}

.max-score-hint { font-size: 13px; color: #909399; }
.question-progress { font-size: 13px; color: #909399; }

/* 考生答案 + 题库答案并排 */
.answer-reference-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

@media (max-width: 900px) {
  .answer-reference-row {
    grid-template-columns: 1fr;
  }
}

.answer-student-section,
.reference-section {
  min-height: 80px;
}

.section-title {
  font-weight: bold;
  font-size: 14px;
  color: #303133;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #ebeef5;
}

.answer-student {
  padding: 14px;
  background: #fff7e6;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.8;
  color: #303133;
  border: 1px solid #ffe58f;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 60px;
}

.reference-section {
  padding: 12px;
  background: #f0f9ff;
  border-radius: 6px;
  border-left: 4px solid #409eff;
}

.ref-block {
  margin-bottom: 10px;
  font-size: 13px;
}

.ref-block:last-child { margin-bottom: 0; }

.ref-label {
  font-weight: bold;
  color: #606266;
  margin-right: 6px;
}

.ref-value {
  color: #303133;
}

.ref-value :deep(img) {
  max-width: 100%;
  height: auto;
}

.standard-answer { font-weight: 500; color: #067947; }
.empty-hint { color: #909399; font-style: italic; }

/* 打分区域：小键盘 + 操作 */
.grading-section {
  padding-top: 16px;
  border-top: 2px solid #ebeef5;
}

.grading-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  flex-wrap: wrap;
}

.numpad {
  flex-shrink: 0;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
}

.numpad-display {
  text-align: right;
  font-size: 22px;
  font-weight: bold;
  color: #303133;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  min-height: 40px;
}

.numpad-keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.numpad-btn {
  width: 48px;
  height: 40px;
  font-size: 16px;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.numpad-btn:hover {
  background: #ecf5ff;
  border-color: #409eff;
}

.numpad-btn-op {
  font-size: 14px;
  background: #f5f7fa;
}

.numpad-btn-clear {
  grid-column: span 2;
  width: auto;
  background: #fef0f0;
  color: #f56c6c;
}

.numpad-btn-clear:hover {
  background: #fde2e2;
  border-color: #f56c6c;
}

.score-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 200px;
}

.score-display-row,
.score-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.score-input-row {
  margin-top: 6px;
}

.score-label { font-weight: bold; font-size: 14px; color: #303133; }
.score-value { font-size: 20px; font-weight: bold; color: #409eff; }
.max-score { font-size: 14px; color: #909399; }

.comment-input {
  width: 100%;
}
</style>
