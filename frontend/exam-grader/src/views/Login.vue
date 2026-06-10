<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <h2>子系统登录</h2>
      </template>
      <el-form :model="form" label-width="80px" @submit.prevent="handleLogin">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleLogin" :loading="loading" style="width: 100%">登录</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { login } from '../api/auth';

const router = useRouter();
const loading = ref(false);
const form = ref({
  username: '',
  password: ''
});

async function handleLogin() {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }

  loading.value = true;
  try {
    const res = await login(form.value.username, form.value.password);
    if (res.success) {
      ElMessage.success('登录成功');
      router.push('/');
    } else {
      ElMessage.error(res.message || '登录失败');
    }
  } catch (e) {
    ElMessage.error(e.message || '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f7fa;
}
.login-card {
  width: 400px;
}
</style>
