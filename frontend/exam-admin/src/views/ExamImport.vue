<template>
  <div style="padding: 40px; text-align: center;">
    <el-icon v-if="loading" class="is-loading" :size="48"><Loading /></el-icon>
    <p v-if="loading">{{ statusText }}</p>
    <p v-else-if="error" style="color: #f56c6c;">{{ error }}</p>
    <p v-else-if="success" style="color: #67c23a;">{{ success }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { importExamFromPaper } from '../api/exams';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const statusText = ref('正在导入试卷并创建考试...');
const error = ref('');
const success = ref('');

onMounted(async () => {
  const paperId = route.query.paperId ? parseInt(route.query.paperId, 10) : null;
  if (!paperId) {
    loading.value = false;
    error.value = '缺少试卷ID';
    setTimeout(() => router.push('/exams'), 2000);
    return;
  }
  try {
    const res = await importExamFromPaper(paperId);
    loading.value = false;
    if (res.success && res.data?.id) {
      success.value = `已创建考试：${res.data.name || ''}`;
      ElMessage.success('导入成功');
      setTimeout(() => router.push('/exams'), 800);
    } else {
      error.value = res.message || '导入失败';
    }
  } catch (e) {
    loading.value = false;
    error.value = e.response?.data?.message || e.message || '导入失败';
    ElMessage.error(error.value);
    setTimeout(() => router.push('/exams'), 2500);
  }
});
</script>
