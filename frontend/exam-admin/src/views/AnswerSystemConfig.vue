<template>
  <div class="answer-system-config">
    <h2>答题系统配置说明</h2>
    <el-alert
      title="答题系统会根据试卷题型自动展示对应的答题方式"
      type="info"
      :closable="false"
      show-icon
      class="mb-16"
    />
    <el-card class="config-card">
      <template #header>
        <span>题型与答题方式</span>
      </template>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="选择题">单选，固定选项 A/B/C/D（不显示选项内容），可配置选项数 3–6</el-descriptions-item>
        <el-descriptions-item label="判断题">单选，选择 正确/错误</el-descriptions-item>
        <el-descriptions-item label="多选题">多选，固定选项 A/B/C/D，支持选择多个</el-descriptions-item>
        <el-descriptions-item label="填空题">下划线输入框，单空或多空</el-descriptions-item>
        <el-descriptions-item label="简答题/论述题/解答题">多行文本输入</el-descriptions-item>
        <el-descriptions-item label="写作题">按字数显示的方格网格</el-descriptions-item>
        <el-descriptions-item label="作图题">Canvas 画布，支持铅笔、橡皮、清空</el-descriptions-item>
      </el-descriptions>
    </el-card>
    <el-card class="config-card mt-16">
      <template #header>
        <span>考试级配置（新建/编辑考试时设置）</span>
      </template>
      <p>在 <strong>新建考试</strong> 或 <strong>编辑考试</strong> 表单中的「答题系统设置」区域可配置：</p>
      <ul>
        <li>写作题默认字数：用于生成答题方格的行数</li>
        <li>作图题启用：是否允许作图题使用画布</li>
        <li>画布尺寸：作图题画布的宽度和高度</li>
      </ul>
      <el-button type="primary" @click="$router.push('/exams/create')">去新建考试</el-button>
      <el-button @click="$router.push('/exams')">查看考试列表（可对任一考试点击「答题预览」查看考生答题界面）</el-button>
    </el-card>
  </div>
</template>

<script setup>
</script>

<style scoped>
.answer-system-config { padding: 0 8px; }
.mb-16 { margin-bottom: 16px; }
.mt-16 { margin-top: 16px; }
.config-card ul { margin: 12px 0; padding-left: 20px; }
.config-card li { margin: 6px 0; }
</style>
