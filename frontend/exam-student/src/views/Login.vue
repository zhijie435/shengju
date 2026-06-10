<template>
  <div class="login-page" :style="pageStyle">
    <div class="login-card">
      <div v-if="branding" class="login-brand">
        <img v-if="branding.logo" :src="branding.logo" alt="" class="login-brand-logo" />
        <h1 class="login-brand-title">{{ branding.title || '考生登录' }}</h1>
        <p v-if="announcementId" class="login-brand-sub">招聘公告报名入口</p>
      </div>
      <h1 v-else>考生登录</h1>
      <el-tabs v-model="loginTab" class="login-tabs">
        <el-tab-pane label="账号登录" name="account">
          <el-form :model="form" label-width="100px" @submit.prevent="onSubmit">
            <el-form-item label="登录账号" required>
              <el-input
                v-model="form.username"
                placeholder="手机号（与导入名单一致）"
                maxlength="64"
                clearable
              />
            </el-form-item>
            <el-form-item label="密码" required>
              <el-input
                v-model="form.password"
                type="password"
                placeholder="身份证后6位"
                show-password
                @keyup.enter="onSubmit"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="loading" @click="onSubmit" style="width:100%">登录</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="短信登录" name="sms">
          <el-form :model="smsForm" label-width="80px" @submit.prevent="onSmsSubmit">
            <el-form-item label="手机号">
              <el-input v-model="smsForm.phone" placeholder="请输入手机号" maxlength="11" />
            </el-form-item>
            <el-form-item label="验证码">
              <div class="sms-code-row">
                <el-input v-model="smsForm.code" placeholder="请输入验证码" maxlength="6" @keyup.enter="onSmsSubmit" />
                <el-button :loading="sending" :disabled="smsCountdown > 0" @click="sendCode">
                  {{ smsCountdown > 0 ? `${smsCountdown}秒后重发` : '获取验证码' }}
                </el-button>
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="loading" @click="onSmsSubmit" style="width:100%">登录</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog
      v-model="examPickerVisible"
      title="选择要参加的考试"
      width="520px"
      destroy-on-close
      :close-on-click-modal="false"
      class="exam-picker-dialog"
    >
      <p class="picker-hint">您当前有多场可参加的考试，请选择一场进入阅读须知（也可点「进入列表」稍后在「我的考试」中选择）。</p>
      <el-radio-group v-model="examPickerChoice" class="picker-group">
        <div v-for="row in examPickerList" :key="row.exam_id" class="picker-row">
          <el-radio :label="Number(row.exam_id)">
            <span class="picker-title">{{ row.exam_name || '考试' }}</span>
            <span class="picker-time">{{ formatExamRowTime(row) }}</span>
          </el-radio>
        </div>
      </el-radio-group>
      <template #footer>
        <el-button @click="closeExamPickerGoList">进入列表</el-button>
        <el-button type="primary" :disabled="examPickerChoice == null" @click="confirmExamPicker">进入所选考试</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { sendSms, getMyExamInvitations, getMyEnrollments, getSessionByPublicRoom, getAnnouncementBranding } from '../api/exam';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const sending = ref(false);
const loginTab = ref('account');
const smsCountdown = ref(0);
let countdownTimer = null;

const form = reactive({ username: '', password: '' });
const smsForm = reactive({ phone: '', code: '' });

const examPickerVisible = ref(false);
const examPickerList = ref([]);
const examPickerChoice = ref(null);

const branding = ref(null);
const announcementId = computed(() => {
  const q = route.query.announcementId || route.query.announcement;
  const n = parseInt(String(q || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
});

const pageStyle = computed(() => {
  const b = branding.value;
  if (!b || !b.pageBackground) return {};
  return { background: b.pageBackground };
});

function roomFromRoute() {
  const q = route.query.room;
  return q != null && String(q).trim() ? String(q).trim() : '';
}

function effectiveRoomCode() {
  return roomFromRoute();
}

function redirectWithRoomForFace(redirectPath) {
  const room = effectiveRoomCode();
  let red = redirectPath || '/exams';
  if (!room) return red;
  if (String(red).includes('room=')) return red;
  const sep = String(red).includes('?') ? '&' : '?';
  return `${red}${sep}room=${encodeURIComponent(room)}`;
}

function formatExamRowTime(row) {
  const a = row.start_time || row.startTime || '';
  const b = row.end_time || row.endTime || '';
  if (a && b) return `${a} ~ ${b}`;
  return a || b || '';
}

function openExamPicker(rows) {
  examPickerList.value = rows;
  examPickerChoice.value = rows.length ? Number(rows[0].exam_id) : null;
  examPickerVisible.value = true;
}

function closeExamPickerGoList() {
  examPickerVisible.value = false;
  examPickerList.value = [];
  examPickerChoice.value = null;
  router.push('/exams');
}

function confirmExamPicker() {
  const id = examPickerChoice.value;
  if (id == null || !Number.isFinite(Number(id))) return;
  const row = examPickerList.value.find((r) => Number(r.exam_id) === Number(id));
  examPickerVisible.value = false;
  examPickerList.value = [];
  examPickerChoice.value = null;
  router.push({
    name: 'ExamInstructions',
    params: { id },
    query: {
      examName: row?.exam_name || row?.examName || '',
      startTime: row?.start_time || row?.startTime || '',
      endTime: row?.end_time || row?.endTime || ''
    }
  });
}

async function loadAnnouncementBranding() {
  const id = announcementId.value;
  if (!id) {
    branding.value = null;
    return;
  }
  try {
    const res = await getAnnouncementBranding(id);
    const data = res?.data != null ? res.data : res;
    branding.value = data && typeof data === 'object' ? data : null;
    if (branding.value?.title) {
      document.title = `${branding.value.title} - 考生登录`;
    }
    try {
      sessionStorage.setItem('exam_student_announcement_id', String(id));
    } catch (_) {
      /* ignore */
    }
  } catch (_) {
    branding.value = null;
  }
}

onMounted(() => {
  loadAnnouncementBranding();
});

async function navigateAfterLogin() {
  const room = effectiveRoomCode();
  const redirect = (route.query.redirect && String(route.query.redirect)) || '/exams';
  if (room) {
    try {
      const res = await getSessionByPublicRoom(room);
      if (res?.success && res.data?.session && res.data?.exam) {
        const exam = res.data.exam;
        ElMessage.success('登录成功');
        router.push({
          name: 'ExamInstructions',
          params: { id: exam.id },
          query: {
            examName: exam.name,
            startTime: exam.startTime || exam.start_time,
            endTime: exam.endTime || exam.end_time
          }
        });
        return;
      }
      if (res?.message) ElMessage.warning(res.message);
    } catch (e) {
      const msg = e.response?.data?.message;
      if (msg) ElMessage.warning(msg);
    }
  }

  let list = [];
  try {
    const enrollRes = await getMyEnrollments();
    list = enrollRes && enrollRes.data ? enrollRes.data : [];
  } catch (invErr) {
    if (invErr.response?.status === 401) {
      auth.logout();
      ElMessage.error('登录状态失效，请重新登录');
      return;
    }
  }

  const actionable = list.filter((r) => !['submitted', 'absent'].includes(String(r.status || '')));

  if (actionable.length >= 2) {
    ElMessage.success('登录成功');
    openExamPicker(actionable);
    return;
  }
  if (actionable.length === 1) {
    const row = actionable[0];
    ElMessage.success('登录成功');
    router.push({
      name: 'ExamInstructions',
      params: { id: row.exam_id },
      query: {
        examName: row.exam_name,
        startTime: row.start_time,
        endTime: row.end_time
      }
    });
    return;
  }

  if (!list || list.length === 0) {
    try {
      const invRes = await getMyExamInvitations();
      const inv = invRes && invRes.data ? invRes.data : [];
      if (!inv || inv.length === 0) {
        ElMessage.warning(
          announcementId.value
            ? '已登录。若暂无笔试场次，请从招聘公告相关通知进入后续环节。'
            : '未查询到考试报名，请核对手机号与身份证后6位。'
        );
      }
    } catch (_) {
      ElMessage.warning('未查询到可参加的考试，请核对名单与考试发布状态。');
    }
  } else {
    ElMessage.warning('暂无可进入的考试场次，请到「我的考试」查看详情。');
  }
  ElMessage.success('登录成功');
  router.push(redirect);
}

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入手机号与密码（身份证后6位）');
    return;
  }
  loading.value = true;
  try {
    const res = await auth.login(form.username, form.password, {
      announcementId: announcementId.value || undefined
    });
    if (res.success) {
      const needFv = res.needFaceVerify === true || res.needFaceVerify === 'true' || res.needFaceVerify === 1;
      if (needFv && res.tempToken) {
        sessionStorage.setItem(
          'pending_face_verify',
          JSON.stringify({
            tempToken: res.tempToken,
            redirect: redirectWithRoomForFace(route.query.redirect || '/exams')
          })
        );
        ElMessage.info('请完成人脸核验');
        router.push('/face-verify');
      } else {
        auth.saveAuth(res.token, res.user);
        await navigateAfterLogin();
      }
    } else {
      ElMessage.error(res.message || '登录失败');
    }
  } catch (e) {
    const msg =
      e.response?.status === 401
        ? e.response?.data?.message || '用户名或密码错误，请检查后重试'
        : e.response?.data?.message || e.message || '登录失败';
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}

async function sendCode() {
  const phone = smsForm.phone.replace(/\D/g, '');
  if (phone.length < 11) {
    ElMessage.warning('请输入正确的手机号');
    return;
  }
  sending.value = true;
  try {
    await sendSms(phone);
    ElMessage.success('验证码已发送');
    smsCountdown.value = 60;
    countdownTimer = setInterval(() => {
      smsCountdown.value--;
      if (smsCountdown.value <= 0 && countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }, 1000);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '发送失败');
  } finally {
    sending.value = false;
  }
}

async function onSmsSubmit() {
  const phone = smsForm.phone.replace(/\D/g, '');
  if (phone.length < 11) {
    ElMessage.warning('请输入正确的手机号');
    return;
  }
  if (!smsForm.code.trim()) {
    ElMessage.warning('请输入验证码');
    return;
  }
  loading.value = true;
  try {
    const res = await auth.loginByPhone(phone, smsForm.code);
    if (res.success) {
      const needFv = res.needFaceVerify === true || res.needFaceVerify === 'true' || res.needFaceVerify === 1;
      if (needFv && res.tempToken) {
        sessionStorage.setItem(
          'pending_face_verify',
          JSON.stringify({
            tempToken: res.tempToken,
            redirect: redirectWithRoomForFace(route.query.redirect || '/exams')
          })
        );
        ElMessage.info('请完成人脸核验');
        router.push('/face-verify');
      } else {
        auth.saveAuth(res.token, res.user);
        await navigateAfterLogin();
      }
    } else {
      ElMessage.error(res.message || '登录失败');
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f0f2f5; }
.login-card { width: 440px; max-width: 96vw; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
.login-card h1 { margin-bottom: 8px; text-align: center; font-size: 24px; color: #333; }
.login-brand { text-align: center; margin-bottom: 20px; }
.login-brand-logo { max-height: 56px; max-width: 200px; object-fit: contain; margin-bottom: 8px; }
.login-brand-title { margin: 0 0 4px; font-size: 22px; color: #303133; line-height: 1.35; }
.login-brand-sub { margin: 0; font-size: 12px; color: #909399; }
.login-tabs :deep(.el-tabs__header) { margin-bottom: 20px; }
.login-tabs :deep(.el-tabs__item) { font-size: 14px; }
.sms-code-row { display: flex; gap: 8px; width: 100%; }
.sms-code-row .el-input { flex: 1; }
.sms-code-row .el-button { flex-shrink: 0; min-width: 110px; }
.picker-hint { font-size: 13px; color: #606266; margin-bottom: 16px; line-height: 1.5; }
.picker-group { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.picker-row { padding: 8px 0; border-bottom: 1px solid #ebeef5; }
.picker-row:last-child { border-bottom: none; }
.picker-title { display: block; font-weight: 600; color: #303133; }
.picker-time { display: block; font-size: 12px; color: #909399; margin-top: 4px; }
</style>
