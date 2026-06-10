<template>
  <el-container>
    <el-header>
      <div class="header-content">
        <h2>子系统</h2>
        <el-button link type="danger" @click="logout">退出</el-button>
      </div>
    </el-header>
    <el-main>
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { logout as apiLogout } from '../api/auth';

const router = useRouter();

function logout() {
  apiLogout();
  router.push('/login');
}
</script>

<style scoped>
.el-header {
  background: #304156;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 20px;
}
.header-content {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header-content h2 {
  color: #fff;
  margin: 0;
}
</style>
