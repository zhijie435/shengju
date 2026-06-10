<template>
  <div>
    <el-page-header @back="$router.back()" content="面试考试设置" />
    <h2 class="page-title">面试考试设置 - {{ exam?.name || '' }}</h2>
    <el-alert
      v-if="exam && exam.exam_type !== 'interview'"
      type="warning"
      show-icon
      :closable="false"
      class="mb-16"
    >
      仅支持 <strong>面试类型</strong> 的考试。本考试当前类型为「{{ examTypeLabel }}」，如需使用面试考试设置请先选择面试类型试卷。
    </el-alert>

    <el-tabs v-model="activeTab" class="tabs-root">
      <el-tab-pane label="面试显示设置" name="display">
        <el-card shadow="never" class="mb-16">
          <template #header>
            <span><strong>防作弊设置</strong>（与笔试一致，考生端按配置启用全屏、双摄等）</span>
          </template>
          <el-form label-width="200px" :model="monitorConfig">
            <el-form-item label="强制全屏">
              <el-switch v-model="monitorConfig.requireFullscreen" />
              <span class="form-tip">开启后考生进入考试须全屏，退出全屏将记录违规</span>
            </el-form-item>
            <el-form-item label="双摄像头">
              <el-switch v-model="monitorConfig.dualCamera" />
              <span class="form-tip">开启后采集考生摄像头画面并上传</span>
            </el-form-item>
            <el-form-item label="启用人脸识别">
              <el-switch v-model="monitorConfig.faceVerifyEnabled" />
              <span class="form-tip">开启后，对已上传身份证的考生启用人脸识别功能</span>
            </el-form-item>
            <el-form-item label="屏幕监控">
              <el-switch v-model="monitorConfig.screenShare" />
              <span class="form-tip">开启后采集考生端屏幕画面上传监考端（单向，考生端不会看到企业/监考端画面）</span>
            </el-form-item>
            <el-form-item label="侧面摄像头（手机扫码）">
              <el-switch v-model="monitorConfig.sideCamera" />
              <span class="form-tip">开启后考场页显示二维码，考生用手机扫码开启侧面摄像头</span>
            </el-form-item>
            <el-form-item label="锁屏/切屏监控">
              <el-switch v-model="monitorConfig.lockScreen" />
              <span class="form-tip">监听切屏、复制、粘贴、右键等并记录违规</span>
            </el-form-item>
            <el-form-item label="最大违规次数">
              <el-input-number v-model="monitorConfig.maxViolations" :min="1" :max="20" />
              <span class="form-tip">超过后提示并记录</span>
            </el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never" class="mb-16 interview-flow-card">
          <template #header>
            <span><strong>面试流程与叫号</strong>（传统 / 提前录制 / 线上顺序）</span>
          </template>
          <el-alert type="info" :closable="false" show-icon class="mb-12">
            此处为<strong>整场面试的流程模式</strong>，保存后考生端叫号、候考与交卷逻辑会随之变化；与下方「试题与作答展示」无关。
          </el-alert>
          <el-form label-width="200px" :model="interviewConfig">
            <el-form-item label="面试流程模式">
              <el-radio-group v-model="interviewConfig.interviewFlowMode" @change="onInterviewFlowModeChange">
                <el-radio-button label="legacy">传统</el-radio-button>
                <el-radio-button label="prerecord">提前录制</el-radio-button>
                <el-radio-button label="online">线上顺序</el-radio-button>
              </el-radio-group>
              <span class="form-tip" style="display: block; margin-top: 6px;">提前录制：抽签后进入统一候考室，考务「开放答题」后同时开始作答并上传录像；线上顺序：按签号排队，轮到签号自动可答。</span>
            </el-form-item>
            <template v-if="interviewConfig.interviewFlowMode === 'prerecord'">
              <el-form-item label="统一开考策略">
                <el-radio-group v-model="interviewConfig.prerecordStartPolicy">
                  <el-radio label="manual">仅人工开放</el-radio>
                  <el-radio label="scheduled">仅定时自动开放</el-radio>
                  <el-radio label="scheduled_confirm">定时到点待人工确认</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item v-if="interviewConfig.prerecordStartPolicy !== 'manual'" label="计划开考时间">
                <el-date-picker
                  v-model="interviewConfig.prerecordScheduledStartAt"
                  type="datetime"
                  value-format="YYYY-MM-DDTHH:mm:ss"
                  placeholder="选择计划开考时间（本地）"
                  style="width: 320px;"
                />
              </el-form-item>
            </template>
            <el-form-item v-if="interviewConfig.interviewFlowMode === 'online'" label="交卷后自动叫下一位">
              <el-switch v-model="interviewConfig.onlineAutoAdvanceOnSubmit" />
              <span class="form-tip">当前考生交卷且全部考官已保存评分后，自动推进叫号（等价于计时端「下一位」）。</span>
            </el-form-item>
            <el-form-item label="按顺序入场（按签号）">
              <el-switch
                v-model="interviewConfig.sequentialEntry"
                :disabled="interviewConfig.interviewFlowMode === 'online' || interviewConfig.interviewFlowMode === 'prerecord'"
              />
              <span class="form-tip">开启后考生按抽签号顺序进入考场，考官端可操作「开始答题」「下一位」。线上顺序与提前录制模式下由系统自动按签号排队，此处开关将锁定为开启或不可用。</span>
            </el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never" class="mb-16">
          <template #header>
            <span><strong>试题与作答展示</strong>（题干、时长、统一开始等）</span>
          </template>
          <el-form label-width="200px" :model="interviewConfig">
            <el-form-item label="考生端显示试题题干">
              <el-switch v-model="interviewConfig.showQuestionsCandidate" />
              <span class="form-tip">关闭后，考生端仅展示面试说明，不展示具体试题内容。</span>
            </el-form-item>
            <el-form-item label="考官端显示试题">
              <el-switch v-model="interviewConfig.showQuestionsExaminer" />
              <span class="form-tip">开启后考官端显示答题预览中的考官视图内容（指导语、考官题本使用说明、试题、参考答案与解析、结束语）；考生端显示答题预览中的考生视图内容。</span>
            </el-form-item>
            <el-form-item label="考官端显示考官题本使用说明">
              <el-switch v-model="interviewConfig.showExaminerInstructions" />
              <span class="form-tip">开启后，考官端可查看从试题编辑中配置的考官题本使用说明。</span>
            </el-form-item>
            <el-form-item label="单考生答题时长（分钟）">
              <el-input-number v-model="interviewConfig.interviewDurationMinutes" :min="5" :max="60" />
              <span class="form-tip">顺序入场时每名考生答题时长，默认 10 分钟。</span>
            </el-form-item>
            <el-form-item label="三道题统一开始答题">
              <el-switch v-model="interviewConfig.unifiedStart" />
              <span class="form-tip">开启后考生端显示一个「开始答题」按钮，三道题共用。</span>
            </el-form-item>
            <el-form-item label="考官端双摄像头">
              <el-switch v-model="interviewConfig.examinerDualCamera" />
              <span class="form-tip">考官端可选启用双摄像头监控（需考官端页面支持）。</span>
            </el-form-item>
            <el-form-item label="考官与考生实时音频">
              <el-switch v-model="interviewConfig.examinerCandidateAudio" />
              <span class="form-tip">启用考官与考生实时音频通话（需 WebRTC 等支持）。</span>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card v-if="currentPaperId" shadow="never" class="mb-16">
          <template #header>
            <span><strong>直接写入试卷</strong>（指导语、结束语、测评要素）</span>
          </template>
          <p class="form-tip" style="margin-bottom: 12px;">下方内容会直接保存到本考试关联的试卷，保存后答题预览与「从试卷同步」即可看到。无需经过试题编辑。</p>
          <el-form label-width="120px">
            <el-form-item label="指导语">
              <el-input v-model="directGuidingWords" type="textarea" :rows="4" placeholder="供主考官使用的开场指导语" />
            </el-form-item>
            <el-form-item label="结束指导语">
              <el-input v-model="directClosingWords" type="textarea" :rows="3" placeholder="供主考官使用的结束语" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingToPaper" @click="saveProjectInfoToPaper">保存到试卷</el-button>
            </el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never">
          <template #header>
            <span><strong>面试评分表设置</strong>（整场面试通用测评要素）</span>
          </template>
          <div v-if="!currentPaperId" class="toolbar-row mb-12">
            <span class="form-tip">本考试尚未关联试卷，「从试卷同步」需先关联试卷。请选择试卷后点击「关联试卷」。</span>
            <el-select v-model="linkPaperId" filterable placeholder="选择试卷" style="width: 280px; margin-right: 8px;" clearable>
              <el-option v-for="p in paperOptions" :key="p.id" :label="(p.paper_name || p.paperName || '未命名') + ' (ID:' + p.id + ')'" :value="p.id" />
            </el-select>
            <el-button type="primary" :loading="linkingPaper" :disabled="!linkPaperId" @click="linkPaper">关联试卷</el-button>
          </div>
          <div class="toolbar-row">
            <span v-if="exam" class="form-tip" style="margin-right: 8px;">当前试卷ID: {{ currentPaperId ?? '未关联' }}</span>
            <el-button type="primary" @click="addRubricItem">新增测评要素</el-button>
            <el-button :disabled="syncingFromPaper" :loading="syncingFromPaper" @click="syncRubricFromPaper">
              从试卷同步
            </el-button>
            <el-button type="primary" plain @click="autoGenerateScoringPoints">根据测评要素自动生成评分要点</el-button>
            <el-button v-if="currentPaperId" type="primary" plain @click="openEditorWithPaper">在试题编辑中打开本试卷</el-button>
            <p class="form-tip" style="margin: 6px 0 0; line-height: 1.5;">
              「从试卷同步」只读取<strong>该试卷在数据库里已保存</strong>的 <code>project_info.evaluationElements</code>。试题编辑里若改完未点「保存试卷」，库里仍是旧数据（常见为默认三项 45/45/10），同步结果就会与当前编辑界面不一致。答题预览未保存前也可能用默认三项占位，不代表已写入试卷。
            </p>
            <span class="form-tip">根据岗位要求自定义测评维度和分值；可手动填写评分要点，或点击「根据测评要素自动生成评分要点」后保存，考官端将显示此处内容。</span>
          </div>
          <el-table
            :data="rubricItems"
            border
            stripe
            size="small"
            style="width: 100%;"
          >
            <el-table-column label="序号" width="70" align="center">
              <template #default="{ row, $index }">
                <el-input-number v-model="row.item_order" :min="1" :max="999" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="测评要素" min-width="180">
              <template #default="{ row }">
                <el-input v-model="row.item_name" placeholder="如：综合分析能力" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="评分要点" min-width="260">
              <template #default="{ row }">
                <el-input
                  v-model="row.item_description"
                  type="textarea"
                  :rows="2"
                  placeholder="可手动填写，或点击上方「根据测评要素自动生成评分要点」自动生成后保存，同步到考官端"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="满分" width="120" align="center">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.max_score"
                  :min="0"
                  :max="100"
                  :step="1"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ $index }">
                <el-button
                  link
                  type="danger"
                  size="small"
                  @click="removeRubricItem($index)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="rubric-summary">
            总分：
            <strong>{{ totalRubricScore }}</strong>
          </div>
          <div class="toolbar-row">
            <span class="form-tip" style="margin-right: 8px;">多考官计分方式：</span>
            <el-switch v-model="interviewConfig.dropHighestLowest" />
            <span class="form-tip">开启：去掉一个最高分和一个最低分后对其余考官总分取平均；关闭：所有考官总分直接平均。</span>
          </div>
          <div class="actions">
            <el-button
              type="primary"
              :loading="savingDisplay"
              @click="saveDisplayAndRubric"
            >
              保存显示、防作弊与评分表设置
            </el-button>
          </div>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="考官设置" name="examiners">
        <el-card shadow="never" class="mb-16">
          <template #header>
            <span><strong>考场设置</strong></span>
          </template>
          <p class="form-tip" style="margin-bottom: 12px;">先添加考场（可多个），再在下方选择考场并添加考官。</p>
          <div class="toolbar-row">
            <el-input v-model="newRoomName" placeholder="考场名称" style="width: 200px; margin-right: 8px;" clearable />
            <el-button type="primary" @click="addRoom">添加考场</el-button>
          </div>
          <el-table :data="rooms" border stripe size="small" style="width: 100%; margin-top: 12px;">
            <el-table-column prop="name" label="考场名称" min-width="120" />
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="deleteRoom(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
        <el-card shadow="never" class="mb-16">
          <template #header>
            <span><strong>身份核验</strong></span>
          </template>
          <el-form label-width="200px">
            <el-form-item label="身份核验">
              <el-switch v-model="interviewConfig.requireIdentityVerify" />
              <span class="form-tip">开启后，考生进入面试前需完成身份核验。</span>
            </el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never">
          <template #header>
            <span><strong>考官选项（考官、计时计分员、监督员）</strong></span>
          </template>
          <el-form label-width="200px">
            <el-form-item label="选择考场">
              <el-select v-model="selectedRoomId" placeholder="请先选择考场" style="width: 280px;" clearable>
                <el-option label="未分配考场" :value="null" />
                <el-option v-for="r in rooms" :key="r.id" :label="r.name" :value="r.id" />
              </el-select>
              <span class="form-tip" style="margin-left: 8px;">在下方为该考场选择考官（打勾即已选），指定主考官后可选「随机分配考官角色」再保存。</span>
            </el-form-item>
            <el-form-item label="主考官">
              <el-select
                v-model="chiefIdForRoomRef"
                placeholder="从已选考官中指定主考官"
                style="width: 280px;"
                clearable
              >
                <el-option
                  v-for="e in selectedExaminersFiltered"
                  :key="e.gradingAccountId"
                  :label="examinerLabel(e.gradingAccountId)"
                  :value="e.gradingAccountId"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="考官选择（打勾）">
              <el-checkbox-group :model-value="examinerIdsForRoom" @update:model-value="onExaminerIdsChange" class="examiner-checkbox-group">
                <el-checkbox
                  v-for="acc in gradingAccounts"
                  :key="acc.id"
                  :value="acc.id"
                  :label="(acc.real_name || acc.username || '') + (acc.username ? ' (' + acc.username + ')' : '')"
                />
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="" style="margin-bottom: 0;">
              <el-button type="primary" plain @click="shuffleExaminerRole" :disabled="!selectedRoomId || selectedExaminersFiltered.length === 0">
                随机分配考官角色
              </el-button>
              <span class="form-tip" style="margin-left: 8px;">主考官固定不变，仅对其余考官随机分配考官1、考官2…角色，再点「保存考官设置」生效。</span>
            </el-form-item>
          </el-form>
          <el-table :data="selectedExaminersFiltered" border stripe size="small" style="width: 100%; margin-top: 12px;">
            <el-table-column label="序号" width="90" align="center">
              <template #default="{ row }">
                {{ row.sequence_no != null ? Number(row.sequence_no) : '—' }}
              </template>
            </el-table-column>
            <el-table-column label="角色" width="100" align="center">
              <template #default="{ row }">
                {{ row.role === 'chief' ? '主考官' : examinerSequenceLabel(row.sequence_no) }}
              </template>
            </el-table-column>
            <el-table-column label="账号" min-width="200">
              <template #default="{ row }">
                {{ examinerLabel(row.gradingAccountId) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="removeExaminer(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <span class="form-tip" style="display: block; margin-top: 8px;">
            这些账号登录阅卷端后可进入面试评分界面，按评分表打分。主考官与考官权限相同，角色（主考官、考官1、考官2…）用于区分身份与汇总表显示。
          </span>
          <el-divider content-position="left">计时计分与监督</el-divider>
          <el-form-item label="计时计分工作人员账号">
            <el-select
              v-model="staffAccountIdsArray"
              multiple
              filterable
              placeholder="从子账号中选择（与上方考官同一批子账号）"
              style="width: 100%; max-width: 480px;"
            >
              <el-option
                v-for="acc in gradingAccounts"
                :key="acc.id"
                :label="(acc.real_name || acc.username || '') + (acc.username ? ' (' + acc.username + ')' : '')"
                :value="acc.id"
              />
            </el-select>
            <span class="form-tip" style="display: block; margin-top: 4px;">工作人员登录考官端后仅显示整体打分与汇总，不显示试题。可查看汇总表、打印考官数据汇总。</span>
          </el-form-item>
          <el-form-item label="监督员账号" style="margin-top: 12px;">
            <el-select
              v-model="supervisorAccountIdsArray"
              multiple
              filterable
              placeholder="从子账号中选择（可选，监督员在汇总表签字）"
              style="width: 100%; max-width: 480px;"
            >
              <el-option
                v-for="acc in gradingAccounts"
                :key="acc.id"
                :label="(acc.real_name || acc.username || '') + (acc.username ? ' (' + acc.username + ')' : '')"
                :value="acc.id"
              />
            </el-select>
            <span class="form-tip" style="display: block; margin-top: 4px;">监督员登录考官端后与工作人员一样查看成绩汇总，并可在汇总表上手写签字。</span>
          </el-form-item>
          <el-form-item label="叫号监督口令（可选）" style="margin-top: 12px;">
            <el-input
              v-model="interviewConfig.advanceSupervisorPin"
              type="password"
              show-password
              clearable
              placeholder="设置后，计时计分员点上一位/下一位须输入此口令"
              style="width: 100%; max-width: 360px;"
            />
            <span class="form-tip" style="display: block; margin-top: 4px;">留空则计时计分员每次切换叫号仅需在弹窗中确认「监督员已确认」。口令仅保存在本场考试配置中。</span>
          </el-form-item>
          <div class="actions">
            <el-button
              type="primary"
              :loading="savingExaminers"
              @click="saveExaminers"
            >
              保存考官设置
            </el-button>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getExam, getPaper, updateExam, listPapers } from '../api/exams';
import { listGradingAccounts } from '../api/grading';
import request from '../api/request';

const route = useRoute();
const examId = computed(() => route.params.id);

const exam = ref(null);
const activeTab = ref('display');

const interviewConfig = reactive({
  interviewFlowMode: 'legacy',
  prerecordStartPolicy: 'manual',
  prerecordScheduledStartAt: '',
  onlineAutoAdvanceOnSubmit: false,
  showQuestionsCandidate: true,
  showQuestionsExaminer: true,
  showExaminerInstructions: false,
  requireIdentityVerify: false,
  sequentialEntry: false,
  interviewDurationMinutes: 10,
  unifiedStart: true,
  examinerDualCamera: false,
  examinerCandidateAudio: false,
  dropHighestLowest: true,
  staffAccountIds: '',
  supervisorAccountIds: '',
  advanceSupervisorPin: ''
});

const monitorConfig = reactive({
  requireFullscreen: true,
  dualCamera: true,
  faceVerifyEnabled: false,
  screenShare: true,
  sideCamera: false,
  lockScreen: true,
  maxViolations: 5
});

const rubricItems = ref([]);
const gradingAccounts = ref([]);
const selectedExaminers = ref([]); // [{ gradingAccountId, role, roomId }]
const staffAccountIdsArray = ref([]); // 计时计分工作人员选中的子账号 ID 数组
const supervisorAccountIdsArray = ref([]); // 监督员选中的子账号 ID 数组（可选）
const chiefIdForRoomRef = ref(null);
const paperProjectInfo = ref(null);
const rooms = ref([]);
const newRoomName = ref('');
const selectedRoomId = ref(null);
const paperOptions = ref([]);
const linkPaperId = ref(null);
const linkingPaper = ref(false);

const loadedPaperIdRef = ref(null);
const currentPaperId = computed(() => {
  const e = exam.value;
  const id = loadedPaperIdRef.value ?? e?.paper_id ?? e?.paperId ?? e?.data?.paper_id ?? e?.data?.paperId;
  if (id == null || id === '') return null;
  const num = Number(id);
  return Number.isFinite(num) && num > 0 ? num : null;
});

const savingDisplay = ref(false);
const savingExaminers = ref(false);
const syncingFromPaper = ref(false);
const savingToPaper = ref(false);
const directGuidingWords = ref('');
const directClosingWords = ref('');

const examTypeLabel = computed(() => {
  if (!exam.value) return '';
  return (exam.value.exam_type || exam.value.examType) === 'interview' ? '面试' : '笔试';
});

const totalRubricScore = computed(() =>
  rubricItems.value.reduce((sum, item) => sum + (Number(item.max_score) || 0), 0)
);

function onInterviewFlowModeChange() {
  if (interviewConfig.interviewFlowMode === 'online') {
    interviewConfig.sequentialEntry = true;
  }
  if (interviewConfig.interviewFlowMode === 'prerecord') {
    interviewConfig.sequentialEntry = false;
  }
}

function ensureInterviewConfigFromExam(e) {
  const asc = e.answer_system_config || {};
  const ic = asc.interviewConfig || {};
  interviewConfig.interviewFlowMode =
    ic.interviewFlowMode === 'prerecord' || ic.interviewFlowMode === 'online' ? ic.interviewFlowMode : 'legacy';
  interviewConfig.prerecordStartPolicy = ['manual', 'scheduled', 'scheduled_confirm'].includes(ic.prerecordStartPolicy)
    ? ic.prerecordStartPolicy
    : 'manual';
  interviewConfig.prerecordScheduledStartAt =
    ic.prerecordScheduledStartAt != null ? String(ic.prerecordScheduledStartAt) : '';
  interviewConfig.onlineAutoAdvanceOnSubmit = !!ic.onlineAutoAdvanceOnSubmit;
  interviewConfig.showQuestionsCandidate = ic.showQuestionsCandidate !== false;
  interviewConfig.showQuestionsExaminer = ic.showQuestionsExaminer !== false;
  interviewConfig.showExaminerInstructions = !!ic.showExaminerInstructions;
  interviewConfig.requireIdentityVerify = !!ic.requireIdentityVerify;
  interviewConfig.sequentialEntry = !!ic.sequentialEntry;
  interviewConfig.interviewDurationMinutes = ic.interviewDurationMinutes != null ? Number(ic.interviewDurationMinutes) : 10;
  interviewConfig.unifiedStart = ic.unifiedStart !== false;
  interviewConfig.examinerDualCamera = !!ic.examinerDualCamera;
  interviewConfig.examinerCandidateAudio = !!ic.examinerCandidateAudio;
  interviewConfig.staffAccountIds = ic.staffAccountIds != null ? String(ic.staffAccountIds) : '';
  interviewConfig.supervisorAccountIds = ic.supervisorAccountIds != null ? String(ic.supervisorAccountIds) : '';
  interviewConfig.advanceSupervisorPin = ic.advanceSupervisorPin != null ? String(ic.advanceSupervisorPin) : '';
  staffAccountIdsArray.value = (ic.staffAccountIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => Number(id))
    .filter((n) => !Number.isNaN(n));
  supervisorAccountIdsArray.value = (ic.supervisorAccountIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => Number(id))
    .filter((n) => !Number.isNaN(n));
  interviewConfig.dropHighestLowest =
    ic && Object.prototype.hasOwnProperty.call(ic, 'dropHighestLowest')
      ? !!ic.dropHighestLowest
      : true;
  const mc = e.monitor_config || {};
  monitorConfig.requireFullscreen = mc.requireFullscreen !== false;
  monitorConfig.dualCamera = mc.dualCamera !== false;
  monitorConfig.faceVerifyEnabled = mc.faceVerifyEnabled === true;
  monitorConfig.screenShare = mc.screenShare !== false;
  monitorConfig.sideCamera = mc.sideCamera === true;
  monitorConfig.lockScreen = mc.lockScreen !== false;
  monitorConfig.maxViolations = mc.maxViolations ?? 5;
}

function normalizeRubricRows(rows) {
  return (rows || []).map((r, index) => ({
    id: r.id,
    exam_id: r.exam_id,
    item_order: r.item_order != null ? r.item_order : index + 1,
    item_name: r.item_name || '',
    item_description: r.item_description || '',
    max_score: r.max_score != null ? Number(r.max_score) : 0,
    weight: r.weight != null ? Number(r.weight) : 1
  }));
}

/** getPaper 拦截器返回 { success, data } 或直接为试卷对象 */
function unwrapPaperResponse(res) {
  if (!res || typeof res !== 'object') return null;
  if (
    res.paper_name != null ||
    res.project_info != null ||
    res.projectInfo != null ||
    Array.isArray(res.majorQuestions)
  ) {
    return res;
  }
  const inner = res.data;
  if (
    inner &&
    typeof inner === 'object' &&
    (inner.paper_name != null ||
      inner.project_info != null ||
      inner.projectInfo != null ||
      Array.isArray(inner.majorQuestions))
  ) {
    return inner;
  }
  return inner ?? null;
}

/** 取出 project_info 对象（兼容 snake/camel、字符串 JSON、双重 stringify） */
function parseProjectInfoField(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return null;
  let pi = rawPaper.project_info ?? rawPaper.projectInfo;
  if (pi == null) return null;
  let guard = 0;
  while (typeof pi === 'string' && guard++ < 4) {
    try {
      pi = JSON.parse(pi);
    } catch {
      return null;
    }
  }
  return pi && typeof pi === 'object' ? pi : null;
}

/** 从考试项目设置中取出测评要素数组（兼容多种键名与元素字段）。空数组表示试卷库未写入要素，不再用默认 45/45/10 冒充，避免与试题编辑中已填写的分值不一致。 */
function extractEvaluationElements(projectInfo) {
  if (!projectInfo || typeof projectInfo !== 'object') return [];
  const keys = [
    'evaluationElements',
    'evaluation_elements',
    'evaluationItemList',
    'scoreDimensions',
    'rubricItems',
    'dimensions'
  ];
  for (const k of keys) {
    const v = projectInfo[k];
    if (Array.isArray(v) && v.length) return v;
  }
  return [];
}

function mapEvalElementToRubricRow(e, index) {
  const name = String(
    e?.name ??
      e?.item_name ??
      e?.elementName ??
      e?.title ??
      e?.dimension ??
      e?.label ??
      e?.['测评要素'] ??
      ''
  ).trim();
  const desc = String(
    e?.description ?? e?.item_description ?? e?.desc ?? e?.scoringPoints ?? e?.['评分要点'] ?? ''
  ).trim();
  const maxScore = Number(e?.score ?? e?.max_score ?? e?.fullScore ?? e?.value ?? e?.['分值'] ?? 0) || 0;
  const ord = e?.item_order != null ? Number(e.item_order) : index + 1;
  return {
    item_order: Number.isFinite(ord) && ord > 0 ? ord : index + 1,
    item_name: name,
    item_description: desc,
    max_score: maxScore,
    weight: e?.weight != null ? Number(e.weight) || 1 : 1
  };
}

function addRubricItem() {
  rubricItems.value.push({
    item_order: rubricItems.value.length + 1,
    item_name: '',
    item_description: '',
    max_score: 10,
    weight: 1
  });
}

function removeRubricItem(index) {
  rubricItems.value.splice(index, 1);
}

/** 与考官端一致的评分要点生成逻辑：标准测评要素 -> 评分要点文案（面试显示设置中生成后同步到考官端） */
const STANDARD_SCORING_POINTS = {
  综合分析能力: '*是否有逻辑、有体系地论述相关问题，判断分析问题是否全面、准确、深刻，阐述角度全面，有理有据。\n*是否思维敏捷，论述时有条理、有深度、有广度，且相对严密客观。',
  岗位专业技能和逻辑思维能力: '*是否具备胜任岗位工作的专业技能、能否清晰阐述工作中面临挑战的应对策略、对工作心态是否积极。\n*阐述问题过程中是否思路清晰、条理清楚、主次分明、逻辑性强，能有效解决实际工作中遇到的问题。',
  分析解决问题和应急应变能力: '*分析问题时是否能抓住问题重点、有顺序、有主次的解决问题。能否对事物的变化反应敏捷，有较强的应急能力。\n*是否具备出色的灵活应变能力，面对突发情况或紧急任务，能够冷静分析、迅速制定方案，确保工作顺利进行。',
  语言表达能力和仪容仪表举止: '*是否普通话标准，语言表达准确简洁，清晰流畅；语言表达层次清楚有条理、富有说服力，和感染力。\n*是否穿着打扮得体，仪表端正自信，有亲和力和影响力；言行举止符合礼仪，肢体动作自然得当，无多余动作。'
};
const SCORING_POINTS_ALIASES = {
  专业水平: '岗位专业技能和逻辑思维能力',
  专业技能: '岗位专业技能和逻辑思维能力',
  岗位专业: '岗位专业技能和逻辑思维能力',
  逻辑思维: '岗位专业技能和逻辑思维能力',
  语言表达: '语言表达能力和仪容仪表举止',
  语言表达能力: '语言表达能力和仪容仪表举止',
  仪容仪表: '语言表达能力和仪容仪表举止',
  综合分析: '综合分析能力',
  应急应变: '分析解决问题和应急应变能力',
  分析解决问题: '分析解决问题和应急应变能力'
};

function getScoringPointsFromName(itemName) {
  const name = (itemName || '').trim();
  if (!name) return '';
  if (STANDARD_SCORING_POINTS[name]) return STANDARD_SCORING_POINTS[name];
  for (const key of Object.keys(STANDARD_SCORING_POINTS)) {
    if (name.includes(key)) return STANDARD_SCORING_POINTS[key];
  }
  const aliasKey = SCORING_POINTS_ALIASES[name];
  if (aliasKey && STANDARD_SCORING_POINTS[aliasKey]) return STANDARD_SCORING_POINTS[aliasKey];
  for (const [alias, standardKey] of Object.entries(SCORING_POINTS_ALIASES)) {
    if (name.includes(alias)) return STANDARD_SCORING_POINTS[standardKey];
  }
  return '';
}

function autoGenerateScoringPoints() {
  let count = 0;
  for (const row of rubricItems.value) {
    const desc = (row.item_description || '').trim();
    if (desc) continue;
    const name = (row.item_name || '').trim();
    if (!name) continue;
    const generated = getScoringPointsFromName(name);
    if (generated) {
      row.item_description = generated;
      count++;
    }
  }
  if (count > 0) {
    ElMessage.success(`已为 ${count} 项测评要素自动生成评分要点，请点击「保存显示、防作弊与评分表设置」同步到考官端。`);
  } else {
    ElMessage.warning('未生成新内容：请确保测评要素已填写，且评分要点为空；或测评要素名称与内置模板不匹配，可手动填写评分要点。');
  }
}

async function loadExam() {
  try {
    const res = await getExam(examId.value);
    const data = res?.data ?? res;
    exam.value = data;
    const pid = data?.paper_id ?? data?.paperId;
    if (pid != null && pid !== '') loadedPaperIdRef.value = Number(pid);
    else loadedPaperIdRef.value = null;
    ensureInterviewConfigFromExam(data);
    if (pid && (data?.exam_type || data?.examType) === 'interview') {
      await loadPaperProjectInfo(pid);
    } else {
      paperProjectInfo.value = null;
    }
  } catch (e) {
    ElMessage.error(e.message || '加载考试失败');
    loadedPaperIdRef.value = null;
  }
}

async function loadPaperProjectInfo(paperId) {
  try {
    const res = await getPaper(paperId);
    const raw = unwrapPaperResponse(res);
    const info = parseProjectInfoField(raw);
    paperProjectInfo.value = info;
    directGuidingWords.value = info && info.guidingWords != null ? String(info.guidingWords) : '';
    directClosingWords.value = info && info.closingWords != null ? String(info.closingWords) : '';
  } catch (e) {
    paperProjectInfo.value = null;
    directGuidingWords.value = '';
    directClosingWords.value = '';
  }
}

async function saveProjectInfoToPaper() {
  const paperId = currentPaperId.value;
  if (!paperId) return;
  savingToPaper.value = true;
  try {
    const projectInfo = {
      guidingWords: directGuidingWords.value || '',
      closingWords: directClosingWords.value || '',
      evaluationElements: (rubricItems.value || []).map((r, i) => ({
        name: r.item_name || '',
        score: Number(r.max_score) || 0
      }))
    };
    await request.put(`/exam-papers/${paperId}`, { projectInfo });
    await loadPaperProjectInfo(paperId);
    ElMessage.success('已保存到试卷，答题预览与从试卷同步将显示最新内容。');
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败');
  } finally {
    savingToPaper.value = false;
  }
}

async function loadRubric() {
  try {
    const res = await request.get(`/interview/interview-exams/${examId.value}/rubric`);
    rubricItems.value = normalizeRubricRows(res.data || []);
  } catch (e) {
    rubricItems.value = [];
  }
}

async function loadRooms() {
  try {
    const res = await request.get(`/interview/interview-exams/${examId.value}/rooms`);
    rooms.value = res.data || [];
  } catch (e) {
    rooms.value = [];
  }
}

async function loadExaminers() {
  try {
    const [accountsRes, examinersRes, roomsRes] = await Promise.all([
      listGradingAccounts({ pageSize: 200 }),
      request.get(`/interview/interview-exams/${examId.value}/examiners`),
      request.get(`/interview/interview-exams/${examId.value}/rooms`)
    ]);
    gradingAccounts.value = accountsRes.data?.list || [];
    rooms.value = roomsRes.data || roomsRes || [];
    const rawList = examinersRes.data || examinersRes || [];
    const list = rawList.map((e) => ({
      gradingAccountId: e.grading_account_id,
      role: e.role === 'chief' ? 'chief' : 'interviewer',
      roomId: e.room_id != null ? e.room_id : null,
      sequence_no: e.sequence_no != null ? e.sequence_no : undefined
    }));
    selectedExaminers.value = list;
  } catch (e) {
    gradingAccounts.value = [];
    selectedExaminers.value = [];
    rooms.value = [];
  }
}

async function addRoom() {
  const name = (newRoomName.value || '').trim() || '考场';
  try {
    await request.post(`/interview/interview-exams/${examId.value}/rooms`, { name });
    newRoomName.value = '';
    await loadRooms();
    ElMessage.success('已添加考场');
  } catch (e) {
    ElMessage.error(e.message || '添加失败');
  }
}

async function deleteRoom(row) {
  try {
    await request.delete(`/interview/interview-exams/${examId.value}/rooms/${row.id}`);
    await loadRooms();
    selectedExaminers.value = selectedExaminers.value.filter((e) => e.roomId !== row.id);
    ElMessage.success('已删除考场');
  } catch (e) {
    ElMessage.error(e.message || '删除失败');
  }
}

const selectedExaminersFiltered = computed(() => {
  const list = selectedExaminers.value.filter((e) => e.roomId === selectedRoomId.value);
  return [...list].sort((a, b) => {
    const sa = a.sequence_no != null ? Number(a.sequence_no) : 999;
    const sb = b.sequence_no != null ? Number(b.sequence_no) : 999;
    return sa - sb;
  });
});

const examinerIdsForRoom = computed(() => {
  return selectedExaminersFiltered.value.map((e) => e.gradingAccountId);
});

watch(
  [selectedExaminersFiltered, selectedRoomId],
  () => {
    const chief = selectedExaminersFiltered.value.find((e) => e.role === 'chief');
    chiefIdForRoomRef.value = chief ? chief.gradingAccountId : null;
  },
  { immediate: true }
);

watch(chiefIdForRoomRef, (newId) => {
  if (newId == null) return;
  const roomId = selectedRoomId.value;
  selectedExaminers.value = selectedExaminers.value.map((e) => {
    if (e.roomId !== roomId) return e;
    return { ...e, role: e.gradingAccountId === newId ? 'chief' : 'interviewer' };
  });
});

function examinerSequenceLabel(seq) {
  if (seq == null || seq === undefined) return '—';
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1) return '—';
  return '考官' + n;
}

function examinerLabel(gradingAccountId) {
  const acc = gradingAccounts.value.find((a) => a.id === gradingAccountId);
  return acc ? `${acc.real_name || acc.username}（${acc.username}）` : `ID ${gradingAccountId}`;
}

function onExaminerIdsChange(ids) {
  const roomId = selectedRoomId.value;
  let chiefId = chiefIdForRoomRef.value;
  const idList = ids || [];
  if (chiefId != null && !idList.includes(chiefId)) chiefIdForRoomRef.value = null;
  chiefId = chiefIdForRoomRef.value;
  const others = selectedExaminers.value.filter((e) => e.roomId !== roomId);
  const forRoom = idList.map((id) => ({
    gradingAccountId: id,
    role: id === chiefId ? 'chief' : 'interviewer',
    roomId
  }));
  selectedExaminers.value = [...others, ...forRoom];
}

function removeExaminer(row) {
  const i = selectedExaminers.value.findIndex(
    (e) => e.gradingAccountId === row.gradingAccountId && e.roomId === row.roomId
  );
  if (i >= 0) selectedExaminers.value.splice(i, 1);
}

/** 随机分配考官角色：主考官固定，仅对其余考官随机分配考官1、考官2…（需再点保存生效） */
function shuffleExaminerRole() {
  const roomId = selectedRoomId.value;
  if (roomId == null) {
    ElMessage.warning('请先选择考场');
    return;
  }
  const list = selectedExaminers.value.filter((e) => e.roomId === roomId);
  if (list.length === 0) {
    ElMessage.warning('请先勾选考官');
    return;
  }
  const chief = list.find((e) => e.role === 'chief');
  const othersForShuffle = list.filter((e) => e.role !== 'chief');
  if (!othersForShuffle.length) {
    ElMessage.warning('当前考场暂无普通考官，无需随机');
    return;
  }
  const shuffled = [...othersForShuffle];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let seq = 1;
  if (chief) {
    chief.sequence_no = seq++;
  }
  shuffled.forEach((e) => {
    e.sequence_no = seq++;
  });
  const othersRooms = selectedExaminers.value.filter((e) => e.roomId !== roomId);
  selectedExaminers.value = [...othersRooms, ...(chief ? [chief] : []), ...shuffled];
  ElMessage.success('已随机分配考官角色，主考官固定，请点击「保存考官设置」生效');
}

async function loadPaperOptions() {
  try {
    const res = await listPapers({ pageSize: 200 });
    paperOptions.value = res?.data?.papers ?? res?.papers ?? res?.data ?? [];
  } catch (e) {
    paperOptions.value = [];
  }
}

async function linkPaper() {
  if (!linkPaperId.value || !examId.value) return;
  linkingPaper.value = true;
  try {
    const pid = linkPaperId.value;
    await updateExam(examId.value, { paperId: pid });
    loadedPaperIdRef.value = pid != null && pid !== '' ? Number(pid) : null;
    await loadExam();
    linkPaperId.value = null;
    ElMessage.success('已关联试卷，可使用「从试卷同步」。');
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '关联失败');
  } finally {
    linkingPaper.value = false;
  }
}

function openEditorWithPaper() {
  const pid = currentPaperId.value;
  if (!pid) return;
  try {
    if (window.parent && window.parent !== window.self && typeof window.parent.switchMainTab === 'function') {
      window.parent.switchMainTab('editor', pid);
      window.parent.location.hash = 'editor?paperId=' + pid;
    } else {
      const base = window.location.origin || '';
      window.open(base + '/src/app.html#editor?paperId=' + pid, '_blank');
    }
  } catch (e) {
    const base = window.location.origin || '';
    window.open(base + '/src/app.html#editor?paperId=' + pid, '_blank');
  }
}

async function syncRubricFromPaper() {
  let paperId = currentPaperId.value;
  if (!paperId) {
    try {
      const res = await getExam(examId.value);
      const data = res?.data ?? res;
      const pid = data?.paper_id ?? data?.paperId;
      if (pid != null && pid !== '') {
        loadedPaperIdRef.value = Number(pid);
        paperId = loadedPaperIdRef.value;
      }
    } catch (_) {}
  }
  if (!paperId) {
    ElMessage.warning('请先在上方选择试卷并点击「关联试卷」后再使用从试卷同步。');
    return;
  }
  syncingFromPaper.value = true;
  try {
    await loadPaperProjectInfo(paperId);
  } finally {
    syncingFromPaper.value = false;
  }
  const evals = extractEvaluationElements(paperProjectInfo.value || {});
  if (!evals || !evals.length) {
    const hint =
      '当前试卷在数据库中的 evaluationElements 为空，与试题编辑里未点「保存」或保存失败时一致。请先在试题编辑中打开本试卷，确认左侧测评要素与分值后点击保存试卷，再回到本页点「从试卷同步」。答题预览在未保存前会用本地默认三项，不代表已写入试卷。';
    ElMessage.warning(hint);
    return;
  }
  const rows = evals.map((e, i) => mapEvalElementToRubricRow(e, i)).filter((r) => r.item_name);
  if (!rows.length) {
    ElMessage.warning('测评要素数组存在，但每项缺少名称字段，请检查试题编辑中的列名或手动新增测评要素。');
    return;
  }
  rubricItems.value = rows;
  const examTime = paperProjectInfo.value?.examTime ?? paperProjectInfo.value?.interviewDuration;
  if (examTime != null && exam.value) {
    ElMessage.success(`已同步 ${rows.length} 项评分要素；试卷时长 ${examTime} 分钟，可在考试编辑中核对。`);
  } else {
    ElMessage.success(`已同步 ${rows.length} 项评分要素。`);
  }
}

async function saveDisplayAndRubric() {
  if (!exam.value) return;
  savingDisplay.value = true;
  try {
    const ic = {
      interviewFlowMode: interviewConfig.interviewFlowMode === 'online' || interviewConfig.interviewFlowMode === 'prerecord'
        ? interviewConfig.interviewFlowMode
        : 'legacy',
      prerecordStartPolicy: interviewConfig.prerecordStartPolicy || 'manual',
      prerecordScheduledStartAt: (interviewConfig.prerecordScheduledStartAt || '').trim() || undefined,
      onlineAutoAdvanceOnSubmit: !!interviewConfig.onlineAutoAdvanceOnSubmit,
      showQuestionsCandidate: !!interviewConfig.showQuestionsCandidate,
      showQuestionsExaminer: !!interviewConfig.showQuestionsExaminer,
      showExaminerInstructions: !!interviewConfig.showExaminerInstructions,
      requireIdentityVerify: !!interviewConfig.requireIdentityVerify,
      sequentialEntry: !!interviewConfig.sequentialEntry,
      interviewDurationMinutes: interviewConfig.interviewDurationMinutes != null ? Number(interviewConfig.interviewDurationMinutes) : 10,
      unifiedStart: interviewConfig.unifiedStart !== false,
      examinerDualCamera: !!interviewConfig.examinerDualCamera,
      examinerCandidateAudio: !!interviewConfig.examinerCandidateAudio,
      dropHighestLowest: !!interviewConfig.dropHighestLowest,
      staffAccountIds: (staffAccountIdsArray.value.length ? staffAccountIdsArray.value.join(',') : '').trim() || undefined,
      supervisorAccountIds: (supervisorAccountIdsArray.value.length ? supervisorAccountIdsArray.value.join(',') : '').trim() || undefined,
      advanceSupervisorPin: (interviewConfig.advanceSupervisorPin || '').trim() || undefined
    };
    const mc = {
      requireFullscreen: !!monitorConfig.requireFullscreen,
      dualCamera: !!monitorConfig.dualCamera,
      faceVerifyEnabled: !!monitorConfig.faceVerifyEnabled,
      screenShare: !!monitorConfig.screenShare,
      sideCamera: !!monitorConfig.sideCamera,
      lockScreen: !!monitorConfig.lockScreen,
      maxViolations: monitorConfig.maxViolations ?? 5
    };
    await updateExam(examId.value, { interviewConfig: ic, monitorConfig: mc });

    const cleanItems = rubricItems.value
      .map((item, index) => ({
        item_order: item.item_order != null ? item.item_order : index + 1,
        item_name: (item.item_name || '').trim(),
        item_description: (item.item_description || '').trim(),
        max_score: Number(item.max_score) || 0,
        weight: item.weight != null ? Number(item.weight) || 1 : 1
      }))
      .filter((i) => i.item_name);

    await request.post(`/interview/interview-exams/${examId.value}/rubric`, {
      items: cleanItems
    });

    ElMessage.success('已保存面试显示、防作弊与评分表设置');
    await loadRubric();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败');
  } finally {
    savingDisplay.value = false;
  }
}

async function saveExaminers() {
  savingExaminers.value = true;
  try {
    await request.post(`/interview/interview-exams/${examId.value}/examiners`, {
      examiners: selectedExaminers.value.map((e) => ({
        gradingAccountId: e.gradingAccountId,
        role: e.role || 'interviewer',
        roomId: e.roomId != null ? e.roomId : null,
        sequence_no: e.sequence_no != null ? e.sequence_no : undefined
      }))
    });
    interviewConfig.staffAccountIds = staffAccountIdsArray.value.length ? staffAccountIdsArray.value.join(',') : '';
    interviewConfig.supervisorAccountIds = supervisorAccountIdsArray.value.length ? supervisorAccountIdsArray.value.join(',') : '';
    await updateExam(examId.value, { interviewConfig: { ...interviewConfig }, monitorConfig: { ...monitorConfig } });
    ElMessage.success('已保存考官设置');
    await loadExaminers();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败');
  } finally {
    savingExaminers.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadExam(), loadRubric(), loadExaminers(), loadPaperOptions()]);
});
</script>

<style scoped>
.page-title {
  margin: 12px 0 16px;
  font-size: 18px;
}
.mb-16 {
  margin-bottom: 16px;
}
.form-tip {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.actions {
  margin-top: 16px;
  text-align: right;
}
.rubric-summary {
  margin-top: 12px;
  font-size: 13px;
  color: #606266;
}
.tabs-root {
  margin-top: 8px;
}
.examiner-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
}
.examiner-checkbox-group :deep(.el-checkbox) {
  margin-right: 0;
}
</style>

