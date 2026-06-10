<template>
  <el-container>
    <el-aside width="200px">
      <div class="logo">总管理端</div>
      <el-menu router :default-active="$route.path">
        <el-menu-item index="/enterprises">企业管理</el-menu-item>
        <el-menu-item index="/exams">考试总览</el-menu-item>
        <el-menu-item index="/grading-system">评分系统</el-menu-item>
        <el-menu-item index="/answer-system">答题系统配置</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header>
        <el-button link type="danger" @click="logout">退出</el-button>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { removeToken } from '../api/request';

const router = useRouter();
function logout() {
  removeToken();
  router.push('/login');
}
</script>

<style scoped>
.el-aside { background: #304156; color: #fff; }
.logo { padding: 20px; text-align: center; font-weight: bold; }
.el-menu { border-right: none; background: transparent; }
.el-menu-item { color: rgba(255,255,255,.7); }
.el-menu-item:hover, .el-menu-item.is-active { color: #fff; background: rgba(255,255,255,.1); }
.el-header { display: flex; justify-content: flex-end; align-items: center; background: #fff; border-bottom: 1px solid #eee; }
</style>
