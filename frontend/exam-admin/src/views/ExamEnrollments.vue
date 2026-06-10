<template>
  <div>
    <el-page-header @back="$router.back()" :title="examName" />
    <div v-if="batchName" class="mb-3 text-sm text-gray-600">
      <el-tag type="info" size="small">批次：{{ batchName }}</el-tag>
    </div>
    <el-alert
      v-if="examPublishHint"
      type="warning"
      :closable="false"
      show-icon
      class="mb-3"
    >
      {{ examPublishHint }}
    </el-alert>
    <el-alert type="info" :closable="false" show-icon class="mb-3 enrollment-identity-hint">
      <strong>登录说明：</strong>考生身份以<strong>姓名 + 手机号</strong>为准，与抽签号无关；<strong>准考证号可随时调整</strong>，不会再用考号当登录名。登录可用：人才网用户名、手机号，或当前准考证号 + 密码（身份证后6位）。请为每位考生填写不同手机号；可选填「用户名」列绑定人才网登录名，不填则默认用手机号。
    </el-alert>
    <div class="toolbar">
      <h3>考生管理</h3>
      <div class="toolbar-actions">
        <template v-if="isInterviewExam">
          <el-button type="primary" @click="$router.push({ path: `/exams/${examId}/draw-checkin`, query: $route.query })">抽签系统</el-button>
          <el-button type="success" @click="$router.push({ path: `/exams/${examId}/interview-score-summary`, query: $route.query })">面试成绩汇总</el-button>
        </template>
        <el-button @click="downloadTemplate">下载导入模板</el-button>
        <el-button type="primary" @click="showImport = true">导入考生</el-button>
        <el-button type="primary" @click="showAdd = true">添加考生</el-button>
        <el-button type="primary" @click="openBatchImport">按批次从企业导入</el-button>
        <el-button type="warning" plain @click="showAssignLogin = true">登录名绑到姓名</el-button>
        <el-button type="warning" :loading="repairing" @click="runRepairIdentities">校正账号绑定</el-button>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无考生数据，请导入或添加考生">
      <el-table-column v-if="isInterviewExam" prop="draw_number" label="抽签号" width="80" align="center" sortable />
      <el-table-column prop="username" label="用户名（登录）" width="128" show-overflow-tooltip />
      <el-table-column prop="real_name" label="姓名" width="100" />
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column prop="exam_number" label="准考证号" width="120" />
      <el-table-column prop="position" label="岗位" width="120" />
      <el-table-column prop="job_code" label="岗位代码" min-width="110" show-overflow-tooltip />
      <el-table-column prop="education" label="学历" width="100" />
      <el-table-column label="身份证照" width="132" align="center">
        <template #default="{ row }">
          <div v-if="hasIdCardForDisplay(row)" class="id-card-cell">
            <div
              v-if="idCardThumbSrc(row)"
              class="id-card-thumb-wrap"
              role="button"
              tabindex="0"
              title="点击查看大图"
              @click="openIdCardPreview(row)"
              @keydown.enter.prevent="openIdCardPreview(row)"
            >
              <img :src="idCardThumbSrc(row)" alt="" class="id-card-thumb" @error="onIdCardThumbError(row.user_id)" />
            </div>
            <div v-else-if="idCardThumbError[row.user_id]" class="id-card-thumb-fail text-xs text-gray-500">加载失败</div>
            <div v-else-if="idCardThumbNeedsFetch(row)" class="id-card-thumb-loading text-xs text-gray-400">加载中…</div>
            <div v-else class="text-xs text-gray-400">—</div>
            <div class="id-card-actions">
              <el-button link type="primary" size="small" @click="openIdCardPreview(row)">查看</el-button>
              <el-button link type="primary" size="small" @click="openIdCardUpload(row)">更换</el-button>
            </div>
          </div>
          <el-button v-else link type="primary" size="small" @click="openIdCardUpload(row)">上传</el-button>
        </template>
      </el-table-column>
      <el-table-column v-if="isInterviewExam" label="签到状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.check_in_at ? 'success' : 'info'" size="small">
            {{ row.check_in_at ? '已签到' : '未签到' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="isInterviewExam" label="签到时间" width="160">
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
      <el-table-column prop="invite_code" label="个人邀码（备查）" width="160" />
      <el-table-column label="操作" width="168">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openRebindLogin(row)">改登录名</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">移除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showAssignLogin" title="登录名绑到指定姓名" width="460px" @closed="assignForm.loginUsername = ''; assignForm.realName = ''">
      <p class="rebind-hint">用于修正「gaoyajun 签到显示小羊」：系统按<strong>登录账号对应的报名行</strong>显示姓名，与抽签号无关。</p>
      <el-form label-width="88px">
        <el-form-item label="登录名">
          <el-input v-model="assignForm.loginUsername" placeholder="如 gaoyajun" clearable />
        </el-form-item>
        <el-form-item label="应对应姓名">
          <el-input v-model="assignForm.realName" placeholder="如 高亚军" clearable />
        </el-form-item>
      </el-form>
      <p class="rebind-hint-sub">若该登录名当前绑在其他人（如小羊）名下，会自动把小羊改绑到其准考证号登录名，再把 gaoyajun 绑给高亚军。</p>
      <template #footer>
        <el-button @click="showAssignLogin = false">取消</el-button>
        <el-button type="primary" :loading="assignLoading" @click="confirmAssignLogin">确定绑定</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="showRebind" title="改绑登录账号" width="440px" @closed="rebindRow = null">
      <p v-if="rebindRow" class="rebind-hint">
        考生：<strong>{{ rebindRow.real_name }}</strong>（当前登录名：{{ rebindRow.username || '—' }}）
      </p>
      <el-input v-model="rebindUsername" placeholder="目标登录名，如 gaoyajun 或 26050101002" clearable />
      <p class="rebind-hint-sub">仅改本场报名绑定的账号，不会修改抽签号。若目标名已被他人占用，请先把对方改绑到准考证号登录名。</p>
      <template #footer>
        <el-button @click="showRebind = false">取消</el-button>
        <el-button type="primary" :loading="rebindLoading" @click="confirmRebindLogin">确定</el-button>
      </template>
    </el-dialog>
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
      <p class="import-tip">请使用标准模板填写。必填：姓名；建议：用户名（登录账号）、准考证号、身份证号、电话（每人不同且与姓名对应）、岗位、岗位代码、学历。若手机号已被其他姓名占用，导入将失败并提示，避免张冠李戴。身份证照请在列表中「上传」，或由「按批次从企业导入」补全。</p>
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

    <el-dialog v-model="showBatchImport" title="按批次从企业导入考生" width="520px">
      <div v-if="batchOptions.length === 0" class="text-gray-500 text-sm space-y-2">
        <p>暂无待导入的批次数据。</p>
        <p>请按顺序操作：</p>
        <ol class="list-decimal pl-4 mt-1">
          <li>在<strong>人才网/企业端</strong>完成考试分配（考生写入库表 <code class="text-xs">sj_exam_imported_candidates</code>）；</li>
          <li>笔试后端 <code class="text-xs">.env</code> 配置 <code class="text-xs">SHENGJU_DB_NAME</code> 指向该表所在库（与主库合并时可与 <code class="text-xs">MAIN_DB_NAME</code> 相同）；</li>
          <li>在本页下拉中选择以 <strong>sj_</strong> 开头的批次 → 点「确认导入」；数字 ID 批次来自导入池，一般可忽略；</li>
          <li>若列表为空，检查后端日志与库表是否存在、服务是否已重启。</li>
        </ol>
      </div>
      <div v-else class="space-y-3">
        <el-select v-model="selectedBatchId" placeholder="请选择要导入的测评批次" style="width: 100%;">
          <el-option
            v-for="b in batchOptions"
            :key="b.id"
            :label="`${b.batchName || b.candidateBatchId}（${b.candidateCount || 0} 人，创建时间：${formatDateTime(b.createdAt)}）`"
            :value="b.id"
          />
        </el-select>
        <p class="text-xs text-gray-500">
          将从企业端同步到笔试系统导入池中的数据中，按所选批次导入对应考生到当前考试的考生列表。
        </p>
      </div>
      <template #footer>
        <el-button @click="showBatchImport = false">取消</el-button>
        <el-button type="danger" plain :loading="batchDeleting" :disabled="!selectedBatchId" @click="doDeleteBatch">删除该批次</el-button>
        <el-button type="primary" :loading="batchImporting" :disabled="!selectedBatchId" @click="doBatchImportFromEnterprise">
          确认导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listEnrollments,
  bulkAddEnrollments,
  removeEnrollment,
  rebindEnrollmentLogin,
  assignLoginToName,
  repairCandidateIdentities,
  downloadCandidateTemplate,
  importCandidates,
  runDraw
} from '../api/enrollments';
import { searchUsers, uploadIdCardImage, fetchIdCardImageBlobUrl, clearIdCardImagePath } from '../api/users';
import { getExam, listImportBatches, importFromBatch, deleteImportBatch } from '../api/exams';

const route = useRoute();
const examId = ref(route.params.id);
const examName = ref('');
const examRef = ref(null);
const isInterviewExam = computed(() => {
  const t = examRef.value?.exam_type || examRef.value?.examType || route.query.examType;
  return t === 'interview';
});
const batchName = ref(route.query.batch_name || '');
const drawing = ref(false);

/** 考试仍为草稿/未发布时：考生列表可显示「已邀请」，但求职者端不会出现专业测评入口与发布通知 */
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

/** 兼容拦截器只返回 body 或已解包为考试对象等情况，避免 examRef 为空导致「考生入口」绿框整段不显示 */
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
const list = ref([]);
const showAdd = ref(false);
const showRebind = ref(false);
const rebindRow = ref(null);
const rebindUsername = ref('');
const rebindLoading = ref(false);
const showAssignLogin = ref(false);
const assignLoading = ref(false);
const assignForm = reactive({ loginUsername: '', realName: '' });
const showImport = ref(false);
const selectedUsers = ref([]);
const userOptions = ref([]);
const searching = ref(false);
const adding = ref(false);
const importing = ref(false);
const repairing = ref(false);
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
/** revoke 用，勿与 data/http 直链混用 */
let idCardPreviewBlobUrl = null;
/** 列表缩略图：仅 revoke 本页通过 fetchIdCardImageBlobUrl 创建的 blob */
const idCardThumbUrls = reactive({});
const idCardThumbError = reactive({});
/** 库里有路径但文件不存在 / 外链失效，按未上传展示 */
const idCardThumbStale = reactive({});
const ownIdCardThumbBlobUserIds = new Set();
let searchTimer = null;
/** 合并并发的 load，避免短时间多次请求同一列表 */
let loadPromise = null;

const showBatchImport = ref(false);
const batchOptions = ref([]);
const selectedBatchId = ref('');
const batchImporting = ref(false);
const batchDeleting = ref(false);

/** 兼容拦截器返回的 { success, data } 与嵌套 data */
function normalizeImportBatchList(res) {
  if (!res) return [];
  const d = res.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  return [];
}

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
    <table><thead><tr><th>抽签号</th><th>姓名</th><th>岗位</th><th>岗位代码</th><th>签到状态</th><th>签到时间</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.draw_number ?? '—'}</td><td>${r.real_name || r.username || '—'}</td><td>${r.position || '—'}</td><td>${r.job_code || '—'}</td><td>${r.check_in_at ? '已签到' : '未签到'}</td><td>${r.check_in_at ? formatDateTime(r.check_in_at) : '—'}</td></tr>`).join('')}
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
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await listEnrollments(examId.value);
      // 兼容：拦截器返回 body { success, data }，列表在 data 中；确保始终赋值为数组
      const raw = res?.data;
      list.value = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []) || [];
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function revokeListIdCardThumbs() {
  for (const uid of ownIdCardThumbBlobUserIds) {
    const url = idCardThumbUrls[uid];
    if (url && String(url).startsWith('blob:')) URL.revokeObjectURL(url);
    delete idCardThumbUrls[uid];
    delete idCardThumbError[uid];
  }
  ownIdCardThumbBlobUserIds.clear();
  for (const key of Object.keys(idCardThumbStale)) delete idCardThumbStale[key];
}

function hasIdCardForDisplay(row) {
  const raw = row?.id_card_image_path;
  if (!raw || !String(raw).trim()) return false;
  const uid = row.user_id;
  if (uid != null && idCardThumbStale[uid]) return false;
  return true;
}

function isIdCardPathUnavailableMessage(msg) {
  const s = String(msg || '');
  return /404|未上传|文件不存在|已被清理|图片为空|路径无效/i.test(s);
}

async function markIdCardPathStale(row, message) {
  const uid = row?.user_id;
  if (uid == null) return;
  idCardThumbStale[uid] = true;
  delete idCardThumbUrls[uid];
  delete idCardThumbError[uid];
  row.id_card_image_path = '';
  if (!isIdCardPathUnavailableMessage(message)) return;
  try {
    await clearIdCardImagePath(uid);
  } catch {
    /* 清库失败仍按未上传展示 */
  }
}

function idCardThumbNeedsFetch(row) {
  const raw = row?.id_card_image_path;
  if (!raw) return false;
  const s = String(raw).trim();
  if (!s || s.toLowerCase().startsWith('blob:')) return false;
  return !/^https?:\/\//i.test(s) && !s.startsWith('data:');
}

function idCardThumbSrc(row) {
  const raw = row?.id_card_image_path;
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s || s.toLowerCase().startsWith('blob:')) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  return idCardThumbUrls[row.user_id] || '';
}

async function ensureIdCardThumb(row) {
  if (!idCardThumbNeedsFetch(row)) return;
  const uid = row.user_id;
  if (!uid || idCardThumbUrls[uid]) return;
  delete idCardThumbError[uid];
  try {
    const blobUrl = await fetchIdCardImageBlobUrl(uid);
    idCardThumbUrls[uid] = blobUrl;
    ownIdCardThumbBlobUserIds.add(uid);
  } catch (e) {
    const msg = e.message || '加载失败';
    if (isIdCardPathUnavailableMessage(msg)) {
      await markIdCardPathStale(row, msg);
    } else {
      idCardThumbError[uid] = msg;
    }
  }
}

function onIdCardThumbError(uid) {
  if (uid == null) return;
  const row = list.value.find((r) => r.user_id === uid);
  if (row) markIdCardPathStale(row, '显示失败');
  else idCardThumbError[uid] = '显示失败';
}

const enrollmentListFingerprint = computed(() =>
  (list.value || []).map((r) => [r.id, r.user_id, r.id_card_image_path || ''].join(':')).join('|')
);

watch(enrollmentListFingerprint, async () => {
  revokeListIdCardThumbs();
  await nextTick();
  for (const row of list.value) {
    if (row.id_card_image_path) ensureIdCardThumb(row);
  }
});

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

function openRebindLogin(row) {
  rebindRow.value = row;
  rebindUsername.value = '';
  showRebind.value = true;
}

async function confirmAssignLogin() {
  const loginUsername = String(assignForm.loginUsername || '').trim();
  const realName = String(assignForm.realName || '').trim();
  if (!loginUsername || !realName) {
    ElMessage.warning('请填写登录名与姓名');
    return;
  }
  assignLoading.value = true;
  try {
    const res = await assignLoginToName(examId.value, loginUsername, realName);
    const displaced = res.data?.displaced || [];
    let msg = res.message || '绑定成功';
    if (displaced.length) {
      msg += `；已将原占用者「${displaced.map((d) => d.name).join('、')}」改绑为 ${displaced.map((d) => d.newUsername).join('、')}`;
    }
    ElMessage.success(msg);
    showAssignLogin.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '绑定失败');
  } finally {
    assignLoading.value = false;
  }
}

async function confirmRebindLogin() {
  const row = rebindRow.value;
  const loginUsername = String(rebindUsername.value || '').trim();
  if (!row?.id || !loginUsername) {
    ElMessage.warning('请填写目标登录名');
    return;
  }
  rebindLoading.value = true;
  try {
    const res = await rebindEnrollmentLogin(row.id, loginUsername, true);
    ElMessage.success(res.message || '已改绑');
    showRebind.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '改绑失败');
  } finally {
    rebindLoading.value = false;
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

async function openBatchImport() {
  batchOptions.value = [];
  selectedBatchId.value = '';
  try {
    const res = await listImportBatches();
    batchOptions.value = normalizeImportBatchList(res);
    if (res.warning) {
      ElMessage.warning(res.warning);
    }
    const qBatchId = route.query.batch_id ? String(route.query.batch_id) : '';
    if (qBatchId && batchOptions.value.some(b => String(b.id) === qBatchId)) {
      selectedBatchId.value = qBatchId;
    } else {
      selectedBatchId.value = batchOptions.value[0]?.id ?? '';
    }
  } catch (e) {
    batchOptions.value = [];
    selectedBatchId.value = '';
    const msg = e?.response?.data?.message || e?.message || '加载待导入批次失败，请检查网络或重新登录';
    ElMessage.error(msg);
  }
  showBatchImport.value = true;
}

async function doBatchImportFromEnterprise() {
  if (!selectedBatchId.value) {
    ElMessage.warning('请选择测评批次');
    return;
  }
  batchImporting.value = true;
  try {
    const res = await importFromBatch(selectedBatchId.value, examId.value);
    const d = res.data || res.data?.data || {};
    const added = d.added ?? d.total ?? 0;
    const failed = d.failed ?? 0;
    ElMessage.success(`批次导入完成：成功 ${added} 人${failed > 0 ? `，失败 ${failed} 人` : ''}`);
    showBatchImport.value = false;
    await load();
    setTimeout(() => load(), 400);
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '导入失败，请稍后重试';
    ElMessage.error(msg);
  } finally {
    batchImporting.value = false;
  }
}

async function doDeleteBatch() {
  if (!selectedBatchId.value) return;
  try {
    await ElMessageBox.confirm('确定删除该导入批次？删除后不可恢复，不影响已导入到考试的考生。', '删除批次', { type: 'warning' });
  } catch {
    return;
  }
  batchDeleting.value = true;
  try {
    await deleteImportBatch(selectedBatchId.value);
    ElMessage.success('已删除该批次');
    const res = await listImportBatches();
    batchOptions.value = normalizeImportBatchList(res);
    selectedBatchId.value = batchOptions.value[0]?.id ?? '';
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '删除失败';
    ElMessage.error(msg);
  } finally {
    batchDeleting.value = false;
  }
}

function onFileChange(file) {
  importFile.value = file.raw;
  importFileList.value = [file];
}

async function runRepairIdentities() {
  try {
    await ElMessageBox.confirm(
      '将按「姓名 + 手机号」重新对齐本场每位考生的登录账号与准考证号（考号重新分配后使用）。不会删除考生，仅修正错绑。',
      '校正账号绑定',
      { type: 'warning', confirmButtonText: '开始校正', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  repairing.value = true;
  try {
    const res = await repairCandidateIdentities(examId.value);
    const d = res?.data || {};
    ElMessage.success(res?.message || `校正完成：已修复 ${d.fixed ?? 0} 条`);
    await load();
    setTimeout(() => load(), 300);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '校正失败');
  } finally {
    repairing.value = false;
  }
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
    // 再拉取一次，避免列表接口缓存或时序导致只显示部分数据
    setTimeout(() => load(), 300);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.error || e.message || '导入失败';
    ElMessage.error(msg);
  } finally {
    importing.value = false;
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

onUnmounted(() => {
  revokeListIdCardThumbs();
  revokeIdCardPreviewBlob();
});
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin: 16px 0; }
.toolbar-actions { display: flex; gap: 8px; }
.import-tip { font-size: 12px; color: #909399; margin-top: 12px; }
.import-tip.login-tip { margin-top: 4px; }
.rebind-hint { margin: 0 0 12px; font-size: 13px; color: #606266; }
.rebind-hint-sub { margin: 12px 0 0; font-size: 12px; color: #909399; line-height: 1.45; }
.id-card-tip { display: block; font-size: 12px; color: #909399; margin-top: 2px; }
.id-card-tag-click { cursor: pointer; user-select: none; }
.id-card-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0; }
.id-card-thumb-wrap {
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  line-height: 0;
}
.id-card-thumb {
  display: block;
  width: 72px;
  height: 48px;
  object-fit: cover;
  vertical-align: top;
}
.id-card-thumb-fail,
.id-card-thumb-loading { min-height: 48px; display: flex; align-items: center; justify-content: center; max-width: 100px; text-align: center; }
.id-card-actions { margin-top: 4px; }
.id-card-preview-wrap { text-align: center; }
.id-card-preview-img { max-width: 100%; max-height: 70vh; object-fit: contain; vertical-align: top; }
.id-card-preview-error { color: var(--el-color-danger); font-size: 13px; line-height: 1.5; }
.id-card-preview-loading { padding: 24px; text-align: center; }
</style>
