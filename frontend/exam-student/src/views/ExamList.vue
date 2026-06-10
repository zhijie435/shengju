<template>
  <div class="exam-list-page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="top-alert"
    >
      <template #title>统一登录说明</template>
      请始终使用本站点<strong>考生登录页</strong>（见下方地址）与<strong>名单中一致的手机号</strong>登录；无需每人不同链接。同账号多场考试将显示多行，请分别点击「进入考试」。企业公布的<strong>单场考场码</strong>仅用于从登录页或邀请页快速进入该场。
      <div v-if="loginUrlHint" class="url-hint">登录地址：<code>{{ loginUrlHint }}</code></div>
    </el-alert>
    <header class="header">
      <span>我的考试</span>
      <div class="header-actions">
        <router-link to="/invitations" class="nav-link">专业测评</router-link>
        <el-button link type="danger" @click="logout">退出</el-button>
      </div>
    </header>
    <div class="content">
      <el-empty
        v-if="!list.length"
        description="暂无可参加的考试。请确认企业已将您加入考生名单、考试已发布，且本账号与导入时手机号一致；可使用企业公布的单场考场码在登录页填写后重试；个人邀请链接仍可作为备查。"
        :image-size="120"
      />
      <el-table v-else :data="list" stripe>
        <el-table-column prop="exam_name" label="考试名称" />
        <el-table-column v-if="hasAnyRoomCode" label="考场码" width="140">
          <template #default="{ row }">
            <span v-if="row.public_room_code" class="mono">{{ row.public_room_code }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
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
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <template v-if="canEnter(row)">
              <el-button type="primary" size="small" @click="enterExam(row)">进入考试</el-button>
            </template>
            <template v-else>
              <el-tooltip :content="cannotEnterReason(row)" placement="top">
                <el-button size="small" disabled>进入考试</el-button>
              </el-tooltip>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { getMyEnrollments, getSessionByPublicRoom } from '../api/exam';
import { getExamStudentToken } from '../utils/studentToken';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const list = ref([]);

const loginUrlHint = computed(() => {
  if (typeof window === 'undefined') return '';
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${window.location.origin}${base}/login`;
});

const hasAnyRoomCode = computed(() => list.value.some((r) => r.public_room_code));

async function tryEnterFromQueryRoom() {
  const room = route.query.room != null ? String(route.query.room).trim() : '';
  if (!room) return;
  try {
    const res = await getSessionByPublicRoom(room);
    if (res?.success && res.data?.session && res.data?.exam) {
      const exam = res.data.exam;
      router.push({
        name: 'ExamInstructions',
        params: { id: exam.id },
        query: {
          examName: exam.name,
          startTime: exam.startTime || exam.start_time,
          endTime: exam.endTime || exam.end_time
        }
      });
    }
  } catch (_) {
    /* 无考场码或不在名单：留在列表 */
  }
}

async function load() {
  if (!getExamStudentToken()) {
    router.replace('/login?redirect=' + encodeURIComponent(router.currentRoute.value.fullPath));
    return;
  }
  try {
    const res = await getMyEnrollments();
    list.value = res.data || [];
    await tryEnterFromQueryRoom();
  } catch (e) {
    if (e.response?.status === 401) {
      ElMessage.warning('登录已过期，请重新登录');
      router.replace('/login?redirect=' + encodeURIComponent(router.currentRoute.value.fullPath));
      return;
    }
    ElMessage.error(e.response?.data?.message || '加载失败');
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
  const map = { invited: 'info', confirmed: 'success', started: 'warning', submitted: 'info', absent: 'danger' };
  return map[s] || 'info';
}

function statusText(s) {
  const map = { invited: '已邀请', confirmed: '已确认', started: '进行中', submitted: '已交卷', absent: '缺考' };
  return map[s] || s;
}

// 开发环境下允许在考试时间外进入，便于联调与测试
const isDev = import.meta.env.DEV;
const TEN_MIN_MS = 10 * 60 * 1000;

// 开考前10分钟可点击「进入考试」，进入后为阅读须知页；开考后可进入答题
function canEnter(row) {
  if (['submitted', 'absent'].includes(row.status)) return false;
  const es = String(row.exam_status || row.examStatus || '').toLowerCase();
  if (es === 'draft') return false;
  if (isDev) return true;
  const now = Date.now();
  const start = new Date(row.start_time).getTime();
  const end = new Date(row.end_time).getTime();
  return now >= start - TEN_MIN_MS && now <= end;
}

function cannotEnterReason(row) {
  if (['submitted'].includes(row.status)) return '已交卷';
  if (['absent'].includes(row.status)) return '缺考';
  const es = String(row.exam_status || row.examStatus || '').toLowerCase();
  if (es === 'draft') return '考试尚未发布，请等企业发布后再进入';
  const now = Date.now();
  const start = new Date(row.start_time).getTime();
  const end = new Date(row.end_time).getTime();
  if (now < start - TEN_MIN_MS) return '开考前10分钟方可进入';
  if (now > end) return '已结束';
  return '暂不可用';
}

function enterExam(row) {
  router.push({ name: 'ExamInstructions', params: { id: row.exam_id }, query: { examName: row.exam_name, startTime: row.start_time, endTime: row.end_time } });
}

function logout() {
  auth.logout();
  router.push('/login');
}

onMounted(load);
</script>

<style scoped>
.exam-list-page { min-height: 100vh; background: #f5f7fa; }
.top-alert { margin: 0 0 0; border-radius: 0; }
.url-hint { margin-top: 8px; font-size: 12px; }
.url-hint code { font-size: 11px; background: rgba(0,0,0,.06); padding: 2px 6px; border-radius: 4px; }
.mono { font-family: ui-monospace, monospace; font-size: 13px; }
.muted { color: #909399; }
.header { padding: 16px 24px; background: #fff; display: flex; justify-content: space-between; align-items: center; }
.header-actions { display: flex; align-items: center; gap: 12px; }
.nav-link { color: var(--el-color-primary); text-decoration: none; font-size: 14px; }
.content { padding: 24px; }
</style>
