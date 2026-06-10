<template>
  <div>
    <div class="toolbar">
      <h2>考试列表</h2>
      <div class="toolbar-actions">
        <el-button type="primary" @click="goCreateOrSetupExam">{{ createExamButtonLabel }}</el-button>
        <el-button @click="router.push('/grading-system/accounts')">系统子账号</el-button>
      </div>
    </div>
    <el-alert
      v-if="list.length === 0 && total === 0"
      type="info"
      :closable="false"
      show-icon
      class="mb-16"
    >
      <template #title>暂无本企业考试</template>
      请点击「新建考试」创建，或联系总管理端将考试指定给本企业。
    </el-alert>
    <el-alert
      v-if="linkedBatchExamId"
      type="warning"
      :closable="false"
      show-icon
      class="mb-16"
    >
      <template #title>本测评批次已创建过考试</template>
      同一批次仅允许创建一场。请点击「继续设置考试」修改配置，或在下方列表中管理该场考试。
    </el-alert>
    <el-alert
      v-else-if="list.length > 0 || total > 0"
      type="info"
      :closable="false"
      show-icon
      class="mb-16"
    >
      <template #title>考生如何登录</template>
      请通知考生使用固定考生端地址 <code>{{ studentLoginHint }}</code>，手机号与导入名单一致；每场考试有独立「考场码」（全员相同），详见各场「考生管理」页说明。同一人多场考试登录后可在「我的考试」中分别进入。
    </el-alert>
    <el-table :data="list" stripe>
      <el-table-column prop="name" label="考试名称" min-width="140" />
      <el-table-column
        label="考试类型"
        width="100"
      >
        <template #default="{ row }">
          {{ (row.exam_type || row.examType) === 'interview' ? '面试' : '笔试' }}
        </template>
      </el-table-column>
      <el-table-column prop="paper_name" label="试卷" width="180" />
      <el-table-column label="开始时间" width="180">
        <template #default="{ row }">{{ formatExamTime(row.start_time) }}</template>
      </el-table-column>
      <el-table-column label="结束时间" width="180">
        <template #default="{ row }">{{ formatExamTime(row.end_time) }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="考场码" width="130">
        <template #default="{ row }">
          <span v-if="row.public_room_code" class="mono">{{ row.public_room_code }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="620" fixed="right">
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
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../api/request';
import { getEnterpriseMe } from '../api/enterprises';
import { listExams, deleteExam, gradeExam, updateExam, getExam } from '../api/exams';
import { getLinkedExamIdForBatch } from '../utils/batchExamMap';

const route = useRoute();
const router = useRouter();

const list = ref([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const myEnterpriseId = ref(null);

const studentLoginHint = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/exam-student/login`;
});

function resolveEnterpriseIdForBatch() {
  const fromMe = myEnterpriseId.value;
  if (fromMe != null && fromMe !== '') return fromMe;
  return route.query.enterprise_id ?? route.query.enterpriseId ?? null;
}

const activeBatchId = computed(() => {
  const bid = route.query.batch_id ?? route.query.batchId;
  return bid != null && String(bid).trim() !== '' ? String(bid).trim() : null;
});

const linkedBatchExamId = computed(() => {
  const bid = activeBatchId.value;
  const eid =
    myEnterpriseId.value ??
    route.query.enterprise_id ??
    route.query.enterpriseId ??
    null;
  if (!bid || eid == null || String(eid).trim() === '') return null;
  return getLinkedExamIdForBatch(eid, bid);
});

const createExamButtonLabel = computed(() =>
  linkedBatchExamId.value ? '继续设置考试' : '新建考试'
);

async function examSettingsPath(examId) {
  try {
    const res = await getExam(examId);
    const row = res.data || {};
    const isInterview = (row.exam_type || row.examType) === 'interview';
    return isInterview ? `/exams/${examId}/interview-settings` : `/exams/${examId}/edit`;
  } catch {
    return `/exams/${examId}/edit`;
  }
}

async function goCreateOrSetupExam() {
  const linked = linkedBatchExamId.value;
  if (linked != null) {
    const path = await examSettingsPath(linked);
    await router.push({ path, query: { ...route.query } });
    return;
  }
  await router.push({ path: '/exams/create', query: { ...route.query } });
}

async function load(retried) {
  try {
    const params = { page: page.value, pageSize: pageSize.value };
    if (myEnterpriseId.value != null) params.enterpriseId = myEnterpriseId.value;
    const res = await listExams(params);
    list.value = res.data?.list || [];
    total.value = res.data?.total || 0;
  } catch (e) {
    if (!retried && e?.response?.status === 500) {
      try {
        await request.get('/exam-system/init');
        return load(true);
      } catch (initErr) {
        const initMsg = initErr?.response?.data?.message;
        if (initMsg) ElMessage.error(`表结构初始化失败：${initMsg}`);
      }
    }
    // axios 拦截器已对 HTTP 错误弹窗；此处仅在网络异常等无 response 时兜底
    if (!e?.response) ElMessage.error(e?.message || '加载失败');
  }
}

function formatExamTime(val) {
  if (val == null || val === '') return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
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

onMounted(async () => {
  try {
    const me = await getEnterpriseMe();
    if (me?.data?.id != null) myEnterpriseId.value = me.data.id;
  } catch (_) {}
  load();
});
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar-actions { display: flex; gap: 8px; }
.el-pagination { margin-top: 16px; }
.mb-16 { margin-bottom: 16px; }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.muted { color: #909399; font-size: 12px; }
</style>
