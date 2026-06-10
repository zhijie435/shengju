<template>
  <div>
    <div class="toolbar">
      <h2>考试总览</h2>
      <div class="toolbar-actions">
        <el-button type="primary" @click="$router.push('/exams/create')">新建考试</el-button>
        <el-button @click="$router.push('/grading-system/accounts')">系统子账号</el-button>
      </div>
    </div>
    <el-table :data="list" stripe>
      <el-table-column prop="name" label="考试名称" />
      <el-table-column
        label="考试类型"
        width="100"
      >
        <template #default="{ row }">
          {{ (row.exam_type || row.examType) === 'interview' ? '面试' : '笔试' }}
        </template>
      </el-table-column>
      <el-table-column prop="enterprise_name" label="企业" width="180" />
      <el-table-column prop="paper_name" label="试卷" width="160" />
      <el-table-column prop="start_time" label="开始时间" width="180" />
      <el-table-column prop="end_time" label="结束时间" width="180" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="600" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'draft'" link type="success" size="small" @click="publishExam(row)">发布</el-button>
          <el-button v-if="row.status === 'published'" link type="warning" size="small" @click="startExam(row)">开启考试</el-button>
          <el-button v-if="row.status === 'ongoing'" link type="danger" size="small" @click="endExam(row)">结束考试</el-button>
          <el-button link type="primary" size="small" @click="$router.push((row.exam_type || row.examType) === 'interview' ? `/exams/${row.id}/interview-answer-preview` : `/exams/${row.id}/answer-preview`)">答题预览</el-button>
          <el-button link type="primary" size="small" @click="$router.push({ path: `/exams/${row.id}/enrollments`, query: { examType: row.exam_type || row.examType || '' } })">考生管理</el-button>
          <el-button link type="primary" size="small" @click="$router.push(`/exams/${row.id}/monitor`)">监控</el-button>
          <el-button
            link
            type="primary"
            size="small"
            @click="$router.push((row.exam_type || row.examType) === 'interview' ? `/exams/${row.id}/interview-settings` : `/exams/${row.id}/edit`)"
          >
            {{ (row.exam_type || row.examType) === 'interview' ? '面试考试设置' : '编辑' }}
          </el-button>
          <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listExams, deleteExam, gradeExam, updateExam, getInterviewSettingsComplete } from '../api/exams';

const list = ref([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

async function load(retried) {
  try {
    const res = await listExams({ page: page.value, pageSize: pageSize.value });
    list.value = res.data?.list || [];
    total.value = res.data?.total || 0;
  } catch (e) {
    ElMessage.error('加载失败');
  }
}

function statusType(s) {
  const map = { draft: 'info', published: 'success', ongoing: 'warning', ended: 'info', cancelled: 'danger' };
  return map[s] || 'info';
}

function statusText(s) {
  const map = { draft: '草稿', published: '已发布', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
  return map[s] || s;
}

async function gradeExamRow(row) {
  try {
    await ElMessageBox.confirm('将对已交卷的答卷进行客观题自动阅卷（选择题、判断题、多选题），需确保试卷小题已设置标准答案。是否继续？', '开始阅卷', { type: 'info' });
    const res = await gradeExam(row.id);
    const results = res.data?.results || [];
    const ok = results.filter(r => !r.error).length;
    const err = results.filter(r => r.error).length;
    ElMessage.success(`阅卷完成：${ok} 份成功${err > 0 ? `，${err} 份失败` : ''}`);
    load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '阅卷失败');
  }
}

async function publishExam(row) {
  try {
    await ElMessageBox.confirm('确定发布该考试？发布后考生可查看考试信息。', '发布考试', { type: 'info' });
    await updateExam(row.id, { status: 'published' });
    ElMessage.success('发布成功');
    load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e?.response?.data?.message || '发布失败');
  }
}

async function startExam(row) {
  try {
    const isInterview = (row.exam_type || row.examType) === 'interview';
    if (isInterview) {
      const res = await getInterviewSettingsComplete(row.id);
      const data = res.data != null ? res.data : res;
      if (!data.complete) {
        ElMessage.warning(data.message || '请先完成面试考试设置（评分表、考官、计时计分工作人员）后再开启考试');
        return;
      }
    }
    await ElMessageBox.confirm('确定开启该考试？开启后考生可进入答题。', '开启考试', { type: 'warning' });
    await updateExam(row.id, { status: 'ongoing' });
    ElMessage.success('考试已开启');
    load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e?.response?.data?.message || '操作失败');
  }
}

async function endExam(row) {
  try {
    await ElMessageBox.confirm('确定结束该考试？结束后考生将无法继续答题。', '结束考试', { type: 'warning' });
    await updateExam(row.id, { status: 'ended' });
    ElMessage.success('考试已结束');
    load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e?.response?.data?.message || '操作失败');
  }
}

async function del(row) {
  try {
    await ElMessageBox.confirm('确定删除该考试？', '提示', { type: 'warning' });
    await deleteExam(row.id);
    ElMessage.success('删除成功');
    load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败');
  }
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar-actions { display: flex; gap: 8px; }
.el-pagination { margin-top: 16px; }
</style>
