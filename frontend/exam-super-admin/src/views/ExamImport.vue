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
import request from '../api/request';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const statusText = ref('正在导入试卷并创建考试...');
const error = ref('');
const success = ref('');

onMounted(async () => {
  const paperId = route.query.paperId ? parseInt(route.query.paperId, 10) : null;
  const enterpriseId = route.query.enterpriseId ? parseInt(route.query.enterpriseId, 10) : null;
  
  if (!paperId) {
    loading.value = false;
    error.value = '缺少试卷ID';
    setTimeout(() => router.push('/exams'), 2000);
    return;
  }
  
  // 如果没有企业ID，获取第一个已审核的企业
  let finalEnterpriseId = enterpriseId;
  if (!finalEnterpriseId) {
    try {
      const entRes = await request.get('/enterprises');
      const approvedEnts = (entRes.data || []).filter(e => e.status === 'approved');
      if (approvedEnts.length > 0) {
        finalEnterpriseId = approvedEnts[0].id;
      } else {
        loading.value = false;
        error.value = '没有已审核的企业，请先创建企业';
        setTimeout(() => router.push('/enterprises'), 2000);
        return;
      }
    } catch (e) {
      loading.value = false;
      error.value = '获取企业列表失败';
      setTimeout(() => router.push('/exams'), 2000);
      return;
    }
  }
  
  try {
    const res = await importExamFromPaper(paperId, undefined, finalEnterpriseId);
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
