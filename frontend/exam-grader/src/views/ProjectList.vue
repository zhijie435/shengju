<template>
  <div>
    <h2>我的项目</h2>
    <el-table :data="projectList" stripe v-loading="loading">
      <el-table-column prop="name" label="项目名称" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">{{ getStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="task_count" label="任务数量" width="120" align="center">
        <template #default="{ row }">
          <el-tag type="info">{{ row.task_count || 0 }} 个</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="start_time" label="开始时间" width="180" />
      <el-table-column prop="end_time" label="结束时间" width="180" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button 
            type="primary" 
            size="small" 
            @click="$router.push(`/tasks?examId=${row.id}`)"
          >
            查看任务
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    
    <div v-if="!loading && projectList.length === 0" style="text-align: center; padding: 40px; color: #909399;">
      <p>暂无可访问的项目</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getProjects } from '../api/grading';

const loading = ref(false);
const projectList = ref([]);

async function loadProjects() {
  loading.value = true;
  try {
    const res = await getProjects();
    projectList.value = res.data || [];
    
    // 如果只有一个项目，可以直接跳转到任务列表
    if (projectList.value.length === 1) {
      // 可选：自动跳转到任务列表
      // this.$router.push(`/tasks?examId=${projectList.value[0].id}`);
    }
  } catch (e) {
    ElMessage.error('加载项目失败：' + (e.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

function getStatusType(status) {
  const map = {
    draft: 'info',
    published: 'success',
    ongoing: 'warning',
    ended: '',
    cancelled: 'danger'
  };
  return map[status] || 'info';
}

function getStatusText(status) {
  const map = {
    draft: '草稿',
    published: '已发布',
    ongoing: '进行中',
    ended: '已结束',
    cancelled: '已取消'
  };
  return map[status] || status;
}

onMounted(loadProjects);
</script>

<style scoped>
h2 {
  margin-bottom: 20px;
}
</style>
