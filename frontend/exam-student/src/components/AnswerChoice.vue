<template>
  <div class="answer-choice">
    <el-radio-group v-model="selected" :disabled="disabled" :class="styleClass" @change="onChange">
      <template v-if="styleType === 'button'">
        <el-radio-button v-for="opt in options" :key="opt.key" :value="opt.key" class="choice-option">
          {{ displayLabel(opt) }}
        </el-radio-button>
      </template>
      <template v-else-if="styleType === 'card'">
        <div class="choice-cards">
          <div
            v-for="opt in options"
            :key="opt.key"
            class="choice-card"
            :class="{ active: selected === opt.key }"
            @click="!disabled && (selected = opt.key)"
          >
            <span class="card-key">{{ opt.key }}</span>
            <span v-if="opt.text" class="card-text">{{ opt.text }}</span>
          </div>
        </div>
      </template>
      <template v-else>
        <el-radio v-for="opt in options" :key="opt.key" :value="opt.key" class="choice-option">
          {{ displayLabel(opt) }}
        </el-radio>
      </template>
    </el-radio-group>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  style: { type: String, default: 'radio' }
});

const emit = defineEmits(['update:modelValue', 'change']);

const selected = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
});

const styleType = computed(() => ['radio', 'button', 'card'].includes(props.style) ? props.style : 'radio');
const styleClass = computed(() => `style-${styleType.value}`);

function displayLabel(opt) {
  return opt.text ? `${opt.key}. ${opt.text}` : opt.key;
}

function onChange(val) {
  emit('change', val);
}
</script>

<style scoped>
.answer-choice { margin-top: 8px; }
.choice-option { display: block; margin-bottom: 6px; }
.style-button :deep(.el-radio-button) { margin-right: 8px; margin-bottom: 8px; }
.choice-cards { display: flex; flex-wrap: wrap; gap: 12px; }
.choice-card { border: 1px solid #dcdfe6; border-radius: 8px; padding: 12px 20px; cursor: pointer; transition: all 0.2s; min-width: 60px; text-align: center; }
.choice-card:hover { border-color: #409eff; }
.choice-card.active { border-color: #409eff; background: #ecf5ff; color: #409eff; }
.card-key { font-weight: 600; font-size: 16px; }
.card-text { margin-left: 6px; font-size: 13px; }
</style>
