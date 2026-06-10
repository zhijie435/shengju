<template>
  <div class="grading-statistics">
    <div class="toolbar">
      <h2>阅卷统计 - {{ examName }}</h2>
      <div>
        <el-button @click="$router.back()">返回</el-button>
        <el-button type="primary" @click="refreshData">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <!-- 整体统计 -->
      <el-tab-pane label="整体统计" name="overview">
        <div v-loading="statisticsLoading" class="statistics-overview">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-card>
                <div class="stat-item">
                  <div class="stat-label">参考人数</div>
                  <div class="stat-value">{{ statistics.totalCandidates || 0 }}</div>
                </div>
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card>
                <div class="stat-item">
                  <div class="stat-label">平均分</div>
                  <div class="stat-value">{{ statistics.averageScore || 0 }}</div>
                </div>
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card>
                <div class="stat-item">
                  <div class="stat-label">平均得分率</div>
                  <div class="stat-value">{{ statistics.averageScoreRate || 0 }}%</div>
                </div>
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card>
                <div class="stat-item">
                  <div class="stat-label">及格率</div>
                  <div class="stat-value">{{ statistics.passRate || 0 }}%</div>
                </div>
              </el-card>
            </el-col>
          </el-row>
          <el-row :gutter="20" style="margin-top: 20px;">
            <el-col :span="12">
              <el-card>
                <div class="stat-item">
                  <div class="stat-label">最高分</div>
                  <div class="stat-value">{{ statistics.highestScore || 0 }}</div>
                </div>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card>
                <div class="stat-item">
                  <div class="stat-label">最低分</div>
                  <div class="stat-value">{{ statistics.lowestScore || 0 }}</div>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </el-tab-pane>

      <!-- 考生汇总列表 -->
      <el-tab-pane label="考生汇总" name="summaries">
        <el-table :data="summaries" stripe v-loading="summariesLoading" style="margin-top: 20px;">
          <el-table-column prop="real_name" label="姓名" width="120" />
          <el-table-column prop="username" label="用户名" width="150" />
          <el-table-column label="总分" width="100">
            <template #default="{ row }">
              {{ row.total_score }} / {{ row.max_score }}
            </template>
          </el-table-column>
          <el-table-column prop="score_rate" label="得分率" width="100">
            <template #default="{ row }">
              {{ row.score_rate }}%
            </template>
          </el-table-column>
          <el-table-column label="客观题得分" width="120">
            <template #default="{ row }">
              {{ row.objective_score }}
            </template>
          </el-table-column>
          <el-table-column label="主观题得分" width="120">
            <template #default="{ row }">
              {{ row.subjective_score }}
            </template>
          </el-table-column>
          <el-table-column label="正确题数" width="100">
            <template #default="{ row }">
              {{ row.correct_count }}
            </template>
          </el-table-column>
          <el-table-column label="错误题数" width="100">
            <template #default="{ row }">
              {{ row.wrong_count }}
            </template>
          </el-table-column>
          <el-table-column prop="submitted_at" label="交卷时间" width="180" />
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="viewDetail(row)">查看详情</el-button>
              <el-button link type="primary" size="small" @click="viewReport(row)">查看报告</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadSummaries"
          style="margin-top: 20px;"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailVisible" title="考生详情" width="80%">
      <div v-if="currentSummary">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ currentSummary.real_name || currentSummary.username }}</el-descriptions-item>
          <el-descriptions-item label="总分">{{ currentSummary.total_score }} / {{ currentSummary.max_score }}</el-descriptions-item>
          <el-descriptions-item label="得分率">{{ currentSummary.score_rate }}%</el-descriptions-item>
          <el-descriptions-item label="答题时长">{{ formatTime(currentSummary.answer_time_seconds) }}</el-descriptions-item>
          <el-descriptions-item label="客观题得分">{{ currentSummary.objective_score }}</el-descriptions-item>
          <el-descriptions-item label="主观题得分">{{ currentSummary.subjective_score }}</el-descriptions-item>
          <el-descriptions-item label="正确题数">{{ currentSummary.correct_count }}</el-descriptions-item>
          <el-descriptions-item label="错误题数">{{ currentSummary.wrong_count }}</el-descriptions-item>
        </el-descriptions>

        <el-divider>各题型统计</el-divider>
        <el-table :data="formatQuestionTypeStats(currentSummary.question_type_stats)" style="margin-top: 20px;">
          <el-table-column prop="type" label="题型" />
          <el-table-column prop="totalScore" label="得分" />
          <el-table-column prop="maxScore" label="满分" />
          <el-table-column prop="scoreRate" label="得分率" />
          <el-table-column prop="correctRate" label="正确率" />
        </el-table>

        <el-divider>各难度统计</el-divider>
        <el-table :data="formatDifficultyStats(currentSummary.difficulty_stats)" style="margin-top: 20px;">
          <el-table-column prop="difficulty" label="难度" />
          <el-table-column prop="totalScore" label="得分" />
          <el-table-column prop="maxScore" label="满分" />
          <el-table-column prop="scoreRate" label="得分率" />
          <el-table-column prop="correctRate" label="正确率" />
        </el-table>

        <el-divider>各考察目的统计</el-divider>
        <el-table :data="formatExamPurposeStats(currentSummary.exam_purpose_stats)" style="margin-top: 20px;">
          <el-table-column prop="purpose" label="考察目的" />
          <el-table-column prop="totalScore" label="得分" />
          <el-table-column prop="maxScore" label="满分" />
          <el-table-column prop="scoreRate" label="得分率" />
          <el-table-column prop="correctRate" label="正确率" />
        </el-table>
      </div>
    </el-dialog>

    <!-- 评估报告对话框 -->
    <el-dialog v-model="reportVisible" title="评估报告" width="80%">
      <div v-loading="reportLoading">
        <div v-if="currentReport && currentReport.generation_status === 'completed'" v-html="currentReport.report_html || currentReport.report_content" class="report-content"></div>
        <div v-else-if="currentReport && currentReport.generation_status === 'generating'" class="report-generating">
          <el-alert type="info" :closable="false">报告正在生成中，请稍候...</el-alert>
        </div>
        <div v-else-if="currentReport && currentReport.generation_status === 'failed'" class="report-failed">
          <el-alert type="error" :closable="false">
            <template #title>报告生成失败</template>
            <p>{{ currentReport.error_message || '未知错误' }}</p>
            <el-button type="primary" size="small" @click="regenerateReport" style="margin-top: 10px;">重新生成</el-button>
          </el-alert>
        </div>
        <div v-else class="report-pending">
          <el-alert type="warning" :closable="false">
            <template #title>报告尚未生成</template>
            <el-button type="primary" size="small" @click="generateReport" style="margin-top: 10px;">生成报告</el-button>
          </el-alert>
        </div>
      </div>
      <template #footer>
        <el-button @click="reportVisible = false">关闭</el-button>
        <el-button type="primary" @click="downloadReport" v-if="currentReport && currentReport.generation_status === 'completed'">下载报告</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getExamStatistics, getExamSummaries, getExamSummary, generateExamSummary } from '../api/grading';
import { getEvaluationReport, generateEvaluationReport, downloadEvaluationReport } from '../api/grading';
import { getExam } from '../api/exams';

const route = useRoute();
const router = useRouter();

const examId = ref(parseInt(route.params.examId));
const examName = ref('');
const activeTab = ref('overview');

// 统计数据
const statistics = ref({});
const statisticsLoading = ref(false);

// 汇总列表
const summaries = ref([]);
const summariesLoading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

// 详情对话框
const detailVisible = ref(false);
const currentSummary = ref(null);

// 报告对话框
const reportVisible = ref(false);
const reportLoading = ref(false);
const currentReport = ref(null);
const currentSessionId = ref(null);

async function loadExamInfo() {
  try {
    const res = await getExam(examId.value);
    examName.value = res.data?.name || '未知考试';
  } catch (e) {
    console.error('Load exam info error:', e);
  }
}

async function loadStatistics() {
  statisticsLoading.value = true;
  try {
    const res = await getExamStatistics(examId.value);
    statistics.value = res.data || {};
  } catch (e) {
    ElMessage.error('加载统计数据失败：' + (e.message || '未知错误'));
  } finally {
    statisticsLoading.value = false;
  }
}

async function loadSummaries() {
  summariesLoading.value = true;
  try {
    const res = await getExamSummaries(examId.value, {
      page: page.value,
      pageSize: pageSize.value
    });
    summaries.value = res.data?.summaries || [];
    total.value = res.data?.total || 0;
  } catch (e) {
    ElMessage.error('加载汇总数据失败：' + (e.message || '未知错误'));
  } finally {
    summariesLoading.value = false;
  }
}

function formatQuestionTypeStats(stats) {
  if (!stats || typeof stats !== 'object') return [];
  return Object.keys(stats).map(type => ({
    type,
    totalScore: stats[type].totalScore?.toFixed(2) || 0,
    maxScore: stats[type].maxScore?.toFixed(2) || 0,
    scoreRate: stats[type].scoreRate?.toFixed(2) || 0,
    correctRate: stats[type].correctRate?.toFixed(2) || 0
  }));
}

function formatDifficultyStats(stats) {
  if (!stats || typeof stats !== 'object') return [];
  return Object.keys(stats).map(difficulty => ({
    difficulty,
    totalScore: stats[difficulty].totalScore?.toFixed(2) || 0,
    maxScore: stats[difficulty].maxScore?.toFixed(2) || 0,
    scoreRate: stats[difficulty].scoreRate?.toFixed(2) || 0,
    correctRate: stats[difficulty].correctRate?.toFixed(2) || 0
  }));
}

function formatExamPurposeStats(stats) {
  if (!stats || typeof stats !== 'object') return [];
  return Object.keys(stats).map(purpose => ({
    purpose,
    totalScore: stats[purpose].totalScore?.toFixed(2) || 0,
    maxScore: stats[purpose].maxScore?.toFixed(2) || 0,
    scoreRate: stats[purpose].scoreRate?.toFixed(2) || 0,
    correctRate: stats[purpose].correctRate?.toFixed(2) || 0
  }));
}

function formatTime(seconds) {
  if (!seconds) return '0秒';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分钟${secs}秒`;
  } else if (minutes > 0) {
    return `${minutes}分钟${secs}秒`;
  } else {
    return `${secs}秒`;
  }
}

async function viewDetail(row) {
  try {
    // 从汇总数据中获取session_id
    const sessionId = row.session_id;
    const res = await getExamSummary(sessionId);
    currentSummary.value = res.data;
    detailVisible.value = true;
  } catch (e) {
    ElMessage.error('加载详情失败：' + (e.message || '未知错误'));
  }
}

async function viewReport(row) {
  currentSessionId.value = row.session_id;
  reportVisible.value = true;
  await loadReport();
}

async function loadReport() {
  if (!currentSessionId.value) return;
  reportLoading.value = true;
  try {
    const res = await getEvaluationReport(currentSessionId.value);
    currentReport.value = res.data;
    
    // 如果报告正在生成中，3秒后重新加载
    if (currentReport.value && currentReport.value.generation_status === 'generating') {
      setTimeout(() => {
        loadReport();
      }, 3000);
    }
  } catch (e) {
    if (e.response?.status === 404) {
      currentReport.value = null;
    } else {
      ElMessage.error('加载报告失败：' + (e.message || '未知错误'));
    }
  } finally {
    reportLoading.value = false;
  }
}

async function generateReport() {
  if (!currentSessionId.value) return;
  try {
    await generateEvaluationReport(currentSessionId.value);
    ElMessage.success('报告生成任务已启动，请稍后查看');
    setTimeout(() => {
      loadReport();
    }, 2000);
  } catch (e) {
    ElMessage.error('生成报告失败：' + (e.message || '未知错误'));
  }
}

async function regenerateReport() {
  await generateReport();
}

async function downloadReport() {
  if (!currentSessionId.value) return;
  try {
    const res = await downloadEvaluationReport(currentSessionId.value);
    const blob = new Blob([res.data], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `评估报告_${currentReport.value.real_name || currentReport.value.username}_${Date.now()}.html`;
    link.click();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error('下载报告失败：' + (e.message || '未知错误'));
  }
}

async function refreshData() {
  await Promise.all([
    loadStatistics(),
    loadSummaries()
  ]);
}

onMounted(async () => {
  await loadExamInfo();
  await refreshData();
});
</script>

<style scoped>
.grading-statistics {
  padding: 20px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.statistics-overview {
  padding: 20px 0;
}

.stat-item {
  text-align: center;
}

.stat-label {
  font-size: 14px;
  color: #666;
  margin-bottom: 10px;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #409eff;
}

.report-content {
  padding: 20px;
  line-height: 1.8;
}

.report-content :deep(h1),
.report-content :deep(h2),
.report-content :deep(h3) {
  margin-top: 20px;
  margin-bottom: 10px;
}

.report-content :deep(p) {
  margin: 10px 0;
}

.report-content :deep(ul),
.report-content :deep(ol) {
  margin: 10px 0;
  padding-left: 30px;
}

.report-generating,
.report-failed,
.report-pending {
  padding: 40px;
  text-align: center;
}
</style>
