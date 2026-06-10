<template>
  <div>
    <h2>我的任务</h2>
    <el-alert
      v-if="!loading && (taskList.length === 0 || taskList.every(t => (t.total ?? 0) === 0))"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px;"
    >
      <template #title>看不到分配题数或阅卷任务？</template>
      子系统的题数和待阅卷列表来自阅卷表。请管理员：1）在「主观题任务分配与阅卷」中点击<strong>「同步考生答案」</strong>，将考生交卷的主观题答案同步到阅卷表；2）确认已为该考试创建并分配了阅卷任务。完成后刷新本页。
    </el-alert>
    <el-table :data="taskList" stripe v-loading="loading">
      <el-table-column prop="exam_name" label="考试名称" min-width="140" />
      <el-table-column label="分配题数" width="100" align="center">
        <template #default="{ row }">
          <el-tag type="primary" size="small">{{ row.total != null ? row.total : 0 }} 题</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="分配方式" width="100">
        <template #default="{ row }">
          {{ row.task_type === 'content' ? '按内容' : '按题型' }}
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">{{ getStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="阅卷进度" width="260">
        <template #default="{ row }">
          <div style="display: flex; align-items: center; gap: 12px;">
            <el-progress 
              :percentage="row.progress != null ? row.progress : 0" 
              :status="row.progress === 100 ? 'success' : ''"
              style="flex: 1;"
            />
            <span style="font-size: 12px; color: #909399; white-space: nowrap;">
              已阅 {{ row.graded != null ? row.graded : 0 }}/{{ row.total != null ? row.total : 0 }}
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="待阅卷" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="(row.pending != null ? row.pending : 0) > 0 ? 'warning' : 'success'" size="small">
            {{ row.pending != null ? row.pending : 0 }} 题
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="assigned_at" label="分配时间" width="180" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button 
            type="primary" 
            size="small" 
            @click="$router.push(`/grading/${row.id}`)"
            :disabled="row.status === 'completed'"
          >
            开始阅卷
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <h2 style="margin-top: 32px;">我的面试考试</h2>
    <el-table :data="interviewExams" stripe v-loading="loadingInterviews">
      <el-table-column prop="name" label="考试名称" min-width="160" />
      <el-table-column prop="paper_name" label="试卷" min-width="140" />
      <el-table-column prop="start_time" label="开始时间" width="180" />
      <el-table-column prop="end_time" label="结束时间" width="180" />
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button
            type="primary"
            size="small"
            @click="$router.push({ path: `/interview-exams/${row.id}`, query: row.isStaffOnly ? { staffOnly: '1' } : {} })"
          >
            {{ row.isStaffOnly ? '查看汇总' : '面试评分' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getMyTasks, getMyInterviewExams } from '../api/grading';

const loading = ref(false);
const taskList = ref([]);
const interviewExams = ref([]);
const loadingInterviews = ref(false);

async function loadTasks() {
  loading.value = true;
  try {
    const res = await getMyTasks();
    // 后端已返回每个任务的分配题数(total)、已阅卷(graded)、待阅卷(pending)、进度(progress)
    taskList.value = res.data || [];
  } catch (e) {
    ElMessage.error('加载任务失败：' + (e.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

async function loadInterviewExams() {
  loadingInterviews.value = true;
  try {
    const res = await getMyInterviewExams();
    interviewExams.value = res.data || [];
  } catch (e) {
    ElMessage.error('加载面试考试失败：' + (e.message || '未知错误'));
  } finally {
    loadingInterviews.value = false;
  }
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

onMounted(() => {
  loadTasks();
  loadInterviewExams();
});
</script>

<style scoped>
h2 {
  margin-bottom: 20px;
}
</style>
