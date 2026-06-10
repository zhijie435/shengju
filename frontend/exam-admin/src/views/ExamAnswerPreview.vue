<template>
  <div ref="previewRef" class="exam-answer-preview">
    <div class="preview-header">
      <h2>考生答题界面预览</h2>
      <el-tag type="info">管理预览（非考生端，仅用于查看答题界面布局）</el-tag>
      <el-popover v-if="!isInterviewPreviewMode" placement="bottom" trigger="click" width="320">
        <template #reference>
          <el-button>答题样式</el-button>
        </template>
        <div class="style-config">
          <div class="style-item">
            <span>选择题样式：</span>
            <el-select v-model="styleConfigLocal.choiceStyle" size="small" @change="onStyleChange">
              <el-option label="单选按钮" value="radio" />
              <el-option label="按钮组" value="button" />
              <el-option label="卡片" value="card" />
            </el-select>
          </div>
          <div class="style-item">
            <span>多选题样式：</span>
            <el-select v-model="styleConfigLocal.multichoiceStyle" size="small" @change="onStyleChange">
              <el-option label="复选框" value="checkbox" />
              <el-option label="按钮组" value="button" />
              <el-option label="标签" value="tag" />
            </el-select>
          </div>
          <div class="style-item">
            <span>填空题样式：</span>
            <el-select v-model="styleConfigLocal.blankStyle" size="small" @change="onStyleChange">
              <el-option label="下划线" value="underline" />
              <el-option label="方框" value="box" />
            </el-select>
          </div>
        </div>
      </el-popover>
      <template v-if="isInterviewPreviewMode">
        <el-radio-group v-model="previewViewMode" size="small">
          <el-radio-button value="candidate">考生视图</el-radio-button>
          <el-radio-button value="examiner">考官视图</el-radio-button>
        </el-radio-group>
      </template>
      <el-button v-if="!isInterviewPreviewMode" type="primary" @click="saveAnswerConfig" :loading="saving">保存答题配置</el-button>
      <el-button @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏' }}</el-button>
      <el-button @click="$router.back()">返回</el-button>
    </div>
    <div v-loading="loading" class="preview-body">
      <template v-if="!loading && exam">
        <div class="exam-preview-header">
          <span class="exam-name">{{ exam.name }}</span>
        </div>
        <div class="exam-body" :class="{ 'a4-layout': !!previewHtml }">
          <div v-if="previewHtml" class="preview-container">
            <div class="a4-preview" v-html="previewHtml"></div>
          </div>
          <div v-else class="question-list">
            <!-- 考生视图不显示指导语；仅考官视图或非面试预览时显示 -->
            <div v-if="isInterviewPreviewMode && previewViewMode !== 'candidate' && (paperProjectInfo?.guidingWords || guidingWordsHtml)" class="interview-guide-block">
              <div class="interview-guide-title">指导语</div>
              <div class="interview-guide-sub">（供主考官使用）</div>
              <div class="interview-guide-content" v-html="guidingWordsHtml"></div>
            </div>
            <div v-else-if="isInterviewPreviewMode && previewViewMode !== 'candidate' && exam?.paper_id" class="interview-guide-block interview-guide-tip">
              <div class="interview-guide-title">指导语</div>
              <div class="interview-guide-content">未配置或未同步。请到 <strong>试题编辑</strong>（考试项目设置）中填写指导语后，点击「保存试题」或「从预览保存」更新试卷；或点击 <el-button type="primary" link size="small" @click="openEditorWithPaper">在试题编辑中打开本试卷</el-button> 自动回填并编辑。</div>
            </div>
            <!-- 面试预览：考官题本使用说明（仅考官视图且开启时显示） -->
            <div v-if="isInterviewPreviewMode && previewViewMode === 'examiner' && showExaminerInstructionsInPreview && paperProjectInfo?.examinerInstructions" class="interview-guide-block examiner-instructions-block">
              <div class="interview-guide-title">考官题本使用说明</div>
              <div class="interview-guide-content" v-html="paperProjectInfo.examinerInstructions"></div>
            </div>
            <!-- 考官视图不显示评分要素（评分表在子系统面试评分页展示） -->
            <div v-for="grp in majorGroups" :key="grp.majorId" class="major-group">
              <div v-if="!isInterviewPreviewMode" class="major-header">
                <span class="major-title">第 {{ grp.majorNumber }} 大题</span>
                <span class="major-unified-setting">
                  <span>本大题答题方式：</span>
                  <el-select v-model="majorAnswerTypeTemp[grp.majorId]" placeholder="选择" size="small" class="major-answer-type-select" clearable>
                    <el-option v-for="opt in ANSWER_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                  <el-button type="primary" size="small" @click="applyMajorAnswerType(grp.majorId, grp.questions.map(x => x.id))">应用到本大题</el-button>
                </span>
              </div>
              <div v-for="q in grp.questions" :key="q.id" class="question-block">
              <div class="question-content" v-html="prependQuestionContent(q)"></div>
              <div v-if="!isInterviewPreviewMode" class="answer-item-header">
                <span class="display-number-label">题号：</span>
                <el-input v-model="displayNumberOverrides[q.id]" placeholder="自动" size="small" class="display-number-input" @change="onAnswerTypeChange" />
                <el-select v-model="answerTypeOverrides[q.id]" placeholder="答题方式" size="small" class="answer-type-select" clearable @change="onAnswerTypeChange">
                  <el-option v-for="opt in ANSWER_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <span class="sub-item-count-label">子小题数：</span>
                <el-input-number v-model="subItemCounts[q.id]" :min="1" :max="10" size="small" class="sub-item-count-input" @change="onAnswerTypeChange" />
                <template v-if="q.answerType === 'choice' || q.answerType === 'multichoice'">
                  <span class="option-count-label">选项数：</span>
                  <el-input-number v-model="optionCounts[q.id]" :min="3" :max="6" size="small" class="option-count-input" @change="onAnswerTypeChange" />
                </template>
              </div>
              <template v-if="!isInterviewPreviewMode && q.subItemCount <= 1">
                <div class="answer-box">
                  <AnswerChoice v-if="q.answerType === 'choice' || q.answerType === 'judge'" v-model="previewAnswers[q.id]" :options="q.options" :style="answerStyleConfig.choiceStyle" :disabled="false" />
                  <AnswerMultiChoice v-else-if="q.answerType === 'multichoice'" v-model="previewAnswers[q.id]" :options="q.options" :style="answerStyleConfig.multichoiceStyle" :disabled="false" />
                  <AnswerBlank v-else-if="q.answerType === 'blank'" v-model="previewAnswers[q.id]" :blank-count="q.blankCount" :style="answerStyleConfig.blankStyle" :disabled="false" />
                  <AnswerEssay v-else-if="q.answerType === 'essay'" v-model="previewAnswers[q.id]" :word-count="q.wordCount" :disabled="false" />
                  <AnswerDrawing v-else-if="q.answerType === 'drawing'" v-model="previewAnswers[q.id]" :width="q.drawingWidth || 500" :height="q.drawingHeight || 300" :disabled="false" />
                  <AnswerText v-else v-model="previewAnswers[q.id]" :rows="4" :disabled="false" />
                </div>
              </template>
              <template v-else-if="!isInterviewPreviewMode">
                <div v-for="(subItem, subIdx) in (q.subAnswerItems && q.subAnswerItems.length > 0 ? q.subAnswerItems : Array(q.subItemCount).fill(null))" :key="subIdx" class="answer-box">
                  <label>作答{{ subItem && subItem.sub_number ? subItem.sub_number : `(${subIdx + 1})` }}：</label>
                  <AnswerChoice v-if="q.answerType === 'choice' || q.answerType === 'judge'" v-model="previewAnswers[getQuestionKey(q, subIdx)]" :options="q.options" :style="answerStyleConfig.choiceStyle" :disabled="false" />
                  <AnswerMultiChoice v-else-if="q.answerType === 'multichoice'" v-model="previewAnswers[getQuestionKey(q, subIdx)]" :options="q.options" :style="answerStyleConfig.multichoiceStyle" :disabled="false" />
                  <AnswerBlank v-else-if="q.answerType === 'blank'" v-model="previewAnswers[getQuestionKey(q, subIdx)]" :blank-count="q.blankCount" :style="answerStyleConfig.blankStyle" :disabled="false" />
                  <AnswerEssay v-else-if="q.answerType === 'essay'" v-model="previewAnswers[getQuestionKey(q, subIdx)]" :word-count="q.wordCount" :disabled="false" />
                  <AnswerDrawing v-else-if="q.answerType === 'drawing'" v-model="previewAnswers[getQuestionKey(q, subIdx)]" :width="q.drawingWidth || 500" :height="q.drawingHeight || 300" :disabled="false" />
                  <AnswerText v-else v-model="previewAnswers[getQuestionKey(q, subIdx)]" :rows="4" :disabled="false" />
                </div>
              </template>
              <template v-if="!isInterviewPreviewMode || previewViewMode === 'examiner'">
                <div v-if="getQuestionAnswer(q)" class="answer-ref-block">
                  <div class="answer-ref-label">参考答案：</div>
                  <div class="answer-ref-content" v-html="getQuestionAnswer(q)"></div>
                </div>
                <div v-if="getQuestionExplanation(q)" class="answer-ref-block">
                  <div class="answer-ref-label">解析：</div>
                  <div class="answer-ref-content" v-html="getQuestionExplanation(q)"></div>
                </div>
              </template>
              </div>
            </div>
            <!-- 考生视图不显示结束指导语；仅考官视图或非面试预览时显示 -->
            <div v-if="isInterviewPreviewMode && previewViewMode !== 'candidate' && (paperProjectInfo?.closingWords || closingWordsHtml)" class="interview-guide-block interview-closing-block">
              <div class="interview-guide-title">结束指导语</div>
              <div class="interview-guide-sub">（供主考官使用）</div>
              <div class="interview-guide-content" v-html="closingWordsHtml"></div>
            </div>
            <div v-else-if="isInterviewPreviewMode && previewViewMode !== 'candidate' && exam?.paper_id" class="interview-guide-block interview-closing-block interview-guide-tip">
              <div class="interview-guide-title">结束指导语</div>
              <div class="interview-guide-content">未配置或未同步。请在试题编辑的考试项目设置中填写结束语后保存试卷；或点击 <el-button type="primary" link size="small" @click="openEditorWithPaper">在试题编辑中打开本试卷</el-button> 自动回填并编辑。</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getExam, getPaper, updateExam } from '../api/exams';
import { getAnswerType, parseOptions, parseBlankCount, prependQuestionNumberTight } from '../utils/questionParser';
import AnswerChoice from '../components/AnswerChoice.vue';
import AnswerMultiChoice from '../components/AnswerMultiChoice.vue';
import AnswerBlank from '../components/AnswerBlank.vue';
import AnswerText from '../components/AnswerText.vue';
import AnswerEssay from '../components/AnswerEssay.vue';
import AnswerDrawing from '../components/AnswerDrawing.vue';

const route = useRoute();
const previewRef = ref(null);
const isFullscreen = ref(false);
const loading = ref(true);
const exam = ref(null);
const paper = ref(null);
const subQuestions = ref([]);
const previewAnswers = reactive({});
const answerTypeOverrides = reactive({});
const majorAnswerTypeTemp = reactive({});
const subItemCounts = reactive({});
const optionCounts = reactive({});
const displayNumberOverrides = reactive({});
const saving = ref(false);
const previewViewMode = ref('examiner'); // 'candidate' | 'examiner'，面试预览时切换

const ANSWER_TYPE_OPTIONS = [
  { value: 'choice', label: '选择题' },
  { value: 'multichoice', label: '多选题' },
  { value: 'judge', label: '判断题' },
  { value: 'blank', label: '填空题' },
  { value: 'text', label: '简答题' },
  { value: 'essay', label: '论述题' },
  { value: 'drawing', label: '画图题' }
];

const answerConfig = computed(() => {
  const c = exam.value?.answer_system_config || {};
  return {
    essayWordCount: c.essayWordCount ?? 800,
    drawingEnabled: c.drawingEnabled !== false,
    drawingWidth: c.drawingWidth ?? 500,
    drawingHeight: c.drawingHeight ?? 300
  };
});

const styleConfigLocal = reactive({
  choiceStyle: 'radio',
  multichoiceStyle: 'checkbox',
  blankStyle: 'underline'
});

const answerStyleConfig = computed(() => ({
  choiceStyle: styleConfigLocal.choiceStyle,
  multichoiceStyle: styleConfigLocal.multichoiceStyle,
  blankStyle: styleConfigLocal.blankStyle
}));

// 笔试、面试均使用题列表；面试仅保留面试答题预览（无笔试预览入口）
const previewHtml = computed(() => '');

/** 面试答题预览：不显示大题题干与答题框，不显示小题题号，显示参考答案与解析 */
const isInterviewPreviewMode = computed(() => route.name === 'InterviewAnswerPreview');

const paperProjectInfo = computed(() => paper.value?.project_info || null);

const showExaminerInstructionsInPreview = computed(() => {
  const ic = exam.value?.answer_system_config?.interviewConfig || {};
  return !!ic.showExaminerInstructions;
});

const guidingWordsHtml = computed(() => {
  const raw = paperProjectInfo.value?.guidingWords || '';
  return String(raw).replace(/\n/g, '<br>');
});

const closingWordsHtml = computed(() => {
  const raw = paperProjectInfo.value?.closingWords || '';
  return String(raw).replace(/\n/g, '<br>');
});

function onStyleChange() {
  // Triggers answerStyleConfig update
}

function prependQuestionContent(q) {
  const html = q.content_html || q.full_content || '';
  if (isInterviewPreviewMode.value) return html; // 面试预览：去掉小题题号
  return prependQuestionNumberTight(html, q.globalDisplayNumber);
}

function getQuestionKey(q, subIndex) {
  return `${q.id}-${subIndex}`;
}

function getQuestionAnswer(q) {
  if (q.subItemCount > 1 && q.subAnswerItems && q.subAnswerItems.length > 0) {
    const parts = q.subAnswerItems.map((s, i) => {
      const subNum = s.sub_number || `(${i + 1})`;
      const ans = s.answer_html || s.answer || '';
      return ans ? `${subNum}：${ans}` : '';
    }).filter(Boolean);
    return parts.length ? parts.join('<br/>') : (q.answer_html || q.answer || q.standard_answer || '');
  }
  return q.answer_html || q.answer || q.standard_answer || '';
}

function getQuestionExplanation(q) {
  if (q.subItemCount > 1 && q.sub_explanations) {
    try {
      const arr = typeof q.sub_explanations === 'string' ? JSON.parse(q.sub_explanations) : q.sub_explanations;
      if (Array.isArray(arr) && arr.length > 0) {
        const parts = arr.map((s, i) => {
          const subNum = s.sub_number || `(${i + 1})`;
          const exp = s.explanation_html || s.explanation || '';
          return exp ? `${subNum}：${exp}` : '';
        }).filter(Boolean);
        return parts.length ? parts.join('<br/>') : (q.explanation_html || q.explanation || q.answer_analysis || '');
      }
    } catch (e) {}
  }
  return q.explanation_html || q.explanation || q.answer_analysis || '';
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const el = previewRef.value || document.documentElement;
    if (!el) return;
    // 尝试使用标准 API
    if (el.requestFullscreen) {
      el.requestFullscreen().then(() => {
        isFullscreen.value = true;
      }).catch((err) => {
        // 权限被拒绝或其他错误，静默处理
        console.warn('全屏请求失败:', err.message);
      });
    } else if (el.webkitRequestFullscreen) {
      // Safari 支持
      el.webkitRequestFullscreen();
      isFullscreen.value = true;
    } else if (el.mozRequestFullScreen) {
      // Firefox 支持
      el.mozRequestFullScreen();
      isFullscreen.value = true;
    } else if (el.msRequestFullscreen) {
      // IE/Edge 支持
      el.msRequestFullscreen();
      isFullscreen.value = true;
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().then(() => {
        isFullscreen.value = false;
      }).catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
      isFullscreen.value = false;
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
      isFullscreen.value = false;
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
      isFullscreen.value = false;
    }
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

function openEditorWithPaper() {
  const pid = exam.value?.paper_id;
  if (!pid) return;
  try {
    if (window.parent && window.parent !== window.self && typeof window.parent.switchMainTab === 'function') {
      window.parent.switchMainTab('editor', pid);
      window.parent.location.hash = 'editor?paperId=' + pid;
    } else {
      const base = window.location.origin || '';
      window.open(base + '/src/app.html#editor?paperId=' + pid, '_blank');
    }
  } catch (e) {
    const base = window.location.origin || '';
    window.open(base + '/src/app.html#editor?paperId=' + pid, '_blank');
  }
}

function onAnswerTypeChange() {
  // Trigger reactivity for enrichedQuestions
}

function applyMajorAnswerType(majorId, subIds) {
  const v = majorAnswerTypeTemp[majorId];
  if (!v) return;
  subIds.forEach(id => {
    answerTypeOverrides[id] = v;
  });
  onAnswerTypeChange();
}

async function saveAnswerConfig() {
  if (!exam.value?.id) return;
  saving.value = true;
  try {
    const cfg = exam.value.answer_system_config || {};
    const overridesToSave = {};
    Object.entries(answerTypeOverrides).forEach(([k, v]) => {
      if (v != null && v !== '') overridesToSave[k] = v;
    });
    const subItemCountsToSave = {};
    Object.entries(subItemCounts).forEach(([k, v]) => {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 1) subItemCountsToSave[k] = n;
    });
    const optionCountsToSave = {};
    Object.entries(optionCounts).forEach(([k, v]) => {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 3 && n <= 6) optionCountsToSave[k] = n;
    });
    const displayNumberOverridesToSave = {};
    Object.entries(displayNumberOverrides).forEach(([k, v]) => {
      const s = (v != null && v !== '') ? String(v).trim() : null;
      if (s) displayNumberOverridesToSave[k] = s;
    });
    const newConfig = {
      ...cfg,
      answerTypeOverrides: overridesToSave,
      subItemCounts: subItemCountsToSave,
      optionCounts: optionCountsToSave,
      displayNumberOverrides: displayNumberOverridesToSave,
      answerStyleConfig: answerStyleConfig.value
    };
    await updateExam(exam.value.id, { answerSystemConfig: newConfig });
    exam.value.answer_system_config = newConfig;
    ElMessage.success('答题配置已保存，将同步到考生端');
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

const majorGroups = computed(() => {
  const questions = enrichedQuestions.value;
  const map = new Map();
  questions.forEach(q => {
    const mid = q.major_question_id ?? q.id;
    if (!map.has(mid)) map.set(mid, { majorId: mid, majorNumber: q.majorNumber ?? 1, questions: [] });
    map.get(mid).questions.push(q);
  });
  return [...map.values()].sort((a, b) => a.majorNumber - b.majorNumber);
});

const enrichedQuestions = computed(() => {
  const counts = subItemCounts;
  const opts = optionCounts;
  return subQuestions.value.map((sq, i) => {
    const majorType = sq.question_type || sq.majorType || '';
    let answerType = answerTypeOverrides[sq.id] || getAnswerType(majorType);
    const optCount = (opts[sq.id] >= 3 && opts[sq.id] <= 6) ? opts[sq.id] : 4;
    const options = parseOptions(sq.content_html || sq.full_content || '', answerType, optCount);
    const blankCount = answerType === 'blank' ? parseBlankCount(sq.content_html || sq.full_content || '') || 1 : 1;
    const wordCount = answerType === 'essay' ? answerConfig.value.essayWordCount : 800;
    const drawingOk = answerType === 'drawing' && answerConfig.value.drawingEnabled;
    
    // 优先使用sub_answers数据来确定子小题数量
    let subItemCount = 1;
    let subAnswerItems = [];
    
    if (sq.sub_answers) {
      try {
        const subAnswers = typeof sq.sub_answers === 'string' ? JSON.parse(sq.sub_answers) : sq.sub_answers;
        if (Array.isArray(subAnswers) && subAnswers.length > 0) {
          subAnswerItems = subAnswers;
          subItemCount = subAnswers.length;
        }
      } catch (e) {
        console.warn('解析 sub_answers 失败:', e);
      }
    }
    
    // 如果没有sub_answers，使用手动设置的subItemCount
    if (subItemCount <= 1) {
      subItemCount = Math.min(Math.max((counts[sq.id] > 1 ? counts[sq.id] : 1) | 0, 1), 10);
    }
    
    const overrides = displayNumberOverrides;
    return {
      ...sq,
      major_question_id: sq.major_question_id,
      globalDisplayNumber: (overrides[sq.id] && String(overrides[sq.id]).trim()) ? String(overrides[sq.id]).trim() : String(i + 1),
      question_type: majorType,
      answerType: drawingOk ? 'drawing' : (answerType === 'drawing' ? 'text' : answerType),
      options,
      blankCount,
      wordCount,
      drawingWidth: answerConfig.value.drawingWidth,
      drawingHeight: answerConfig.value.drawingHeight,
      subItemCount,
      subAnswerItems // 保存子小题答案数据，用于显示子题号
    };
  });
});

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  const id = route.params.id;
  try {
    const examRes = await getExam(id);
    exam.value = examRes.data;
    const overrides = exam.value?.answer_system_config?.answerTypeOverrides || {};
    Object.keys(answerTypeOverrides).forEach(k => delete answerTypeOverrides[k]);
    Object.assign(answerTypeOverrides, overrides);
    const paperId = exam.value?.paper_id;
    if (paperId) {
      const paperRes = await getPaper(paperId);
      paper.value = paperRes.data;
      const majors = paper.value?.majorQuestions || [];
      subQuestions.value = majors.flatMap(m =>
        (m.subQuestions || []).map(s => ({
          ...s,
          major_question_id: s.major_question_id ?? m.id,
          majorNumber: m.major_number,
          question_type: m.question_type
        }))
      );
    } else {
      subQuestions.value = [];
    }
    const counts = exam.value?.answer_system_config?.subItemCounts || {};
    Object.keys(subItemCounts).forEach(k => delete subItemCounts[k]);
    subQuestions.value.forEach(sq => {
      subItemCounts[sq.id] = (counts[sq.id] > 1 ? counts[sq.id] : 1);
    });
    const opts = exam.value?.answer_system_config?.optionCounts || {};
    const displayOverrides = exam.value?.answer_system_config?.displayNumberOverrides || {};
    Object.keys(optionCounts).forEach(k => delete optionCounts[k]);
    Object.keys(displayNumberOverrides).forEach(k => delete displayNumberOverrides[k]);
    subQuestions.value.forEach((sq, idx) => {
      optionCounts[sq.id] = (opts[sq.id] >= 3 && opts[sq.id] <= 6) ? opts[sq.id] : 4;
      displayNumberOverrides[sq.id] = (displayOverrides[sq.id] && String(displayOverrides[sq.id]).trim()) || String(idx + 1);
    });
    const sc = exam.value?.answer_system_config?.answerStyleConfig || {};
    styleConfigLocal.choiceStyle = sc.choiceStyle || 'radio';
    styleConfigLocal.multichoiceStyle = sc.multichoiceStyle || 'checkbox';
    styleConfigLocal.blankStyle = sc.blankStyle || 'underline';
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '加载失败');
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  if (document.fullscreenElement) document.exitFullscreen?.();
});
</script>

<style scoped>
.exam-answer-preview { padding: 0 8px; }
.preview-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.preview-header h2 { margin: 0; font-size: 18px; }
.preview-body { min-height: 400px; }
.exam-preview-header { padding: 12px 16px; background: #409eff; color: #fff; border-radius: 8px 8px 0 0; }
.exam-name { font-weight: 600; }
.exam-body { padding: 24px; background: #f9f9f9; border: 1px solid #e4e7ed; border-top: none; border-radius: 0 0 8px 8px; overflow-y: auto; max-height: 70vh; }
.question-list { max-width: 900px; margin: 0 auto; }
.major-group { margin-bottom: 24px; }
.major-header { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; padding: 10px 16px; background: #ecf5ff; border: 1px solid #b3d8ff; border-radius: 6px; }
.major-title { font-weight: 600; color: #409eff; }
.major-unified-setting { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.major-answer-type-select { width: 120px; }
.question-block { margin-bottom: 28px; padding: 20px; background: #fff; border: 1px solid #e4e7ed; border-radius: 8px; }
.question-content { margin-bottom: 16px; line-height: 1.8; font-size: 14px; }
.question-number-preview { color: #333; font-weight: 500; }
.question-content :deep(img) { max-width: 100%; }
.answer-box { padding-top: 12px; border-top: 1px dashed #ddd; }
.answer-box .answer-item-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.answer-box .answer-item-header label { margin: 0; font-weight: 500; flex-shrink: 0; }
.answer-type-select { width: 120px; }
.display-number-input { width: 80px; margin-right: 8px; }
.sub-item-count-label { margin-left: 12px; font-size: 12px; color: #606266; }
.sub-item-count-input { width: 100px; }
.option-count-label { margin-left: 12px; font-size: 12px; color: #606266; }
.option-count-input { width: 80px; }
.style-config { padding: 8px 0; }
.style-item { margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.style-item span { min-width: 90px; font-size: 13px; }
.answer-box label { display: block; margin-bottom: 6px; font-size: 13px; color: #606266; }
.answer-ref-block { margin-top: 12px; padding: 12px; background: #f0f9ff; border: 1px solid #b3d8ff; border-radius: 6px; }
.answer-ref-label { font-weight: 600; color: #409eff; margin-bottom: 6px; font-size: 13px; }
.answer-ref-content { font-size: 13px; line-height: 1.6; color: #333; }
.answer-ref-content :deep(img) { max-width: 100%; }
.exam-body.a4-layout { padding: 0; background: transparent; border: none; }
.preview-container { background: #e8e8e8; border-radius: 8px; padding: 30px 20px; margin: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.08); width: calc(100% - 40px); max-width: 100%; min-height: 400px; overflow-x: auto; overflow-y: visible; position: relative; display: flex; justify-content: center; align-items: flex-start; }
.a4-preview { display: block; }
.a4-preview :deep(.a4-page),
.a4-preview :deep(.a3-page) {
  line-height: 1.6;
}
.interview-guide-block {
  margin-bottom: 20px;
  padding: 14px 18px;
  background: #f0f9ff;
  border: 1px solid #b3d8ff;
  border-radius: 8px;
}
.interview-guide-title { font-weight: 600; color: #409eff; margin-bottom: 4px; text-align: center; }
.interview-guide-sub { font-size: 12px; color: #909399; text-align: center; margin-bottom: 8px; }
.interview-guide-content { font-size: 14px; line-height: 1.8; text-indent: 2em; }
.interview-guide-content :deep(img) { max-width: 100%; }
.interview-closing-block { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 20px; }
.interview-guide-tip .interview-guide-content { color: #909399; text-indent: 0; }
.examiner-instructions-block { background: #fef9e7; border-color: #f5d76e; }
.examiner-instructions-block .interview-guide-title { color: #b7950b; }
.interview-rubric-table-wrap { margin-bottom: 20px; }
.interview-rubric-table-wrap .interview-guide-title { text-align: left; margin-bottom: 8px; }
</style>
