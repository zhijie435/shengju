<template>
  <div class="invitations-page">
    <header class="header">
      <span>个人中心 · 专业测评</span>
      <div class="header-actions">
        <el-button link @click="goExams">我的考试</el-button>
        <el-button link type="danger" @click="logout">退出</el-button>
      </div>
    </header>
    <div class="content">
      <el-table v-if="list.length" :data="list" stripe>
        <el-table-column prop="examName" label="考试名称" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="String(row.examStatus || '').toLowerCase() === 'draft'" type="info" size="small">待发布</el-tag>
            <el-tag v-else-if="String(row.examStatus || '').toLowerCase() === 'ongoing'" type="warning" size="small">进行中</el-tag>
            <el-tag v-else type="success" size="small">已发布</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="startTime" label="开始时间" width="180" />
        <el-table-column prop="endTime" label="结束时间" width="180" />
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              :disabled="String(row.examStatus || '').toLowerCase() === 'draft'"
              @click="goExam(row)"
            >
              去考试
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无专业测评邀请" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { getMyExamInvitations } from '../api/exam';

const router = useRouter();
const auth = useAuthStore();
const list = ref([]);

async function load() {
  const token = localStorage.getItem('exam_student_token');
  if (!token) {
    router.replace('/login?redirect=' + encodeURIComponent(router.currentRoute.value.fullPath));
    return;
  }
  try {
    const res = await getMyExamInvitations();
    list.value = (res && res.data) ? res.data : [];
  } catch (e) {
    list.value = [];
    if (e.response?.status === 401) {
      ElMessage.warning('登录已过期，请重新登录');
      router.replace('/login?redirect=' + encodeURIComponent(router.currentRoute.value.fullPath));
    } else {
      ElMessage.error(e.response?.data?.message || '加载失败');
    }
  }
}

function goExam(row) {
  router.push({ path: '/exams' });
}

function goExams() {
  router.push({ path: '/exams' });
}

function logout() {
  auth.logout();
  router.push('/login');
}

onMounted(load);
</script>

<style scoped>
.invitations-page { min-height: 100vh; background: #f5f7fa; }
.header { padding: 16px 24px; background: #fff; display: flex; justify-content: space-between; align-items: center; }
.header-actions { display: flex; gap: 8px; }
.content { padding: 24px; }
</style>
