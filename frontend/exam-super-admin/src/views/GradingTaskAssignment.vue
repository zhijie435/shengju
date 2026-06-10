<template>
  <div>
    <el-page-header @back="$router.back()" :title="exam?.name || '主观题任务分配'" />
    <div class="toolbar">
      <h2>主观题任务分配</h2>
      <el-button @click="loadTasks">刷新</el-button>
    </div>
    
    <el-card>
      <template #header>
        <span>创建新任务</span>
      </template>
      <el-form :model="taskForm" label-width="120px">
        <el-form-item label="阅卷账号" required>
          <el-select v-model="taskForm.grading_account_id" placeholder="请选择阅卷账号" style="width: 300px">
            <el-option
              v-for="account in accountList"
              :key="account.id"
              :label="`${account.real_name || account.username} (${account.username})`"
              :value="account.id"
            />
          </el-select>
        </el-form-item>
        
        <el-form-item label="分配方式" required>
          <el-radio-group v-model="taskForm.task_type">
            <el-radio value="content">按内容分配</el-radio>
            <el-radio value="question_type">按题型分配</el-radio>
          </el-radio-group>
        </el-form-item>
        
        <!-- 按内容分配 -->
        <template v-if="taskForm.task_type === 'content'">
          <el-form-item label="选择大题">
            <el-checkbox-group v-model="selectedMajorQuestions">
              <el-checkbox
                v-for="mq in majorQuestions"
                :key="mq.id"
                :value="mq.id"
              >
                第{{ mq.order_number }}题 - {{ mq.question_type }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="或选择小题">
            <el-checkbox-group v-model="selectedSubQuestions">
              <el-checkbox
                v-for="sq in subQuestions"
                :key="sq.id"
                :value="sq.id"
              >
                {{ sq.question_number }} ({{ sq.score }}分)
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </template>
        
        <!-- 按题型分配 -->
        <template v-if="taskForm.task_type === 'question_type'">
          <el-form-item label="选择题型">
            <el-checkbox-group v-model="selectedQuestionTypes">
              <el-checkbox
                v-for="type in questionTypes"
                :key="type"
                :value="type"
              >
                {{ type }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </template>
        
        <el-form-item>
          <el-button type="primary" @click="handleCreateTask" :loading="creating">创建任务</el-button>
          <el-button @click="resetForm">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    
    <el-card style="margin-top: 20px">
      <template #header>
        <span>已有任务</span>
      </template>
      <el-table :data="taskList" stripe>
        <el-table-column prop="username" label="阅卷账号" width="150" />
        <el-table-column prop="real_name" label="姓名" width="120" />
        <el-table-column label="分配题数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small">{{ row.total != null ? row.total : '-' }} 题</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分配方式" width="120">
          <template #default="{ row }">
            {{ row.task_type === 'content' ? '按内容' : '按题型' }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">{{ getStatusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="assigned_at" label="分配时间" width="180" />
        <el-table-column prop="completed_at" label="完成时间" width="180" />
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewTaskDetails(row)">查看详情</el-button>
            <el-button link type="danger" size="small" @click="handleDeleteTask(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getExam } from '../api/exams';
import { getPaper } from '../api/exams';
import { listGradingAccounts, listGradingTasks, createGradingTask, deleteGradingTask } from '../api/grading';
import request from '../api/request';

const route = useRoute();
const router = useRouter();
const examId = parseInt(route.params.examId);
const exam = ref(null);
const accountList = ref([]);
const taskList = ref([]);
const majorQuestions = ref([]);
const subQuestions = ref([]);
const creating = ref(false);

const taskForm = ref({
  grading_account_id: null,
  task_type: 'content'
});

const selectedMajorQuestions = ref([]);
const selectedSubQuestions = ref([]);
const selectedQuestionTypes = ref([]);

const questionTypes = computed(() => {
  const types = new Set();
  majorQuestions.value.forEach(mq => {
    if (mq.question_type) {
      types.add(mq.question_type);
    }
  });
  return Array.from(types);
});

async function loadExam() {
  try {
    const res = await getExam(examId);
    exam.value = res.data;
    
    // 加载试卷信息
    if (exam.value.paper_id) {
      const paperRes = await getPaper(exam.value.paper_id);
      const paper = paperRes.data;
      
      // 加载大题
      const majorRes = await request.get(`/exam-papers/${exam.value.paper_id}/major-questions`);
      majorQuestions.value = majorRes.data || [];
      
      // 加载小题
      const subRes = await request.get(`/exam-papers/${exam.value.paper_id}/sub-questions`);
      subQuestions.value = subRes.data || [];
    }
  } catch (e) {
    ElMessage.error('加载考试信息失败：' + (e.message || '未知错误'));
  }
}

async function loadAccounts() {
  try {
    const res = await listGradingAccounts({ page: 1, pageSize: 1000 });
    accountList.value = res.data?.list || [];
  } catch (e) {
    ElMessage.error('加载账号列表失败：' + (e.message || '未知错误'));
  }
}

async function loadTasks() {
  try {
    const res = await listGradingTasks(examId);
    taskList.value = res.data || [];
  } catch (e) {
    ElMessage.error('加载任务列表失败：' + (e.message || '未知错误'));
  }
}

function resetForm() {
  taskForm.value = {
    grading_account_id: null,
    task_type: 'content'
  };
  selectedMajorQuestions.value = [];
  selectedSubQuestions.value = [];
  selectedQuestionTypes.value = [];
}

async function handleCreateTask() {
  if (!taskForm.value.grading_account_id) {
    ElMessage.warning('请选择阅卷账号');
    return;
  }
  
  let taskConfig = {};
  
  if (taskForm.value.task_type === 'content') {
    if (selectedMajorQuestions.value.length === 0 && selectedSubQuestions.value.length === 0) {
      ElMessage.warning('请至少选择一个大题或小题');
      return;
    }
    if (selectedMajorQuestions.value.length > 0) {
      taskConfig.major_question_ids = selectedMajorQuestions.value;
    }
    if (selectedSubQuestions.value.length > 0) {
      taskConfig.sub_question_ids = selectedSubQuestions.value;
    }
  } else {
    if (selectedQuestionTypes.value.length === 0) {
      ElMessage.warning('请至少选择一个题型');
      return;
    }
    taskConfig.question_types = selectedQuestionTypes.value;
  }
  
  creating.value = true;
  try {
    await createGradingTask(examId, {
      grading_account_id: taskForm.value.grading_account_id,
      task_type: taskForm.value.task_type,
      task_config: taskConfig
    });
    ElMessage.success('任务创建成功');
    resetForm();
    loadTasks();
  } catch (e) {
    ElMessage.error(e.message || '创建失败');
  } finally {
    creating.value = false;
  }
}

async function handleDeleteTask(task) {
  try {
    await ElMessageBox.confirm('确定删除该任务？', '提示', { type: 'warning' });
    await deleteGradingTask(task.id);
    ElMessage.success('删除成功');
    loadTasks();
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || '删除失败');
    }
  }
}

function viewTaskDetails(task) {
  router.push(`/grading-system/task-details/${task.id}`);
}

function getStatusType(status) {
  const map = {
    pending: 'info',
    assigned: 'warning',
    in_progress: 'primary',
    completed: 'success'
  };
  return map[status] || 'info';
}

function getStatusText(status) {
  const map = {
    pending: '待分配',
    assigned: '已分配',
    in_progress: '进行中',
    completed: '已完成'
  };
  return map[status] || status;
}

onMounted(() => {
  loadExam();
  loadAccounts();
  loadTasks();
});
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0;
}
</style>
