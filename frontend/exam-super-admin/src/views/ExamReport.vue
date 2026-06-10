<template>
  <div ref="reportRef" class="exam-report">
    <div class="report-header">
      <el-button @click="$router.back()">返回</el-button>
      <el-button type="primary" @click="exportPrint">导出/打印</el-button>
    </div>
    <div v-loading="loading" class="report-body">
      <template v-if="!loading && report">
        <h2>{{ report.exam?.name }} — 测评报告</h2>
        <p class="student-info">考生：{{ report.student?.name }} &nbsp;&nbsp; 总分：{{ report.totalScore ?? '-' }}</p>
        <div v-for="(item, i) in report.items" :key="i" class="report-item">
          <div class="item-question" v-html="item.content || '（题干）'" />
          <div class="item-row"><strong>考生答案：</strong>{{ item.studentAnswer || '-' }}</div>
          <div class="item-row"><strong>标准答案：</strong>{{ item.standardAnswer || '-' }}</div>
          <div v-if="item.analysis" class="item-row"><strong>解析：</strong>{{ item.analysis }}</div>
          <div class="item-row"><strong>得分：</strong>{{ item.score ?? '-' }} / {{ item.maxScore ?? '-' }} 分</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getReport } from '../api/exams';

const route = useRoute();
const loading = ref(true);
const report = ref(null);
const reportRef = ref(null);

onMounted(async () => {
  try {
    const res = await getReport(route.params.id, route.params.sessionId);
    report.value = res.data;
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
});

function exportPrint() {
  window.print();
}
</script>

<style scoped>
.report-header { display: flex; justify-content: space-between; margin-bottom: 16px; }
.report-body { padding: 24px; background: #fff; }
.report-body h2 { margin-bottom: 12px; }
.student-info { margin-bottom: 24px; color: #606266; }
.report-item { border: 1px solid #ebeef5; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.item-question { margin-bottom: 12px; line-height: 1.6; }
.item-question :deep(img) { max-width: 100%; }
.item-row { margin: 8px 0; font-size: 14px; }
@media print {
  .report-header .el-button { display: none; }
}
</style>
