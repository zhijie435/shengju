<template>
  <div class="login-page">
    <div class="login-card">
      <h1>总管理端登录</h1>
      <el-form :model="form">
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
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import request from '../api/request';
import { setToken } from '../api/request';

const router = useRouter();
const loading = ref(false);
const form = reactive({ username: '', password: '' });

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    const res = await request.post('/auth/login', form);
    if (res.needFaceVerify) {
      ElMessage.warning('该账号需先完成人脸核验，请使用考生/题库 Web 登录页完成核验后再试');
      return;
    }
    if (res.success && res.user?.role === 'admin') {
      setToken(res.token);
      ElMessage.success('登录成功');
      router.push('/');
    } else if (res.success === false && res.message) {
      ElMessage.error(res.message);
    } else {
      ElMessage.error('仅管理员可登录');
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
.login-card { width: 400px; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
.login-card h1 { margin-bottom: 24px; text-align: center; }
</style>
