<template>
  <div class="draw-checkin-page">
    <el-page-header @back="goBack" :title="examName" />

    <!-- 一、签到与抽签参与范围 -->
    <section class="section">
      <h3>一、签到与抽签范围</h3>
      <p class="tip sub-tip">抽签不要求先签到；可在下列开关或批量操作中排除不参与抽签的人员。</p>
      <el-alert v-if="requireIdentityVerify" type="info" :closable="false" show-icon class="identity-tip">
        本场考试已开启身份验证。已上传身份证照的考生请在考生端进行人脸+身份证识别签到；也可由管理员在下方代为标记签到。
      </el-alert>
      <el-alert v-else type="info" :closable="false" show-icon class="identity-tip">
        已上传身份证照的考生建议在考生端进行人脸+身份证识别签到；或由管理员在下方代为标记签到。
      </el-alert>
      <div class="draw-toolbar">
        <el-button size="small" :loading="bulkExcludeLoading" @click="excludeUnsignedFromDraw">
          未签到：全部不参与抽签
        </el-button>
        <el-button size="small" plain :loading="bulkIncludeLoading" @click="includeAllInDraw">
          全部恢复参与抽签
        </el-button>
      </div>
      <el-table :data="list" stripe size="small">
        <el-table-column prop="real_name" label="姓名" width="100">
          <template #default="{ row }">{{ row.real_name || row.username || '—' }}</template>
        </el-table-column>
        <el-table-column prop="position" label="岗位" width="100" show-overflow-tooltip />
        <el-table-column label="身份证照" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.id_card_image_path" type="success" size="small">已上传</el-tag>
            <el-tag v-else type="info" size="small">未上传</el-tag>
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
          <template #default="{ row }">{{ row.check_in_at ? formatDateTime(row.check_in_at) : '—' }}</template>
        </el-table-column>
        <el-table-column label="参与抽签" width="120" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="!isExcludedFromDraw(row)"
              size="small"
              inline-prompt
              active-text="参与"
              inactive-text="排除"
              :disabled="excludeRowId === row.id"
              @change="(v) => onParticipateDrawChange(row, v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button
              v-if="!row.check_in_at"
              type="primary"
              link
              size="small"
              :loading="checkingIn === row.user_id"
              @click="markCheckIn(row)"
            >
              标记签到
            </el-button>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 二、抽签（按岗位滚动） -->
    <section class="section">
      <h3>二、滚动抽签（未排除的考生参与，按岗位一起滚动）</h3>
      <p class="tip">
        参与抽签人数：{{ eligibleDrawList.length }} 人（未标记「不参与」的报名）。点击「开始滚动抽签」后，再点击「停止并生成签号」完成抽签。
      </p>
      <div class="draw-roll-area">
        <div v-if="rollPhase === 'idle'" class="roll-idle">
          <el-button type="primary" :disabled="eligibleDrawList.length === 0" :loading="drawing" @click="startRollDraw">
            {{ hasDrawn ? '重新滚动抽签' : '开始滚动抽签' }}
          </el-button>
          <span v-if="eligibleDrawList.length === 0" class="text-muted">没有可参与抽签的考生，请取消排除或添加报名</span>
        </div>
        <div v-else class="roll-playing">
          <div class="roll-status">按岗位滚动中…</div>
          <div class="roll-number" :class="{ fixed: rollStopped }">{{ displayNumber }}</div>
          <el-button v-if="!rollStopped" type="primary" @click="stopAndGenerate">停止并生成签号</el-button>
          <template v-else>
            <span class="text-success">已生成签号</span>
            <el-button @click="rollPhase = 'idle'">完成</el-button>
          </template>
        </div>
      </div>
      <el-table :data="sortedList" stripe size="small" class="draw-table">
        <el-table-column prop="draw_number" label="抽签号" width="88" align="center" />
        <el-table-column prop="real_name" label="姓名" width="100">
          <template #default="{ row }">{{ row.real_name || row.username || '—' }}</template>
        </el-table-column>
        <el-table-column prop="position" label="岗位" width="120" show-overflow-tooltip />
        <el-table-column label="签到" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.check_in_at ? 'success' : 'info'" size="small">{{ row.check_in_at ? '已签' : '未签' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="抽签" width="88" align="center">
          <template #default="{ row }">
            <el-tag v-if="isExcludedFromDraw(row)" type="warning" size="small">不参与</el-tag>
            <el-tag v-else type="success" size="small">参与</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 提前录制：统一开考 -->
    <section v-if="isPrerecordMode" class="section">
      <h3>三、提前录制统一开考</h3>
      <p class="tip">考生抽签并签到后进入候考室；考务点击「立即开放答题」后（或定时策略自动/确认后），全体考生可同时开始正式答题与录像上传。</p>
      <div v-if="prerecordStatus" class="draw-call-area">
        <div class="draw-call-row">
          <span class="draw-call-label">闸门：</span>
          <strong>{{ prerecordStatus.gateOpenAt ? '已开放（' + formatDateTime(prerecordStatus.gateOpenAt) + '）' : '未开放' }}</strong>
          <el-tag v-if="prerecordStatus.confirmPending" type="warning" size="small" style="margin-left: 8px;">待确认开考</el-tag>
        </div>
        <div class="draw-call-row">
          <span class="draw-call-label">开考策略：</span>
          {{ prerecordStatus.prerecordStartPolicy || '—' }}
          <span v-if="prerecordStatus.prerecordScheduledStartAt" class="text-muted">（计划：{{ formatDateTime(prerecordStatus.prerecordScheduledStartAt) }}）</span>
        </div>
      </div>
      <div class="draw-toolbar" style="margin-top: 8px;">
        <el-button type="primary" :loading="prerecordGateLoading" @click="openPrerecordGate">立即开放答题</el-button>
        <el-button
          v-if="prerecordStatus && prerecordStatus.confirmPending"
          type="success"
          :loading="prerecordGateLoading"
          @click="confirmPrerecordGate"
        >
          确认开放答题（定时+确认）
        </el-button>
        <el-button size="small" @click="loadPrerecordStatus">刷新闸门状态</el-button>
      </div>
    </section>

    <!-- 三、考场叫号 -->
    <section v-if="sequentialEntryEnabled || isOnlineFlowMode" class="section">
      <h3>四、考场叫号</h3>
      <p class="tip">顺序入场时使用：下一位即退出当前考生、下一号进入考场、并通知再下一位准备。</p>
      <div class="draw-call-area">
        <div class="draw-call-row">
          <span class="draw-call-label">当前叫号：</span>
          <strong>{{ drawStatus.currentDrawNumber != null ? drawStatus.currentDrawNumber + ' 号' : '—' }}</strong>
        </div>
        <div class="draw-call-row">
          <span class="draw-call-label">下一位进入：</span>
          <span v-if="drawStatus.nextCandidate">{{ drawStatus.nextCandidate.drawNumber }} 号 {{ drawStatus.nextCandidate.realName || '' }}</span>
          <span v-else class="text-muted">—</span>
        </div>
        <div class="draw-call-row">
          <span class="draw-call-label">通知准备：</span>
          <span v-if="drawStatus.waitingCandidate">{{ drawStatus.waitingCandidate.drawNumber }} 号 {{ drawStatus.waitingCandidate.realName || '' }}</span>
          <span v-else class="text-muted">—</span>
        </div>
        <el-button type="primary" :loading="nextCandidateLoading" @click="doNextCandidate">
          下一位（退出当前考生，下一号进入，通知再下一位准备）
        </el-button>
      </div>
    </section>

    <!-- 五、打印 -->
    <section class="section">
      <h3>五、打印</h3>
      <div class="print-actions">
        <el-button type="primary" :disabled="!sortedList.length" @click="printDrawTable">打印抽签表</el-button>
        <el-button type="primary" plain :disabled="!sortedList.length" @click="printDrawCards">打印签号（每人一签，可裁剪）</el-button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  listEnrollments,
  runDraw as runDrawApi,
  setEnrollmentExcludeFromDraw,
  adminCheckIn,
  getCurrentDrawStatus,
  nextCandidateDraw
} from '../api/enrollments';
import { getExam } from '../api/exams';
import request from '../api/request';

const route = useRoute();
const router = useRouter();
const examId = ref(route.params.id);
const examName = ref('');
const examRef = ref(null);
const list = ref([]);
const drawing = ref(false);
const checkingIn = ref(null);
const excludeRowId = ref(null);
const bulkExcludeLoading = ref(false);
const bulkIncludeLoading = ref(false);
const rollPhase = ref('idle');
const rollStopped = ref(false);
const rollTimer = ref(null);
const displayNumber = ref(1);

const sequentialEntryEnabled = computed(() => {
  const asc = examRef.value?.answer_system_config || {};
  return !!(asc.interviewConfig && asc.interviewConfig.sequentialEntry);
});

const isOnlineFlowMode = computed(
  () => examRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode === 'online'
);

const isPrerecordMode = computed(
  () => examRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode === 'prerecord'
);

const prerecordStatus = ref(null);
const prerecordGateLoading = ref(false);
const drawStatus = ref({ currentDrawNumber: null, nextCandidate: null, waitingCandidate: null });
const nextCandidateLoading = ref(false);

const requireIdentityVerify = computed(() => {
  const asc = examRef.value?.answer_system_config || {};
  const ic = asc.interviewConfig || {};
  const mc = examRef.value?.monitor_config || {};
  return !!(ic.requireIdentityVerify || mc.faceVerifyEnabled);
});

function isExcludedFromDraw(row) {
  return Number(row.exclude_from_draw) === 1;
}

const eligibleDrawList = computed(() => list.value.filter((r) => !isExcludedFromDraw(r)));

const hasDrawn = computed(() => list.value.some((r) => r.draw_number != null && r.draw_number !== ''));

const sortedList = computed(() => {
  const arr = [...list.value];
  return arr.sort((a, b) => {
    const na = a.draw_number != null ? Number(a.draw_number) : 9999;
    const nb = b.draw_number != null ? Number(b.draw_number) : 9999;
    return na - nb;
  });
});

function goBack() {
  router.push({ path: `/exams/${examId.value}/enrollments`, query: route.query });
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

async function load() {
  const [examRes, listRes] = await Promise.all([
    getExam(examId.value),
    listEnrollments(examId.value)
  ]);
  examRef.value = examRes.data;
  examName.value = examRef.value?.name || '面试考试';
  list.value = listRes.data || [];
  if (rollTimer.value) {
    clearInterval(rollTimer.value);
    rollTimer.value = null;
  }
  if (sequentialEntryEnabled.value || isOnlineFlowMode.value) await loadDrawStatus();
  if (isPrerecordMode.value) await loadPrerecordStatus();
}

async function loadDrawStatus() {
  if (!examId.value) return;
  try {
    const res = await getCurrentDrawStatus(examId.value);
    const data = res?.data?.data ?? res?.data ?? {};
    drawStatus.value = {
      currentDrawNumber: data.currentDrawNumber ?? null,
      nextCandidate: data.nextCandidate ?? null,
      waitingCandidate: data.waitingCandidate ?? null
    };
  } catch (_) {
    drawStatus.value = { currentDrawNumber: null, nextCandidate: null, waitingCandidate: null };
  }
}

async function loadPrerecordStatus() {
  if (!examId.value || !isPrerecordMode.value) return;
  try {
    const res = await request.get(`/interview/interview-exams/${examId.value}/prerecord/status`);
    const data = res?.data?.data ?? res?.data ?? {};
    prerecordStatus.value = data;
  } catch (_) {
    prerecordStatus.value = null;
  }
}

async function openPrerecordGate() {
  if (!examId.value) return;
  prerecordGateLoading.value = true;
  try {
    await request.post(`/interview/interview-exams/${examId.value}/prerecord/open-gate`);
    ElMessage.success('已开放考生正式答题');
    await loadPrerecordStatus();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  } finally {
    prerecordGateLoading.value = false;
  }
}

async function confirmPrerecordGate() {
  if (!examId.value) return;
  prerecordGateLoading.value = true;
  try {
    await request.post(`/interview/interview-exams/${examId.value}/prerecord/confirm-scheduled`);
    ElMessage.success('已确认并开放答题');
    await loadPrerecordStatus();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  } finally {
    prerecordGateLoading.value = false;
  }
}

async function doNextCandidate() {
  nextCandidateLoading.value = true;
  try {
    const res = await nextCandidateDraw(examId.value);
    ElMessage.success(res?.data?.message || res?.data?.data?.message || '已叫下一位');
    await loadDrawStatus();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  } finally {
    nextCandidateLoading.value = false;
  }
}

async function markCheckIn(row) {
  checkingIn.value = row.user_id;
  try {
    await adminCheckIn(examId.value, row.user_id);
    ElMessage.success('已标记签到');
    await load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  } finally {
    checkingIn.value = null;
  }
}

async function onParticipateDrawChange(row, participate) {
  const excluded = !participate;
  excludeRowId.value = row.id;
  try {
    await setEnrollmentExcludeFromDraw(row.id, excluded);
    row.exclude_from_draw = excluded ? 1 : 0;
    ElMessage.success(excluded ? '已设为不参与抽签' : '已恢复参与抽签');
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  } finally {
    excludeRowId.value = null;
  }
}

async function excludeUnsignedFromDraw() {
  const targets = list.value.filter((r) => !r.check_in_at && !isExcludedFromDraw(r));
  if (!targets.length) {
    ElMessage.info('没有「未签到且仍参与抽签」的考生');
    return;
  }
  bulkExcludeLoading.value = true;
  try {
    await Promise.all(targets.map((r) => setEnrollmentExcludeFromDraw(r.id, true)));
    targets.forEach((r) => {
      r.exclude_from_draw = 1;
    });
    ElMessage.success(`已为 ${targets.length} 人标记不参与抽签`);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
    await load();
  } finally {
    bulkExcludeLoading.value = false;
  }
}

async function includeAllInDraw() {
  const targets = list.value.filter((r) => isExcludedFromDraw(r));
  if (!targets.length) {
    ElMessage.info('当前没有标记为不参与抽签的考生');
    return;
  }
  bulkIncludeLoading.value = true;
  try {
    await Promise.all(targets.map((r) => setEnrollmentExcludeFromDraw(r.id, false)));
    targets.forEach((r) => {
      r.exclude_from_draw = 0;
    });
    ElMessage.success('已全部恢复参与抽签');
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
    await load();
  } finally {
    bulkIncludeLoading.value = false;
  }
}

function startRollDraw() {
  rollPhase.value = 'rolling';
  rollStopped.value = false;
  const n = Math.max(1, eligibleDrawList.value.length);
  displayNumber.value = Math.floor(Math.random() * n) + 1;
  rollTimer.value = setInterval(() => {
    displayNumber.value = Math.floor(Math.random() * n) + 1;
  }, 100);
}

function stopAndGenerate() {
  if (rollTimer.value) {
    clearInterval(rollTimer.value);
    rollTimer.value = null;
  }
  rollStopped.value = true;
  drawing.value = true;
  runDrawApi(examId.value)
    .then(() => {
      ElMessage.success('签号已生成');
      load();
    })
    .catch((e) => {
      ElMessage.error(e.response?.data?.message || e.message || '抽签失败');
    })
    .finally(() => {
      drawing.value = false;
    });
}

function printDrawTable() {
  const rows = sortedList.value;
  const content = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>抽签表 - ${examName.value}</title>
    <style>body{font-family:Microsoft YaHei,sans-serif;padding:20px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #333;padding:8px;text-align:left;} th{background:#f0f0f0;}</style>
    </head><body>
    <h2>${examName.value} - 抽签表</h2>
    <p>打印时间：${formatDateTime(new Date())}</p>
    <table><thead><tr><th>抽签号</th><th>姓名</th><th>岗位</th><th>参与抽签</th><th>签到状态</th><th>签到时间</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r.draw_number ?? '—'}</td><td>${r.real_name || r.username || '—'}</td><td>${r.position || '—'}</td><td>${isExcludedFromDraw(r) ? '不参与' : '参与'}</td><td>${r.check_in_at ? '已签到' : '未签到'}</td><td>${r.check_in_at ? formatDateTime(r.check_in_at) : '—'}</td></tr>`).join('')}
    </tbody></table></body></html>`;
  const w = window.open('', '_blank');
  w.document.write(content);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}

function printDrawCards() {
  const rows = sortedList.value;
  const cards = rows.map((r) => `
    <div class="card">
      <div class="card-num">${r.draw_number ?? '—'}</div>
      <div class="card-label">签号</div>
      <div class="card-name">${(r.real_name || r.username || '—').replace(/</g, '&lt;')}</div>
      <div class="card-pos">${(r.position || '—').replace(/</g, '&lt;')}</div>
    </div>
  `).join('');
  const content = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>签号 - ${examName.value}</title>
    <style>
      body{font-family:Microsoft YaHei,sans-serif;padding:12px;}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
      .card{border:2px solid #333;padding:12px;text-align:center;min-height:80px;page-break-inside:avoid;}
      .card-num{font-size:28px;font-weight:bold;}
      .card-label{font-size:12px;color:#666;}
      .card-name{margin-top:6px;font-size:14px;}
      .card-pos{font-size:12px;color:#666;}
    </style>
    </head><body>
    <h2>${examName.value} - 签号</h2>
    <p style="font-size:12px;color:#666;">打印后按虚线裁剪分发</p>
    <div class="cards">${cards}</div>
    </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(content);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}

onMounted(() => {
  load();
});
</script>

<style scoped>
.draw-checkin-page { padding: 0 16px 24px; }
.identity-tip { margin: 12px 0; }
.draw-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.sub-tip { margin-top: -8px; margin-bottom: 8px; }
.section { margin-top: 24px; }
.section h3 { margin-bottom: 12px; font-size: 16px; color: #303133; }
.tip { font-size: 12px; color: #606266; margin-bottom: 12px; }
.draw-roll-area { margin-bottom: 16px; padding: 16px; background: #f5f7fa; border-radius: 8px; }
.roll-idle { display: flex; align-items: center; gap: 12px; }
.roll-playing { text-align: center; }
.roll-status { margin-bottom: 8px; font-size: 14px; color: #606266; }
.roll-number { font-size: 48px; font-weight: bold; padding: 16px; color: #409eff; }
.roll-number.fixed { color: #303133; }
.draw-table { margin-top: 12px; }
.print-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.text-muted { color: #909399; font-size: 12px; margin-left: 8px; }
.text-success { color: #67c23a; margin-right: 12px; }
.draw-call-area { padding: 12px; background: #f5f7fa; border-radius: 8px; margin-bottom: 12px; }
.draw-call-row { margin-bottom: 8px; font-size: 14px; }
.draw-call-label { color: #606266; margin-right: 8px; }
</style>
