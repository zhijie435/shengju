<template>
  <div class="answer-text">
    <el-input v-model="value" type="textarea" :rows="rows" placeholder="请输入答案" :disabled="disabled" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ modelValue: { type: String, default: '' }, rows: { type: Number, default: 4 }, disabled: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue']);
const value = computed({ get: () => props.modelValue || '', set: v => emit('update:modelValue', v) });
</script>

<style scoped>
.answer-text { margin-top: 8px; }
</style>
