<template>
  <div>
    <div class="toolbar">
      <h2>评分系统</h2>
      <div>
        <el-button @click="$router.push('/grading-system/accounts')">子系统账号管理</el-button>
      </div>
    </div>
    
    <el-tabs v-model="activeTab">
      <el-tab-pane label="考试列表" name="exams">
        <el-table :data="examList" stripe v-loading="loading">
          <el-table-column prop="name" label="考试名称" />
          <el-table-column prop="enterprise_name" label="企业" width="180" />
          <el-table-column prop="paper_name" label="试卷" width="160" />
          <el-table-column prop="start_time" label="开始时间" width="180" />
          <el-table-column prop="end_time" label="结束时间" width="180" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="!isInterviewExam(row)" label="客观题阅卷" width="120">
            <template #default="{ row: r }">
              <el-tag v-if="r.objectiveGraded" type="success">已完成</el-tag>
              <el-tag v-else type="info">未完成</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="!isInterviewExam(row)" label="主观题进度" width="150">
            <template #default="{ row: r }">
              <el-progress 
                :percentage="r.subjectiveProgress || 0" 
                :status="r.subjectiveProgress === 100 ? 'success' : ''"
                :stroke-width="8"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="520" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openExamineeStatus(row)">考生情况</el-button>
              <template v-if="!isInterviewExam(row)">
                <el-button link type="primary" size="small" @click="openObjectiveSetting(row)">客观题设置</el-button>
                <el-button link type="primary" size="small" @click="openObjectiveGradingDialog(row)">客观题阅卷</el-button>
                <el-button link type="primary" size="small" @click="$router.push(`/grading-system/subjective/${row.id}`)">主观题任务分配与阅卷</el-button>
                <el-button link type="primary" size="small" @click="viewStatistics(row)">阅卷统计</el-button>
              </template>
              <template v-else>
                <el-button link type="primary" size="small" @click="viewStatistics(row)">面试成绩汇总</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadExams"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 考生考试情况弹窗（全屏） -->
    <el-dialog
      v-model="examineeDialogVisible"
      :title="`考生考试情况 - ${currentExam?.name || ''}`"
      fullscreen
      destroy-on-close
    >
      <div class="examinee-dialog-content">
        <div class="examinee-section">
          <h4>考生列表</h4>
          <el-table :data="examineeList" stripe max-height="50vh" v-loading="examineeLoading">
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column prop="real_name" label="姓名" width="100" />
            <el-table-column prop="email" label="邮箱" width="160" />
            <el-table-column prop="phone" label="电话" width="120" />
            <el-table-column prop="exam_number" label="准考证号" width="120" />
            <el-table-column prop="position" label="岗位" width="120" />
            <el-table-column label="身份证照" width="140">
              <template #default="{ row }">
                <el-tag v-if="row.id_card_image_path" type="success" size="small">已上传</el-tag>
                <el-tag v-else type="info" size="small">未上传</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="考试状态" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.status === '缺考'" type="warning">缺考</el-tag>
                <el-tag v-else-if="row.status === '违规'" type="danger">违规</el-tag>
                <el-tag v-else type="success">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="violation_count" label="违规次数" width="90">
              <template #default="{ row }">
                <span :class="{ 'text-danger': row.status === '违规' }">{{ row.violation_count }}/{{ row.max_violations }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="invite_code" label="邀请码" width="180" />
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="examineeDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 客观题答案设置弹窗（加大尺寸、丰富功能） -->
    <el-dialog
      v-model="objectiveSettingVisible"
      :title="`客观题答案设置 - ${currentExam?.name || ''}`"
      width="1100px"
      class="objective-setting-dialog"
      destroy-on-close
      @close="objectiveSettingVisible = false"
    >
      <div class="objective-dialog-body">
        <div class="objective-tip">
          <el-alert type="info" :closable="false" show-icon>
            <template #title>
              设置客观题的标准答案。可点击「题库答案选项填入并保存」将匹配到的题库答案提取选项字母填入（单选仅单选项、判断仅对/错、多选必须多选项），也可在表格中手动修改后保存。
            </template>
          </el-alert>
        </div>
        <div class="objective-actions">
          <el-button type="success" :loading="fillingFromBank" @click="fillStandardFromBankAndSave">
            <el-icon><CopyDocument /></el-icon>
            题库答案选项填入并保存
          </el-button>
          <span class="action-hint">共 {{ objectiveQuestions.length }} 道客观题</span>
        </div>
        <el-table :data="objectiveQuestions" stripe max-height="60vh" v-loading="objectiveLoading" border>
          <el-table-column prop="displayNumber" label="题号" width="80" fixed="left" align="center">
            <template #default="{ row }">
              <span class="question-number">{{ row.displayNumber }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="answerTypeLabel" label="答题方式" width="100" fixed="left" align="center">
            <template #default="{ row }">
              <el-tag size="small" type="info">{{ row.answerTypeLabel || row.question_type || '-' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="题库答案" width="180" min-width="140">
            <template #default="{ row }">
              <div class="bank-answer-cell" :title="row.bankAnswer || '-'">
                <span class="text-muted">{{ row.bankAnswer || '-' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="解析" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="text-muted" :title="row.bankExplanation || '-'">{{ row.bankExplanation || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="标准答案" min-width="260">
            <template #default="{ row }">
              <el-input
                v-model="row.standard_answer"
                :placeholder="row.answerTypeLabel === '多选题' ? '如：A,B 或 A,B,C' : (row.answerTypeLabel === '判断题' ? '正确 或 错误' : (row.answerTypeLabel === '填空题' ? '如：xxx,xxx（多空逗号分隔）' : '如：A'))"
                size="small"
                clearable
                class="standard-answer-input"
              />
            </template>
          </el-table-column>
        </el-table>
        <div v-if="objectiveQuestions.length === 0 && !objectiveLoading" class="empty-tip">
          该试卷暂无客观题。请在「答题预览」中为小题设置答题方式（选择题、多选题、判断题、填空题）后，客观题将在此显示。
        </div>
      </div>
      <template #footer>
        <el-button @click="objectiveSettingVisible = false">取消</el-button>
        <el-button type="primary" @click="saveObjectiveAnswers" :loading="savingObjective">
          <el-icon><Check /></el-icon>
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 客观题阅卷（执行阅卷 + 结果与导出 合并） -->
    <el-dialog
      v-model="objectiveResultsVisible"
      :title="`客观题阅卷 - ${currentExam?.name || ''}`"
      width="1000px"
      class="objective-grading-dialog"
      destroy-on-close
      @opened="onObjectiveGradingDialogOpened"
    >
      <div class="objective-results-header">
        <span class="total-count">共 <strong>{{ objectiveResultsList.length }}</strong> 名已交卷考生（按标准答案自动阅卷）</span>
        <div class="header-actions">
          <el-button type="warning" size="small" :loading="syncingObjectiveAnswers" @click="doSyncObjectiveAnswers">
            同步所有考生客观题答案
          </el-button>
          <el-button type="primary" size="small" :loading="gradingInProgress" :disabled="!objectiveSettingsOk" @click="doGradeObjective">
            {{ objectiveSettingsOk ? '执行阅卷' : `请先完成客观题设置（缺 ${objectiveSettingsMissingCount} 题）` }}
          </el-button>
          <el-button type="success" size="small" @click="doExportObjectiveResults" :loading="exportingResults" :disabled="objectiveResultsList.length === 0">
            导出表格（含明细）
          </el-button>
        </div>
      </div>
      <el-table :data="objectiveResultsList" stripe max-height="55vh" v-loading="objectiveResultsLoading" row-key="session_id" :default-expand-all="true">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div v-if="row.details && row.details.length" class="detail-table-wrap">
              <div class="detail-title">每题得分明细（题号与答题预览一致）</div>
              <el-table :data="row.details" size="small" border>
                <el-table-column prop="displayNumber" label="题号" width="70" align="center" />
                <el-table-column prop="standard_answer" label="标准答案" width="100" show-overflow-tooltip />
                <el-table-column prop="student_answer" label="考生答案" width="100" show-overflow-tooltip />
                <el-table-column prop="max_score" label="满分" width="60" align="center">
                  <template #default="{ row: d }">{{ d.max_score != null ? d.max_score : '-' }}</template>
                </el-table-column>
                <el-table-column prop="score" label="得分" width="70" align="center">
                  <template #default="{ row: d }">
                    <span :class="{ 'score-correct': d.correct === true, 'score-wrong': d.correct === false }">
                      {{ d.score != null ? d.score : '-' }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="正确" width="70" align="center">
                  <template #default="{ row: d }">
                    <el-tag v-if="d.correct === true" type="success" size="small">是</el-tag>
                    <el-tag v-else-if="d.correct === false" type="danger" size="small">否</el-tag>
                    <span v-else>-</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <div v-else class="empty-tip-small">暂无明细</div>
          </template>
        </el-table-column>
        <el-table-column prop="rank" label="总排名" width="80" />
        <el-table-column prop="position" label="岗位" width="120" />
        <el-table-column prop="positionRank" label="岗位内排名" width="100" />
        <el-table-column prop="real_name" label="姓名" width="100" />
        <el-table-column prop="exam_number" label="准考证号" width="120" />
        <el-table-column prop="total_score" label="客观题得分" width="110" align="center">
          <template #default="{ row }">
            <strong>{{ row.total_score != null ? row.total_score : '-' }}</strong>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="objectiveResultsList.length === 0 && !objectiveResultsLoading" class="empty-tip">
        <template v-if="objectiveSessionStats">
          <p>暂无已交卷考生。</p>
          <p class="empty-tip-stats">
            本场考试：共 {{ objectiveSessionStats.total }} 人参加，
            <span v-if="objectiveSessionStats.submitted > 0">其中 {{ objectiveSessionStats.submitted }} 人已交卷（若未显示请刷新）</span>
            <span v-else>
              {{ objectiveSessionStats.ongoing || 0 }} 人考试中、{{ objectiveSessionStats.pending || 0 }} 人未开始。
              请确认考生已点击「交卷」按钮完成提交。
            </span>
          </p>
          <p class="empty-tip-hint">可点击「考生情况」查看每位考生的考试状态（已交卷/考试中/缺考）。</p>
        </template>
        <template v-else>暂无已交卷考生。请先进行考试收卷，再执行客观题阅卷。</template>
      </div>
      <template #footer>
        <el-button @click="objectiveResultsVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { CopyDocument, Check } from '@element-plus/icons-vue';
import { listExams, gradeExam, getExamineeStatus, getObjectiveSettingsCheck, getObjectiveGradedStatus, getObjectiveResults, exportObjectiveResults, syncObjectiveAnswers } from '../api/exams';
import { listGradingTasks, getTaskProgress } from '../api/grading';
import request from '../api/request';

const router = useRouter();
const loading = ref(false);
const examList = ref([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const activeTab = ref('exams');

// 考生情况弹窗
const examineeDialogVisible = ref(false);
const examineeList = ref([]);
const examineeLoading = ref(false);
const currentExam = ref(null);

// 客观题设置弹窗
const objectiveSettingVisible = ref(false);
const objectiveQuestions = ref([]);
const objectiveLoading = ref(false);
const savingObjective = ref(false);
const fillingFromBank = ref(false);

// 客观题阅卷（合并执行+结果）弹窗
const objectiveResultsVisible = ref(false);
const objectiveResultsList = ref([]);
const objectiveResultsLoading = ref(false);
const objectiveSettingsOk = ref(true);
const objectiveSettingsMissingCount = ref(0);
const objectiveSessionStats = ref(null);
const gradingInProgress = ref(false);
const exportingResults = ref(false);
const syncingObjectiveAnswers = ref(false);

async function loadExams() {
  loading.value = true;
  try {
    const res = await listExams({ page: page.value, pageSize: pageSize.value });
    const exams = res.data?.list || [];
    
    // 加载每个考试的阅卷状态
    for (const exam of exams) {
      try {
        const statusRes = await getObjectiveGradedStatus(exam.id);
        exam.objectiveGraded = statusRes.data?.ok ?? false;
      } catch (e) {
        exam.objectiveGraded = false;
      }
      // 加载主观题进度
      try {
        const tasksRes = await listGradingTasks(exam.id);
        const tasks = tasksRes.data || [];
        let totalProgress = 0;
        let taskCount = 0;
        
        for (const task of tasks) {
          try {
            const progressRes = await getTaskProgress(task.id);
            const progress = progressRes.data?.progress || 0;
            totalProgress += progress;
            taskCount++;
          } catch (e) {
            // 403 表示无权限查看该任务（非本企业），跳过即可，不展示、不报错
            if (e.response?.status !== 403) console.error('Get task progress error:', e);
          }
        }
        
        exam.subjectiveProgress = taskCount > 0 ? Math.round(totalProgress / taskCount) : 0;
      } catch (e) {
        exam.subjectiveProgress = 0;
      }
    }
    
    examList.value = exams;
    total.value = res.data?.total || 0;
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

function statusType(s) {
  const map = { draft: 'info', published: 'success', ongoing: 'warning', ended: 'info', cancelled: 'danger' };
  return map[s] || 'info';
}

function statusText(s) {
  const map = { draft: '草稿', published: '已发布', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
  return map[s] || s;
}

function openObjectiveGradingDialog(exam) {
  currentExam.value = exam;
  objectiveResultsVisible.value = true;
  objectiveResultsList.value = [];
  objectiveSettingsOk.value = true;
  objectiveSettingsMissingCount.value = 0;
}

async function onObjectiveGradingDialogOpened() {
  if (!currentExam.value) return;
  objectiveResultsLoading.value = true;
  objectiveSessionStats.value = null;
  try {
    const [checkRes, resultsRes] = await Promise.all([
      getObjectiveSettingsCheck(currentExam.value.id),
      getObjectiveResults(currentExam.value.id, true)
    ]);
    const check = checkRes.data || {};
    objectiveSettingsOk.value = !!check.ok;
    objectiveSettingsMissingCount.value = check.missingCount || 0;
    objectiveResultsList.value = resultsRes.data?.list || [];
    objectiveSessionStats.value = resultsRes.data?.sessionStats || null;
  } catch (e) {
    objectiveResultsList.value = [];
    objectiveSessionStats.value = null;
    ElMessage.error(e.message || '加载失败');
  } finally {
    objectiveResultsLoading.value = false;
  }
}

async function doGradeObjective() {
  if (!currentExam.value || !objectiveSettingsOk.value) return;
  try {
    await ElMessageBox.confirm(
      '将对已交卷的答卷进行客观题自动阅卷（选择题、判断题、多选题、填空题），需确保已在客观题设置中完成所有标准答案。是否继续？',
      '执行阅卷',
      { type: 'info' }
    );
    gradingInProgress.value = true;
    const res = await gradeExam(currentExam.value.id);
    const results = res.data?.results || [];
    const ok = results.filter(r => !r.error).length;
    const err = results.filter(r => r.error).length;
    ElMessage.success(`阅卷完成：${ok} 份成功${err > 0 ? `，${err} 份失败` : ''}`);
    await onObjectiveGradingDialogOpened();
    loadExams();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.message || e.message || '阅卷失败');
  } finally {
    gradingInProgress.value = false;
  }
}

async function doSyncObjectiveAnswers() {
  if (!currentExam.value) return;
  syncingObjectiveAnswers.value = true;
  try {
    const res = await syncObjectiveAnswers(currentExam.value.id);
    ElMessage.success(res.message || '同步成功');
    await onObjectiveGradingDialogOpened();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '同步失败');
  } finally {
    syncingObjectiveAnswers.value = false;
  }
}

async function doExportObjectiveResults() {
  if (!currentExam.value) return;
  exportingResults.value = true;
  try {
    await exportObjectiveResults(currentExam.value.id, currentExam.value.name, true);
    ElMessage.success('导出成功');
  } catch (e) {
    ElMessage.error(e.message || '导出失败');
  } finally {
    exportingResults.value = false;
  }
}

function isInterviewExam(row) {
  return (row && (row.exam_type || row.examType) === 'interview');
}

function viewStatistics(exam) {
  if (isInterviewExam(exam)) {
    router.push(`/grading-system/interview-summary/${exam.id}`);
  } else {
    router.push(`/grading-system/statistics/${exam.id}`);
  }
}

async function openExamineeStatus(exam) {
  currentExam.value = exam;
  examineeDialogVisible.value = true;
  examineeList.value = [];
  examineeLoading.value = true;
  try {
    const examineeRes = await getExamineeStatus(exam.id);
    examineeList.value = examineeRes.data || [];
  } catch (e) {
    ElMessage.error('加载考生情况失败');
  } finally {
    examineeLoading.value = false;
  }
}

async function openObjectiveSetting(exam) {
  currentExam.value = exam;
  objectiveSettingVisible.value = true;
  objectiveQuestions.value = [];
  objectiveLoading.value = true;
  try {
    const subRes = await request.get(`/exams/${exam.id}/objective-questions`);
    const list = Array.isArray(subRes?.data) ? subRes.data : (Array.isArray(subRes) ? subRes : []);
    const stripHtml = (v) => (v && typeof v === 'string') ? v.replace(/<[^>]+>/g, '').trim() : '';
    objectiveQuestions.value = list.map(q => ({
      ...q,
      bankAnswer: (q.bankAnswer && q.bankAnswer.trim()) || (q.answer && String(q.answer).trim()) || stripHtml(q.answer_html) || '',
      bankExplanation: (q.bankExplanation && q.bankExplanation.trim()) || (q.explanation && String(q.explanation).trim()) || stripHtml(q.explanation_html) || (q.answer_analysis && String(q.answer_analysis).trim()) || '',
      standard_answer: q.standard_answer || ''
    }));
  } catch (e) {
    ElMessage.error('加载客观题失败');
  } finally {
    objectiveLoading.value = false;
  }
}

/** 从答案文本中仅提取选项字母，规则：单选仅单选项无重复，判断仅对/错，多选必须多选项 */
function extractOptionsOnly(text, answerType) {
  if (!text || typeof text !== 'string') return '';
  const s = String(text).trim();
  if (!s) return '';
  const t = answerType ? String(answerType).toLowerCase() : '';
  if (t === 'judge') {
    if (/对|正确/.test(s)) return '正确';
    if (/错|错误/.test(s)) return '错误';
    return '';
  }
  if (t === 'blank') return '';
  const letters = (s.match(/[A-F]/gi) || []).map(c => c.toUpperCase());
  const unique = [...new Set(letters)];
  if (t === 'choice' || t === '单选题' || t === '选择题') {
    if (unique.length === 0) return '';
    return unique[0];
  }
  if (t === 'multichoice' || t === '多选题') {
    if (unique.length < 2) return '';
    return unique.sort().join(',');
  }
  return unique.length > 0 ? unique.sort().join(',') : '';
}

async function fillStandardFromBankAndSave() {
  if (!objectiveQuestions.value.length) return;
  fillingFromBank.value = true;
  try {
    let filled = 0;
    for (const q of objectiveQuestions.value) {
      if (!q.bankAnswer || !q.bankAnswer.trim()) continue;
      const extracted = extractOptionsOnly(q.bankAnswer, q.answerType);
      if (extracted) {
        q.standard_answer = extracted;
        filled++;
      }
    }
    await saveObjectiveAnswers();
    ElMessage.success(`已从题库答案提取选项填入 ${filled} 道题并保存`);
  } catch (e) {
    ElMessage.error(e.message || '操作失败');
  } finally {
    fillingFromBank.value = false;
  }
}

async function saveObjectiveAnswers() {
  savingObjective.value = true;
  try {
    for (const q of objectiveQuestions.value) {
      if (q.standard_answer !== undefined) {
        await request.put(`/exam-papers/sub-questions/${q.id}`, {
          standard_answer: q.standard_answer || null
        });
      }
    }
    ElMessage.success('保存成功');
    objectiveSettingVisible.value = false;
    loadExams();
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '保存失败';
    ElMessage.error(msg);
  } finally {
    savingObjective.value = false;
  }
}

onMounted(loadExams);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.el-pagination {
  margin-top: 16px;
}
.text-danger {
  color: var(--el-color-danger);
  font-weight: 500;
}
.text-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.objective-setting-dialog {
  max-width: 96vw;
}
.objective-dialog-body {
  padding: 0 4px;
}
.objective-tip {
  margin-bottom: 14px;
}
.objective-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.objective-actions .action-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-left: 8px;
}
.question-number {
  font-weight: 500;
}
.bank-answer-cell {
  font-size: 13px;
}
.standard-answer-input {
  margin-bottom: 4px;
}
.empty-tip {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.empty-tip p { margin: 8px 0; }
.empty-tip-stats { font-size: 14px; }
.empty-tip-hint { font-size: 13px; color: var(--el-text-color-regular); }
.examinee-dialog-content { padding: 0 8px; }
.examinee-section { margin-bottom: 24px; }
.examinee-section h4 { margin: 0 0 12px 0; font-size: 15px; }
.paper-answers-section { margin-top: 20px; }
.empty-tip-small { padding: 16px; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }
.objective-results-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.objective-results-header .total-count { font-size: 14px; }
.objective-results-header .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.detail-table-wrap { padding: 12px 0; }
.detail-title { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 10px; }
.score-correct { color: var(--el-color-success); font-weight: 500; }
.score-wrong { color: var(--el-color-danger); }
</style>
