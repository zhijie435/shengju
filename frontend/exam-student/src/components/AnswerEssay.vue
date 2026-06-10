<template>
  <div class="answer-essay">
    <div class="essay-info">要求字数：{{ wordCount }} 字</div>
    <div class="essay-grid" :style="gridStyle">
      <div
        v-for="(cell, idx) in cells"
        :key="idx"
        class="essay-cell"
        :class="{ filled: cell }"
      >
        {{ cell }}
      </div>
    </div>
    <el-input
      v-model="innerValue"
      type="textarea"
      :rows="8"
      placeholder="请在下方方格上方输入框中作答，每格一字"
      :disabled="disabled"
      @input="onInput"
      @blur="onBlur"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  wordCount: { type: Number, default: 800 },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue', 'change', 'blur']);

const innerValue = ref(props.modelValue || '');

watch(() => props.modelValue, v => { innerValue.value = v || ''; }, { immediate: true });

const cols = 20;
const rows = computed(() => Math.ceil(props.wordCount / cols));
const cellCount = computed(() => rows.value * cols);

const cells = computed(() => {
  const text = innerValue.value || '';
  const arr = text.split('');
  const result = [];
  for (let i = 0; i < cellCount.value; i++) {
    result.push(arr[i] || '');
  }
  return result;
});

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gridTemplateRows: `repeat(${rows.value}, 1fr)`
}));

function onInput() {
  emit('update:modelValue', innerValue.value);
  emit('change', innerValue.value);
}

function onBlur() {
  emit('blur', innerValue.value);
}
</script>

<style scoped>
.answer-essay { margin-top: 8px; }
.essay-info { font-size: 12px; color: #909399; margin-bottom: 8px; }
.essay-grid {
  display: grid;
  gap: 1px;
  border: 1px solid #dcdfe6;
  padding: 8px;
  background: #f5f7fa;
  margin-bottom: 12px;
  max-height: 300px;
  overflow: auto;
}
.essay-cell {
  min-width: 18px;
  min-height: 24px;
  border: 1px solid #e4e7ed;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}
.essay-cell.filled { color: #303133; }
</style>
