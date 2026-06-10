<template>
  <div class="exam-enter-page">
    <h2>考前环境检测</h2>
    <el-steps :active="step" finish-status="success" align-center>
      <el-step title="摄像头" />
      <el-step title="屏幕监控" />
      <el-step title="全屏" />
    </el-steps>
    <div class="check-area">
      <div v-if="step === 0" class="check-item">
        <video ref="videoRef" autoplay muted playsinline style="max-width:320px;border-radius:8px;background:#000" />
        <p>请确保摄像头已开启并对准您的面部</p>
        <el-button type="primary" :disabled="!cameraOk" @click="step++">下一步</el-button>
      </div>
      <div v-else-if="step === 1" class="check-item">
        <video v-if="screenStream" ref="screenRef" autoplay muted playsinline style="max-width:320px;border-radius:8px;background:#000" />
        <el-button v-else type="primary" @click="requestScreen">授权屏幕监控</el-button>
        <p v-else>请选择供监考采集的屏幕或窗口（画面仅上传至监考端，不会向您展示企业端画面）</p>
        <el-button v-if="screenStream" type="primary" @click="step++">下一步</el-button>
      </div>
      <div v-else class="check-item">
        <p>即将进入全屏考试模式，请做好准备</p>
        <el-button type="primary" @click="goToExam">进入考试</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

const route = useRoute();
const router = useRouter();
const step = ref(0);
const cameraOk = ref(false);
const videoRef = ref(null);
const screenRef = ref(null);
const screenStream = ref(null);
let stream = null;

onMounted(async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    cameraOk.value = true;
    if (videoRef.value) videoRef.value.srcObject = stream;
  } catch (e) {
    ElMessage.error('无法访问摄像头：' + (e.message || '请授权摄像头'));
  }
});

onUnmounted(() => {
  stream?.getTracks().forEach(t => t.stop());
  screenStream.value?.getTracks().forEach(t => t.stop());
});

async function requestScreen() {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenStream.value = s;
    if (screenRef.value) screenRef.value.srcObject = s;
  } catch (e) {
    ElMessage.error('无法开启屏幕监控：' + (e.message || '请授权'));
  }
}

function goToExam() {
  const { examId } = route.query;
  router.push({ name: 'ExamRoom', params: { id: examId } });
}
</script>

<style scoped>
.exam-enter-page { padding: 40px; text-align: center; }
.check-area { margin-top: 40px; min-height: 200px; }
.check-item { display: flex; flex-direction: column; align-items: center; gap: 16px; }
</style>
