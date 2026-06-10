<template>
  <div class="face-verify-page">
    <div class="face-verify-card">
      <h1>人脸身份核验</h1>
      <p class="tip">已上传身份证的考生需完成人脸实名认证。请正对摄像头，确保面部清晰可见。</p>
      <div v-if="!pending" class="no-pending">
        <p>未检测到核验信息，请先登录。</p>
        <el-button type="primary" @click="$router.push('/login')">去登录</el-button>
      </div>
      <template v-else>
        <div class="video-wrap">
          <video ref="videoRef" autoplay playsinline muted class="video-el" />
        </div>
        <div class="actions">
          <el-button type="primary" :loading="verifying" :disabled="!cameraReady" @click="captureAndVerify">
            {{ verifying ? '核验中…' : '拍照并核验' }}
          </el-button>
          <el-button @click="$router.push('/login')">返回登录</el-button>
        </div>
        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const videoRef = ref(null);
const pending = ref(null);
const cameraReady = ref(false);
const verifying = ref(false);
const errorMsg = ref('');
let stream = null;

function safeGetPendingVerify() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem('pending_face_verify');
  } catch (e) {
    return null;
  }
}

function safeRemovePendingVerify() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.removeItem('pending_face_verify');
  } catch (e) {}
}

onMounted(() => {
  const raw = safeGetPendingVerify();
  if (raw) {
    try {
      pending.value = JSON.parse(raw);
    } catch (e) {
      pending.value = null;
    }
  }
  if (pending.value) {
    startCamera();
  }
});

onUnmounted(() => {
  stream?.getTracks().forEach(t => t.stop());
});

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      cameraReady.value = true;
    }
  } catch (e) {
    errorMsg.value = '无法打开摄像头：' + (e.message || '请授权摄像头');
  }
}

function captureFrame() {
  const video = videoRef.value;
  if (!video || !video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function captureAndVerify() {
  if (!pending.value?.tempToken || verifying.value) return;
  const base64 = captureFrame();
  if (!base64) {
    errorMsg.value = '请确保面部在画面内后重试';
    return;
  }
  errorMsg.value = '';
  verifying.value = true;
  try {
    const res = await auth.completeFaceVerify(pending.value.tempToken, base64);
    if (res.success) {
      safeRemovePendingVerify();
      ElMessage.success('核验通过');
      router.replace(pending.value.redirect || '/exams');
    } else {
      errorMsg.value = res.message || '核验未通过，请重试';
    }
  } catch (e) {
    errorMsg.value = e.response?.data?.message || e.message || '核验失败，请重试';
  } finally {
    verifying.value = false;
  }
}
</script>

<style scoped>
.face-verify-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f0f2f5; }
.face-verify-card { width: 420px; padding: 32px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
.face-verify-card h1 { margin: 0 0 8px 0; font-size: 22px; text-align: center; color: #333; }
.tip { font-size: 13px; color: #909399; text-align: center; margin-bottom: 20px; }
.no-pending { text-align: center; padding: 24px 0; }
.video-wrap { width: 100%; aspect-ratio: 4/3; background: #000; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
.video-el { width: 100%; height: 100%; object-fit: cover; }
.actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.error-msg { font-size: 12px; color: #f56c6c; text-align: center; margin-top: 12px; }
</style>
