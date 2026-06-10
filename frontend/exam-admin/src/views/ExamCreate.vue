<template>
  <div>
    <h2>{{ isEdit ? '编辑考试' : '新建考试' }}</h2>
    <el-form :model="form" label-width="120px" style="max-width: 600px">
      <el-form-item label="考试名称" required>
        <el-input v-model="form.name" placeholder="请输入考试名称" />
      </el-form-item>
      <el-form-item label="试卷" required>
        <el-select v-model="form.paperId" placeholder="选择试卷" filterable style="width:100%">
          <el-option v-for="p in papers" :key="p.id" :label="p.paper_name" :value="p.id" />
        </el-select>
        <div v-if="showNoPurchasedPapersTip" class="form-tip" style="color: #e6a23c; margin-top: 6px;">
          暂无可用试卷：此处仅列出本企业已购买测评包关联的试卷。请先在人才网测评中心完成购买并同步到笔试系统。
        </div>
      </el-form-item>
      <el-form-item label="开始时间" required>
        <el-date-picker v-model="form.startTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="选择开始时间" style="width:100%" />
      </el-form-item>
      <el-form-item label="结束时间" required>
        <el-date-picker v-model="form.endTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="选择结束时间" style="width:100%" />
      </el-form-item>
      <el-form-item label="答题时长(分钟)">
        <el-input-number :model-value="computedDurationMinutes" disabled :min="10" :max="300" />
        <span class="form-tip">根据开始与结束时间自动生成，与考生端一致</span>
      </el-form-item>
      <el-card class="monitor-card" shadow="never">
        <template #header>
          <span><strong>防作弊设置</strong>（考生端按配置启用全屏、双摄等）</span>
        </template>
        <el-form-item label="强制全屏">
          <el-switch v-model="form.monitorConfig.requireFullscreen" />
          <span class="form-tip">开启后考生进入考试须全屏，退出全屏将记录违规</span>
        </el-form-item>
        <el-form-item label="双摄像头">
          <el-switch v-model="form.monitorConfig.dualCamera" />
          <span class="form-tip">开启后采集考生摄像头画面并上传</span>
        </el-form-item>
        <el-form-item label="启用人脸识别">
          <el-switch v-model="form.monitorConfig.faceVerifyEnabled" />
          <span class="form-tip">开启且考试已发布/进行中、考生已上传身份证时：考生端登录需先扫脸；真实 1:1 比对需在服务端配置阿里云视觉智能 CompareFace（ALIYUN_VIAPI_ACCESS_KEY_ID 等），未配置时默认为占位逻辑</span>
        </el-form-item>
        <el-form-item label="屏幕监控">
          <el-switch v-model="form.monitorConfig.screenShare" />
          <span class="form-tip">开启后采集考生端屏幕画面上传监考端（单向，考生端不会看到企业/监考端画面）</span>
        </el-form-item>
        <el-form-item label="侧面摄像头（手机扫码）">
          <el-switch v-model="form.monitorConfig.sideCamera" />
          <span class="form-tip">开启后考场页显示二维码，考生用手机扫码开启侧面摄像头</span>
        </el-form-item>
        <el-form-item label="锁屏/切屏监控">
          <el-switch v-model="form.monitorConfig.lockScreen" />
          <span class="form-tip">监听切屏、复制、粘贴、右键等并记录违规</span>
        </el-form-item>
        <el-form-item label="最大违规次数">
          <el-input-number v-model="form.monitorConfig.maxViolations" :min="1" :max="20" />
          <span class="form-tip">超过后提示并记录</span>
        </el-form-item>
      </el-card>
      <el-card class="answer-system-card" shadow="never">
        <template #header>
          <span><strong>答题系统设置</strong>（考生端按题型展示对应答题方式）</span>
        </template>
      <el-form-item label="答题方式">
        <el-select v-model="form.answerSystemConfig.answerMode" placeholder="请选择" style="width:100%">
          <el-option label="整卷作答（一页展示全部题目）" value="full" />
          <el-option label="逐题作答（一题一页，可上一题/下一题）" value="question_by_question" />
          <el-option label="按大题作答（一大题一页，可上一大题/下一大题）" value="by_section" />
        </el-select>
        <span class="form-tip">根据考试喜好选择不同展示方式</span>
      </el-form-item>
      <el-form-item label="写作题默认字数">
        <el-input-number v-model="form.answerSystemConfig.essayWordCount" :min="100" :max="2000" :step="100" />
        <span class="form-tip">用于写作题答题方格的行数计算</span>
      </el-form-item>
      <el-form-item label="作图题启用">
        <el-switch v-model="form.answerSystemConfig.drawingEnabled" />
      </el-form-item>
      <template v-if="form.answerSystemConfig.drawingEnabled">
        <el-form-item label="画布宽度">
          <el-input-number v-model="form.answerSystemConfig.drawingWidth" :min="300" :max="800" />
        </el-form-item>
        <el-form-item label="画布高度">
          <el-input-number v-model="form.answerSystemConfig.drawingHeight" :min="200" :max="500" />
        </el-form-item>
      </template>
      </el-card>
      <el-form-item label="状态">
        <el-select v-model="form.status">
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="submit">保存</el-button>
        <el-button @click="$router.back()">取消</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getEnterpriseMe } from '../api/enterprises';
import { createExam, updateExam, getExam, listPapers } from '../api/exams';
import {
  getLinkedExamIdForBatch,
  setBatchExamLink
} from '../utils/batchExamMap';

const route = useRoute();
const router = useRouter();
const isEdit = computed(() => !!route.params.id);
const loading = ref(false);
const papers = ref([]);
/** 有企业上下文时用于提示「仅已购试卷」且列表为空 */
const contextEnterpriseId = ref(null);
const showNoPurchasedPapersTip = computed(() => {
  const id = contextEnterpriseId.value;
  if (id == null || id === '') return false;
  return papers.value.length === 0;
});
const form = reactive({
  name: '',
  paperId: null,
  startTime: '',
  endTime: '',
  durationMinutes: 90,
  status: 'draft',
  monitorConfig: {
    requireFullscreen: true,
    dualCamera: true,
    faceVerifyEnabled: false,
    screenShare: true,
    sideCamera: false,
    lockScreen: true,
    maxViolations: 5
  },
  answerSystemConfig: {
    answerMode: 'full',
    essayWordCount: 800,
    drawingEnabled: true,
    drawingWidth: 500,
    drawingHeight: 300,
    answerStyleConfig: {
      choiceStyle: 'radio',
      multichoiceStyle: 'checkbox',
      blankStyle: 'underline'
    }
  }
});

// 答题时长由开始、结束时间自动计算（与考生端一致）
const computedDurationMinutes = computed(() => {
  if (!form.startTime || !form.endTime) return form.durationMinutes;
  const start = new Date(form.startTime).getTime();
  const end = new Date(form.endTime).getTime();
  if (end <= start) return 0;
  const mins = Math.round((end - start) / 60000);
  return Math.max(10, Math.min(300, mins));
});

watch(computedDurationMinutes, (v) => {
  form.durationMinutes = v;
});

onMounted(async () => {
  let enterpriseId = route.query.enterprise_id ?? route.query.enterpriseId;
  // 仅使用测评包/试卷参数；勿用 batch_id 冒充 package_id，否则关联表按错键过滤会拉空列表
  const packageId = route.query.package_id ?? route.query.packageId;

  if (isEdit.value) {
    const examRes = await getExam(route.params.id);
    const e = examRes.data;
    enterpriseId = e.enterprise_id ?? enterpriseId;
    form.name = e.name;
    form.paperId = e.paper_id;
    form.startTime = e.start_time;
    form.endTime = e.end_time;
    form.durationMinutes = e.duration_minutes || 90;
    form.status = e.status || 'draft';
    if (e.monitor_config && typeof e.monitor_config === 'object') {
      const mc = e.monitor_config;
      form.monitorConfig = {
        requireFullscreen: mc.requireFullscreen !== false,
        dualCamera: mc.dualCamera !== false,
        faceVerifyEnabled: mc.faceVerifyEnabled === true,
        screenShare: mc.screenShare !== false,
        sideCamera: mc.sideCamera === true,
        lockScreen: mc.lockScreen !== false,
        maxViolations: mc.maxViolations ?? 5
      };
    }
    if (e.answer_system_config) {
      const asc = e.answer_system_config.answerStyleConfig || {};
      form.answerSystemConfig = {
        answerMode: e.answer_system_config.answerMode || 'full',
        essayWordCount: e.answer_system_config.essayWordCount ?? 800,
        drawingEnabled: e.answer_system_config.drawingEnabled !== false,
        drawingWidth: e.answer_system_config.drawingWidth ?? 500,
        drawingHeight: e.answer_system_config.drawingHeight ?? 300,
        answerStyleConfig: {
          choiceStyle: asc.choiceStyle || 'radio',
          multichoiceStyle: asc.multichoiceStyle || 'checkbox',
          blankStyle: asc.blankStyle || 'underline'
        }
      };
    }
  }

  /** 人才网跳转可能带旧 enterprise_id（账号主键）；与同库笔试 enterprises.id 不一致时试卷列表为空。以 GET /enterprises/me 为准并同步地址栏。 */
  try {
    const me = await getEnterpriseMe();
    if (me?.data?.id != null) {
      const canon = me.data.id;
      if (String(enterpriseId ?? '') !== String(canon)) {
        enterpriseId = canon;
        if (!isEdit.value) {
          router.replace({
            path: route.path,
            query: {
              ...route.query,
              enterprise_id: String(canon),
              enterpriseId: String(canon)
            }
          });
        }
      }
    }
  } catch (_) {
    if (enterpriseId == null || enterpriseId === '') {
      /* 无 query 且 /me 失败则保持空 */
    }
  }

  contextEnterpriseId.value =
    enterpriseId != null && enterpriseId !== '' ? enterpriseId : null;

  if (!isEdit.value) {
    const bid = route.query.batch_id ?? route.query.batchId;
    const eidForMap =
      enterpriseId != null && enterpriseId !== ''
        ? enterpriseId
        : (route.query.enterprise_id ?? route.query.enterpriseId);
    if (bid != null && String(bid).trim() !== '' && eidForMap != null && String(eidForMap).trim() !== '') {
      const existingId = getLinkedExamIdForBatch(eidForMap, bid);
      if (existingId != null) {
        let settingsPath = `/exams/${existingId}/edit`;
        try {
          const ex = await getExam(existingId);
          const row = ex.data || {};
          if ((row.exam_type || row.examType) === 'interview') {
            settingsPath = `/exams/${existingId}/interview-settings`;
          }
        } catch (_) {
          /* 仍进编辑页 */
        }
        ElMessage.warning('该测评批次已创建过考试，同一批次仅可设置一次。已打开本场考试设置。');
        router.replace({ path: settingsPath, query: { ...route.query } });
        return;
      }
    }
  }

  // 有企业上下文时只拉已购关联试卷；先企业+测评包，再仅按企业。不再回退到全库，避免企业端看到总管理端全部试卷。
  let params = { pageSize: 200 };
  if (enterpriseId != null && enterpriseId !== '') params.enterpriseId = enterpriseId;
  if (packageId != null && packageId !== '') params.packageId = packageId;
  let res = await listPapers(params);
  let list = res.data?.papers || [];
  if (list.length === 0 && (enterpriseId != null && enterpriseId !== '') && (packageId != null && packageId !== '')) {
    params = { pageSize: 200, enterpriseId };
    res = await listPapers(params);
    list = res.data?.papers || [];
  }
  papers.value = list;

  if (!isEdit.value) {
    const paperIdFromQuery = route.query.paperId;
    if (paperIdFromQuery) {
      const id = parseInt(paperIdFromQuery, 10);
      if (!isNaN(id)) form.paperId = id;
    }
  }
});

async function submit() {
  if (!form.name || !form.paperId || !form.startTime || !form.endTime) {
    ElMessage.warning('请填写必填项');
    return;
  }
  const start = new Date(form.startTime).getTime();
  const end = new Date(form.endTime).getTime();
  if (end <= start) {
    ElMessage.warning('结束时间必须晚于开始时间');
    return;
  }
  const durationMinutes = computedDurationMinutes.value;
  loading.value = true;
  try {
    const payload = {
      ...form,
      durationMinutes,
      monitorConfig: form.monitorConfig,
      answerSystemConfig: form.answerSystemConfig
    };
    if (isEdit.value) {
      await updateExam(route.params.id, payload);
      ElMessage.success('更新成功');
    } else {
      const body = await createExam(payload);
      ElMessage.success('创建成功');
      const batchId = route.query.batch_id ?? route.query.batchId;
      const eidForMap =
        route.query.enterprise_id ??
        route.query.enterpriseId ??
        contextEnterpriseId.value;
      const newExamId = body?.data?.id;
      if (
        newExamId != null &&
        batchId != null &&
        String(batchId).trim() !== '' &&
        eidForMap != null &&
        String(eidForMap).trim() !== ''
      ) {
        setBatchExamLink(eidForMap, batchId, newExamId);
      }
    }
    router.push('/exams');
  } catch (e) {
    ElMessage.error('保存失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.form-tip { margin-left: 8px; font-size: 12px; color: #909399; }
.monitor-card { margin: 16px 0; border: 1px solid #e4e7ed; }
.monitor-card :deep(.el-card__header) { background: #f5f7fa; font-size: 14px; }
.answer-system-card { margin: 16px 0; border: 1px solid #e4e7ed; }
.answer-system-card :deep(.el-card__header) { background: #f5f7fa; font-size: 14px; }
</style>
