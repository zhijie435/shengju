<template>
  <div class="side-camera-page">
    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-else class="camera-box">
      <video ref="videoRef" autoplay playsinline muted class="camera-video" />
      <p class="tip">侧面摄像头已开启（含麦克风时将录制环境声），请保持此页面打开</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { startMonitorSegmentRecorderMobile } from '../utils/monitorSegmentUpload';
import { openSideCameraStreamWithOptionalAudio, buildMediaRecorderOptions } from '../utils/examMediaCapture';

const route = useRoute();
const videoRef = ref(null);
const error = ref('');
let stream = null;
let uploadTimer = null;
let monitorMobileRecorder = null;

const token = route.query.token || '';
const prerecordMode = route.query.prerecord === '1' || route.query.prerecord === 'true';

/** 与 src/api/index.js 一致，保证手机页上传与 PC 端同源或同配置的 API 根路径 */
function getUploadUrl() {
  const raw = String(import.meta.env.VITE_API_BASE || '/api').trim().replace(/\/$/, '');
  if (!raw) return '/api/exam-monitor/upload-chunk-mobile';
  return `${raw}/exam-monitor/upload-chunk-mobile`;
}

function getPrerecordUploadUrl() {
  const raw = String(import.meta.env.VITE_API_BASE || '/api').trim().replace(/\/$/, '');
  if (!raw) return '/api/exam-monitor/upload-prerecord-side-mobile';
  return `${raw}/exam-monitor/upload-prerecord-side-mobile`;
}

function getPrerecordSideFailStatusUrl() {
  const raw = String(import.meta.env.VITE_API_BASE || '/api').trim().replace(/\/$/, '');
  if (!raw) return '/api/exam-monitor/prerecord-side-upload-status';
  return `${raw}/exam-monitor/prerecord-side-upload-status`;
}

async function reportSideUploadFail() {
  if (!token) return;
  try {
    await fetch(getPrerecordSideFailStatusUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'side_fail' })
    });
  } catch (_) {}
}

async function uploadChunk(blob) {
  if (!token) return;
  const fd = new FormData();
  fd.append('file', blob);
  try {
    const res = await fetch(getUploadUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });
    const data = await res.json();
    if (!data.success) console.warn('Upload failed:', data.message);
  } catch (e) {
    console.warn('Upload error:', e);
  }
}

const CAPTURE_MAX_DIM = 960;
const CAPTURE_JPEG_QUALITY = 0.5;

function captureAndUploadPreview() {
  const video = videoRef.value;
  if (!video || video.readyState < 2 || !token) return;
  try {
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w === 0 || h === 0) return;
    if (w > CAPTURE_MAX_DIM || h > CAPTURE_MAX_DIM) {
      const scale = CAPTURE_MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(blob => blob && uploadChunk(blob), 'image/jpeg', CAPTURE_JPEG_QUALITY);
  } catch (e) {}
}

function startCaptureLoop() {
  if (!videoRef.value || !token) return;
  const startCapture = () => {
    captureAndUploadPreview();
  };
  videoRef.value.addEventListener('loadeddata', () => setTimeout(startCapture, 500), { once: true });
  setTimeout(startCapture, 2000);
  uploadTimer = setInterval(captureAndUploadPreview, 5000);
}

function startMonitorSideUpload() {
  if (!stream || !token) return;
  monitorMobileRecorder = startMonitorSegmentRecorderMobile(stream, {
    token,
    onError: (e) => console.warn('Side monitor upload:', e?.message || e)
  });
  if (!monitorMobileRecorder) {
    startCaptureLoop();
  } else if (videoRef.value) {
    const snapOnce = () => captureAndUploadPreview();
    videoRef.value.addEventListener('loadeddata', () => setTimeout(snapOnce, 400), { once: true });
    setTimeout(snapOnce, 1500);
  }
}

let sideRecorder = null;
let sideChunks = [];

function startPrerecordSideRecorder() {
  if (!stream) return;
  try {
    sideChunks = [];
    const opts =
      typeof MediaRecorder !== 'undefined'
        ? buildMediaRecorderOptions(stream, { videoBitsPerSecond: 500000, audioBitsPerSecond: 48000 })
        : null;
    const mr = opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
    sideRecorder = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size) sideChunks.push(e.data);
    };
    mr.start(1000);
  } catch (_) {
    if (!monitorMobileRecorder && !uploadTimer) startCaptureLoop();
  }
}

onMounted(async () => {
  if (!token) {
    error.value = '缺少 Token，请从考试页面扫码进入';
    return;
  }
  try {
    const opened = await openSideCameraStreamWithOptionalAudio();
    stream = opened.stream;
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      videoRef.value.play().catch(() => {});
      startMonitorSideUpload();
      if (prerecordMode) startPrerecordSideRecorder();
    }
  } catch (e) {
    error.value = '无法打开摄像头：' + (e.message || '请授权摄像头');
  }
});

onUnmounted(async () => {
  monitorMobileRecorder?.stop();
  monitorMobileRecorder = null;
  if (uploadTimer) clearInterval(uploadTimer);
  if (sideRecorder && sideRecorder.state === 'recording') {
    await new Promise((resolve) => {
      try {
        sideRecorder.onstop = async () => {
          try {
            const blob = new Blob(sideChunks, { type: 'video/webm' });
            sideChunks = [];
            if (blob.size > 2000 && token) {
              const fd = new FormData();
              fd.append('file', blob, 'side.webm');
              const res = await fetch(getPrerecordUploadUrl(), {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: fd
              });
              let data = {};
              try {
                data = await res.json();
              } catch (_) {}
              if (!res.ok || !data.success) {
                await reportSideUploadFail();
              }
            } else if (token && prerecordMode) {
              await reportSideUploadFail();
            }
          } catch (_) {
            await reportSideUploadFail();
          }
          resolve();
        };
        sideRecorder.stop();
      } catch (_) {
        resolve();
      }
    });
    sideRecorder = null;
  }
  stream?.getTracks().forEach((t) => t.stop());
});
</script>

<style scoped>
.side-camera-page {
  min-height: 100vh;
  background: #1a1a1a;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.error-msg {
  color: #f56c6c;
  text-align: center;
  padding: 24px;
}
.camera-box {
  width: 100%;
  max-width: 360px;
}
.camera-video {
  width: 100%;
  border-radius: 8px;
  background: #000;
  object-fit: cover;
  aspect-ratio: 4/3;
}
.tip {
  color: #aaa;
  text-align: center;
  margin-top: 16px;
  font-size: 14px;
}
</style>
