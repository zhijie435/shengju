<template>
  <div class="login-page">
    <div class="login-card">
      <h1>企业端登录</h1>
      <el-form :model="form" @submit.prevent="onSubmit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password @keyup.enter="onSubmit" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit" style="width:100%">登录</el-button>
        </el-form-item>
      </el-form>
      <div class="login-divider">或</div>
      <el-button type="default" style="width:100%" @click="loginByTalentNetwork">
        使用人才网企业账号登录
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import request from '../api/request';
import { setToken } from '../api/auth';
import { exchangeTalentJwtForExam, firstQueryVal } from '../api/talentExchange';

// 生产环境（80/443 或无端口）：人才网与考试企业端同域，用当前 origin；仅本地 Vite(5174) 时默认连本机 3001
function resolveTalentNetworkOrigin() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  if (window.location.port === '5174') return 'http://127.0.0.1:3001';
  const p = window.location.port;
  if (!p || p === '80' || p === '443') return window.location.origin;
  return window.location.origin.replace(/:\d+$/, ':3001');
}
const TALENT_NETWORK_ORIGIN = import.meta.env.VITE_TALENT_NETWORK_ORIGIN || resolveTalentNetworkOrigin();

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const form = reactive({ username: '', password: '' });

function loginByTalentNetwork() {
  const returnUrl = window.location.origin + window.location.pathname + '?from=talent_network';
  const ssoUrl = `${TALENT_NETWORK_ORIGIN}/enterprise/exam-sso.html?return_url=${encodeURIComponent(returnUrl)}`;
  window.location.href = ssoUrl;
}

function buildRedirectAfterTalentExchange() {
  const q = { ...route.query };
  delete q.token;
  delete q.Token;
  const restKeys = Object.keys(q).filter((k) => q[k] != null && String(q[k]).trim() !== '');
  if (restKeys.length === 0) {
    return { path: '/', query: {} };
  }
  const hasExamContext =
    q.enterprise_id != null ||
    q.enterpriseId != null ||
    q.package_id != null ||
    q.packageId != null ||
    q.batch_id != null ||
    q.batchId != null;
  if (hasExamContext) {
    return { path: '/exams/create', query: q };
  }
  return { path: '/', query: q };
}

async function tryTokenFromQuery() {
  const token = firstQueryVal(route.query.token) || firstQueryVal(route.query.Token);
  if (!token) return false;
  loading.value = true;
  try {
    const examTok = await exchangeTalentJwtForExam(token);
    setToken(examTok);
    ElMessage.success('登录成功');
    const target = buildRedirectAfterTalentExchange();
    await router.replace(target);
    return true;
  } catch (e) {
    ElMessage.error(e.message || '人才网登录失败');
  } finally {
    loading.value = false;
  }
  return false;
}

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    let res = await request.post('/auth/login', form);
    let token = res?.token || res?.data?.token;
    // 兼容子阅卷账号：企业登录失败时自动回退到 grader 登录接口
    if (!res?.success) {
      try {
        const graderRes = await request.post('/auth/login-grader', form);
        if (graderRes?.success) {
          res = graderRes;
          token = graderRes?.token || graderRes?.data?.token;
        }
      } catch (_) {
        // 保留原始错误信息
      }
    }
    if (res?.success && token) {
      setToken(token);
      ElMessage.success('登录成功');
      router.push('/');
    } else if (res?.success && !token) {
      ElMessage.error('登录成功但未返回令牌');
    } else {
      ElMessage.error(res?.message || '登录失败');
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '登录失败');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (route.query.token) {
    await tryTokenFromQuery();
  }
});
</script>

<style scoped>
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f0f2f5; }
.login-card { width: 400px; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
.login-card h1 { margin-bottom: 24px; text-align: center; font-size: 24px; }
.login-divider { text-align: center; color: #999; margin: 16px 0; font-size: 12px; }
</style>
