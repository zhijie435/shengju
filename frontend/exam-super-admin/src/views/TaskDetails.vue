<template>
  <div>
    <el-page-header @back="$router.back()" :title="taskDetails?.task?.exam_name || '任务详情'" />
    
    <div v-loading="loading" class="task-details-container">
      <template v-if="taskDetails">
        <!-- 任务基本信息 -->
        <el-card style="margin-bottom: 20px;">
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>任务基本信息</span>
              <el-button size="small" @click="loadTaskDetails">刷新</el-button>
            </div>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="任务ID">{{ taskDetails.task.id }}</el-descriptions-item>
            <el-descriptions-item label="考试名称">{{ taskDetails.task.exam_name }}</el-descriptions-item>
            <el-descriptions-item label="阅卷账号">{{ taskDetails.task.username }}</el-descriptions-item>
            <el-descriptions-item label="姓名">{{ taskDetails.task.real_name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="分配方式">
              {{ taskDetails.task.task_type === 'content' ? '按内容分配' : '按题型分配' }}
            </el-descriptions-item>
            <el-descriptions-item label="任务状态">
              <el-tag :type="getStatusType(taskDetails.task.status)">
                {{ getStatusText(taskDetails.task.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="创建时间">
              {{ formatTime(taskDetails.task.created_at) }}
            </el-descriptions-item>
            <el-descriptions-item label="分配时间">
              {{ formatTime(taskDetails.task.assigned_at) || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="完成时间" :span="2">
              {{ formatTime(taskDetails.task.completed_at) || '-' }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 总题数为 0 时提示：需先同步考生答案 -->
        <el-alert
          v-if="taskDetails.progress && taskDetails.progress.total === 0"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 20px;"
        >
          <template #title>总题数为 0：阅卷表暂无主观题答案</template>
          <div>
            子系统的「分配题数」和「待阅卷」来自阅卷表。考生交卷时主观题答案先存入临时表，需<strong>先同步到阅卷表</strong>后才会显示。请点击下方按钮同步，或前往「主观题任务分配与阅卷」页点击「同步考生答案」。
            <el-button type="warning" size="small" :loading="syncing" @click="handleSyncSubjectiveAnswers" style="margin-top: 8px; display: block;">
              立即同步考生答案
            </el-button>
          </div>
        </el-alert>

        <!-- 总体进度统计 -->
        <el-card style="margin-bottom: 20px;">
          <template #header>
            <span>总体进度统计</span>
          </template>
          <el-row :gutter="20">
            <el-col :span="6">
              <el-statistic title="总题数" :value="taskDetails.progress.total" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="已阅卷" :value="taskDetails.progress.graded">
                <template #suffix>
                  <el-tag type="success" size="small">已完成</el-tag>
                </template>
              </el-statistic>
            </el-col>
            <el-col :span="6">
              <el-statistic title="待阅卷" :value="taskDetails.progress.pending">
                <template #suffix>
                  <el-tag type="warning" size="small">待处理</el-tag>
                </template>
              </el-statistic>
            </el-col>
            <el-col :span="6">
              <el-statistic title="完成进度" :value="taskDetails.progress.progress">
                <template #suffix>%</template>
              </el-statistic>
            </el-col>
          </el-row>
          <el-progress 
            :percentage="taskDetails.progress.progress" 
            :status="taskDetails.progress.progress === 100 ? 'success' : ''"
            style="margin-top: 20px;"
          />
        </el-card>

        <!-- 子账号管理 -->
        <el-card style="margin-bottom: 20px;">
          <template #header>
            <span>子系统阅卷情况</span>
          </template>
          <el-table :data="taskDetails.accounts" stripe border>
            <el-table-column prop="username" label="用户名" width="150" />
            <el-table-column prop="real_name" label="姓名" width="120" />
            <el-table-column prop="email" label="邮箱" width="200" />
            <el-table-column prop="task_status" label="任务状态" width="100">
              <template #default="{ row }">
                <el-tag :type="getStatusType(row.task_status)" size="small">
                  {{ getStatusText(row.task_status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="total" label="总题数" width="100" align="center" />
            <el-table-column prop="graded" label="已阅卷" width="100" align="center">
              <template #default="{ row }">
                <span style="color: #67c23a;">{{ row.graded }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="pending" label="待阅卷" width="100" align="center">
              <template #default="{ row }">
                <span style="color: #e6a23c;">{{ row.pending }}</span>
              </template>
            </el-table-column>
            <el-table-column label="进度" min-width="200">
              <template #default="{ row }">
                <el-progress 
                  :percentage="row.progress" 
                  :status="row.progress === 100 ? 'success' : ''"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 小题进度统计 -->
        <el-card style="margin-bottom: 20px;">
          <template #header>
            <span>小题阅卷进度</span>
          </template>
          <el-table :data="taskDetails.questionProgress" stripe border max-height="400px">
            <el-table-column prop="question_number" label="题号" width="100" align="center" />
            <el-table-column prop="total" label="总题数" width="100" align="center" />
            <el-table-column prop="graded" label="已阅卷" width="100" align="center">
              <template #default="{ row }">
                <span style="color: #67c23a;">{{ row.graded }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="progress" label="进度" min-width="200">
              <template #default="{ row }">
                <el-progress 
                  :percentage="row.progress" 
                  :status="row.progress === 100 ? 'success' : ''"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 阅卷时间分布 -->
        <el-card v-if="taskDetails.timeDistribution && taskDetails.timeDistribution.length > 0">
          <template #header>
            <span>阅卷时间分布</span>
          </template>
          <el-table :data="taskDetails.timeDistribution" stripe border>
            <el-table-column prop="hour" label="时间" width="200" />
            <el-table-column prop="count" label="阅卷数量" width="150" align="center">
              <template #default="{ row }">
                <el-tag type="info">{{ row.count }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="可视化" min-width="300">
              <template #default="{ row }">
                <el-progress 
                  :percentage="getTimeDistributionPercentage(row.count)" 
                  :format="() => `${row.count} 份`"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getTaskDetails } from '../api/grading';
import { syncSubjectiveAnswers } from '../api/exams';

const route = useRoute();
const router = useRouter();
const taskId = parseInt(route.params.id);
const loading = ref(false);
const syncing = ref(false);
const taskDetails = ref(null);
let refreshTimer = null;

async function handleSyncSubjectiveAnswers() {
  if (!taskDetails.value?.task?.exam_id) return;
  syncing.value = true;
  try {
    const res = await syncSubjectiveAnswers(taskDetails.value.task.exam_id);
    ElMessage.success(res.data?.message || '同步成功');
    await loadTaskDetails();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function loadTaskDetails() {
  loading.value = true;
  try {
    const res = await getTaskDetails(taskId);
    taskDetails.value = res.data;
  } catch (e) {
    const errorMsg = e.response?.data?.message || e.message || '加载失败';
    ElMessage.error(errorMsg);
  } finally {
    loading.value = false;
  }
}

function formatTime(time) {
  if (!time) return '-';
  return new Date(time).toLocaleString('zh-CN');
}

function getStatusType(status) {
  const map = {
    pending: 'info',
    assigned: 'warning',
    in_progress: 'primary',
    completed: 'success'
  };
  return map[status] || 'info';
}

function getStatusText(status) {
  const map = {
    pending: '待分配',
    assigned: '已分配',
    in_progress: '进行中',
    completed: '已完成'
  };
  return map[status] || status;
}

function getTimeDistributionPercentage(count) {
  if (!taskDetails.value || !taskDetails.value.timeDistribution || taskDetails.value.timeDistribution.length === 0) {
    return 0;
  }
  const maxCount = Math.max(...taskDetails.value.timeDistribution.map(t => t.count));
  return maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
}

// 实时刷新（每10秒刷新一次）
function startAutoRefresh() {
  refreshTimer = setInterval(() => {
    loadTaskDetails();
  }, 10000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

onMounted(() => {
  loadTaskDetails();
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>

<style scoped>
.task-details-container {
  padding: 20px;
}
</style>
