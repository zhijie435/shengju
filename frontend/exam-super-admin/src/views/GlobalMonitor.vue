<template>
  <div>
    <el-page-header @back="$router.back()" :title="examName" />
    <el-tabs v-model="activeTab">
      <el-tab-pane label="会话列表" name="sessions">
        <el-table :data="sessions" stripe>
          <el-table-column prop="username" label="考生" />
          <el-table-column prop="real_name" label="姓名" />
          <el-table-column prop="status" label="状态">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ongoing' ? 'success' : 'info'">
                {{ { pending: '待开始', ongoing: '进行中', submitted: '已交卷', abnormal: '异常' }[row.status] || row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="violation_count" label="违规次数" width="100" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="违规事件" name="events">
        <el-table :data="events" stripe>
          <el-table-column prop="username" label="考生" width="120" />
          <el-table-column prop="event_type" label="事件类型" width="140">
            <template #default="{ row }">
              {{ eventTypeText(row.event_type) }}
            </template>
          </el-table-column>
          <el-table-column prop="occurred_at" label="时间" width="180" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import request from '../api/request';

const route = useRoute();
const examId = ref(route.params.id);
const examName = ref('');
const activeTab = ref('sessions');
const sessions = ref([]);
const events = ref([]);

function eventTypeText(t) {
  const map = {
    tab_leave: '切屏', fullscreen_exit: '退出全屏', copy_attempt: '复制尝试',
    paste_attempt: '粘贴尝试', right_click: '右键', window_blur: '窗口失焦'
  };
  return map[t] || t;
}

onMounted(async () => {
  const examRes = await request.get(`/exams/${examId.value}`);
  examName.value = examRes.data?.name || '全局监控';
  const [sessRes, evRes] = await Promise.all([
    request.get(`/exam-sessions/exam/${examId.value}`),
    request.get(`/exam-monitor/events/exam/${examId.value}`)
  ]);
  sessions.value = sessRes.data || [];
  events.value = evRes.data || [];
});
</script>
