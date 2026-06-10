<template>
  <div>
    <el-page-header @back="$router.back()" :title="examName" />
    <el-tabs v-model="activeTab">
      <el-tab-pane label="会话列表" name="sessions">
        <p class="session-list-hint">本列表已与<strong>当前报名名单</strong>对齐：只显示名单中仍存在的考生会话（一行一人，签号来自报名/抽签）。若人数与导入批次不一致，请到「报名/名单」核对是否曾单独加人、或是否删改过名单；已从名单移除的考生，其旧会话不再出现在此列表。</p>
        <el-table :data="sessions" stripe>
          <el-table-column label="签号" width="88" align="center">
            <template #default="{ row }">
              {{ row.draw_number != null && row.draw_number !== '' ? `${row.draw_number} 号` : '—' }}
            </template>
          </el-table-column>
          <el-table-column prop="username" label="登录账号" min-width="120" />
          <el-table-column prop="real_name" label="姓名" width="100" />
          <el-table-column prop="status" label="状态">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ongoing' ? 'success' : 'info'">
                {{ sessionStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="violation_count" label="违规次数" width="100" />
          <el-table-column prop="started_at" label="开始时间" width="180" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="违规事件" name="events">
        <el-table :data="events" stripe>
          <el-table-column prop="username" label="考生" width="120" />
          <el-table-column prop="event_type" label="事件类型" width="140">
            <template #default="{ row }">
              {{ eventTypeText(row.event_type) }}
            </template>
          </el-table-column>
          <el-table-column prop="occurred_at" label="时间" width="180" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="考生监控" name="monitor">
        <div class="monitor-toolbar">
          <el-pagination
            v-model:current-page="monitorPage"
            :page-size="pageSize"
            :total="sessions.length"
            layout="prev, pager, next, total"
            @current-change="monitorPage = $event"
          />
          <el-button size="small" @click="fetchLatestChunks">刷新画面</el-button>
          <el-button size="small" type="primary" :loading="archiveLoading" @click="exportArchive">导出监控存档</el-button>
        </div>
        <p v-if="!sessions.length" class="monitor-hint">暂无考生会话。考生进入考试后会出现于此。</p>
        <p v-else-if="!latestChunks.length" class="monitor-hint">考生进入考场并开启监控（主摄像头/屏幕监控/侧摄）后，画面将在此显示。请确保本场考试已开启「双摄像头」「屏幕监控」等防作弊项。</p>
        <p v-if="sessions.length" class="monitor-hint monitor-hint-live">
          说明：本页为<strong>视频分片监考</strong>（约每 6 秒上传一段 webm，考生授权麦克风后含环境声；缩略图静音自动播放，<strong>点击放大</strong>后可听声音）。可使用「导出监控存档」打包留存。提前录制的<strong>完整答题录像</strong>在考官端「提前录制录像回放」中查看。
        </p>
        <div class="monitor-grid">
          <div
            v-for="item in paginatedMonitorList"
            :key="item.session_id"
            class="monitor-card"
          >
            <div class="monitor-card-header">
              <span class="name">
                <template v-if="item.draw_number != null && item.draw_number !== ''">
                  <span class="draw-tag">{{ item.draw_number }} 号</span>
                </template>
                {{ item.real_name || item.username || '考生' }}
              </span>
              <el-tag v-if="isSessionInWaitingRoom(item.session_id)" type="warning" size="small">候考室</el-tag>
              <el-tag size="small" :type="getSessionStatusType(item.session_id)">
                {{ getSessionStatus(item.session_id) }}
              </el-tag>
            </div>
            <div class="monitor-card-body">
              <div class="video-cell" @click="openEnlarge(item, 'camera', item.camera)">
                <span class="label">正面</span>
                <template v-if="item.camera?.file_path">
                  <img v-if="isImageChunk(item.camera)" :key="'camera-'+item.session_id+'-'+(item.camera?.id||0)" :src="chunkUrl(item.camera)" class="monitor-media clickable" alt="正面" />
                  <video v-else :key="'camera-'+chunkMediaKey(item.camera)" :src="chunkUrl(item.camera)" muted playsinline autoplay loop class="monitor-media clickable" />
                </template>
                <div v-else class="no-video">暂无</div>
              </div>
              <div class="video-cell" @click="openEnlarge(item, 'side_camera', item.side_camera)">
                <span class="label">侧面</span>
                <template v-if="item.side_camera?.file_path">
                  <img v-if="isImageChunk(item.side_camera)" :key="'side-'+item.session_id+'-'+(item.side_camera?.id||0)" :src="chunkUrl(item.side_camera)" class="monitor-media clickable" alt="侧面" />
                  <video v-else :key="'side-'+chunkMediaKey(item.side_camera)" :src="chunkUrl(item.side_camera)" muted playsinline autoplay loop class="monitor-media clickable" />
                </template>
                <div v-else class="no-video">暂无</div>
              </div>
              <div class="video-cell" @click="openEnlarge(item, 'screen', item.screen)">
                <span class="label">屏幕</span>
                <template v-if="item.screen?.file_path">
                  <img v-if="isImageChunk(item.screen)" :key="'screen-'+item.session_id+'-'+(item.screen?.id||0)" :src="chunkUrl(item.screen)" class="monitor-media clickable" alt="屏幕" />
                  <video v-else :key="'screen-'+chunkMediaKey(item.screen)" :src="chunkUrl(item.screen)" muted playsinline autoplay loop class="monitor-media clickable" />
                </template>
                <div v-else class="no-video">暂无</div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="enlargeVisible" :title="enlargeTitle" width="90%" top="5vh" class="enlarge-dialog" @closed="onEnlargeClosed">
      <div v-if="enlargeChunk?.file_path" class="enlarge-content">
        <img v-if="isImageChunk(enlargeChunk)" :src="chunkUrl(enlargeChunk)" class="enlarge-media" alt="放大" />
        <video v-else :key="chunkMediaKey(enlargeChunk)" :src="chunkUrl(enlargeChunk)" muted playsinline autoplay controls loop class="enlarge-media" />
      </div>
      <div v-if="enlargeSessionId && !isImageChunk(enlargeChunk)" class="history-toolbar">
        <el-button size="small" :loading="historyLoading" @click="loadChunkHistory">加载历史片段</el-button>
      </div>
      <div v-if="chunkHistory.length" class="chunk-history-list">
        <div
          v-for="c in chunkHistory"
          :key="c.id"
          class="chunk-history-item"
          :class="{ active: enlargeChunk?.id === c.id }"
          @click="selectHistoryChunk(c)"
        >
          <span class="time">{{ formatChunkTime(c.created_at) }}</span>
          <span class="dur">{{ c.duration_seconds ? `${c.duration_seconds}s` : '' }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute } from 'vue-router';
import { getExam } from '../api/exams';
import { listSessions } from '../api/sessions';
import { listMonitorEvents, getLatestChunksByExam, downloadMonitorArchive, listVideoChunks } from '../api/monitor';

const route = useRoute();
const examId = ref(route.params.id);
const examName = ref('');
const activeTab = ref('sessions');
const sessions = ref([]);
const events = ref([]);
const latestChunks = ref([]);
const monitorPage = ref(1);
const pageSize = 10;
let pollTimer = null;
const enlargeVisible = ref(false);
const enlargeChunk = ref(null);
const enlargeTitle = ref('');
const enlargeSessionId = ref(null);
const enlargeChunkType = ref('');
const chunkHistory = ref([]);
const historyLoading = ref(false);
const archiveLoading = ref(false);
const chunkPollTick = ref(0);

const labelMap = { camera: '正面', side_camera: '侧面', screen: '屏幕' };

function sessionStatusText(st) {
  const map = {
    pending: '待开始',
    ongoing: '进行中',
    submitted: '已交卷',
    force_submitted: '已交卷(系统)',
    abnormal: '异常'
  };
  return map[st] || st || '—';
}

async function exportArchive() {
  archiveLoading.value = true;
  try {
    await downloadMonitorArchive(examId.value);
    ElMessage.success('监控存档已下载');
  } catch (e) {
    ElMessage.error(e.message || '导出失败');
  } finally {
    archiveLoading.value = false;
  }
}

function openEnlarge(item, type, chunk) {
  if (!chunk?.file_path) return;
  enlargeChunk.value = chunk;
  enlargeSessionId.value = item.session_id;
  enlargeChunkType.value = type;
  chunkHistory.value = [];
  const dn = item.draw_number != null && item.draw_number !== '' ? `${item.draw_number}号·` : '';
  enlargeTitle.value = `${dn}${item.real_name || item.username || '考生'} - ${labelMap[type] || type}`;
  enlargeVisible.value = true;
}

function onEnlargeClosed() {
  enlargeChunk.value = null;
  enlargeSessionId.value = null;
  enlargeChunkType.value = '';
  chunkHistory.value = [];
}

function selectHistoryChunk(c) {
  enlargeChunk.value = c;
}

async function loadChunkHistory() {
  if (!enlargeSessionId.value || !enlargeChunkType.value) return;
  historyLoading.value = true;
  try {
    const res = await listVideoChunks(enlargeSessionId.value);
    const rows = res.data || [];
    const typeKey = enlargeChunkType.value;
    chunkHistory.value = rows
      .filter((r) => (r.chunk_type || r.chunkType) === typeKey)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!chunkHistory.value.length) ElMessage.info('暂无更多历史片段');
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    historyLoading.value = false;
  }
}

function formatChunkTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function chunkMediaKey(c) {
  return `${c?.id || 0}-${chunkPollTick.value}`;
}

function eventTypeText(t) {
  const map = {
    tab_leave: '切屏',
    fullscreen_exit: '退出全屏',
    copy_attempt: '复制尝试',
    paste_attempt: '粘贴尝试',
    right_click: '右键',
    window_blur: '窗口失焦'
  };
  return map[t] || t;
}

function chunkUrl(c) {
  if (!c?.file_path) return '';
  const p = String(c.file_path).replace(/^\/+/, '').replace(/\\/g, '/');
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
  const url = base ? `${base}/${p}` : `/${p}`;
  const bust = c?.id != null ? `?v=${c.id}` : '';
  return `${url}${bust}`;
}
function isImageChunk(c) {
  if (!c?.file_path) return false;
  const lower = String(c.file_path).toLowerCase();
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp');
}

const sessionMap = computed(() => {
  const m = {};
  sessions.value.forEach(s => { m[s.id] = s; });
  return m;
});

function getSessionStatus(sessionId) {
  const s = sessionMap.value[sessionId];
  if (!s) return '-';
  return sessionStatusText(s.status);
}

function isSessionInWaitingRoom(sessionId) {
  const s = sessionMap.value[sessionId];
  return !!(s && s.status === 'pending' && s.interview_waiting_room_at);
}

function getSessionStatusType(sessionId) {
  const s = sessionMap.value[sessionId];
  if (!s) return 'info';
  return s.status === 'ongoing' ? 'success' : 'info';
}

const latestChunksMap = computed(() => {
  const m = {};
  latestChunks.value.forEach(item => { m[item.session_id] = item; });
  return m;
});

const paginatedMonitorList = computed(() => {
  const start = (monitorPage.value - 1) * pageSize;
  const pageSessions = sessions.value.slice(start, start + pageSize);
  return pageSessions.map(s => ({
    session_id: s.id,
    username: s.username,
    real_name: s.real_name,
    draw_number: s.draw_number,
    ...latestChunksMap.value[s.id]
  }));
});

async function fetchLatestChunks() {
  try {
    const res = await getLatestChunksByExam(examId.value);
    latestChunks.value = res.data || [];
    chunkPollTick.value += 1;
  } catch (e) {
    latestChunks.value = [];
  }
}

function startPolling() {
  pollTimer = setInterval(() => {
    if (activeTab.value === 'monitor') fetchLatestChunks();
  }, 6500);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function loadExamData() {
  const examRes = await getExam(examId.value);
  examName.value = examRes.data?.name || '考试监控';
  const [sessRes, evRes] = await Promise.all([
    listSessions(examId.value),
    listMonitorEvents(examId.value)
  ]);
  sessions.value = sessRes.data || [];
  events.value = evRes.data || [];
  await fetchLatestChunks();
}

watch(() => route.params.id, (newId) => {
  if (newId && newId !== examId.value) {
    examId.value = newId;
    loadExamData();
  }
});

onMounted(() => {
  loadExamData();
  startPolling();
});

onUnmounted(stopPolling);
</script>

<style scoped>
.session-list-hint { font-size: 12px; color: #909399; line-height: 1.5; margin: 0 0 12px; max-width: 960px; }
.monitor-card-header .draw-tag { display: inline-block; margin-right: 6px; padding: 0 6px; font-size: 12px; font-weight: 600; color: #409eff; background: #ecf5ff; border-radius: 4px; vertical-align: middle; }
.monitor-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.monitor-hint { font-size: 13px; color: #909399; margin-bottom: 16px; padding: 12px; background: #f5f7fa; border-radius: 6px; }
.monitor-hint-live { margin-top: -8px; }
.monitor-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.monitor-card { border: 1px solid #e4e7ed; border-radius: 8px; overflow: hidden; background: #fff; }
.monitor-card-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f5f7fa; }
.monitor-card-header .name { font-weight: 500; }
.monitor-card-body { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px; }
.video-cell { display: flex; flex-direction: column; align-items: center; }
.video-cell .label { font-size: 12px; color: #909399; margin-bottom: 4px; }
.monitor-media { width: 100%; aspect-ratio: 4/3; background: #000; object-fit: contain; border-radius: 4px; max-height: 120px; }
.monitor-media.clickable { cursor: pointer; }
.video-cell { cursor: pointer; }
.no-video { width: 100%; aspect-ratio: 4/3; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #909399; border-radius: 4px; max-height: 120px; }
.enlarge-dialog :deep(.el-dialog__body) { padding: 12px; max-height: 85vh; overflow: auto; }
.enlarge-content { display: flex; justify-content: center; align-items: center; min-height: 400px; }
.enlarge-media { max-width: 100%; max-height: 80vh; object-fit: contain; }
.history-toolbar { margin-top: 12px; }
.chunk-history-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; max-height: 160px; overflow-y: auto; }
.chunk-history-item { padding: 6px 10px; font-size: 12px; border: 1px solid #dcdfe6; border-radius: 4px; cursor: pointer; background: #fff; }
.chunk-history-item.active { border-color: #409eff; background: #ecf5ff; }
.chunk-history-item .dur { margin-left: 6px; color: #909399; }
</style>
