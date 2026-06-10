<template>
  <div>
    <el-page-header @back="$router.back()" :title="examName" />
    <div v-if="batchName" class="block-mb">
      <el-tag type="info" size="small">批次：{{ batchName }}</el-tag>
    </div>
    <el-alert
      v-if="examPublishHint"
      type="warning"
      :closable="false"
      show-icon
      class="block-mb"
    >
      {{ examPublishHint }}
    </el-alert>
    <div class="toolbar">
      <h3>考生管理</h3>
      <div class="toolbar-actions">
        <el-button v-if="isInterviewExam" type="primary" @click="$router.push({ path: `/exams/${examId}/draw-checkin`, query: $route.query })">抽签系统</el-button>
        <el-tag v-if="!isInterviewExam" type="info" size="small">仅面试考试显示抽签系统</el-tag>
        <el-button @click="downloadTemplate">下载导入模板</el-button>
        <el-button type="primary" @click="showImport = true">导入考生</el-button>
        <el-button type="primary" @click="showAdd = true">添加考生</el-button>
      </div>
    </div>
    <el-table :data="list" stripe>
      <el-table-column prop="draw_number" label="抽签号" width="80" align="center" sortable />
      <el-table-column prop="username" label="用户名" width="120" />
      <el-table-column prop="real_name" label="姓名" width="100" />
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column prop="exam_number" label="准考证号" width="120" />
      <el-table-column prop="position" label="岗位" width="120" />
      <el-table-column label="身份证照" width="260">
        <template #default="{ row }">
          <template v-if="row.id_card_image_path">
            <el-tag type="success" size="small" class="id-card-tag-click" role="button" tabindex="0" @click="openIdCardPreview(row)" @keydown.enter.prevent="openIdCardPreview(row)">已上传 · 点此查看</el-tag>
            <span class="id-card-tip">（登录时需扫脸实名认证）</span>
            <div class="id-card-actions">
              <el-button link type="primary" size="small" @click="openIdCardPreview(row)">查看</el-button>
              <el-button link type="primary" size="small" @click="openIdCardUpload(row)">更换</el-button>
            </div>
          </template>
          <el-button v-else link type="primary" size="small" @click="openIdCardUpload(row)">上传</el-button>
        </template>
      </el-table-column>
      <el-table-column label="签到状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.check_in_at ? 'success' : 'info'" size="small">
            {{ row.check_in_at ? '已签到' : '未签到' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="签到时间" width="160">
        <template #default="{ row }">
          {{ row.check_in_at ? formatDateTime(row.check_in_at) : '—' }}
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="row.status === 'submitted' ? 'success' : 'info'">
            {{ { invited: '已邀请', confirmed: '已确认', started: '进行中', submitted: '已交卷', absent: '缺考' }[row.status] || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="invite_code" label="邀请码" width="180" />
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="remove(row)">移除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showAdd" title="添加考生" width="500px">
      <el-select v-model="selectedUsers" multiple filterable placeholder="搜索并选择用户" style="width:100%" :loading="searching">
        <el-option v-for="u in userOptions" :key="u.id" :label="`${u.username} (${u.real_name || '-'})`" :value="u.id" />
      </el-select>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="addUsers">添加</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="showImport" title="导入考生" width="500px">
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :on-change="onFileChange"
        :file-list="importFileList"
      >
        <el-button type="primary">选择 Excel 文件</el-button>
      </el-upload>
      <p class="import-tip">请使用标准模板填写，必填：姓名；建议填写：准考证号、身份证号、电话、岗位等。同一考生（手机号/身份证等一致）只计一人，重复行不会重复添加。</p>
      <p class="import-tip login-tip">考生端登录：用户名为手机号（或准考证号），密码为身份证后 6 位，未填身份证则为 123456。</p>
      <template #footer>
        <el-button @click="showImport = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="!importFile" @click="doImport">导入</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="showIdCardUpload" :title="idCardUploadTitle" width="400px">
      <el-upload
        :auto-upload="false"
        :limit="1"
        accept="image/*"
        :on-change="onIdCardFileChange"
        :file-list="idCardFileList"
      >
        <el-button type="primary">选择身份证照片</el-button>
      </el-upload>
      <template #footer>
        <el-button @click="showIdCardUpload = false">取消</el-button>
        <el-button type="primary" :loading="idCardUploading" :disabled="!idCardFile" @click="submitIdCardUpload">上传</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showIdCardPreview" :title="idCardPreviewTitle" width="min(520px, 92vw)" destroy-on-close @closed="onIdCardPreviewClosed">
      <div v-if="idCardPreviewLoading" class="id-card-preview-loading text-gray-500">加载中…</div>
      <div v-else-if="idCardPreviewLoadError" class="id-card-preview-error">{{ idCardPreviewLoadError }}</div>
      <div v-else-if="idCardPreviewUrl" class="id-card-preview-wrap">
        <img :src="idCardPreviewUrl" alt="身份证照" class="id-card-preview-img" @error="onIdCardPreviewImgError" />
      </div>
      <template #footer>
        <el-button type="primary" @click="showIdCardPreview = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listEnrollments, bulkAddEnrollments, removeEnrollment, downloadCandidateTemplate, importCandidates, runDraw } from '../api/enrollments';
import { searchUsers, uploadIdCardImage, fetchIdCardImageBlobUrl } from '../api/users';
import { getExam } from '../api/exams';

const route = useRoute();
const examId = ref(route.params.id);
const examName = ref('');
const examRef = ref(null);
const isInterviewExam = computed(() => {
  const t = examRef.value?.exam_type || examRef.value?.examType || route.query.examType;
  return t === 'interview';
});
const batchName = ref(route.query.batch_name || '');

/** 考试仍为草稿/未发布时：列表可显示「已邀请」，但考生端入口可能未完全开放 */
const examPublishHint = computed(() => {
  const s = examRef.value?.status;
  if (!s || s === 'published' || s === 'ongoing') return '';
  const label =
    { draft: '草稿', ended: '已结束', cancelled: '已取消' }[s] || s;
  return `当前考试状态为「${label}」。列表中的「已邀请」仅表示已加入考生名单；求职者个人中心的专业测评入口、邀请通知，需在「考试列表」中将本场考试发布（状态变为已发布）后才会出现。`;
});

watch(() => route.query.batch_name, (name) => {
  batchName.value = name || '';
}, { immediate: true });

const list = ref([]);
const drawing = ref(false);

/** 兼容拦截器返回形态，避免 examRef 为空导致「考生入口」绿框不显示 */
function pickExamPayload(res) {
  if (!res) return null;
  if (res.data != null && typeof res.data === 'object' && !Array.isArray(res.data)) return res.data;
  if (res.id != null || res.name != null) return res;
  return null;
}

watch(() => route.params.id, (newId) => {
  if (newId && newId !== examId.value) {
    examId.value = newId;
    getExam(newId).then((res) => {
      const exam = pickExamPayload(res);
      examRef.value = exam;
      examName.value = exam?.name || '考试';
    });
    load();
  }
});
const showAdd = ref(false);
const showImport = ref(false);
const selectedUsers = ref([]);
const userOptions = ref([]);
const searching = ref(false);
const adding = ref(false);
const importing = ref(false);
const importFile = ref(null);
const importFileList = ref([]);
const showIdCardUpload = ref(false);
const idCardUploadTitle = ref('上传身份证照片');
const idCardUploadUserId = ref(null);
const idCardFile = ref(null);
const idCardFileList = ref([]);
const idCardUploading = ref(false);
const showIdCardPreview = ref(false);
const idCardPreviewTitle = ref('查看身份证照');
const idCardPreviewUrl = ref('');
const idCardPreviewLoadError = ref('');
const idCardPreviewLoading = ref(false);
let idCardPreviewBlobUrl = null;
let searchTimer = null;

onMounted(async () => {
  const res = await getExam(examId.value);
  const exam = pickExamPayload(res);
  examRef.value = exam;
  examName.value = exam?.name || '考试';
  load();
});

async function doDraw() {
  drawing.value = true;
  try {
    const res = await runDraw(examId.value);
    ElMessage.success(res.message || '抽签完成');
    load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '抽签失败');
  } finally {
    drawing.value = false;
  }
}

function formatDateTime(v) {
  if (!v) return '';
  try {
    const d = typeof v === 'string' ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return String(v);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(v);
  }
}

function printDrawTable() {
  const rows = [...list.value].sort((a, b) => {
    const na = a.draw_number != null ? Number(a.draw_number) : 9999;
    const nb = b.draw_number != null ? Number(b.draw_number) : 9999;
    return na - nb;
  });
  const printContent = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>抽签表 - ${examName.value}</title>
    <style>body{font-family:Microsoft YaHei,sans-serif;padding:20px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #333;padding:8px;text-align:left;} th{background:#f0f0f0;}</style>
    </head><body>
    <h2>${examName.value} - 抽签表</h2>
    <p>打印时间：${formatDateTime(new Date())}</p>
    <table><thead><tr><th>抽签号</th><th>姓名</th><th>岗位</th><th>签到状态</th><th>签到时间</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.draw_number ?? '—'}</td><td>${r.real_name || r.username || '—'}</td><td>${r.position || '—'}</td><td>${r.check_in_at ? '已签到' : '未签到'}</td><td>${r.check_in_at ? formatDateTime(r.check_in_at) : '—'}</td></tr>`).join('')}
    </tbody></table></body></html>`;
  const w = window.open('', '_blank');
  w.document.write(printContent);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}

watch(showAdd, (v) => {
  if (v) searchUsersDebounced('');
});

async function load() {
  const res = await listEnrollments(examId.value);
  const raw = res?.data;
  list.value = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []) || [];
}

async function searchUsersDebounced(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    searching.value = true;
    try {
      const res = await searchUsers(q);
      userOptions.value = res.data || [];
    } finally {
      searching.value = false;
    }
  }, 300);
}

async function addUsers() {
  if (selectedUsers.value.length === 0) {
    ElMessage.warning('请选择用户');
    return;
  }
  const existingIds = new Set(list.value.map(e => e.user_id));
  const toAdd = selectedUsers.value.filter(id => !existingIds.has(id));
  if (toAdd.length === 0) {
    ElMessage.warning('所选用户已在考生列表中');
    return;
  }
  adding.value = true;
  try {
    await bulkAddEnrollments(examId.value, toAdd);
    ElMessage.success('添加成功');
    showAdd.value = false;
    selectedUsers.value = [];
    load();
  } catch (e) {
    ElMessage.error('添加失败');
  } finally {
    adding.value = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm('确定移除该考生？', '提示', { type: 'warning' });
    await removeEnrollment(row.id);
    ElMessage.success('移除成功');
    load();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('移除失败');
  }
}

async function downloadTemplate() {
  try {
    await downloadCandidateTemplate();
    ElMessage.success('模板已下载');
  } catch (e) {
    ElMessage.error(e.message || '下载失败');
  }
}

function onFileChange(file) {
  importFile.value = file.raw;
  importFileList.value = [file];
}

async function doImport() {
  if (!importFile.value) return;
  importing.value = true;
  try {
    const res = await importCandidates(examId.value, importFile.value);
    const d = res?.data || res || {};
    const u = d.unique ?? d.total;
    ElMessage.success(`导入完成：成功解析 ${d.total || 0} 行，共 ${u} 名考生，新增报名 ${d.added || 0} 人${d.failed > 0 ? `，失败 ${d.failed} 人` : ''}`);
    showImport.value = false;
    importFile.value = null;
    importFileList.value = [];
    await load();
    setTimeout(() => load(), 300);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.error || e.message || '导入失败';
    ElMessage.error(msg);
  } finally {
    importing.value = false;
  }
}

function revokeIdCardPreviewBlob() {
  if (idCardPreviewBlobUrl) {
    URL.revokeObjectURL(idCardPreviewBlobUrl);
    idCardPreviewBlobUrl = null;
  }
}

function onIdCardPreviewClosed() {
  revokeIdCardPreviewBlob();
  idCardPreviewUrl.value = '';
  idCardPreviewLoadError.value = '';
  idCardPreviewLoading.value = false;
}

async function openIdCardPreview(row) {
  const raw = row.id_card_image_path;
  if (!raw) return;
  const s = String(raw).trim();
  if (s.toLowerCase().startsWith('blob:')) {
    ElMessage.warning('该记录为临时链接，已失效。请让考生重新上传或使用「更换」上传身份证照。');
    return;
  }
  revokeIdCardPreviewBlob();
  idCardPreviewTitle.value = `查看身份证照 - ${row.real_name || row.username || ''}`;
  idCardPreviewLoadError.value = '';
  idCardPreviewUrl.value = '';
  idCardPreviewLoading.value = true;
  showIdCardPreview.value = true;
  try {
    if (s.startsWith('data:')) {
      idCardPreviewUrl.value = s;
      return;
    }
    if (/^https?:\/\//i.test(s)) {
      idCardPreviewUrl.value = s;
      return;
    }
    idCardPreviewBlobUrl = await fetchIdCardImageBlobUrl(row.user_id);
    idCardPreviewUrl.value = idCardPreviewBlobUrl;
  } catch (e) {
    idCardPreviewLoadError.value = e.message || '加载失败';
  } finally {
    idCardPreviewLoading.value = false;
  }
}

function onIdCardPreviewImgError() {
  idCardPreviewLoadError.value = '图片无法显示。外链可能被拦截；服务器文件请点「更换」重新上传。';
  idCardPreviewUrl.value = '';
}

function openIdCardUpload(row) {
  idCardUploadUserId.value = row.user_id;
  idCardUploadTitle.value = `上传身份证照片 - ${row.real_name || row.username}`;
  idCardFile.value = null;
  idCardFileList.value = [];
  showIdCardUpload.value = true;
}

function onIdCardFileChange(file) {
  idCardFile.value = file?.raw;
  idCardFileList.value = file ? [file] : [];
}

async function submitIdCardUpload() {
  if (!idCardFile.value || !idCardUploadUserId.value) return;
  idCardUploading.value = true;
  try {
    await uploadIdCardImage(idCardUploadUserId.value, idCardFile.value);
    ElMessage.success('上传成功，该考生登录时需完成人脸核验');
    showIdCardUpload.value = false;
    load();
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '上传失败';
    ElMessage.error(msg);
  } finally {
    idCardUploading.value = false;
  }
}
</script>

<style scoped>
.block-mb { margin-bottom: 12px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin: 16px 0; flex-wrap: wrap; gap: 8px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.import-tip { font-size: 12px; color: #909399; margin-top: 12px; }
.import-tip.login-tip { margin-top: 4px; }
.id-card-tip { display: block; font-size: 12px; color: #909399; margin-top: 2px; }
.id-card-tag-click { cursor: pointer; user-select: none; }
.id-card-actions { margin-top: 4px; }
.id-card-preview-wrap { text-align: center; }
.id-card-preview-img { max-width: 100%; max-height: 70vh; object-fit: contain; vertical-align: top; }
.id-card-preview-error { color: var(--el-color-danger); font-size: 13px; line-height: 1.5; }
.id-card-preview-loading { padding: 24px; text-align: center; }
</style>
