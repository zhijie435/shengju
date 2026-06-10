<template>
  <div class="invite-page">
    <div class="card">
      <h2>{{ isPublicRoom ? '考场入口' : '考试邀请' }}</h2>
      <p v-if="!info">正在验证…</p>
      <template v-else>
        <p><strong>{{ displayExamName }}</strong></p>
        <p>开始：{{ displayStart }} 结束：{{ displayEnd }}</p>
        <p>时长：{{ displayDuration }} 分钟</p>
        <p v-if="isPublicRoom" class="hint">
          本场使用<strong>统一考场码</strong>。请使用与企业在考生名单中<strong>一致的手机号</strong>登录考生端；同一人参加多场考试时，登录后在「我的考试」中可看到多场，也可使用下方「登录态进入」直达本场。
        </p>
        <div class="actions">
          <el-button
            v-if="!isPublicRoom"
            type="primary"
            :loading="loadingGuest"
            @click="enterExamGuest"
          >免登录进入考试</el-button>
          <el-button v-if="!hasAuth" type="default" @click="goLogin">登录后参加考试</el-button>
          <el-button v-else type="primary" :loading="loading" @click="enterExam">登录态进入考试</el-button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getInviteInfo, getSessionByInvite, getEnterByInvite, getSessionByPublicRoom } from '../api/exam';
import { getExamStudentToken } from '../utils/studentToken';

const route = useRoute();
const router = useRouter();
const code = computed(() => route.params.code);
const info = ref(null);
const loading = ref(false);
const loadingGuest = ref(false);
const hasAuth = computed(() => !!getExamStudentToken());

const isPublicRoom = computed(() => info.value && info.value.entryMode === 'public_room');
const displayExamName = computed(() => info.value?.exam_name || info.value?.examName || '');
const displayStart = computed(() => info.value?.start_time || info.value?.startTime || '');
const displayEnd = computed(() => info.value?.end_time || info.value?.endTime || '');
const displayDuration = computed(() => info.value?.duration_minutes ?? info.value?.durationMinutes ?? '');

onMounted(async () => {
  try {
    const res = await getInviteInfo(code.value);
    if (res.success) info.value = res.data;
  } catch (e) {
    ElMessage.error('邀请码或考场码无效');
    router.push('/login');
  }
});

function goLogin() {
  router.push({ path: '/login', query: { redirect: route.fullPath, room: code.value } });
}

function safeSetSessionItem(key, value) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(key, value);
  } catch (e) {
    // 忽略
  }
}

async function enterExamGuest() {
  loadingGuest.value = true;
  try {
    const res = await getEnterByInvite(code.value);
    if (res.success && res.data?.session && res.data?.exam && res.data?.guestToken) {
      safeSetSessionItem('exam_guest_token', res.data.guestToken);
      safeSetSessionItem('exam_guest_session', JSON.stringify(res.data.session));
      safeSetSessionItem('exam_guest_examId', String(res.data.exam.id));
      const exam = res.data.exam;
      router.push({
        name: 'ExamInstructions',
        params: { id: exam.id },
        query: {
          examName: exam.name || info.value?.exam_name,
          startTime: exam.start_time || info.value?.start_time,
          endTime: exam.end_time || info.value?.end_time,
          guest: '1'
        }
      });
    } else {
      ElMessage.error('无法获取考试会话');
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '进入失败');
  } finally {
    loadingGuest.value = false;
  }
}

async function enterExam() {
  loading.value = true;
  try {
    if (isPublicRoom.value) {
      const res = await getSessionByPublicRoom(code.value);
      if (res.success && res.data?.session && res.data?.exam) {
        const exam = res.data.exam;
        router.push({
          name: 'ExamInstructions',
          params: { id: exam.id },
          query: {
            examName: exam.name || displayExamName.value,
            startTime: exam.startTime || exam.start_time || displayStart.value,
            endTime: exam.endTime || exam.end_time || displayEnd.value
          }
        });
        return;
      }
      ElMessage.error((res && res.message) || '无法进入本场考试');
      return;
    }
    const res = await getSessionByInvite(code.value);
    if (res.success && res.data?.session && res.data?.exam) {
      const exam = res.data.exam;
      router.push({
        name: 'ExamInstructions',
        params: { id: exam.id },
        query: {
          examName: exam.name || displayExamName.value,
          startTime: exam.start_time || exam.startTime || displayStart.value,
          endTime: exam.end_time || exam.endTime || displayEnd.value
        }
      });
    } else {
      ElMessage.error(res?.message || '无法获取考试会话');
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '进入失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.invite-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f0f2f5; }
.card { padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); text-align: center; max-width: 520px; }
.hint { margin-top: 12px; font-size: 13px; color: #606266; line-height: 1.5; text-align: left; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 16px; }
</style>
