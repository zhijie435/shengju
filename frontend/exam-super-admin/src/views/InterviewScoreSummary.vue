<template>
  <div class="interview-score-summary">
    <el-page-header @back="$router.back()" :title="examName || '面试成绩汇总'" />
    <div class="toolbar">
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
      <el-button type="success" :loading="tableLoading" @click="openPrintDialog">打印考官数据汇总表</el-button>
    </div>
    <el-table v-loading="loading" :data="summaryList" border stripe size="small" class="summary-table">
      <el-table-column prop="drawNumber" label="签号" width="80" align="center" />
      <el-table-column prop="realName" label="姓名" min-width="100" />
      <el-table-column prop="examNumber" label="准考证号" width="120" />
      <el-table-column label="各考官总分" min-width="180">
        <template #default="{ row }">
          <span v-for="(t, i) in (row.graderTotals || [])" :key="i">
            {{ (t.examinerLabel || t.name) || ('考官' + t.gradingAccountId) }}: {{ t.total }} 分<span v-if="i < (row.graderTotals || []).length - 1">；</span>
          </span>
          <span v-if="!(row.graderTotals || []).length">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="finalScore" label="最终得分（去高低平均）" width="160" align="center">
        <template #default="{ row }">
          {{ row.finalScore != null ? Number(row.finalScore).toFixed(2) : '—' }}
        </template>
      </el-table-column>
      <el-table-column label="签字确认" width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.scoreConfirmedAt" type="success" size="small">已确认</el-tag>
          <el-tag v-else type="info" size="small">未确认</el-tag>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="printVisible" title="考官数据汇总表" width="90%" top="2vh" class="print-dialog" @open="loadGradingTable">
      <div ref="printArea" class="print-area">
        <h2 v-if="gradingTableData.examName" class="print-title">{{ gradingTableData.examName }} - 考官数据汇总表</h2>
        <table v-if="gradingTableData.rows?.length" class="print-table">
          <thead>
            <tr>
              <th>签号</th>
              <th>姓名</th>
              <th>准考证号</th>
              <th v-for="g in (gradingTableData.rows[0] && gradingTableData.rows[0].graderTotals) || []" :key="g.graderId">{{ g.name }} 总分</th>
              <th>最终得分</th>
              <th>签字确认</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in gradingTableData.rows" :key="r.sessionId">
              <td>{{ r.drawNumber }}</td>
              <td>{{ r.realName }}</td>
              <td>{{ r.examNumber }}</td>
              <td v-for="g in r.graderTotals" :key="g.graderId">{{ g.total != null ? g.total : '—' }}</td>
              <td>{{ r.finalScore != null ? Number(r.finalScore).toFixed(2) : '—' }}</td>
              <td>{{ r.scoreConfirmedAt ? '已确认' : '未确认' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="no-data">暂无数据</p>
      </div>
      <template #footer>
        <el-button @click="printVisible = false">关闭</el-button>
        <el-button type="primary" @click="doPrint">打印</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getExam, getInterviewStaffSummary, getInterviewGradingTable } from '../api/exams';

const route = useRoute();
const examId = computed(() => route.params.examId);

const loading = ref(false);
const tableLoading = ref(false);
const summaryList = ref([]);
const examName = ref('');
const printVisible = ref(false);
const printArea = ref(null);
const gradingTableData = ref({ examName: '', rows: [] });

async function load() {
  if (!examId.value) return;
  loading.value = true;
  try {
    const [examRes, summaryRes] = await Promise.all([
      getExam(examId.value).catch(() => ({ data: {} })),
      getInterviewStaffSummary(examId.value)
    ]);
    const examData = examRes?.data != null ? examRes.data : examRes;
    examName.value = examData?.name || '';
    summaryList.value = summaryRes?.data || [];
  } catch (e) {
    ElMessage.error(e?.message || e?.response?.data?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadGradingTable() {
  if (!examId.value) return;
  tableLoading.value = true;
  try {
    const res = await getInterviewGradingTable(examId.value);
    const data = res?.data || {};
    gradingTableData.value = {
      examName: data.examName || examName.value,
      rows: data.rows || []
    };
  } catch (e) {
    gradingTableData.value = { examName: examName.value, rows: [] };
  } finally {
    tableLoading.value = false;
  }
}

function openPrintDialog() {
  printVisible.value = true;
}

function doPrint() {
  if (!printArea.value) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>考官数据汇总表</title>
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #333; padding: 6px 10px; text-align: center; font-size: 13px; }
      th { background: #f0f0f0; }
      h2 { text-align: center; margin-bottom: 16px; }
    </style></head><body>
    ${printArea.value.innerHTML}
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

onMounted(() => {
  load();
});
</script>

<style scoped>
.interview-score-summary { padding: 16px; }
.toolbar { margin: 16px 0; display: flex; gap: 12px; }
.summary-table { margin-top: 12px; }
.print-dialog :deep(.el-dialog__body) { max-height: 75vh; overflow: auto; }
.print-area { padding: 8px; }
.print-title { font-size: 18px; margin-bottom: 16px; }
.print-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.print-table th, .print-table td { border: 1px solid #ddd; padding: 6px 10px; text-align: center; }
.print-table th { background: #f5f7fa; }
.no-data { color: #909399; text-align: center; padding: 24px; }
</style>
