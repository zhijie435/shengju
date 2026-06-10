<template>
  <div>
    <el-page-header @back="$router.back()" :title="exam?.name || '阅卷'" />
    <div class="toolbar">
      <h3>主观题阅卷</h3>
      <el-button @click="load">刷新</el-button>
    </div>
    <div v-loading="loading" class="grading-content">
      <template v-if="!loading && sessions.length">
        <el-collapse v-model="activeSessions">
          <el-collapse-item v-for="s in sessions" :key="s.id" :name="s.id">
            <template #title>
              <span>{{ s.real_name || s.username }} — 总分：{{ s.total_score ?? '-' }}</span>
              <el-button link type="primary" size="small" class="ml-12" @click.stop="viewReport(s.id)">查看报告</el-button>
            </template>
            <div v-for="a in s.answers" :key="a.id" class="answer-item">
              <div class="answer-question" v-html="a.content_html || a.full_content || '（题干）'" />
              <div class="answer-meta">
                <span>标准答案：{{ a.standard_answer || '-' }}</span>
                <span v-if="a.answer_analysis">解析：{{ a.answer_analysis }}</span>
              </div>
              <div class="answer-student">考生答案：{{ formatStudentAnswer(a) }}</div>
              <div class="answer-score-row">
                <span>得分：</span>
                <el-input-number v-model="scoreInputs[a.id]" :min="0" :max="a.max_score || 100" :step="0.5" size="small" @change="saveScore(a)" />
                <span v-if="a.max_score">/ {{ a.max_score }} 分</span>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </template>
      <el-empty v-else-if="!loading" description="暂无已交卷的答卷" />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getGradingData, updateAnswerScore, getReport } from '../api/exams';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const exam = ref(null);
const sessions = ref([]);
const activeSessions = ref([]);
const scoreInputs = reactive({});

async function load() {
  loading.value = true;
  try {
    const res = await getGradingData(route.params.id);
    exam.value = res.data?.exam;
    sessions.value = res.data?.sessions || [];
    activeSessions.value = sessions.value.slice(0, 3).map(s => s.id);
    sessions.value.forEach(s => {
      (s.answers || []).forEach(a => {
        scoreInputs[a.id] = a.score != null ? parseFloat(a.score) : null;
      });
    });
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
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

async function saveScore(a) {
  const v = scoreInputs[a.id];
  if (v == null || isNaN(v)) return;
  try {
    await updateAnswerScore(a.id, v);
    ElMessage.success('保存成功');
    load();
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  }
}

function viewReport(sessionId) {
  router.push({ name: 'ExamReport', params: { id: route.params.id, sessionId } });
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin: 16px 0; }
.grading-content { min-height: 200px; }
.answer-item { border: 1px solid #ebeef5; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.answer-question { margin-bottom: 12px; font-size: 14px; line-height: 1.6; }
.answer-question :deep(img) { max-width: 100%; }
.answer-meta { font-size: 12px; color: #909399; margin-bottom: 8px; }
.answer-student { margin-bottom: 12px; padding: 8px; background: #f5f7fa; border-radius: 4px; font-size: 13px; }
.answer-score-row { display: flex; align-items: center; gap: 8px; }
.ml-12 { margin-left: 12px; }
</style>
