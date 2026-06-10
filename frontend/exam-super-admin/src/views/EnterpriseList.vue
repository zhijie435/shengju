<template>
  <div>
    <div class="toolbar">
      <h2>企业管理</h2>
      <el-button type="primary" @click="showCreate = true">新建企业</el-button>
    </div>
    <el-table :data="list" stripe>
      <el-table-column label="企业名称" min-width="160">
        <template #default="{ row }">
          <span>{{ row.name }}</span>
          <el-tag v-if="row.talent_company_id" type="info" size="small" style="margin-left: 6px">来自人才网</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="contact_name" label="联系人" width="120" />
      <el-table-column prop="contact_phone" label="联系电话" width="140" />
      <el-table-column prop="talent_company_id" label="人才网企业ID" width="120" />
      <el-table-column prop="username" label="账号" width="120" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="420">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'pending'" link type="success" size="small" @click="approve(row)">通过</el-button>
          <el-button v-if="row.status === 'pending'" link type="danger" size="small" @click="reject(row)">拒绝</el-button>
          <el-button v-if="row.status === 'approved'" link type="warning" size="small" @click="disable(row)">禁用</el-button>
          <el-button v-if="row.status === 'disabled'" link type="success" size="small" @click="enable(row)">恢复启用</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="showCreate" title="新建企业" width="500px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="企业名称" required>
          <el-input v-model="createForm.name" placeholder="请输入企业名称" />
        </el-form-item>
        <el-form-item label="创建方式">
          <el-radio-group v-model="createForm.createNewAccount">
            <el-radio :label="false">关联已有账号</el-radio>
            <el-radio :label="true">新建账号</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="createForm.createNewAccount">
          <el-form-item label="账号" required>
            <el-input v-model="createForm.username" placeholder="企业登录账号，不可重复" />
          </el-form-item>
          <el-form-item label="密码" required>
            <el-input v-model="createForm.password" type="password" show-password placeholder="至少6位" />
          </el-form-item>
        </template>
        <el-form-item v-else label="关联账号">
          <el-select v-model="createForm.userId" clearable filterable placeholder="可选，选择企业登录账号" style="width:100%">
            <el-option v-for="u in users" :key="u.id" :label="u.username" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="createForm.contactName" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="createForm.contactPhone" />
        </el-form-item>
        <el-form-item label="人才网企业ID">
          <el-input v-model.number="createForm.talentCompanyId" placeholder="人才网 sj_companies.id，用于批次隔离" type="number" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="create">创建</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="showEdit" title="编辑企业" width="500px">
      <el-form :model="editForm" label-width="110px">
        <el-form-item label="企业名称" required>
          <el-input v-model="editForm.name" placeholder="请输入企业名称" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="editForm.contactName" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="editForm.contactPhone" />
        </el-form-item>
        <el-form-item label="人才网企业ID">
          <el-input v-model.number="editForm.talentCompanyId" placeholder="人才网 sj_companies.id，用于批次隔离" type="number" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../api/request';

const list = ref([]);
const users = ref([]);
const showCreate = ref(false);
const creating = ref(false);
const createForm = reactive({ name: '', userId: null, contactName: '', contactPhone: '', createNewAccount: false, username: '', password: '', talentCompanyId: null });
const showEdit = ref(false);
const saving = ref(false);
const editForm = reactive({ id: null, name: '', contactName: '', contactPhone: '', talentCompanyId: null });

async function load() {
  const res = await request.get('/enterprises');
  list.value = res.data || [];
}

function statusType(s) {
  const map = { pending: 'warning', approved: 'success', rejected: 'danger', disabled: 'info' };
  return map[s] || 'info';
}

function statusText(s) {
  const map = { pending: '待审核', approved: '已通过', rejected: '已拒绝', disabled: '已禁用' };
  return map[s] || s;
}

async function approve(row) {
  await request.put(`/enterprises/${row.id}`, { status: 'approved' });
  ElMessage.success('已通过');
  load();
}

async function reject(row) {
  await request.put(`/enterprises/${row.id}`, { status: 'rejected' });
  ElMessage.success('已拒绝');
  load();
}

async function disable(row) {
  await ElMessageBox.confirm('确定禁用该企业？', '提示', { type: 'warning' });
  await request.put(`/enterprises/${row.id}`, { status: 'disabled' });
  ElMessage.success('已禁用');
  load();
}

async function enable(row) {
  await ElMessageBox.confirm('确定恢复启用该企业？启用后企业将恢复使用系统功能。', '恢复启用', { type: 'info' });
  await request.put(`/enterprises/${row.id}`, { status: 'approved' });
  ElMessage.success('已恢复启用');
  load();
}

async function loadUsers() {
  const res = await request.get('/users/search', { params: { q: '' } });
  users.value = res.data || [];
}

function openEdit(row) {
  editForm.id = row.id;
  editForm.name = row.name || '';
  editForm.contactName = row.contact_name || '';
  editForm.contactPhone = row.contact_phone || '';
  editForm.talentCompanyId = row.talent_company_id != null ? row.talent_company_id : null;
  showEdit.value = true;
}

async function saveEdit() {
  if (!editForm.name?.trim()) {
    ElMessage.warning('请输入企业名称');
    return;
  }
  saving.value = true;
  try {
    await request.put(`/enterprises/${editForm.id}`, {
      name: editForm.name.trim(),
      contactName: editForm.contactName || null,
      contactPhone: editForm.contactPhone || null,
      talent_company_id: editForm.talentCompanyId != null && editForm.talentCompanyId !== '' ? editForm.talentCompanyId : null
    });
    ElMessage.success('保存成功');
    showEdit.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

async function create() {
  if (!createForm.name) {
    ElMessage.warning('请输入企业名称');
    return;
  }
  if (createForm.createNewAccount) {
    if (!createForm.username?.trim()) {
      ElMessage.warning('请输入账号');
      return;
    }
    if (!createForm.password || createForm.password.length < 6) {
      ElMessage.warning('密码至少6位');
      return;
    }
  }
  creating.value = true;
  try {
    const payload = {
      name: createForm.name,
      contactName: createForm.contactName,
      contactPhone: createForm.contactPhone,
      talentCompanyId: createForm.talentCompanyId != null && createForm.talentCompanyId !== '' ? createForm.talentCompanyId : undefined
    };
    if (createForm.createNewAccount) {
      payload.username = createForm.username.trim();
      payload.password = createForm.password;
    } else {
      payload.userId = createForm.userId;
    }
    await request.post('/enterprises', payload);
    ElMessage.success('创建成功');
    showCreate.value = false;
    createForm.name = '';
    createForm.userId = null;
    createForm.contactName = '';
    createForm.contactPhone = '';
    createForm.createNewAccount = false;
    createForm.username = '';
    createForm.password = '';
    createForm.talentCompanyId = null;
    load();
  } finally {
    creating.value = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确定要删除企业「${row.name}」吗？此操作主要用于清理测试企业，可能会级联删除其考试等数据，请谨慎操作。`,
      '删除企业',
      { type: 'warning' }
    );
  } catch {
    return;
  }
  try {
    await request.delete(`/enterprises/${row.id}`);
    ElMessage.success('删除成功');
    load();
  } catch (e) {
    // 错误提示由 request 统一处理
  }
}

onMounted(() => { load(); loadUsers(); });
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
</style>
