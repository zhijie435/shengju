<template>
  <div>
    <el-page-header @back="$router.back()" title="评分系统" />
    <div class="toolbar">
      <h2>子系统账号管理</h2>
      <el-button type="primary" @click="showCreateDialog">创建账号</el-button>
    </div>
    
    <el-table :data="accountList" stripe v-loading="loading">
      <el-table-column prop="username" label="用户名" width="150" />
      <el-table-column prop="real_name" label="真实姓名" width="120" />
      <el-table-column prop="email" label="邮箱" width="200" />
      <el-table-column prop="phone" label="手机号" width="120" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column prop="last_login_at" label="最后登录" width="180" />
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="showEditDialog(row)">编辑</el-button>
          <el-button link type="primary" size="small" @click="showResetPasswordDialog(row)">重置密码</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="loadAccounts"
    />
    
    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="500px"
      @close="resetForm"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="密码" :required="!isEdit">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="真实姓名">
          <el-input v-model="form.real_name" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="状态" v-if="isEdit">
          <el-select v-model="form.status">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
    
    <!-- 重置密码对话框 -->
    <el-dialog
      v-model="resetPasswordDialogVisible"
      title="重置密码"
      width="400px"
    >
      <el-form :model="resetPasswordForm" label-width="100px">
        <el-form-item label="新密码" required>
          <el-input v-model="resetPasswordForm.newPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPasswordDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleResetPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listGradingAccounts,
  createGradingAccount,
  updateGradingAccount,
  deleteGradingAccount,
  resetGradingAccountPassword
} from '../api/grading';

const loading = ref(false);
const accountList = ref([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const dialogVisible = ref(false);
const resetPasswordDialogVisible = ref(false);
const isEdit = ref(false);
const currentAccountId = ref(null);

const form = ref({
  username: '',
  password: '',
  real_name: '',
  email: '',
  phone: '',
  status: 'active'
});

const resetPasswordForm = ref({
  newPassword: ''
});

const dialogTitle = computed(() => isEdit.value ? '编辑账号' : '创建账号');

async function loadAccounts() {
  loading.value = true;
  try {
    const res = await listGradingAccounts({
      page: page.value,
      pageSize: pageSize.value
    });
    accountList.value = res.data?.list || [];
    total.value = res.data?.total || 0;
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

function showCreateDialog() {
  isEdit.value = false;
  currentAccountId.value = null;
  resetForm();
  dialogVisible.value = true;
}

function showEditDialog(row) {
  isEdit.value = true;
  currentAccountId.value = row.id;
  form.value = {
    username: row.username,
    password: '',
    real_name: row.real_name || '',
    email: row.email || '',
    phone: row.phone || '',
    status: row.status
  };
  dialogVisible.value = true;
}

function showResetPasswordDialog(row) {
  currentAccountId.value = row.id;
  resetPasswordForm.value.newPassword = '';
  resetPasswordDialogVisible.value = true;
}

function resetForm() {
  form.value = {
    username: '',
    password: '',
    real_name: '',
    email: '',
    phone: '',
    status: 'active'
  };
}

async function handleSubmit() {
  if (!form.value.username) {
    ElMessage.warning('请输入用户名');
    return;
  }
  if (!isEdit.value && !form.value.password) {
    ElMessage.warning('请输入密码');
    return;
  }
  if (form.value.password && form.value.password.length < 6) {
    ElMessage.warning('密码长度至少6位');
    return;
  }

  try {
    if (isEdit.value) {
      const updateData = { ...form.value };
      if (!updateData.password) {
        delete updateData.password;
      }
      await updateGradingAccount(currentAccountId.value, updateData);
      ElMessage.success('更新成功');
    } else {
      await createGradingAccount(form.value);
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
    loadAccounts();
  } catch (e) {
    ElMessage.error(e.message || '操作失败');
  }
}

async function handleResetPassword() {
  if (!resetPasswordForm.value.newPassword) {
    ElMessage.warning('请输入新密码');
    return;
  }
  if (resetPasswordForm.value.newPassword.length < 6) {
    ElMessage.warning('密码长度至少6位');
    return;
  }

  try {
    await resetGradingAccountPassword(currentAccountId.value, resetPasswordForm.value.newPassword);
    ElMessage.success('密码重置成功');
    resetPasswordDialogVisible.value = false;
  } catch (e) {
    ElMessage.error(e.message || '重置失败');
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm('确定删除该账号？', '提示', { type: 'warning' });
    await deleteGradingAccount(row.id);
    ElMessage.success('删除成功');
    loadAccounts();
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || '删除失败');
    }
  }
}

onMounted(loadAccounts);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0;
}
.el-pagination {
  margin-top: 16px;
}
</style>
