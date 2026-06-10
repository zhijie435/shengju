<template>
  <el-container>
    <el-aside width="200px">
      <div class="logo">企业端</div>
      <el-menu router :default-active="$route.path">
        <el-menu-item index="/exams">考试管理</el-menu-item>
        <el-menu-item index="/grading-system">评分系统</el-menu-item>
        <el-menu-item index="/answer-system">答题系统</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="main-header">
        <span class="enterprise-name">{{ enterpriseName || '企业笔试系统' }}</span>
        <el-button link type="primary" @click="logout">退出登录</el-button>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { removeToken } from '../api/auth';
import { getEnterpriseMe } from '../api/enterprises';

const router = useRouter();
const enterpriseName = ref('');

async function loadEnterprise() {
  try {
    const res = await getEnterpriseMe();
    if (res && res.data && res.data.name) {
      enterpriseName.value = res.data.name;
    }
  } catch (_) {
    enterpriseName.value = '';
  }
}

function logout() {
  removeToken();
  router.push('/login');
}

onMounted(() => {
  loadEnterprise();
});
</script>

<style scoped>
.el-aside { background: #304156; color: #fff; }
.logo { padding: 20px; text-align: center; font-weight: bold; }
.el-menu { border-right: none; background: transparent; }
.el-menu-item { color: rgba(255,255,255,.7); }
.el-menu-item:hover, .el-menu-item.is-active { color: #fff; background: rgba(255,255,255,.1); }
.main-header { display: flex; justify-content: space-between; align-items: center; background: #fff; border-bottom: 1px solid #eee; padding: 0 16px; }
.enterprise-name { font-size: 14px; color: #303133; }
</style>
