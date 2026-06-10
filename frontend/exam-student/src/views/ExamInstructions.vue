<template>
  <div class="exam-instructions-page">
    <header class="header">
      <span>答题须知 - {{ examName || '在线考试' }}</span>
      <el-button link @click="$router.push('/exams')">返回</el-button>
    </header>
    <div class="content">
      <div class="instructions-card">
        <h2>考试答题须知</h2>
        <p class="intro">请仔细阅读以下注意事项，确保顺利完成考试。</p>

        <section>
          <h3>一、考试纪律</h3>
          <ul>
            <li>考试期间禁止切换浏览器标签页或窗口，违规将记录并可能影响成绩；</li>
            <li>禁止退出全屏模式，如因故退出请立即点击「恢复全屏」重新进入；</li>
            <li>禁止使用复制、粘贴、右键菜单等操作；</li>
            <li>禁止打开开发者工具或进行任何作弊行为；</li>
            <li>考试全程请保持摄像头开启（若考试要求）；</li>
            <li>请独立完成答卷，不得查阅资料或与他人交流。</li>
          </ul>
        </section>

        <section>
          <h3>二、答题方式说明</h3>
          <ul>
            <li><strong>整卷作答</strong>：所有题目一页展示，可自由滚动浏览和答题；</li>
            <li><strong>逐题作答</strong>：一题一页，通过「上一题」「下一题」按钮切换；</li>
            <li><strong>按大题作答</strong>：一大题一页，通过「上一大题」「下一大题」切换；</li>
            <li>选择题、判断题：点击选项作答；多选题可多选；</li>
            <li>填空题：在横线处输入答案；</li>
            <li>简答题、论述题、写作题：在文本框中作答；</li>
            <li>作图题：使用画布工具作答（若启用）。</li>
          </ul>
        </section>

        <section>
          <h3>三、交卷与时间规则</h3>
          <ul>
            <li>请留意页面顶部的倒计时，考试结束时系统将自动交卷；</li>
            <li>可随时点击「交卷」按钮提前交卷，交卷前请确认已答题目；</li>
            <li>交卷后无法修改答案；</li>
            <li>建议预留充足时间检查，避免因网络等原因导致交卷失败。</li>
          </ul>
        </section>

        <section>
          <h3>四、违规处理说明</h3>
          <ul>
            <li>系统将自动记录切屏、退出全屏、复制、粘贴、右键等违规行为；</li>
            <li>累计违规次数达到上限时，系统将进行提示并记录；</li>
            <li>严重违规可能影响考试成绩或导致考试无效；</li>
            <li>请务必遵守考试纪律，诚信作答。</li>
          </ul>
        </section>

        <section>
          <h3>五、技术环境要求</h3>
          <ul>
            <li>请使用现代浏览器（Chrome、Edge、Firefox、Safari 等）的最新版本；</li>
            <li>考试期间须保持全屏模式，请允许浏览器的全屏权限；退出全屏将记录违规；</li>
            <li>若本场考试要求屏幕监控，进入考场后请立即完成授权并保持至交卷；画面仅由监考端查看，系统不会向考生展示企业端或监考端屏幕；</li>
            <li>若启用摄像头监控，请提前授权摄像头权限；</li>
            <li>请确保网络稳定，避免考试过程中断网；</li>
            <li>建议在安静、光线充足的环境下完成考试。</li>
          </ul>
        </section>

        <div class="enter-area">
          <p v-if="!canEnterNow && countdownText" class="countdown-text">{{ countdownText }}</p>
          <el-button
            type="primary"
            size="large"
            :disabled="!canEnterNow"
            @click="enterExam"
          >
            {{ enterButtonText }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getExam } from '../api/exam';

const route = useRoute();
const router = useRouter();
const examName = ref(route.query.examName || '');
const startTime = ref(route.query.startTime || '');
const endTime = ref(route.query.endTime || '');
const countdownText = ref('');
let countdownTimer = null;

// 仅开考后（当前时间 >= 考试开始时间）才可进入答题
const canEnterNow = computed(() => {
  if (!startTime.value || !endTime.value) return false;
  const now = Date.now();
  const start = new Date(startTime.value).getTime();
  const end = new Date(endTime.value).getTime();
  return now >= start && now <= end;
});

// 合并阅读须知与进入考试：统一为「进入考试」按钮
const enterButtonText = computed(() => {
  if (!startTime.value) return '请从考试列表进入';
  if (canEnterNow.value) return '进入考试';
  return '等待开考';
});

function updateCountdown() {
  if (!startTime.value) return;
  const now = Date.now();
  const start = new Date(startTime.value).getTime();
  if (now >= start) {
    countdownText.value = '';
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    const examId = route.params.id;
    if (examId) router.replace({ name: 'ExamRoom', params: { id: examId } });
    return;
  }
  const diff = Math.max(0, Math.floor((start - now) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  countdownText.value = `距开考还有 ${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

async function enterExam() {
  const examId = route.params.id;
  if (!examId) {
    ElMessage.warning('考试信息有误，请从考试列表重新进入');
    router.push('/exams');
    return;
  }
  if (!canEnterNow.value) return;
  if (document.documentElement?.requestFullscreen && !document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.warn('全屏请求失败:', e?.message);
    }
  }
  router.push({ name: 'ExamRoom', params: { id: examId } });
}

onMounted(async () => {
  if (!route.params.id) {
    ElMessage.warning('缺少考试信息');
    router.push('/exams');
    return;
  }
  if (!startTime.value || !endTime.value) {
    try {
      const res = await getExam(route.params.id);
      const e = res.data;
      if (e) {
        examName.value = examName.value || e.name;
        startTime.value = startTime.value || e.start_time;
        endTime.value = endTime.value || e.end_time;
      }
    } catch (err) {
      console.warn('获取考试信息失败:', err);
    }
  }
  updateCountdown();
  if (startTime.value && Date.now() < new Date(startTime.value).getTime()) {
    countdownTimer = setInterval(updateCountdown, 1000);
  }
});

onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
});
</script>

<style scoped>
.exam-instructions-page { min-height: 100vh; background: #f5f7fa; }
.header { padding: 16px 24px; background: #fff; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.content { padding: 24px; max-width: 800px; margin: 0 auto; }
.instructions-card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.instructions-card h2 { margin: 0 0 12px 0; font-size: 22px; color: #303133; }
.intro { margin: 0 0 24px 0; color: #606266; font-size: 14px; }
.instructions-card section { margin-bottom: 24px; }
.instructions-card section h3 { margin: 0 0 12px 0; font-size: 16px; color: #409eff; }
.instructions-card section ul { margin: 0; padding-left: 24px; line-height: 1.8; color: #606266; font-size: 14px; }
.instructions-card section li { margin-bottom: 8px; }
.enter-area { margin-top: 32px; padding-top: 24px; border-top: 1px solid #ebeef5; text-align: center; }
.countdown-text { margin-bottom: 16px; font-size: 15px; color: #409eff; font-weight: 500; }
</style>
