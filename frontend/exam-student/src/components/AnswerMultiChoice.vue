<template>
  <div class="answer-multichoice">
    <el-checkbox-group v-model="selected" :disabled="disabled" :class="styleClass" @change="onChange">
      <template v-if="styleType === 'button'">
        <el-checkbox-button v-for="opt in options" :key="opt.key" :value="opt.key" class="choice-option">
          {{ displayLabel(opt) }}
        </el-checkbox-button>
      </template>
      <template v-else-if="styleType === 'tag'">
        <el-checkbox v-for="opt in options" :key="opt.key" :value="opt.key" class="choice-tag">
          <el-tag :type="selected.includes(opt.key) ? 'primary' : 'info'" effect="plain">{{ displayLabel(opt) }}</el-tag>
        </el-checkbox>
      </template>
      <template v-else>
        <el-checkbox v-for="opt in options" :key="opt.key" :value="opt.key" class="choice-option">
          {{ displayLabel(opt) }}
        </el-checkbox>
      </template>
    </el-checkbox-group>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  style: { type: String, default: 'checkbox' }
});

const emit = defineEmits(['update:modelValue', 'change']);

const selected = computed({
  get: () => (Array.isArray(props.modelValue) ? props.modelValue : []),
  set: v => emit('update:modelValue', v || [])
});

const styleType = computed(() => ['checkbox', 'button', 'tag'].includes(props.style) ? props.style : 'checkbox');
const styleClass = computed(() => `style-${styleType.value}`);

function displayLabel(opt) {
  return opt.text ? `${opt.key}. ${opt.text}` : opt.key;
}

function onChange(val) {
  emit('change', val);
}
</script>

<style scoped>
.answer-multichoice { margin-top: 8px; }
.choice-option { display: block; margin-bottom: 6px; }
.style-button :deep(.el-checkbox-button) { margin-right: 8px; margin-bottom: 8px; }
.choice-tag { margin-right: 12px; margin-bottom: 8px; display: inline-block; }
.choice-tag :deep(.el-checkbox__label) { padding-left: 4px; }
</style>
