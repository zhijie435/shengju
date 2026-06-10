<template>
  <div class="answer-blank" :class="styleClass">
    <template v-if="blankCount <= 1">
      <el-input :model-value="singleValue" @update:model-value="updateSingle" placeholder="请输入答案" clearable :disabled="disabled" :class="inputClass" />
    </template>
    <template v-else>
      <div v-for="(_, i) in blankCount" :key="i" class="blank-item">
        <span class="blank-label">空{{ i + 1 }}：</span>
        <el-input :model-value="getBlank(i)" @update:model-value="v => updateBlank(i, v)" placeholder="请输入" size="small" :class="inputClass" style="width: 180px" :disabled="disabled" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ modelValue: { type: [String, Array], default: '' }, blankCount: { type: Number, default: 1 }, disabled: { type: Boolean, default: false }, style: { type: String, default: 'underline' } });
const emit = defineEmits(['update:modelValue']);
const singleValue = computed(() => (props.blankCount <= 1 ? (props.modelValue || '') : ''));
function getBlank(i) { const arr = Array.isArray(props.modelValue) ? props.modelValue : []; return arr[i] || ''; }
function updateSingle(v) { emit('update:modelValue', v); }
function updateBlank(i, v) { const arr = Array.isArray(props.modelValue) ? [...props.modelValue] : []; while (arr.length <= i) arr.push(''); arr[i] = v; emit('update:modelValue', arr); }
const styleType = computed(() => ['underline', 'box'].includes(props.style) ? props.style : 'underline');
const styleClass = computed(() => `blank-${styleType.value}`);
const inputClass = computed(() => styleType.value === 'box' ? 'blank-box-input' : '');
</script>

<style scoped>
.answer-blank { margin-top: 8px; }
.blank-item { margin-bottom: 8px; }
.blank-label { margin-right: 8px; font-size: 13px; color: #606266; }
.blank-box-input :deep(.el-input__wrapper) { border-radius: 6px; box-shadow: 0 0 0 1px #dcdfe6 inset; }
</style>
