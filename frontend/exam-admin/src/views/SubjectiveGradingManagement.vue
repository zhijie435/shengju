<template>
  <div>
    <el-page-header @back="$router.back()" :title="exam?.name || '主观题任务分配与阅卷'" />
    <div class="toolbar">
      <h2>主观题任务分配与阅卷</h2>
      <el-button @click="loadAll">刷新</el-button>
    </div>

    <el-tabs v-model="activeTab" class="main-tabs">
      <el-tab-pane label="任务分配" name="assignment">
        <el-card>
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>创建新任务</span>
              <el-button type="warning" size="small" :loading="syncingAnswers" @click="handleSyncAnswers">
                同步考生答案
              </el-button>
            </div>
          </template>
          <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
            <template #title>子系统显示「分配题数」和「阅卷任务」的前提</template>
            考生交卷时主观题答案先存入临时表，子系统从阅卷表（exam_answers）读取。请<strong>先点击「同步考生答案」</strong>，将主观题答案同步到阅卷表后，再创建任务，子系统端才会显示分配题数和待阅卷列表。
          </el-alert>
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
              <el-form-item label="按大题分配">
                <el-checkbox-group v-model="selectedMajorQuestions">
                  <el-checkbox
                    v-for="mq in sortedMajorQuestions"
                    :key="mq.id"
                    :value="mq.id"
                  >
                    第{{ mq.major_number || mq.order_number || '-' }}题 - {{ mq.question_type || '未知题型' }}
                  </el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="按小题分配">
                <el-alert
                  v-if="subjectiveQuestions.length === 0 && !loadingQuestions"
                  type="info"
                  :closable="false"
                  style="margin-bottom: 10px;"
                >
                  暂无主观题小题。请在「答题预览」中为小题设置答题方式（简答题、作文题、作图题等非客观题）后，主观题将在此显示。
                </el-alert>
                <el-checkbox-group v-model="selectedSubQuestions">
                  <el-checkbox
                    v-for="sq in filteredSubjectiveQuestions"
                    :key="sq.id"
                    :value="sq.id"
                  >
                    {{ sq.displayNumber }} ({{ sq.score }}分) - {{ sq.answerTypeLabel || '未知' }}
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

        <!-- 主观题列表：按答题预览的答题方式展示，答案与解析可同步，考生答案由考生端按答题方式同步 -->
        <el-card style="margin-top: 20px" class="subjective-list-card">
          <template #header>
            <div class="subjective-list-header">
              <span>主观题列表</span>
              <div class="header-actions">
                <el-button type="primary" size="small" :loading="syncingFromBank" @click="handleSyncAnswersFromBank">
                  同步答案与解析
                </el-button>
                <el-button type="warning" size="small" :loading="syncingAnswers" @click="handleSyncAnswers">
                  同步考生答案
                </el-button>
                <el-select v-model="filterAnswerType" placeholder="按答题方式筛选" clearable style="width: 160px" size="small">
                  <el-option label="全部" value="" />
                  <el-option v-for="type in answerTypes" :key="type" :label="type" :value="type" />
                </el-select>
              </div>
            </div>
            <div class="subjective-list-desc">
              按答题预览设置的答题方式展示；答案即标准答案，可点击「同步答案与解析」从题库同步；点击「同步考生答案」将交卷时上传的主观题答案同步到阅卷表（与客观题阅卷方式一致），同步后下方考生答案列会显示各考生答案。
            </div>
          </template>
          <el-table :data="filteredSubjectiveQuestions" stripe max-height="500px" v-loading="loadingQuestions" border>
            <el-table-column prop="displayNumber" label="题号" width="80" fixed="left" align="center">
              <template #default="{ row }">
                <span class="question-number">{{ row.displayNumber }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="answerTypeLabel" label="答题方式" width="100" fixed="left" align="center">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.answerTypeLabel || '-' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="答案" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <span>{{ displayAnswer(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="解析" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="text-muted">{{ row.bankExplanation || row.answer_analysis || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="考生答案" min-width="280">
              <template #default="{ row }">
                <div v-if="row.studentAnswers && row.studentAnswers.length > 0" class="student-answers">
                  <el-button link type="primary" size="small" @click="openStudentAnswersDialog(row)">
                    查看 {{ row.studentAnswers.length }} 位考生答案
                  </el-button>
                </div>
                <span v-else class="text-muted">暂无考生答案（考生交卷后按答题方式同步）</span>
              </template>
            </el-table-column>
            <el-table-column label="分配" width="80" align="center">
              <template #default="{ row }">
                <el-checkbox
                  :model-value="selectedSubQuestions.includes(row.id)"
                  @update:model-value="(checked) => toggleSubQuestionSelection(row.id, checked)"
                />
              </template>
            </el-table-column>
          </el-table>
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
          <el-alert v-if="taskList.length > 0 && taskList.every(t => (t.total ?? 0) === 0)" type="info" :closable="false" style="margin-top: 12px;">
            若分配题数均为 0，请先点击本页「同步考生答案」，将考生交卷的主观题答案同步到阅卷表后再刷新。
          </el-alert>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 考生答案查看对话框 -->
    <el-dialog
      v-model="studentAnswersDialogVisible"
      title="考生答案查看"
      width="80%"
      :close-on-click-modal="false"
    >
      <div v-if="currentQuestionForDialog">
        <div style="margin-bottom: 16px;">
          <el-input
            v-model="studentAnswerSearchText"
            placeholder="搜索考生姓名或准考证号"
            clearable
            style="width: 300px;"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
        <div class="question-info" style="margin-bottom: 16px; padding: 12px; background: #f5f7fa; border-radius: 4px;">
          <div><strong>题号：</strong>{{ currentQuestionForDialog.displayNumber }}</div>
          <div><strong>答题方式：</strong>{{ currentQuestionForDialog.answerTypeLabel }}</div>
          <div><strong>标准答案：</strong>{{ currentQuestionForDialog.standard_answer || '-' }}</div>
        </div>
        <el-table :data="filteredStudentAnswers" stripe border max-height="500px">
          <el-table-column prop="realName" label="姓名" width="120">
            <template #default="{ row }">
              {{ row.realName || row.username }}
            </template>
          </el-table-column>
          <el-table-column prop="examNumber" label="准考证号" width="150" />
          <el-table-column prop="username" label="用户名" width="150" />
          <el-table-column label="答案内容" min-width="300">
            <template #default="{ row }">
              <div class="answer-content-dialog">
                {{ formatStudentAnswer(row) }}
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { getExam, getPaper, getSubjectiveQuestions, syncSubjectiveAnswers, syncAnswersFromBank } from '../api/exams';
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
const subjectiveQuestions = ref([]);
const creating = ref(false);
const loadingQuestions = ref(false);
const syncingAnswers = ref(false);
const syncingFromBank = ref(false);
const activeTab = ref('assignment');
const filterAnswerType = ref('');
const studentAnswersDialogVisible = ref(false);
const currentQuestionForDialog = ref(null);
const studentAnswerSearchText = ref('');

const taskForm = ref({
  grading_account_id: null,
  task_type: 'content'
});

const selectedMajorQuestions = ref([]);
const selectedSubQuestions = ref([]);
const selectedQuestionTypes = ref([]);

// 判断是否是客观题
function isObjectiveQuestionType(type) {
  if (!type) return false;
  const t = String(type);
  const objectiveTypes = ['choice', 'judge', 'multichoice', 'blank', '选择题', '判断题', '多选题', '单选题', '填空题'];
  return objectiveTypes.some(ot => t.includes(ot));
}

// 主观题列表：答案列优先显示标准答案，无则题库答案
function displayAnswer(row) {
  const v = (row.standard_answer && String(row.standard_answer).trim()) || (row.bankAnswer && String(row.bankAnswer).trim());
  return v || '-';
}

// 格式化题号显示
function formatQuestionNumber(sq) {
  if (sq.major_number) {
    let result = `第${sq.major_number}题`;
    if (sq.number) {
      result += `-${sq.number}`;
    }
    if (sq.sub_number) {
      result += `.${sq.sub_number}`;
    }
    return result;
  }
  if (sq.sub_number) {
    return `${sq.number || ''}.${sq.sub_number}`;
  }
  return sq.number || sq.question_number || '-';
}

// 格式化考生答案
function formatStudentAnswer(sa) {
  if (sa.answerData) {
    try {
      const d = typeof sa.answerData === 'string' ? JSON.parse(sa.answerData) : sa.answerData;
      if (d.selected) return Array.isArray(d.selected) ? d.selected.join(',') : d.selected;
      if (d.blanks) return Array.isArray(d.blanks) ? d.blanks.join(',') : d.blanks;
      if (d.imageBase64) return '[已上传图片]';
    } catch (_) {}
  }
  return sa.answerText || '-';
}

// 仅保留答题方式中含主观题的大题（客观题大题不显示）
const majorQuestionIdsWithSubjective = computed(() => {
  const ids = new Set();
  subjectiveQuestions.value.forEach(q => {
    if (q.major_question_id != null) ids.add(q.major_question_id);
  });
  return ids;
});

const sortedMajorQuestions = computed(() => {
  return majorQuestions.value
    .filter(mq => majorQuestionIdsWithSubjective.value.has(mq.id))
    .sort((a, b) => {
      const numA = parseInt(a.major_number || a.order_number || 0);
      const numB = parseInt(b.major_number || b.order_number || 0);
      return numA - numB;
    });
});

// 主观题列表唯一数据源：GET subjective-questions（按答题预览的答题方式，不显示客观题）
// 过滤后的主观题列表（按答题方式筛选）
const filteredSubjectiveQuestions = computed(() => {
  let filtered = subjectiveQuestions.value;
  if (filterAnswerType.value) {
    filtered = filtered.filter(q => q.answerTypeLabel === filterAnswerType.value);
  }
  return filtered;
});

// 答题方式列表
const answerTypes = computed(() => {
  const types = new Set();
  subjectiveQuestions.value.forEach(q => {
    if (q.answerTypeLabel) {
      types.add(q.answerTypeLabel);
    }
  });
  return Array.from(types);
});

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
    
    if (exam.value.paper_id) {
      try {
        const paperRes = await getPaper(exam.value.paper_id);
        const paper = paperRes.data;
        
        const majorRes = await request.get(`/exam-papers/${exam.value.paper_id}/major-questions`);
        majorQuestions.value = majorRes.data || [];
        
        const subRes = await request.get(`/exam-papers/${exam.value.paper_id}/sub-questions`);
        subQuestions.value = subRes.data || [];
      } catch (e) {
        // 如果无法加载试卷信息，不影响主观题列表的加载
        console.warn('加载试卷信息失败（可能无权限）:', e.message);
      }
    }
  } catch (e) {
    ElMessage.error('加载考试信息失败：' + (e.message || '未知错误'));
  }
}

async function loadSubjectiveQuestions() {
  loadingQuestions.value = true;
  try {
    const res = await getSubjectiveQuestions(examId);
    subjectiveQuestions.value = res.data || [];
  } catch (e) {
    const errorMsg = e.response?.data?.message || e.message || '未知错误';
    if (e.response?.status === 403) {
      ElMessage.error('无权限访问主观题列表');
    } else {
      ElMessage.error('加载主观题列表失败：' + errorMsg);
    }
    subjectiveQuestions.value = [];
  } finally {
    loadingQuestions.value = false;
  }
}

async function loadAccounts() {
  try {
    const res = await listGradingAccounts({ page: 1, pageSize: 1000 });
    accountList.value = res.data?.list || [];
  } catch (e) {
    // 子账号可能无法访问账号列表API，这是正常的，不显示错误
    if (e.response?.status === 403) {
      console.log('无权限访问账号列表（可能是子账号）');
      accountList.value = [];
    } else {
      ElMessage.error('加载账号列表失败：' + (e.message || '未知错误'));
    }
  }
}

async function loadTasks() {
  try {
    const res = await listGradingTasks(examId);
    taskList.value = res.data || [];
    
    // 如果子账号有任务，自动切换到阅卷标签页
    if (taskList.value.length > 0 && activeTab.value === 'assignment') {
      // 检查是否是子账号（通过是否有权限创建任务来判断）
      // 这里不自动切换，让用户自己选择
    }
  } catch (e) {
    // 子账号可能无法访问任务列表API，这是正常的
    if (e.response?.status === 403) {
      console.log('无权限访问任务列表（可能是子账号）');
      taskList.value = [];
    } else {
      ElMessage.error('加载任务列表失败：' + (e.message || '未知错误'));
    }
  }
}

async function handleSyncAnswers() {
  syncingAnswers.value = true;
  try {
    const res = await syncSubjectiveAnswers(examId);
    ElMessage.success(res.message || '同步成功');
    await loadSubjectiveQuestions();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '同步失败');
  } finally {
    syncingAnswers.value = false;
  }
}

async function handleSyncAnswersFromBank() {
  syncingFromBank.value = true;
  try {
    const res = await syncAnswersFromBank(examId, { category: '未分类', subject: '未分类' });
    ElMessage.success(res.message || '同步成功');
    await loadSubjectiveQuestions();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '同步失败');
  } finally {
    syncingFromBank.value = false;
  }
}

function toggleSubQuestionSelection(id, checked) {
  if (checked) {
    if (!selectedSubQuestions.value.includes(id)) {
      selectedSubQuestions.value = [...selectedSubQuestions.value, id];
    }
  } else {
    selectedSubQuestions.value = selectedSubQuestions.value.filter((x) => x !== id);
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
    // 子账号可能无法创建任务，显示友好的错误提示
    const errorMsg = e.response?.data?.message || e.message || '创建失败';
    if (e.response?.status === 403) {
      ElMessage.error('无权限创建任务，请联系管理员');
    } else {
      ElMessage.error(errorMsg);
    }
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
      const errorMsg = e.response?.data?.message || e.message || '删除失败';
      if (e.response?.status === 403) {
        ElMessage.error('无权限删除任务，请联系管理员');
      } else {
        ElMessage.error(errorMsg);
      }
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

// 过滤后的考生答案（用于对话框搜索）
const filteredStudentAnswers = computed(() => {
  if (!currentQuestionForDialog.value || !currentQuestionForDialog.value.studentAnswers) {
    return [];
  }
  let answers = currentQuestionForDialog.value.studentAnswers;
  if (studentAnswerSearchText.value) {
    const searchText = studentAnswerSearchText.value.toLowerCase();
    answers = answers.filter(sa => {
      const name = (sa.realName || sa.username || '').toLowerCase();
      const examNumber = (sa.examNumber || '').toLowerCase();
      return name.includes(searchText) || examNumber.includes(searchText);
    });
  }
  return answers;
});

// 打开考生答案对话框
function openStudentAnswersDialog(question) {
  currentQuestionForDialog.value = question;
  studentAnswerSearchText.value = '';
  studentAnswersDialogVisible.value = true;
}

async function loadAll() {
  await Promise.all([
    loadExam(),
    loadSubjectiveQuestions(),
    loadAccounts(),
    loadTasks()
  ]);
}

onMounted(() => {
  loadAll();
});
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0;
}
.main-tabs {
  margin-top: 20px;
}
.question-number {
  font-weight: 500;
}
.bank-answer-cell {
  font-size: 13px;
}
.text-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.student-answers-list {
  max-height: 400px;
  overflow-y: auto;
}
.student-answer-item {
  padding: 8px 0;
  border-bottom: 1px solid #ebeef5;
}
.student-answer-item:last-child {
  border-bottom: none;
}
.student-info {
  margin-bottom: 4px;
}
.exam-number {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.answer-content {
  font-size: 13px;
  color: var(--el-text-color-regular);
  word-break: break-word;
}
.grading-content {
  min-height: 200px;
}
.answer-item {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}
.answer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.answer-question {
  margin-bottom: 12px;
  font-size: 14px;
  line-height: 1.6;
}
.answer-question :deep(img) {
  max-width: 100%;
}
.answer-meta {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
  display: flex;
  gap: 16px;
}
.answer-student {
  margin-bottom: 12px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
}
.answer-score-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.grading-info {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  display: flex;
  gap: 16px;
}
.ml-12 {
  margin-left: 12px;
}
.answer-content-dialog {
  word-break: break-word;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}
.question-info {
  font-size: 14px;
  line-height: 1.8;
}
.question-info > div {
  margin-bottom: 4px;
}
.subjective-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.subjective-list-header .header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.subjective-list-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 8px;
  line-height: 1.5;
}
</style>
