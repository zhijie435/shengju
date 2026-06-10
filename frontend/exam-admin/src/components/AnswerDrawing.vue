<template>
  <div class="answer-drawing" tabindex="0" @paste="onPaste">
    <div class="draw-toolbar">
      <el-button size="small" :type="tool === 'pen' ? 'primary' : 'default'" @click="tool = 'pen'" :disabled="disabled">铅笔</el-button>
      <el-button size="small" :type="tool === 'eraser' ? 'primary' : 'default'" @click="tool = 'eraser'" :disabled="disabled">橡皮</el-button>
      <el-button size="small" @click="clear" :disabled="disabled">清空</el-button>
      <el-button size="small" @click="triggerFileInput" :disabled="disabled">插入图片</el-button>
      <input ref="fileInputRef" type="file" accept="image/*" class="hidden-file-input" @change="onFileSelect" />
    </div>
    <canvas ref="canvasRef" :width="width" :height="height" class="draw-canvas" :style="{ pointerEvents: disabled ? 'none' : 'auto' }" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
const props = defineProps({ modelValue: { type: String, default: '' }, width: { type: Number, default: 500 }, height: { type: Number, default: 300 }, disabled: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue']);
const canvasRef = ref(null);
const fileInputRef = ref(null);
const tool = ref('pen');
let ctx = null;
let drawing = false;
let lastX = 0, lastY = 0;
onMounted(() => initCanvas());
watch(() => props.modelValue, v => { if (v && canvasRef.value && ctx) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = v; } }, { immediate: true });
function initCanvas() { const canvas = canvasRef.value; if (!canvas) return; ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, props.width, props.height); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.lineCap = 'round'; if (props.modelValue) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = props.modelValue; } }
function getPos(e) { const rect = canvasRef.value?.getBoundingClientRect(); if (!rect) return { x: 0, y: 0 }; return { x: (e.clientX - rect.left) * (props.width / rect.width), y: (e.clientY - rect.top) * (props.height / rect.height) }; }
function onMouseDown(e) { if (props.disabled) return; drawing = true; const { x, y } = getPos(e); lastX = x; lastY = y; if (tool.value === 'eraser') ctx.clearRect(x - 10, y - 10, 20, 20); }
function onMouseMove(e) { if (!drawing || !ctx || props.disabled) return; const { x, y } = getPos(e); if (tool.value === 'pen') { ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke(); } else if (tool.value === 'eraser') ctx.clearRect(x - 10, y - 10, 20, 20); lastX = x; lastY = y; }
function onMouseUp() { if (drawing) { drawing = false; const dataUrl = canvasRef.value?.toDataURL('image/png'); if (dataUrl) emit('update:modelValue', dataUrl); } }
function clear() { if (!ctx || props.disabled) return; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, props.width, props.height); emit('update:modelValue', ''); }
function drawImageOnCanvas(dataUrl) { if (!ctx || !dataUrl || props.disabled) return; const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { const scale = Math.min(props.width / img.width, props.height / img.height); const w = img.width * scale, h = img.height * scale; const x = (props.width - w) / 2, y = (props.height - h) / 2; ctx.drawImage(img, x, y, w, h); const out = canvasRef.value?.toDataURL('image/png'); if (out) emit('update:modelValue', out); }; img.onerror = () => {}; img.src = dataUrl; }
function onPaste(e) { if (props.disabled) return; const items = e.clipboardData?.items; if (!items) return; for (const item of items) { if (item.type.indexOf('image') !== -1) { e.preventDefault(); const file = item.getAsFile(); if (!file) return; const reader = new FileReader(); reader.onload = () => drawImageOnCanvas(reader.result); reader.readAsDataURL(file); return; } } }
function triggerFileInput() { if (props.disabled) return; fileInputRef.value?.click(); }
function onFileSelect(e) { if (props.disabled) return; const file = e.target.files?.[0]; if (!file || !file.type.startsWith('image/')) return; const reader = new FileReader(); reader.onload = () => drawImageOnCanvas(reader.result); reader.readAsDataURL(file); e.target.value = ''; }
</script>

<style scoped>
.answer-drawing { margin-top: 8px; }
.draw-toolbar { margin-bottom: 8px; }
.draw-canvas { border: 1px solid #dcdfe6; cursor: crosshair; display: block; max-width: 100%; }
.hidden-file-input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
</style>
