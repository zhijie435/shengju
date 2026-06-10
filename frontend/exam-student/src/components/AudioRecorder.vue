<template>
  <div class="audio-recorder">
    <div class="controls">
      <el-button
        v-if="!supported"
        type="danger"
        size="small"
        disabled
      >
        当前浏览器不支持录音
      </el-button>
      <template v-else>
        <el-button
          v-if="(state === 'idle' || state === 'error') && !autoStart"
          type="primary"
          size="small"
          :disabled="disabled"
          @click="start"
        >
          {{ buttonLabel || '开始录音' }}
        </el-button>
        <el-button
          v-else-if="state === 'recording'"
          type="danger"
          size="small"
          :disabled="disabled"
          @click="stop"
        >
          停止并上传
        </el-button>
        <el-button
          v-else-if="state === 'uploaded'"
          type="primary"
          size="small"
          :disabled="disabled"
          @click="start"
        >
          重新录制
        </el-button>
        <el-button
          v-else-if="state !== 'idle' && state !== 'error'"
          type="primary"
          size="small"
          :disabled="true"
        >
          处理中…
        </el-button>
        <span class="time" v-if="state === 'recording'">
          {{ formattedDuration }}
        </span>
      </template>
    </div>
    <div class="status-line">
      <template v-if="state === 'recording'">
        正在录音，请清晰作答…
      </template>
      <template v-else-if="state === 'uploading'">
        正在上传录音…
      </template>
      <template v-else-if="state === 'uploaded'">
        已上传录音，可点击「重新录制」覆盖原录音。
      </template>
      <template v-else-if="state === 'error'">
        录音或上传失败，请检查麦克风权限后重试。
      </template>
      <template v-else-if="autoStart">
        录音将自动开始，请清晰作答；可点击「停止并上传」结束本题录音。
      </template>
      <template v-else>
        点击「{{ buttonLabel || '开始录音' }}」，听到提示后开始作答。
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api/index';

const props = defineProps({
  sessionId: { type: [Number, String], required: true },
  examId: { type: [Number, String], default: null },
  subQuestionId: { type: [Number, String], default: null },
  disabled: { type: Boolean, default: false },
  buttonLabel: { type: String, default: '' },
  /** 为 true 时不显示「开始录音」按钮，在可录音时自动开始录音 */
  autoStart: { type: Boolean, default: false }
});

const emit = defineEmits(['uploaded']);

const supported = !!(navigator.mediaDevices && window.MediaRecorder);

const state = ref('idle'); // idle | recording | uploading | uploaded | error
const durationSeconds = ref(0);
const mediaStream = ref(null);
const mediaRecorder = ref(null);
let chunks = [];
let timer = null;

const formattedDuration = computed(() => {
  const m = Math.floor(durationSeconds.value / 60);
  const s = durationSeconds.value % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function resetRecording() {
  clearTimer();
  durationSeconds.value = 0;
  chunks = [];
  if (mediaRecorder.value) {
    mediaRecorder.value.ondataavailable = null;
    mediaRecorder.value.onstop = null;
  }
  if (mediaStream.value) {
    mediaStream.value.getTracks().forEach((t) => t.stop());
    mediaStream.value = null;
  }
  mediaRecorder.value = null;
}

async function start() {
  if (!supported || props.disabled || state.value === 'recording') return;
  try {
    resetRecording();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream.value = stream;
    const recorder = new MediaRecorder(stream);
    mediaRecorder.value = recorder;
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    recorder.onstop = handleStop;
    recorder.start();
    state.value = 'recording';
    durationSeconds.value = 0;
    timer = setInterval(() => {
      durationSeconds.value += 1;
      // 简单限制录音最长 10 分钟，防止文件过大
      if (durationSeconds.value >= 600 && mediaRecorder.value && mediaRecorder.value.state === 'recording') {
        stop();
        ElMessage.warning('录音已达到 10 分钟上限，已自动停止并开始上传');
      }
    }, 1000);
  } catch (e) {
    console.error('start recording error:', e);
    state.value = 'error';
    ElMessage.error('无法访问麦克风，请检查权限后重试');
  }
}

function stop() {
  if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
    mediaRecorder.value.stop();
    clearTimer();
  }
}

async function handleStop() {
  try {
    if (!chunks.length) {
      state.value = 'error';
      ElMessage.warning('未捕获到有效录音，请重试');
      return;
    }
    const blob = new Blob(chunks, { type: 'audio/webm' });
    state.value = 'uploading';
    const fd = new FormData();
    fd.append('file', blob, 'interview.webm');
    fd.append('sessionId', String(props.sessionId));
    if (props.examId != null) fd.append('examId', String(props.examId));
    if (props.subQuestionId != null) fd.append('subQuestionId', String(props.subQuestionId));
    fd.append('durationSeconds', String(durationSeconds.value || 0));

    const res = await api.post('/interview/recordings', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    state.value = 'uploaded';
    emit('uploaded', res?.data || {});
    ElMessage.success('录音已上传');
  } catch (e) {
    console.error('upload recording error:', e);
    state.value = 'error';
    ElMessage.error(e.response?.data?.message || e.message || '录音上传失败，请稍后重试');
  } finally {
    resetRecording();
  }
}

// autoStart 且未禁用时自动开始录音（挂载后或 disabled 从 true 变为 false 时）
watch(
  [() => props.autoStart, () => props.disabled],
  () => {
    if (props.autoStart && !props.disabled && (state.value === 'idle' || state.value === 'error')) {
      start();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  resetRecording();
});
</script>

<style scoped>
.audio-recorder {
  margin-top: 8px;
}
.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.time {
  font-size: 13px;
  color: #606266;
}
.status-line {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
</style>

