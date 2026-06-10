<template>
  <div ref="containerRef" class="exam-room">
    <header class="exam-header">
      <span>{{ exam?.name }}</span>
      <span v-if="isInterviewExam && session?.draw_number != null" class="header-draw-number">您的抽签号：{{ session.draw_number }} 号</span>
      <template v-if="isSessionSubmitted">
        <el-tag type="success" size="large">已交卷</el-tag>
        <span v-if="isInterviewExam && session?.total_score != null" class="header-score">面试得分：{{ session.total_score }} 分</span>
        <el-button v-if="isInterviewExam && session?.total_score != null && !session?.score_confirmed_at" type="primary" size="small" :loading="confirmScoreLoading" @click="doConfirmScore">确认成绩</el-button>
        <span v-else-if="isInterviewExam && session?.score_confirmed_at" class="header-confirmed">已签字确认</span>
        <el-button type="default" size="small" @click="showCheckPanel = true">检查答题卡</el-button>
        <el-button type="default" size="small" @click="$router.push('/exams')" style="margin-left: auto;">返回考试列表</el-button>
      </template>
      <template v-else-if="inInterviewWaitingPhase">
        <el-tag type="info" size="large">候考中</el-tag>
        <span class="prerecord-waiting-hint">请等候计时计分端点击「开始答题」</span>
        <el-button type="default" size="small" @click="$router.push('/exams')" style="margin-left: auto;">返回考试列表</el-button>
      </template>
      <template v-else-if="isPrerecordInterview && !interviewAnswerStarted">
        <el-tag type="warning" size="large">等待开考</el-tag>
        <el-button type="default" size="small" @click="$router.push('/exams')" style="margin-left: auto;">返回考试列表</el-button>
      </template>
      <template v-else>
        <span class="timer" :class="{ warn: remainingMins < 5 }">{{ formatTime(remainingSecs) }}</span>
        <el-button type="default" size="small" @click="showCheckPanel = true">检查答题卡</el-button>
        <span v-if="isPrerecordInterview" class="prerecord-submit-hint">提前录制：倒计时结束将自动上传正面/侧面录像并交卷</span>
        <el-button
          v-else
          type="primary"
          size="small"
          @click="submit"
          class="unified-submit-btn"
        >
          统一提交
        </el-button>
      </template>
    </header>
    <!-- 面试签到：未签到时先完成签到再开始考试 -->
    <template v-if="needCheckIn && !loading">
      <div class="check-in-block">
        <div class="check-in-card">
          <h3>请先完成签到</h3>
          <p v-if="requireFaceForCheckIn" class="check-in-tip">本考试需刷脸签到，请点击下方按钮拍照完成签到。</p>
          <p v-else class="check-in-tip">请点击下方按钮完成签到后开始考试。</p>
          <template v-if="requireFaceForCheckIn">
            <el-button type="primary" :loading="checkInLoading" @click="showFaceCheckInDialog = true">拍照签到</el-button>
          </template>
          <el-button v-else type="primary" :loading="checkInLoading" @click="doCheckIn()">签到</el-button>
        </div>
      </div>
      <el-dialog v-model="showFaceCheckInDialog" title="刷脸签到" width="400px" :close-on-click-modal="false">
        <div class="face-check-in-dialog">
          <video ref="faceCheckInVideoRef" autoplay playsinline muted class="face-video" />
          <el-button type="primary" :loading="checkInLoading" @click="captureAndCheckIn">拍照并签到</el-button>
        </div>
      </el-dialog>
    </template>
    <!-- 面试：未抽签或顺序入场候考（不可进入考场时） -->
    <template v-else-if="isInterviewExam && canEnterRoomResult && !canEnterRoomResult.canEnter && !loading">
      <div v-if="canEnterRoomResult.interviewPhase === 'waiting_room'" class="waiting-room-block prerecord-waiting">
        <div class="waiting-room-card">
          <h3>统一候考室</h3>
          <p v-if="canEnterRoomResult.yourDrawNumber != null" class="waiting-tip">您是 {{ canEnterRoomResult.yourDrawNumber }} 号考生</p>
          <p class="waiting-reason">{{ canEnterRoomResult.reason || '请等候计时计分人员宣布开始答题' }}</p>
          <p class="waiting-refresh">候考期间不显示试题。请保持本页打开，计时计分端点击「开始答题」后将自动进入试题界面并开始倒计时。</p>
          <div v-show="showMonitorPanel" class="monitor-panel monitor-panel-embedded">
            <div class="monitor-panel-title">候考监控（已同步监考端）</div>
            <div class="monitor-grid">
              <div v-if="monitorConfig.dualCamera" class="monitor-cell monitor-cell-main">
                <span class="monitor-label">主摄像头</span>
                <video ref="cameraRef" muted playsinline autoplay class="monitor-video" />
              </div>
              <div v-if="monitorConfig.sideCamera" class="monitor-cell" :class="sideCameraPreviewUrl ? 'monitor-cell-side-live' : 'monitor-cell-qr'">
                <span class="monitor-label">手机侧摄</span>
                <template v-if="sideCameraPreviewUrl">
                  <video :key="'side-prev-'+sideCameraPreviewKey" :src="sideCameraPreviewUrl" muted playsinline autoplay loop class="monitor-video side-camera-preview" />
                  <p class="side-camera-qr-tip connected">侧摄已连接</p>
                </template>
                <template v-else>
                  <p v-if="!sideCameraQrDataUrl && !sideCameraQrError" class="side-camera-qr-tip">加载二维码中…</p>
                  <p v-else-if="sideCameraQrError" class="side-camera-qr-tip error">获取失败，请刷新重试</p>
                  <template v-else>
                    <img :src="sideCameraQrDataUrl" alt="侧摄二维码" class="side-camera-qr-img" />
                  </template>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="waiting-room-block">
        <div class="waiting-room-card">
          <h3>{{ canEnterRoomResult.missingDrawNumber ? '无法进入考试' : '候考' }}</h3>
          <p v-if="canEnterRoomResult.yourDrawNumber != null" class="waiting-tip">您是 {{ canEnterRoomResult.yourDrawNumber }} 号考生</p>
          <p
            v-if="canEnterRoomResult.interviewFlowMode === 'online' && canEnterRoomResult.currentDrawNumber != null"
            class="waiting-tip"
          >
            当前叫号：{{ canEnterRoomResult.currentDrawNumber }} 号
          </p>
          <p class="waiting-reason">{{ canEnterRoomResult.reason || (canEnterRoomResult.missingDrawNumber ? '请先完成抽签后再进入考场' : '请等待叫号后进入考场') }}</p>
          <p class="waiting-refresh">{{ canEnterRoomResult.missingDrawNumber ? '完成抽签后请刷新页面或稍候自动检测…' : '页面将自动刷新，请稍候…' }}</p>
        </div>
      </div>
    </template>
    <div v-if="prerecordSubmitting" class="prerecord-submit-overlay">
      <div class="prerecord-submit-panel">
        <p class="prerecord-submit-title">正在交卷</p>
        <p class="prerecord-submit-phase">{{ prerecordUploadPhaseText }}</p>
        <el-progress
          :percentage="prerecordUploadPercent"
          :status="prerecordUploadPercent >= 100 ? 'success' : undefined"
          :stroke-width="10"
          class="prerecord-upload-progress"
        />
        <p class="prerecord-submit-sub">请勿关闭、刷新或返回列表，直至显示「交卷完成」</p>
        <p class="prerecord-submit-sub">侧面录像请在手机侧摄页完成上传</p>
      </div>
    </div>
    <div v-else-if="showMainExamBody" class="exam-body">
      <p v-if="isInterviewExam && session?.draw_number != null" class="interview-draw-greeting">你好，{{ session.draw_number }} 号考生</p>
      <div
        v-if="isInterviewExam && interviewConfig.unifiedStart && !isPrerecordInterview && session?.status === 'ongoing' && !interviewAnswerStarted && !isSessionSubmitted"
        class="interview-unified-start"
      >
        <p class="unified-start-tip">请等待考官宣布开始答题后，点击下方按钮开始作答（点击后才开始本场答题倒计时）。</p>
        <el-button type="primary" size="large" @click="onInterviewUnifiedStartClick">开始答题</el-button>
      </div>
      <div
        v-if="isPrerecordInterview && session?.status === 'ongoing' && !interviewAnswerStarted && !isSessionSubmitted"
        class="interview-unified-start"
      >
        <p class="unified-start-tip">计时计分已宣布开始答题，正在进入试题界面并开始倒计时，请稍候…</p>
      </div>
      <div v-if="answerMode !== 'full' && navLabel && showInterviewQuestionContent" class="answer-mode-nav">
        <el-button :disabled="!canPrev" @click="answerMode === 'by_section' ? currentSectionIndex-- : currentQuestionIndex--">{{ answerMode === 'by_section' ? '上一大题' : '上一题' }}</el-button>
        <span class="nav-label">{{ navLabel }}</span>
        <el-button :disabled="!canNext" @click="answerMode === 'by_section' ? currentSectionIndex++ : currentQuestionIndex++">{{ answerMode === 'by_section' ? '下一大题' : '下一题' }}</el-button>
      </div>
      <div v-show="showInterviewQuestionContent" class="question-list">
        <div
          v-for="(q, i) in displayQuestions"
          :key="q.id"
          ref="(el) => setQuestionBlockRef(q.id, el)"
          class="question-block"
        >
          <div
            v-if="showInterviewQuestionContent"
            class="question-content"
            v-html="isInterviewExam ? (q.content_html || q.full_content || '') : prependQuestionNumberTight(q.content_html || q.full_content || '', q.globalDisplayNumber)"
          />
          <div
            v-else
            class="question-content interview-placeholder"
          >
            本题题干将由考官现场说明，请根据考官提问作答，考官将现场评分。
          </div>
          <template v-if="q.subItemCount <= 1">
            <div class="answer-box">
              <label>{{ isInterviewExam ? '作答：' : q.globalDisplayNumber + ' 作答：' }}</label>
              <template v-if="isInterviewExam">
                <p class="interview-answer-hint">请根据考官提问作答，考官将现场评分。</p>
              </template>
              <template v-else>
                <AnswerChoice
                  v-if="q.answerType === 'choice' || q.answerType === 'judge'"
                  v-model="answers[q.id]"
                  :options="q.options"
                  :style="answerStyleConfig.choiceStyle"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, undefined))"
                  @change="(v) => onAnswerBlur(q, v, undefined)"
                  @blur="() => onAnswerBlur(q, answers[q.id], undefined)"
                />
                <AnswerMultiChoice
                  v-else-if="q.answerType === 'multichoice'"
                  v-model="answers[q.id]"
                  :options="q.options"
                  :style="answerStyleConfig.multichoiceStyle"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, undefined))"
                  @change="(v) => onAnswerBlur(q, v, true, null, undefined)"
                  @blur="() => onAnswerBlur(q, answers[q.id], true, null, undefined)"
                />
                <AnswerBlank
                  v-else-if="q.answerType === 'blank'"
                  v-model="answers[q.id]"
                  :blank-count="q.blankCount"
                  :style="answerStyleConfig.blankStyle"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, undefined))"
                  @blur="() => onAnswerBlur(q, answers[q.id], false, null, undefined)"
                />
                <AnswerEssay
                  v-else-if="q.answerType === 'essay'"
                  v-model="answers[q.id]"
                  :word-count="q.wordCount"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, undefined))"
                  @blur="() => onAnswerBlur(q, answers[q.id], false, null, undefined)"
                />
                <AnswerDrawing
                  v-else-if="q.answerType === 'drawing'"
                  v-model="answers[q.id]"
                  :width="q.drawingWidth || 500"
                  :height="q.drawingHeight || 300"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, undefined))"
                  @change="(d) => onAnswerBlur(q, null, false, d, undefined)"
                  @blur="(d) => onAnswerBlur(q, null, false, d, undefined)"
                />
                <AnswerText
                  v-else
                  v-model="answers[q.id]"
                  :rows="q.answerType === 'text' ? 4 : 3"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, undefined))"
                  @blur="() => onAnswerBlur(q, answers[q.id], false, null, undefined)"
                />
                <div class="answer-actions">
                  <template v-if="isSessionSubmitted">
                    <el-tag type="success" size="small">已提交</el-tag>
                  </template>
                  <template v-else-if="isSlotSubmitted(getAnswerSlotKey(q, undefined))">
                    <el-tag type="success" size="small">已提交</el-tag>
                    <el-button type="primary" link size="small" @click="modifySlot(q, undefined)">修改</el-button>
                  </template>
                  <template v-else>
                    <el-button type="primary" size="small" @click="submitSlot(q, undefined)">提交</el-button>
                  </template>
                </div>
              </template>
            </div>
          </template>
          <template v-else>
            <div v-for="(subItem, subIdx) in (q.subAnswerItems && q.subAnswerItems.length > 0 ? q.subAnswerItems : Array(q.subItemCount).fill(null))" :key="subIdx" class="answer-box">
              <label>{{ isInterviewExam ? '作答' + (subItem && subItem.sub_number ? subItem.sub_number : `(${subIdx + 1})`) + '：' : q.globalDisplayNumber + ' 作答' + (subItem && subItem.sub_number ? subItem.sub_number : `(${subIdx + 1})`) + '：' }}</label>
              <template v-if="isInterviewExam">
                <p class="interview-answer-hint">请根据考官提问作答，考官将现场评分。</p>
              </template>
              <template v-else>
                <AnswerChoice
                  v-if="q.answerType === 'choice' || q.answerType === 'judge'"
                  v-model="answers[getQuestionNumberKey(q, subIdx)]"
                  :options="q.options"
                  :style="answerStyleConfig.choiceStyle"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, subIdx))"
                  @change="(v) => onAnswerBlur(q, v, undefined, null, subIdx)"
                  @blur="() => onAnswerBlur(q, answers[getQuestionNumberKey(q, subIdx)], undefined, null, subIdx)"
                />
                <AnswerMultiChoice
                  v-else-if="q.answerType === 'multichoice'"
                  v-model="answers[getQuestionNumberKey(q, subIdx)]"
                  :options="q.options"
                  :style="answerStyleConfig.multichoiceStyle"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, subIdx))"
                  @change="(v) => onAnswerBlur(q, v, true, null, subIdx)"
                  @blur="() => onAnswerBlur(q, answers[getQuestionNumberKey(q, subIdx)], true, null, subIdx)"
                />
                <AnswerBlank
                  v-else-if="q.answerType === 'blank'"
                  v-model="answers[getQuestionNumberKey(q, subIdx)]"
                  :blank-count="q.blankCount"
                  :style="answerStyleConfig.blankStyle"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, subIdx))"
                  @blur="() => onAnswerBlur(q, answers[getQuestionNumberKey(q, subIdx)], false, null, subIdx)"
                />
                <AnswerEssay
                  v-else-if="q.answerType === 'essay'"
                  v-model="answers[getQuestionNumberKey(q, subIdx)]"
                  :word-count="q.wordCount"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, subIdx))"
                  @blur="() => onAnswerBlur(q, answers[getQuestionNumberKey(q, subIdx)], false, null, subIdx)"
                />
                <AnswerDrawing
                  v-else-if="q.answerType === 'drawing'"
                  v-model="answers[getQuestionNumberKey(q, subIdx)]"
                  :width="q.drawingWidth || 500"
                  :height="q.drawingHeight || 300"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, subIdx))"
                  @change="(d) => onAnswerBlur(q, null, false, d, subIdx)"
                  @blur="(d) => onAnswerBlur(q, null, false, d, subIdx)"
                />
                <AnswerText
                  v-else
                  v-model="answers[getQuestionNumberKey(q, subIdx)]"
                  :rows="q.answerType === 'text' ? 4 : 3"
                  :disabled="isSessionSubmitted || isSlotSubmitted(getAnswerSlotKey(q, subIdx))"
                  @blur="() => onAnswerBlur(q, answers[getQuestionNumberKey(q, subIdx)], false, null, subIdx)"
                />
                <div class="answer-actions">
                  <template v-if="isSessionSubmitted">
                    <el-tag type="success" size="small">已提交</el-tag>
                  </template>
                  <template v-else-if="isSlotSubmitted(getAnswerSlotKey(q, subIdx))">
                    <el-tag type="success" size="small">已提交</el-tag>
                    <el-button type="primary" link size="small" @click="modifySlot(q, subIdx)">修改</el-button>
                  </template>
                  <template v-else>
                    <el-button type="primary" size="small" @click="submitSlot(q, subIdx)">提交</el-button>
                  </template>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
    <!-- 面试：考官正面视频（考生端显示考官画面） -->
    <div v-if="isInterviewExam && !needCheckIn && !(canEnterRoomResult && !canEnterRoomResult.canEnter)" class="examiner-video-panel">
      <div class="examiner-video-title">考官正面视频</div>
      <div class="examiner-video-wrap">
        <video ref="examinerVideoRef" autoplay playsinline muted class="examiner-video-el" />
        <p class="examiner-video-tip">本场未接入实时视频通话，考官画面不显示；考务请在企业端「考试监控」查看考生分片画面</p>
      </div>
    </div>
    <div class="monitor-panel" v-show="showMonitorPanel">
      <div class="monitor-panel-title">监控画面（已同步至监考端）</div>
      <div class="monitor-grid">
        <div v-if="monitorConfig.dualCamera" class="monitor-cell monitor-cell-main">
          <span class="monitor-label">主摄像头</span>
          <video ref="cameraRef" muted playsinline autoplay class="monitor-video" />
        </div>
        <div v-if="monitorConfig.screenShare" class="monitor-cell">
          <span class="monitor-label">屏幕监控</span>
          <video ref="screenRef" muted playsinline autoplay class="monitor-video" />
        </div>
        <div v-if="monitorConfig.sideCamera" class="monitor-cell" :class="sideCameraPreviewUrl ? 'monitor-cell-side-live' : 'monitor-cell-qr'">
          <span class="monitor-label">手机侧摄</span>
          <template v-if="sideCameraPreviewUrl">
            <video :key="'side-prev-main-'+sideCameraPreviewKey" :src="sideCameraPreviewUrl" muted playsinline autoplay loop class="monitor-video side-camera-preview" />
            <p class="side-camera-qr-tip connected">侧摄已连接，画面已同步监考端</p>
          </template>
          <template v-else>
          <p v-if="!sideCameraQrDataUrl && !sideCameraQrError" class="side-camera-qr-tip">加载二维码中…</p>
          <p v-else-if="sideCameraQrError" class="side-camera-qr-tip error">获取失败，请刷新重试</p>
          <template v-else>
            <p class="side-camera-qr-tip">扫码或复制链接在手机浏览器打开（勿用过期链接）。</p>
            <p class="side-camera-qr-tip wechat-hint">微信内若无法调起摄像头，请在右上角「···」选择「在浏览器中打开」。</p>
            <p v-if="isLocalhostOrigin" class="side-camera-qr-tip dev-hint">开发环境：请确保手机与电脑同一网络，并配置 VITE_PUBLIC_URL 为电脑局域网 IP（如 http://192.168.x.x:5176）</p>
            <img :src="sideCameraQrDataUrl" alt="侧摄二维码" class="side-camera-qr-img" />
            <div v-if="sideCameraOpenUrl" class="side-camera-link-row">
              <el-input :model-value="sideCameraOpenUrl" readonly size="small" class="side-camera-link-input" />
              <el-button size="small" @click="copySideCameraLink">复制链接</el-button>
            </div>
          </template>
          </template>
        </div>
      </div>
    </div>
    <div v-show="showFullscreenLock" class="fullscreen-lock-overlay">
      <div class="fullscreen-lock-content">
        <p class="fullscreen-lock-title">请保持全屏答题</p>
        <p class="fullscreen-lock-desc">考试期间请勿退出全屏模式，否则将记录违规</p>
        <el-button type="primary" size="large" @click="requestFullscreen">恢复全屏</el-button>
      </div>
    </div>
    <el-drawer v-model="showCheckPanel" title="答题卡" direction="rtl" size="320px">
      <div class="check-panel-stats">
        <div class="stat-item"><span class="stat-num">{{ answerSlots.filter(s => s.hasAnswer).length }}</span> 已答</div>
        <div class="stat-item"><span class="stat-num">{{ answerSlots.filter(s => s.isSubmitted).length }}</span> 已提交</div>
        <div class="stat-item"><span class="stat-num">{{ answerSlots.filter(s => !s.hasAnswer).length }}</span> 未答</div>
      </div>
      <div class="check-panel-list">
        <div
          v-for="(slot, idx) in answerSlots"
          :key="slot.key"
          class="check-slot-item"
          :class="{ answered: slot.hasAnswer, submitted: slot.isSubmitted }"
          @click="jumpToSlot(slot)"
        >
          <span class="slot-num">{{ slot.label }}</span>
          <span class="slot-status">{{ slot.isSubmitted ? '已提交' : (slot.hasAnswer ? '已答' : '未答') }}</span>
        </div>
      </div>
      <div class="check-panel-footer">
        <template v-if="!isSessionSubmitted">
          <p v-if="isPrerecordInterview" class="check-panel-hint">提前录制模式无需手动提交；时间到后系统将自动上传录像并交卷。</p>
          <el-button
            v-else
            type="primary"
            size="large"
            class="unified-submit-btn"
            @click="showCheckPanel = false; submit()"
          >
            统一提交
          </el-button>
          <p v-if="!isPrerecordInterview" class="check-panel-hint">提交后答案将同步至管理端/企业端阅卷系统（客观题阅卷、主观题阅卷）</p>
        </template>
        <el-button v-else type="default" size="large" @click="showCheckPanel = false; $router.push('/exams')">返回考试列表</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import {
  getMySession,
  getExam,
  getPaper,
  startSession,
  submitSession,
  checkInSession,
  canEnterRoom,
  enterRoomSession,
  postInterviewWaitingRoom,
  postPrerecordVideoStatus,
  saveAnswer as saveAnswerApi,
  saveAnswersBatch,
  getMyAnswers,
  reportMonitorEvent,
  getSideCameraToken,
  getMyLatestMonitorChunks,
  confirmInterviewScore,
  uploadPrerecordVideo
} from '../api/exam';
import QRCode from 'qrcode';
import { getAnswerType, parseOptions, parseBlankCount, prependQuestionNumberTight } from '../utils/questionParser';
import AnswerChoice from '../components/AnswerChoice.vue';
import AnswerMultiChoice from '../components/AnswerMultiChoice.vue';
import AnswerBlank from '../components/AnswerBlank.vue';
import AnswerText from '../components/AnswerText.vue';
import AnswerEssay from '../components/AnswerEssay.vue';
import AnswerDrawing from '../components/AnswerDrawing.vue';
import { startMonitorSegmentRecorder } from '../utils/monitorSegmentUpload';
import {
  openCameraStreamWithOptionalAudio,
  buildDisplayMediaConstraints,
  buildMediaRecorderOptions
} from '../utils/examMediaCapture';
const route = useRoute();
const router = useRouter();
const containerRef = ref(null);
const cameraRef = ref(null);
const screenRef = ref(null);
const examinerVideoRef = ref(null);
const showMonitorMini = ref(false);
const showFullscreenLock = ref(false);
const showMonitorPanel = computed(() => {
  const cfg = monitorConfig.value;
  return !!(cfg.dualCamera || cfg.screenShare || cfg.sideCamera);
});
const sideCameraQrError = ref(false);
const sideCameraQrDataUrl = ref('');
const sideCameraOpenUrl = ref('');
const sideCameraPreviewUrl = ref('');
const sideCameraPreviewKey = ref(0);
let sideCameraPollTimer = null;
const isLocalhostOrigin = computed(() => {
  const o = window.location.origin;
  return !import.meta.env.VITE_PUBLIC_URL && (o.includes('localhost') || o.includes('127.0.0.1'));
});

/**
 * 从当前地址栏推断考生端部署前缀（应对 nginx 子路径与构建 BASE_URL 不一致）。
 * 例：https://域名/exam-student/exam/55 → /exam-student
 */
function inferExamStudentPublicPrefix() {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname || '';
  const m1 = path.match(/^(\/.+?)\/exam\/\d+/i);
  if (m1 && m1[1]) return m1[1].replace(/\/$/, '') || m1[1];
  const m2 = path.match(/^(\/.+?)\/side-camera\/?$/i);
  if (m2 && m2[1]) return m2[1].replace(/\/$/, '') || m2[1];
  return String(import.meta.env.BASE_URL || '/').replace(/\/$/, '');
}

/** 侧摄 H5 页完整前缀：优先 VITE_PUBLIC_URL；否则 origin + 路径推断/Vite BASE_URL */
function buildSideCameraPageBase() {
  const fromEnv = String(import.meta.env.VITE_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin.replace(/\/$/, '');
  const fromPath = inferExamStudentPublicPrefix();
  const fromVite = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const basePath = fromPath || fromVite;
  return basePath ? `${origin}${basePath}` : origin;
}

async function copySideCameraLink() {
  const t = sideCameraOpenUrl.value;
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    ElMessage.success('链接已复制，请在手机浏览器中粘贴打开');
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ElMessage.success('链接已复制');
    } catch (e2) {
      ElMessage.warning('请长按上方链接手动复制');
    }
  }
}

function buildSideCameraOpenUrl(token) {
  const base = buildSideCameraPageBase();
  let q = `token=${encodeURIComponent(token)}`;
  if (isPrerecordInterview.value) q += '&prerecord=1';
  return `${base}/side-camera?${q}`;
}

async function loadSideCameraQr() {
  if (!monitorConfig.value.sideCamera || !session.value?.id) return;
  /** 与服务器对齐会话状态，避免本地仍显示「答题中」而库中已交卷等竞态导致侧摄 Token 400 */
  try {
    if (exam.value?.id) {
      const r = await getMySession(exam.value.id);
      const d = r?.data;
      if (d && (d.id == null || Number(d.id) === Number(session.value.id))) {
        session.value = { ...session.value, ...d };
      }
    }
  } catch (_) {}
  const st = String(session.value.status ?? '').trim();
  if (!['pending', 'ongoing'].includes(st)) {
    sideCameraQrError.value = true;
    sideCameraOpenUrl.value = '';
    sideCameraQrDataUrl.value = '';
    return;
  }
  sideCameraQrError.value = false;
  sideCameraOpenUrl.value = '';
  try {
    const res = await getSideCameraToken(session.value.id);
    const token = res?.data?.token ?? res?.token;
    if (!token) {
      sideCameraQrError.value = true;
      return;
    }
    const url = buildSideCameraOpenUrl(token);
    sideCameraOpenUrl.value = url;
    /** 长 URL 用 L 级纠错模块更疏，同尺寸下更易扫；略增大画布与静区 */
    const longUrl = url.length > 160;
    sideCameraQrDataUrl.value = await QRCode.toDataURL(url, {
      width: longUrl ? 420 : 360,
      margin: 4,
      errorCorrectionLevel: longUrl ? 'L' : 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });
  } catch (e) {
    console.warn('Side camera token failed:', e);
    sideCameraQrError.value = true;
    sideCameraOpenUrl.value = '';
  }
  startSideCameraPreviewPoll();
}

function buildMonitorChunkUrl(filePath, chunkId) {
  if (!filePath) return '';
  const p = String(filePath).replace(/^\/+/, '').replace(/\\/g, '/');
  const apiBase = String(import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';
  const staticBase = apiBase.endsWith('/api') ? origin : apiBase.replace(/\/api\/?$/, '') || origin;
  const url = `${staticBase}/${p}`;
  return chunkId != null ? `${url}?v=${chunkId}` : url;
}

async function pollSideCameraPreview() {
  if (!monitorConfig.value.sideCamera || !session.value?.id) return;
  try {
    const res = await getMyLatestMonitorChunks(session.value.id);
    const payload = res?.data?.data ?? res?.data;
    const side = payload?.side_camera;
    if (!side?.file_path) return;
    const url = buildMonitorChunkUrl(side.file_path, side.id);
    if (url !== sideCameraPreviewUrl.value) {
      sideCameraPreviewUrl.value = url;
    }
    sideCameraPreviewKey.value = side.id || Date.now();
  } catch (_) {}
}

function startSideCameraPreviewPoll() {
  if (!monitorConfig.value.sideCamera || !session.value?.id) return;
  stopSideCameraPreviewPoll();
  pollSideCameraPreview();
  sideCameraPollTimer = setInterval(pollSideCameraPreview, 4000);
}

function stopSideCameraPreviewPoll() {
  if (sideCameraPollTimer) clearInterval(sideCameraPollTimer);
  sideCameraPollTimer = null;
}

const FULLSCREEN_RETRY_MAX = 3;

const exam = ref(null);
const paper = ref(null);
const session = ref(null);
const subQuestions = ref([]);
const answers = reactive({});
const durationSecs = ref(0);
const remainingSecs = ref(0);
let timerId = null;
let cameraStream = null;
let screenStream = null;
let monitorRecorderStops = { camera: null, screen: null };
let violationCount = 0;
let antiCheatCleanup = null;

const remainingMins = computed(() => Math.floor(remainingSecs.value / 60));

// 已交卷会话：只读展示，保留掉线前/统一提交后的界面状态
const isSessionSubmitted = computed(() => {
  const st = session.value?.status;
  return st === 'submitted' || st === 'force_submitted';
});

const monitorConfig = computed(() => {
  const mc = exam.value?.monitor_config || {};
  return {
    requireFullscreen: mc.requireFullscreen === true,
    dualCamera: mc.dualCamera === true,
    sideCamera: mc.sideCamera === true,
    screenShare: mc.screenShare === true,
    lockScreen: mc.lockScreen === true,
    maxViolations: typeof mc.maxViolations === 'number' ? mc.maxViolations : 5
  };
});

const answerMode = computed(() => {
  return exam.value?.answer_system_config?.answerMode || 'full';
});

const isInterviewExam = computed(() => {
  const t = exam.value?.exam_type || exam.value?.examType;
  return t === 'interview';
});

const interviewConfig = computed(() => {
  const ic = exam.value?.answer_system_config?.interviewConfig || {};
  const flow =
    ic.interviewFlowMode === 'prerecord' || ic.interviewFlowMode === 'online' ? ic.interviewFlowMode : 'legacy';
  return {
    interviewFlowMode: flow,
    showQuestionsCandidate: ic.showQuestionsCandidate !== false,
    showQuestionsExaminer: ic.showQuestionsExaminer !== false,
    requireIdentityVerify: !!ic.requireIdentityVerify,
    sequentialEntry: flow === 'online' ? true : !!ic.sequentialEntry,
    interviewDurationMinutes: ic.interviewDurationMinutes != null ? Number(ic.interviewDurationMinutes) : 10,
    unifiedStart: ic.unifiedStart !== false
  };
});

const isPrerecordInterview = computed(() => interviewConfig.value.interviewFlowMode === 'prerecord');
const isOnlineInterview = computed(() => interviewConfig.value.interviewFlowMode === 'online');

/** 面试候考/闸门未开：不展示试题区域（与候考室 UI 互斥） */
const inInterviewWaitingPhase = computed(() => {
  if (!isInterviewExam.value || needCheckIn.value) return false;
  const r = canEnterRoomResult.value;
  return !!(r && r.canEnter === false);
});

const showMainExamBody = computed(() => !needCheckIn.value && !inInterviewWaitingPhase.value);

/** 提前录制：计时计分开放答题并开始倒计时后才展示试题 */
const showInterviewQuestionContent = computed(() => {
  if (!isInterviewExam.value) return true;
  if (isPrerecordInterview.value) {
    return interviewAnswerStarted.value || isSessionSubmitted.value;
  }
  return interviewConfig.value.showQuestionsCandidate;
});
/** 面试/提前录制：按本场作答时长倒计时，不用考试全局 end_time（否则会出现 90+ 分钟且结束前提醒对不上） */
const useInterviewSegmentTimer = computed(() => isInterviewExam.value);
const prerecordSubmitting = ref(false);
let submitInFlight = false;
const prerecordUploadPercent = ref(0);
const prerecordUploadPhaseText = ref('准备中…');
let prerecordTimeUpNotification = null;

// 指导语中配置的「最后 X 分钟」提醒（来自试卷 project_info.reminderMinute）
const reminderMinuteMins = computed(() => {
  const p = paper.value?.project_info;
  const m = p?.reminderMinute;
  return m != null && Number(m) >= 1 ? Number(m) : 1;
});

const needCheckIn = computed(() => {
  if (!isInterviewExam.value || !session.value) return false;
  return session.value.check_in_at == null || session.value.check_in_at === '';
});

const canEnterRoomResult = ref(null);
let canEnterRoomPollTimer = null;
const roomEnteredSent = ref(false);
const waitingRoomPosted = ref(false);
let prerecordFrontRecorder = null;
let prerecordFrontChunks = [];
const interviewAnswerStarted = ref(false);
const confirmScoreLoading = ref(false);
let submittedScorePollTimer = null;
let waitForOngoingPollId = null;

const requireFaceForCheckIn = computed(() => {
  const ic = exam.value?.answer_system_config?.interviewConfig || {};
  const mc = exam.value?.monitor_config || {};
  return !!(ic.requireIdentityVerify || mc.faceVerifyEnabled);
});

const answerConfig = computed(() => {
  const c = exam.value?.answer_system_config || {};
  return {
    essayWordCount: c.essayWordCount ?? 800,
    drawingEnabled: c.drawingEnabled !== false,
    drawingWidth: c.drawingWidth ?? 500,
    drawingHeight: c.drawingHeight ?? 300
  };
});

const answerStyleConfig = computed(() => {
  const c = exam.value?.answer_system_config?.answerStyleConfig || {};
  return {
    choiceStyle: c.choiceStyle || 'radio',
    multichoiceStyle: c.multichoiceStyle || 'checkbox',
    blankStyle: c.blankStyle || 'underline'
  };
});

const subItemCounts = computed(() => exam.value?.answer_system_config?.subItemCounts || {});
const optionCounts = computed(() => exam.value?.answer_system_config?.optionCounts || {});

const currentQuestionIndex = ref(0);
const currentSectionIndex = ref(0);
const showCheckPanel = ref(false);
const checkInLoading = ref(false);
const showFaceCheckInDialog = ref(false);
const faceCheckInVideoRef = ref(null);
let faceCheckInStream = null;
const submittedKeys = ref(new Set());
const questionBlockRefs = ref({});

const enrichedQuestions = computed(() => {
  const overrides = exam.value?.answer_system_config?.answerTypeOverrides || {};
  const displayNumberOverrides = exam.value?.answer_system_config?.displayNumberOverrides || {};
  const counts = subItemCounts.value;
  const opts = optionCounts.value;
  return subQuestions.value.map((sq, idx) => {
    const majorType = sq.question_type || sq.majorType || '';
    let answerType = overrides[sq.id] || getAnswerType(majorType);
    const optCount = (opts[sq.id] >= 3 && opts[sq.id] <= 6) ? opts[sq.id] : 4;
    const options = parseOptions(sq.content_html || sq.full_content || '', answerType, optCount);
    const blankCount = answerType === 'blank' ? parseBlankCount(sq.content_html || sq.full_content || '') || 1 : 1;
    const wordCount = answerType === 'essay' ? answerConfig.value.essayWordCount : 800;
    const drawingOk = answerType === 'drawing' && answerConfig.value.drawingEnabled;
    
    // 优先使用sub_answers数据来确定子小题数量
    let subItemCount = 1;
    let subAnswerItems = [];
    
    if (sq.sub_answers) {
      try {
        const subAnswers = typeof sq.sub_answers === 'string' ? JSON.parse(sq.sub_answers) : sq.sub_answers;
        if (Array.isArray(subAnswers) && subAnswers.length > 0) {
          subAnswerItems = subAnswers;
          subItemCount = subAnswers.length;
        }
      } catch (e) {
        console.warn('解析 sub_answers 失败:', e);
      }
    }
    
    // 如果没有sub_answers，使用手动设置的subItemCount
    if (subItemCount <= 1) {
      subItemCount = Math.min(Math.max((counts[sq.id] > 1 ? counts[sq.id] : 1) | 0, 1), 10);
    }
    
    const globalDisplayNumber = (displayNumberOverrides[sq.id] && String(displayNumberOverrides[sq.id]).trim()) || String(idx + 1);
    return {
      ...sq,
      globalDisplayNumber,
      question_type: majorType,
      answerType: drawingOk ? 'drawing' : (answerType === 'drawing' ? 'text' : answerType),
      options,
      blankCount,
      wordCount,
      drawingWidth: answerConfig.value.drawingWidth,
      drawingHeight: answerConfig.value.drawingHeight,
      subItemCount,
      subAnswerItems // 保存子小题答案数据，用于显示子题号
    };
  });
});

const sections = computed(() => {
  const list = enrichedQuestions.value;
  if (!list.length) return [];
  const groups = [];
  let lastMajor = null;
  let group = [];
  for (const q of list) {
    const major = q.majorNumber ?? q.number ?? '';
    if (major !== lastMajor && group.length) {
      groups.push([...group]);
      group = [];
    }
    lastMajor = major;
    group.push(q);
  }
  if (group.length) groups.push(group);
  return groups;
});

const displayQuestions = computed(() => {
  const mode = answerMode.value;
  const all = enrichedQuestions.value;
  if (mode === 'question_by_question') {
    const idx = Math.max(0, Math.min(currentQuestionIndex.value, all.length - 1));
    return all[idx] ? [all[idx]] : [];
  }
  if (mode === 'by_section') {
    const secs = sections.value;
    const idx = Math.max(0, Math.min(currentSectionIndex.value, secs.length - 1));
    return secs[idx] || [];
  }
  return all;
});

const canPrev = computed(() => {
  if (answerMode.value === 'question_by_question') return currentQuestionIndex.value > 0;
  if (answerMode.value === 'by_section') return currentSectionIndex.value > 0;
  return false;
});

const canNext = computed(() => {
  if (answerMode.value === 'question_by_question') return currentQuestionIndex.value < enrichedQuestions.value.length - 1;
  if (answerMode.value === 'by_section') return currentSectionIndex.value < sections.value.length - 1;
  return false;
});

const navLabel = computed(() => {
  if (answerMode.value === 'question_by_question') {
    const total = enrichedQuestions.value.length;
    return `第 ${currentQuestionIndex.value + 1} / ${total} 题`;
  }
  if (answerMode.value === 'by_section') {
    const total = sections.value.length;
    return `第 ${currentSectionIndex.value + 1} / ${total} 大题`;
  }
  return '';
});

function getQuestionNumberKey(q, subIndex) {
  return `${q.globalDisplayNumber || q.number}-${q.sub_number || ''}-${subIndex}`;
}

function getAnswerSlotKey(q, subIndex) {
  if (subIndex === undefined || subIndex === null) return q.id;
  return getQuestionNumberKey(q, subIndex);
}

function isSlotSubmitted(slotKey) {
  return submittedKeys.value.has(String(slotKey));
}

function setQuestionBlockRef(qId, el) {
  if (el) questionBlockRefs.value[qId] = el;
}

const answerSlots = computed(() => {
  const list = enrichedQuestions.value;
  const slots = [];
  for (const q of list) {
    const subCount = q.subItemCount || 1;
    for (let i = 0; i < subCount; i++) {
      const key = subCount <= 1 ? q.id : getQuestionNumberKey(q, i);
      const label = subCount <= 1
        ? `${q.globalDisplayNumber || q.number}${q.sub_number ? `(${q.sub_number})` : ''}`
        : `${q.globalDisplayNumber || q.number}${q.sub_number ? `(${q.sub_number})` : ''}-${i + 1}`;
      const val = answers[key];
      const hasValue = val != null && (Array.isArray(val) ? val.length > 0 : String(val).trim() !== '');
      const hasAnswer = hasValue;
      const isSubmitted = submittedKeys.value.has(String(key));
      slots.push({
        key,
        label,
        q,
        subIndex: subCount > 1 ? i : undefined,
        hasAnswer,
        isSubmitted,
        questionIndex: enrichedQuestions.value.indexOf(q)
      });
    }
  }
  return slots;
});

function jumpToSlot(slot) {
  showCheckPanel.value = false;
  if (answerMode.value === 'full') {
    const el = questionBlockRefs.value[slot.q.id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    currentQuestionIndex.value = slot.questionIndex;
    if (answerMode.value === 'by_section') {
      const secIdx = sections.value.findIndex(sec => sec.some(sq => sq.id === slot.q.id));
      if (secIdx >= 0) currentSectionIndex.value = secIdx;
    }
    nextTick(() => {
      const el = questionBlockRefs.value[slot.q.id];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

async function submitSlot(q, subIndex) {
  const slotKey = getAnswerSlotKey(q, subIndex);
  const val = subIndex === undefined ? answers[q.id] : answers[getQuestionNumberKey(q, subIndex)];
  let answerText = null;
  let data = null;
  if (q.answerType === 'multichoice' && Array.isArray(val)) {
    data = { selected: val };
    answerText = val.join(',');
  } else if (q.answerType === 'drawing' && val && typeof val === 'string') {
    data = { imageBase64: val };
  } else if (q.answerType === 'blank' && Array.isArray(val)) {
    data = { blanks: val };
    answerText = val.join(',');
  } else {
    answerText = Array.isArray(val) ? (val || []).join(',') : (val || '');
  }
  const subQuestionId = subIndex === undefined ? q.id : null;
  const questionNumber = subIndex !== undefined ? getQuestionNumberKey(q, subIndex) : (q.globalDisplayNumber ?? q.number ?? q.sub_number);
  await saveAnswer(subQuestionId, questionNumber, answerText, data, true);
  submittedKeys.value = new Set([...submittedKeys.value, String(slotKey)]);
  ElMessage.success('已提交');
}

function modifySlot(q, subIndex) {
  const slotKey = getAnswerSlotKey(q, subIndex);
  const next = new Set(submittedKeys.value);
  next.delete(String(slotKey));
  submittedKeys.value = next;
  ElMessage.info('已解除提交，可修改答案');
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function safeGetSessionItem(key) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeGetLocalItem(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

/** 与 src/api/index.js 一致：正式 token 优先，其次免登录 guest（upload-chunk 用 fetch 须手动带 Authorization） */
function getExamStudentToken() {
  return (
    safeGetSessionItem('exam_student_token') ||
    safeGetLocalItem('exam_student_token') ||
    safeGetSessionItem('exam_guest_token') ||
    safeGetLocalItem('exam_guest_token') ||
    ''
  );
}

async function loadExam() {
  const examId = route.params.id;
  try {
    const guestExamId = safeGetSessionItem('exam_guest_examId');
    const guestSession = safeGetSessionItem('exam_guest_session');
    if (guestExamId === examId && guestSession) {
      try {
        session.value = JSON.parse(guestSession);
      } catch (_) {
        session.value = null;
      }
    }
    if (!session.value) {
      const sessionRes = await getMySession(examId);
      session.value = sessionRes.data;
    }
    if (!session.value) throw new Error('未找到考试会话');
    const examRes = await getExam(examId);
    exam.value = examRes.data;
    const now = Date.now();
    const startMs = exam.value?.start_time ? new Date(exam.value.start_time).getTime() : 0;
    const endMs = exam.value?.end_time ? new Date(exam.value.end_time).getTime() : 0;
    if (startMs && now < startMs) {
      ElMessage.warning('尚未到开考时间，请稍后再进入答题');
      router.replace({ name: 'ExamInstructions', params: { id: examId }, query: { examName: exam.value?.name, startTime: exam.value?.start_time, endTime: exam.value?.end_time } });
      return;
    }
    if (endMs && now > endMs) {
      ElMessage.warning('考试已结束');
      router.push('/exams');
      return;
    }
    const paperId = exam.value?.paper_id;
    if (paperId) {
      const paperRes = await getPaper(paperId);
      paper.value = paperRes.data;
      const majors = paper.value?.majorQuestions || [];
      subQuestions.value = majors.flatMap(m =>
        (m.subQuestions || []).map(s => ({
          ...s,
          majorNumber: m.major_number,
          question_type: m.question_type
        }))
      );
    } else {
      subQuestions.value = [];
    }
    const ansRes = await getMyAnswers(session.value.id);
    const initialSubmitted = new Set();
    const toMerge = {};
    (ansRes.data || []).forEach(a => {
      let parsedVal;
      if (a.answer_data) {
        const d = typeof a.answer_data === 'string' ? JSON.parse(a.answer_data || '{}') : (a.answer_data || {});
        if (Array.isArray(d.selected)) {
          parsedVal = d.selected;
        } else if (d.imageBase64) {
          parsedVal = d.imageBase64;
        } else if (Array.isArray(d.blanks)) {
          parsedVal = d.blanks;
        } else {
          parsedVal = a.answer_text || '';
        }
      } else {
        parsedVal = a.answer_text || '';
      }
      const isSlotSubmitted = a.slot_submitted === 1 || a.slot_submitted === true;
      const keyBySubId = a.sub_question_id != null && a.sub_question_id !== '' ? (Number(a.sub_question_id) || a.sub_question_id) : null;
      const keyByQNum = a.question_number != null && String(a.question_number).trim() !== '' ? a.question_number : null;
      if (keyBySubId != null) {
        toMerge[keyBySubId] = parsedVal;
        if (isSlotSubmitted) initialSubmitted.add(String(keyBySubId));
      }
      if (keyByQNum != null && keyByQNum !== keyBySubId) {
        toMerge[keyByQNum] = parsedVal;
        if (isSlotSubmitted) initialSubmitted.add(String(keyByQNum));
      }
    });
    Object.assign(answers, toMerge);
    submittedKeys.value = initialSubmitted;
    const isInterview = (exam.value?.exam_type || exam.value?.examType) === 'interview';
    const needCheckInNow = isInterview && (session.value.check_in_at == null || session.value.check_in_at === '');
    if (needCheckInNow) {
      return;
    }
    await proceedAfterCheckInReady(initialSubmitted);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '加载失败');
    router.push('/exams');
  }
}

function startCanEnterRoomPoll(initialSubmitted) {
  if (canEnterRoomPollTimer) clearInterval(canEnterRoomPollTimer);
  const pollMs = isPrerecordInterview.value ? 2500 : 5000;
  canEnterRoomPollTimer = setInterval(async () => {
    try {
      const r = await canEnterRoom(session.value.id);
      const d = r?.data?.data ?? r?.data;
      if (d) canEnterRoomResult.value = d;
      if (d && d.canEnter) {
        if (canEnterRoomPollTimer) clearInterval(canEnterRoomPollTimer);
        canEnterRoomPollTimer = null;
        await onInterviewCanEnterGranted(initialSubmitted);
      }
    } catch (_) {}
  }, pollMs);
}

async function onInterviewCanEnterGranted(initialSubmitted) {
  const flow = interviewConfig.value.interviewFlowMode;
  if (!roomEnteredSent.value && session.value?.id && interviewConfig.value.sequentialEntry) {
    roomEnteredSent.value = true;
    try {
      await enterRoomSession(session.value.id);
    } catch (_) {}
  }
  if (flow === 'online' && session.value?.status === 'pending') {
    try {
      await startSession(session.value.id);
      const sessionRes = await getMySession(exam.value.id);
      if (sessionRes?.data) session.value = sessionRes.data;
    } catch (_) {}
  }
  await finalizeExamRoom(initialSubmitted);
}

async function proceedAfterCheckInReady(initialSubmitted) {
  const isInterview = (exam.value?.exam_type || exam.value?.examType) === 'interview';
  if (!isInterview) {
    await finalizeExamRoom(initialSubmitted);
    return;
  }
  try {
    const enterRes = await canEnterRoom(session.value.id);
    const data = enterRes?.data?.data ?? enterRes?.data;
    if (data && !data.canEnter) {
      canEnterRoomResult.value = data;
      startCanEnterRoomPoll(initialSubmitted);
      return;
    }
    canEnterRoomResult.value = data || { canEnter: true };
    await onInterviewCanEnterGranted(initialSubmitted);
  } catch (_) {
    canEnterRoomResult.value = { canEnter: true };
    await finalizeExamRoom(initialSubmitted);
  }
}

async function finalizeExamRoom(initialSubmitted) {
  if (!session.value || !exam.value) return;
  const isInterview = (exam.value?.exam_type || exam.value?.examType) === 'interview';
  const sequentialEntry =
    isInterview && interviewConfig.value.sequentialEntry && !isPrerecordInterview.value;
  const interviewDurationMins = (exam.value?.answer_system_config?.interviewConfig?.interviewDurationMinutes != null)
    ? Number(exam.value.answer_system_config.interviewConfig.interviewDurationMinutes) : 10;

  if (session.value.status === 'submitted') {
    const allKeys = new Set(initialSubmitted || submittedKeys.value);
    const counts = exam.value?.answer_system_config?.subItemCounts || {};
    const displayOverrides = exam.value?.answer_system_config?.displayNumberOverrides || {};
    subQuestions.value.forEach((sq, idx) => {
      const n = Math.min(Math.max((counts[sq.id] > 1 ? counts[sq.id] : 1) | 0, 1), 10);
      const globalNum = (displayOverrides[sq.id] && String(displayOverrides[sq.id]).trim()) || String(idx + 1);
      for (let i = 0; i < n; i++) {
        allKeys.add(n <= 1 ? String(sq.id) : `${globalNum}-${sq.sub_number || ''}-${i}`);
      }
    });
    submittedKeys.value = allKeys;
  }
  const endTimeMs =
    !useInterviewSegmentTimer.value && exam.value?.end_time ? new Date(exam.value.end_time).getTime() : 0;
  if (endTimeMs && endTimeMs > Date.now()) {
    durationSecs.value = Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000));
    remainingSecs.value = durationSecs.value;
  } else {
    durationSecs.value = isInterview ? interviewDurationMins * 60 : (exam.value.duration_minutes || 90) * 60;
    if (session.value.started_at && !useInterviewSegmentTimer.value) {
      const elapsed = Math.floor((Date.now() - new Date(session.value.started_at).getTime()) / 1000);
      remainingSecs.value = Math.max(0, durationSecs.value - elapsed);
    } else if (session.value.started_at && useInterviewSegmentTimer.value && interviewAnswerStarted.value) {
      const elapsed = Math.floor((Date.now() - new Date(session.value.started_at).getTime()) / 1000);
      remainingSecs.value = Math.max(0, durationSecs.value - elapsed);
    } else {
      remainingSecs.value = durationSecs.value;
    }
  }
  if (session.value.status === 'pending') {
    if (sequentialEntry) {
      const pollUntilStarted = async () => {
        return new Promise((resolve) => {
          const t = setInterval(async () => {
            try {
              const r = await getMySession(exam.value.id);
              const s = r?.data;
              if (s && s.status === 'ongoing') {
                clearInterval(t);
                session.value = s;
                resolve();
              }
            } catch (_) {}
          }, 2000);
          setTimeout(() => { clearInterval(t); resolve(); }, 120000);
        });
      };
      await pollUntilStarted();
    }
    if (session.value.status === 'pending') {
      await startSession(session.value.id);
      session.value.status = 'ongoing';
      session.value.started_at = new Date().toISOString();
    }
  }
  if (
    session.value.status !== 'submitted' &&
    (monitorConfig.value.dualCamera || monitorConfig.value.screenShare || isPrerecordInterview.value)
  ) {
    await startMonitoring();
  }
  if (session.value.status === 'ongoing') {
    if (isPrerecordInterview.value && interviewConfig.value.unifiedStart) {
      beginPrerecordUnifiedAnswer();
      await nextTick();
      startPrerecordFrontCapture();
    } else {
      if (!interviewConfig.value.unifiedStart) {
        interviewAnswerStarted.value = true;
      }
      startTimer();
    }
  }
  await loadSideCameraQr();
  enableAntiCheat();
  nextTick(() => { requestFullscreen(); });
}

async function doCheckIn(faceImage) {
  if (!session.value?.id) return;
  checkInLoading.value = true;
  try {
    await checkInSession(session.value.id, faceImage ? { faceImage } : {});
    ElMessage.success(faceImage ? '刷脸签到成功' : '签到成功');
    showFaceCheckInDialog.value = false;
    if (faceCheckInStream) {
      faceCheckInStream.getTracks().forEach(t => t.stop());
      faceCheckInStream = null;
    }
    const sessionRes = await getMySession(route.params.id);
    session.value = sessionRes.data;
    await proceedAfterCheckInReady(submittedKeys.value);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '签到失败');
  } finally {
    checkInLoading.value = false;
  }
}

async function captureAndCheckIn() {
  const video = faceCheckInVideoRef.value;
  if (!video || !video.videoWidth) {
    ElMessage.warning('请确保摄像头已开启并正对镜头');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  await doCheckIn(dataUrl);
}

function applyOngoingAndStartTimer(s) {
  if (!s || s.status !== 'ongoing' || !exam.value) return;
  session.value = s;
  interviewAnswerStarted.value = true;
  syncInterviewRemainingFromSession(s);
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  startTimer();
}

/** 与计时计分端一致：按会话 started_at 与服务端配置的面试时长计算剩余秒数 */
function syncInterviewRemainingFromSession(s = session.value) {
  if (!exam.value || !s) return;
  const mins = (exam.value?.answer_system_config?.interviewConfig?.interviewDurationMinutes != null)
    ? Number(exam.value.answer_system_config.interviewConfig.interviewDurationMinutes) : 10;
  durationSecs.value = mins * 60;
  if (s.started_at) {
    const start = new Date(s.started_at).getTime();
    const end = start + durationSecs.value * 1000;
    remainingSecs.value = Math.max(0, Math.floor((end - Date.now()) / 1000));
  } else {
    remainingSecs.value = durationSecs.value;
  }
}

/** 提前录制 + 考务统一开考：计时计分开放闸门后会话为 ongoing，由系统自动开始倒计时与录像（考生不可再点「开始答题」） */
function beginPrerecordUnifiedAnswer() {
  if (!isPrerecordInterview.value || !interviewConfig.value.unifiedStart) return;
  if (interviewAnswerStarted.value || session.value?.status !== 'ongoing') return;
  interviewAnswerStarted.value = true;
  syncInterviewRemainingFromSession(session.value);
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  startTimer();
  notifyInterviewAnswerStarted();
}

function notifyInterviewAnswerStarted() {
  const mins = interviewConfig.value.interviewDurationMinutes;
  const rm = reminderMinuteMins.value;
  const tip = rm > 0 && rm < mins
    ? `答题已开始，本场作答 ${mins} 分钟；剩余 ${rm} 分钟时将提醒。`
    : `答题已开始，本场作答 ${mins} 分钟，时间到将自动上传录像并交卷。`;
  ElNotification.success({ title: '开始答题', message: tip, duration: 8000 });
}

function onInterviewUnifiedStartClick() {
  if (session.value?.status !== 'ongoing') {
    ElMessage.warning('请等待考务允许开始后再作答');
    return;
  }
  if (isPrerecordInterview.value) {
    ElMessage.info('提前录制由考务统一开考，无需点击开始答题');
    return;
  }
  if (interviewConfig.value.unifiedStart) {
    applyOngoingAndStartTimer(session.value);
    notifyInterviewAnswerStarted();
  }
}

function startTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  const endTimeMs =
    !useInterviewSegmentTimer.value && exam.value?.end_time ? new Date(exam.value.end_time).getTime() : 0;
  const reminderMins = reminderMinuteMins.value;
  const reminderSecs = reminderMins * 60;
  const interviewMins = interviewConfig.value.interviewDurationMinutes;
  let lastRemaining = remainingSecs.value;
  let warnedHalf = false;
  timerId = setInterval(() => {
    if (endTimeMs && endTimeMs > 0) {
      remainingSecs.value = Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000));
    } else if (
      useInterviewSegmentTimer.value &&
      interviewAnswerStarted.value &&
      session.value?.started_at
    ) {
      syncInterviewRemainingFromSession(session.value);
    } else {
      remainingSecs.value--;
    }
    if (remainingSecs.value <= 0) {
      clearInterval(timerId);
      timerId = null;
      if (isPrerecordInterview.value) {
        closePrerecordTimeUpNotification();
        prerecordTimeUpNotification = ElNotification.warning({
          title: '作答时间到',
          message: '请留在本页等待上传进度完成，勿返回考试列表',
          duration: 0
        });
      }
      submit(true);
    } else {
      if (useInterviewSegmentTimer.value && interviewMins >= 4) {
        const halfSecs = Math.floor((interviewMins * 60) / 2);
        if (!warnedHalf && lastRemaining > halfSecs && remainingSecs.value <= halfSecs) {
          warnedHalf = true;
          ElMessage.info(`本场作答已过半（约 ${interviewMins} 分钟），请抓紧完成`);
        }
      }
      if (lastRemaining > 120 && remainingSecs.value <= 120 && remainingSecs.value > 60) {
        ElMessage.warning('剩余 2 分钟，请抓紧时间作答');
      } else if (lastRemaining > 60 && remainingSecs.value <= 60) {
        ElMessage.warning('剩余 1 分钟，请尽快完成作答');
      }
      if (reminderSecs > 0 && lastRemaining > reminderSecs && remainingSecs.value <= reminderSecs && remainingSecs.value > 0) {
        ElMessage.warning(
          reminderMins === 1 ? '距离本场作答结束还有最后一分钟' : `距离本场作答结束还有 ${reminderMins} 分钟`
        );
      }
      lastRemaining = remainingSecs.value;
    }
  }, 1000);
}

function onAnswerBlur(q, textOrArray, isMulti = false, answerData = null, subIndex = undefined) {
  if (!session.value || session.value.status !== 'ongoing') return;
  let answerText = null;
  let data = null;
  if (isMulti && Array.isArray(textOrArray)) {
    data = { selected: textOrArray };
    answerText = textOrArray.join(',');
  } else if (answerData && answerData.imageBase64) {
    data = { imageBase64: answerData.imageBase64 };
  } else if (q.answerType === 'blank' && Array.isArray(textOrArray)) {
    data = { blanks: textOrArray };
    answerText = textOrArray.join(',');
  } else {
    answerText = Array.isArray(textOrArray) ? (textOrArray || []).join(',') : (textOrArray || '');
  }
  if (subIndex !== undefined && subIndex !== null && (q.subItemCount || 0) > 1) {
    saveAnswer(null, getQuestionNumberKey(q, subIndex), answerText, data);
  } else {
    saveAnswer(q.id, q.globalDisplayNumber ?? q.number ?? q.sub_number, answerText, data);
  }
}

async function saveAllAnswersBeforeSubmit() {
  if (!session.value || session.value.status !== 'ongoing') return;
  const batch = [];
  for (const q of enrichedQuestions.value) {
    const subCount = q.subItemCount || 1;
    for (let i = 0; i < subCount; i++) {
      const key = subCount <= 1 ? q.id : getQuestionNumberKey(q, i);
      const val = answers[key];
      const isMulti = q.answerType === 'multichoice';
      const isChoice = q.answerType === 'choice' || q.answerType === 'judge';
      const isBlank = q.answerType === 'blank';
      const isDrawing = q.answerType === 'drawing';
      let answerText = '';
      let answerData = null;
      if (isMulti && Array.isArray(val)) {
        answerData = { selected: val };
        answerText = val.join(',');
      } else if (isChoice && (val != null && val !== '')) {
        answerData = { selected: Array.isArray(val) ? val : [String(val)] };
        answerText = Array.isArray(val) ? val.join(',') : String(val);
      } else if (isDrawing && val && typeof val === 'string') {
        answerData = { imageBase64: val };
      } else if (isBlank && Array.isArray(val)) {
        answerData = { blanks: val };
        answerText = val.join(',');
      } else {
        answerText = Array.isArray(val) ? (val || []).join(',') : String(val || '');
      }
      const subQuestionId = subCount <= 1 && (q.id != null && q.id !== '') ? q.id : null;
      const questionNumber = subCount <= 1 ? (q.globalDisplayNumber ?? q.number ?? q.sub_number) : getQuestionNumberKey(q, i);
      batch.push({
        subQuestionId: subQuestionId ?? undefined,
        questionNumber: questionNumber != null && String(questionNumber) !== '' ? String(questionNumber) : undefined,
        answerText: answerText || undefined,
        answerData: answerData || undefined
      });
    }
  }
  if (batch.length === 0) return;
  await saveAnswersBatch({
    sessionId: session.value.id,
    answers: batch
  });
}

async function saveAnswer(subQuestionId, questionNumber, answerText, answerData = null, slotSubmitted = false) {
  if (!session.value || session.value.status !== 'ongoing') return;
  try {
    await saveAnswerApi({
      sessionId: session.value.id,
      subQuestionId: subQuestionId ?? undefined,
      questionNumber: questionNumber != null ? String(questionNumber) : undefined,
      answerText,
      answerData: answerData || undefined,
      slotSubmitted: slotSubmitted === true
    });
  } catch (e) {
    console.error('保存答案失败:', e);
    const msg = e?.response?.data?.message || e?.message || '保存失败';
    ElMessage.warning(`答案保存失败：${msg}，请检查网络后重试`);
  }
}

const OBJECTIVE_TYPES = ['choice', 'judge', 'multichoice', 'blank'];

function collectSubjectiveAnswersForSubmit() {
  const list = [];
  for (const q of enrichedQuestions.value) {
    if (OBJECTIVE_TYPES.includes(q.answerType)) continue;
    const subCount = q.subItemCount || 1;
    for (let i = 0; i < subCount; i++) {
      const key = subCount <= 1 ? q.id : getQuestionNumberKey(q, i);
      const val = answers[key];
      const questionNumber = subCount <= 1 ? (q.globalDisplayNumber ?? q.number ?? q.sub_number) : getQuestionNumberKey(q, i);
      if (questionNumber == null || String(questionNumber).trim() === '') continue;
      let answerText = '';
      let answerData = null;
      if (q.answerType === 'multichoice' && Array.isArray(val)) {
        answerData = { selected: val };
        answerText = val.join(',');
      } else if ((q.answerType === 'choice' || q.answerType === 'judge') && (val != null && val !== '')) {
        answerData = { selected: Array.isArray(val) ? val : [String(val)] };
        answerText = Array.isArray(val) ? val.join(',') : String(val);
      } else if (q.answerType === 'blank' && Array.isArray(val)) {
        answerData = { blanks: val };
        answerText = val.join(',');
      } else if (q.answerType === 'drawing' && val && typeof val === 'string') {
        answerData = { imageBase64: val };
      } else {
        answerText = Array.isArray(val) ? (val || []).join(',') : String(val || '');
      }
      list.push({
        questionNumber: String(questionNumber).trim(),
        answerText: answerText || undefined,
        answerData: answerData || undefined
      });
    }
  }
  return list;
}

function collectObjectiveAnswersForSubmit() {
  const list = [];
  for (const q of enrichedQuestions.value) {
    if (!OBJECTIVE_TYPES.includes(q.answerType)) continue;
    const subCount = q.subItemCount || 1;
    for (let i = 0; i < subCount; i++) {
      const key = subCount <= 1 ? q.id : getQuestionNumberKey(q, i);
      const val = answers[key];
      const questionNumber = subCount <= 1 ? (q.globalDisplayNumber ?? q.number ?? q.sub_number) : getQuestionNumberKey(q, i);
      if (questionNumber == null || String(questionNumber).trim() === '') continue;
      let answerText = '';
      let answerData = null;
      if (q.answerType === 'multichoice' && Array.isArray(val)) {
        answerData = { selected: val };
        answerText = val.join(',');
      } else if ((q.answerType === 'choice' || q.answerType === 'judge') && (val != null && val !== '')) {
        answerData = { selected: Array.isArray(val) ? val : [String(val)] };
        answerText = Array.isArray(val) ? val.join(',') : String(val);
      } else if (q.answerType === 'blank' && Array.isArray(val)) {
        answerData = { blanks: val };
        answerText = val.join(',');
      } else {
        answerText = Array.isArray(val) ? (val || []).join(',') : String(val || '');
      }
      list.push({
        questionNumber: String(questionNumber).trim(),
        answerText: answerText || undefined,
        answerData: answerData || undefined
      });
    }
  }
  return list;
}

function closePrerecordTimeUpNotification() {
  try {
    if (prerecordTimeUpNotification && typeof prerecordTimeUpNotification.close === 'function') {
      prerecordTimeUpNotification.close();
    }
  } catch (_) {}
  prerecordTimeUpNotification = null;
}

async function submit(isAuto = false) {
  if (submitInFlight || isSessionSubmitted.value) return;
  submitInFlight = true;
  if (!isAuto) {
    try {
      await ElMessageBox.confirm(
        '统一提交将把您的全部答案（客观题、主观题）上传并同步到阅卷系统，提交后无法修改。确定要提交吗？',
        '统一提交',
        {
          confirmButtonText: '确定提交',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );
    } catch {
      submitInFlight = false;
      return;
    }
  }
  let videoUploadOk = true;
  try {
    await saveAllAnswersBeforeSubmit();
    const objectiveAnswers = collectObjectiveAnswersForSubmit();
    const subjectiveAnswers = collectSubjectiveAnswersForSubmit();
    if (isPrerecordInterview.value) {
      prerecordSubmitting.value = true;
      prerecordUploadPercent.value = 0;
      prerecordUploadPhaseText.value = '正在结束录像…';
    }
    const uploadResult = await stopPrerecordAndUpload();
    videoUploadOk = uploadResult.ok;
    if (isPrerecordInterview.value) {
      prerecordUploadPhaseText.value = '正在提交答卷…';
      prerecordUploadPercent.value = uploadResult.ok ? 100 : Math.max(prerecordUploadPercent.value, 5);
    }
    await submitSession(session.value.id, {
      force: !videoUploadOk,
      objectiveAnswers,
      subjectiveAnswers
    });
    if (document.fullscreenElement) document.exitFullscreen?.();
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('exam_guest_token');
        window.sessionStorage.removeItem('exam_guest_session');
        window.sessionStorage.removeItem('exam_guest_examId');
      }
    } catch (e) {}
    closePrerecordTimeUpNotification();
    if (isPrerecordInterview.value) {
      if (videoUploadOk) {
        ElNotification.success({
          title: '交卷完成',
          message: isAuto
            ? '时间到：正面录像已上传并已交卷。侧面录像请确认手机侧摄页已传完。'
            : '正面录像已上传并已交卷。',
          duration: 10000
        });
      } else {
        ElNotification.warning({
          title: '答卷已提交，正面录像未上传',
          message: uploadResult.message || '录像未生成或上传失败，请联系考务；考官端可能无法回放。',
          duration: 0
        });
      }
    } else {
      ElMessage.success(isAuto ? '时间到，已自动提交' : '提交成功，答案已同步至阅卷系统');
    }
    if (isInterviewExam.value) {
      const submitStatus = videoUploadOk ? 'submitted' : 'force_submitted';
      session.value = { ...session.value, status: submitStatus, submitted_at: new Date().toISOString() };
    } else {
      router.push('/exams');
    }
  } catch (e) {
    closePrerecordTimeUpNotification();
    ElMessage.error(e.response?.data?.message || e.message || '提交失败，请稍后重试');
  } finally {
    submitInFlight = false;
    prerecordSubmitting.value = false;
    prerecordUploadPercent.value = 0;
    prerecordUploadPhaseText.value = '准备中…';
  }
}

async function doConfirmScore() {
  if (!session.value?.id || !exam.value?.id) return;
  confirmScoreLoading.value = true;
  try {
    await confirmInterviewScore(exam.value.id, session.value.id);
    ElMessage.success('已确认成绩');
    const r = await getMySession(exam.value.id);
    if (r?.data) session.value = r.data;
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '确认失败');
  } finally {
    confirmScoreLoading.value = false;
  }
}

function stopMonitorRecorders() {
  Object.values(monitorRecorderStops).forEach((r) => r?.stop?.());
  monitorRecorderStops = { camera: null, screen: null };
}

function startMonitorUploadForStream(stream, chunkType) {
  if (!stream || !session.value) return;
  monitorRecorderStops[chunkType]?.stop?.();
  const recorder = startMonitorSegmentRecorder(stream, chunkType, {
    sessionId: session.value.id,
    examId: exam.value?.id,
    getToken: getExamStudentToken,
    onError: (e) => {
      if (import.meta.env.DEV) console.warn('Monitor segment upload:', e?.message || e);
    }
  });
  monitorRecorderStops[chunkType] = recorder;
}

/** @returns {Promise<boolean>} 是否已成功获取主摄像头（含麦克风时用于监考/录像） */
async function openMainCameraStream() {
  if (cameraStream) return true;
  try {
    const { stream, warning } = await openCameraStreamWithOptionalAudio();
    cameraStream = stream;
    if (warning) ElMessage.warning(warning);
    if (cameraRef.value) {
      cameraRef.value.srcObject = cameraStream;
      cameraRef.value.play().catch(() => {});
    }
    return true;
  } catch (e) {
    const isNotFound = e?.name === 'NotFoundError' || /not found|Requested device not found/i.test(e?.message || '');
    const msg = isNotFound
      ? '未检测到摄像头（设备可能无摄像头或被占用），考试可继续作答'
      : '主摄像头无法打开，请授权摄像头与麦克风后刷新重试';
    if (import.meta.env.DEV) console.warn('Camera not available:', e?.message || e);
    ElMessage.warning(msg);
    return false;
  }
}

async function startMonitoring() {
  const cfg = monitorConfig.value;
  const needCamera = cfg.dualCamera || isPrerecordInterview.value;
  if (needCamera) {
    const ok = await openMainCameraStream();
    if (ok) {
      // 提前录制或开启双摄像头时，向监考端上传约 6 秒一段的画面（非 WebRTC 实时流）
      if (cfg.dualCamera || isPrerecordInterview.value) {
        startMonitorUploadForStream(cameraStream, 'camera');
      }
      if (cfg.dualCamera) showMonitorMini.value = true;
    }
  }
  if (cfg.screenShare) {
    try {
      // 使用 preferCurrentTab 突出当前标签页，简化选择流程（部分浏览器支持）
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia(
          buildDisplayMediaConstraints({ preferCurrentTab: true, audio: true })
        );
      } catch (optErr) {
        if (optErr?.name === 'NotAllowedError' || optErr?.name === 'NotFoundError') throw optErr;
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia(
            buildDisplayMediaConstraints({ audio: true })
          );
        } catch (_) {
          screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        }
      }
      if (screenRef.value) {
        screenRef.value.srcObject = screenStream;
        screenRef.value.play().catch(() => {});
      }
      startMonitorUploadForStream(screenStream, 'screen');
      showMonitorMini.value = true;
    } catch (e) {
      if (import.meta.env.DEV) console.warn('Screen share not available:', e);
      const isDenied = e?.name === 'NotAllowedError' || /Permission denied|permission denied/i.test(e?.message || '');
      ElMessage.warning(isDenied
        ? '您已取消屏幕监控授权，考试可继续作答。如需开启监考，请刷新页面后重新授权'
        : '屏幕监控未能开启，请检查设置或刷新重试');
    }
  }
}

function startPrerecordFrontCapture() {
  if (!isPrerecordInterview.value || !cameraStream) return;
  if (prerecordFrontRecorder && prerecordFrontRecorder.state === 'recording') return;
  try {
    prerecordFrontChunks = [];
    const opts =
      typeof MediaRecorder !== 'undefined'
        ? buildMediaRecorderOptions(cameraStream, { videoBitsPerSecond: 600000, audioBitsPerSecond: 64000 })
        : {};
    const mr =
      typeof MediaRecorder !== 'undefined' && Object.keys(opts).length
        ? new MediaRecorder(cameraStream, opts)
        : new MediaRecorder(cameraStream);
    prerecordFrontRecorder = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size) prerecordFrontChunks.push(e.data);
    };
    mr.start(1000);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('Prerecord MR:', e);
  }
}

/**
 * @returns {Promise<{ ok: boolean, message?: string, sizeBytes?: number }>}
 */
async function stopPrerecordAndUpload() {
  if (!isPrerecordInterview.value || !session.value?.id || !exam.value?.id) {
    return { ok: true };
  }
  const sid = session.value.id;
  const examIdVal = exam.value.id;
  const reportFrontFail = async () => {
    try {
      await postPrerecordVideoStatus(sid, 'front_fail');
    } catch (_) {}
  };

  const finishBlob = await new Promise((resolve) => {
    let settled = false;
    const done = (blob) => {
      if (settled) return;
      settled = true;
      resolve(blob);
    };
    const failTimer = setTimeout(() => done(null), 45000);
    try {
      const mr = prerecordFrontRecorder;
      if (!mr || mr.state === 'inactive') {
        clearTimeout(failTimer);
        prerecordFrontRecorder = null;
        done(null);
        return;
      }
      mr.onstop = () => {
        clearTimeout(failTimer);
        prerecordFrontRecorder = null;
        try {
          const blob = new Blob(prerecordFrontChunks, { type: 'video/webm' });
          prerecordFrontChunks = [];
          done(blob);
        } catch (_) {
          done(null);
        }
      };
      try {
        if (mr.state === 'recording' && typeof mr.requestData === 'function') mr.requestData();
      } catch (_) {}
      mr.stop();
    } catch (_) {
      clearTimeout(failTimer);
      reportFrontFail();
      done(null);
    }
  });

  if (!finishBlob || finishBlob.size <= 2000) {
    await reportFrontFail();
    return {
      ok: false,
      sizeBytes: finishBlob?.size || 0,
      message:
        finishBlob && finishBlob.size > 0
          ? '录像文件过小或未录到画面，请确认已授权摄像头并在开考后保持页面在前台'
          : '未检测到答题录像（摄像头未就绪或未开始录制），请联系考务重新安排'
    };
  }

  prerecordUploadPhaseText.value = `正在上传正面录像（约 ${(finishBlob.size / 1024 / 1024).toFixed(1)} MB）…`;
  prerecordUploadPercent.value = 1;
  const fd = new FormData();
  fd.append('file', finishBlob, 'front.webm');
  fd.append('kind', 'front');
  try {
    await uploadPrerecordVideo(examIdVal, sid, fd, (pct) => {
      prerecordUploadPercent.value = Math.max(1, Math.min(99, pct));
    });
    prerecordUploadPercent.value = 100;
    prerecordUploadPhaseText.value = '录像上传完成';
    return { ok: true, sizeBytes: finishBlob.size };
  } catch (e) {
    await reportFrontFail();
    const status = e?.response?.status;
    let msg = e?.response?.data?.message || e?.message || '网络或服务器错误';
    if (status === 413) {
      const mb = (finishBlob.size / 1024 / 1024).toFixed(1);
      msg = `录像约 ${mb} MB，超过服务器上传限制（HTTP 413）。请联系考务在 Nginx 将 client_max_body_size 调至至少 100m（建议 512m）后重试`;
    }
    prerecordUploadPhaseText.value = '上传失败';
    return { ok: false, sizeBytes: finishBlob.size, message: `录像上传失败：${msg}` };
  }
}

async function reportViolation(eventType, metadata = {}) {
  if (!session.value) return;
  violationCount++;
  try {
    await reportMonitorEvent({ sessionId: session.value.id, eventType, metadata });
  } catch (e) {}
  const maxV = monitorConfig.value.maxViolations;
  if (maxV > 0 && violationCount >= maxV) {
    ElMessage.warning('违规次数过多，系统将记录');
  }
}

function enableAntiCheat() {
  // 按考试配置强制锁屏与全屏，与创建页防作弊设置一致；默认开启确保监控生效
  const effectiveLockScreen = monitorConfig.value.lockScreen !== false;
  const effectiveRequireFullscreen = monitorConfig.value.requireFullscreen !== false;
  const onVisibility = () => {
    if (document.hidden && effectiveLockScreen) reportViolation('tab_leave');
  };
  const onBlur = () => {
    if (effectiveLockScreen) reportViolation('window_blur');
  };
  const onFullscreen = async () => {
    if (!effectiveRequireFullscreen) return;
    if (!document.fullscreenElement) {
      reportViolation('fullscreen_exit');
      showFullscreenLock.value = true;
      for (let i = 0; i < FULLSCREEN_RETRY_MAX; i++) {
        await new Promise(r => setTimeout(r, 300));
        if (document.fullscreenElement) {
          showFullscreenLock.value = false;
          return;
        }
        const el = containerRef.value || document.documentElement;
        try {
          await el?.requestFullscreen?.();
          showFullscreenLock.value = false;
          return;
        } catch (_) {}
      }
    } else {
      showFullscreenLock.value = false;
    }
  };
  const onCopy = e => { if (effectiveLockScreen) { e.preventDefault(); reportViolation('copy_attempt'); } };
  const onContext = e => { if (effectiveLockScreen) { e.preventDefault(); reportViolation('right_click'); } };
  const onPaste = e => { if (effectiveLockScreen) { e.preventDefault(); reportViolation('paste_attempt'); } };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  document.addEventListener('copy', onCopy);
  document.addEventListener('contextmenu', onContext);
  document.addEventListener('paste', onPaste);
  document.addEventListener('fullscreenchange', onFullscreen);
  const onBeforeUnload = (e) => {
    if (session.value?.status === 'ongoing') {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  antiCheatCleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('fullscreenchange', onFullscreen);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('contextmenu', onContext);
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('beforeunload', onBeforeUnload);
    antiCheatCleanup = null;
  };
}

async function requestFullscreen() {
  const el = containerRef.value || document.documentElement;
  try {
    await el?.requestFullscreen?.();
    showFullscreenLock.value = false;
  } catch (e) {
    ElMessage.warning('无法进入全屏，请允许浏览器全屏权限后重试');
  }
}

watch(showFaceCheckInDialog, async (open) => {
  if (!open) {
    if (faceCheckInStream) {
      faceCheckInStream.getTracks().forEach(t => t.stop());
      faceCheckInStream = null;
    }
    const v = faceCheckInVideoRef.value;
    if (v && v.srcObject) v.srcObject = null;
    return;
  }
  const v = faceCheckInVideoRef.value;
  if (!v) return;
  try {
    faceCheckInStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    v.srcObject = faceCheckInStream;
  } catch (e) {
    ElMessage.error('无法打开摄像头：' + (e.message || '请授权摄像头'));
  }
});

watch(
  () => ({
    phase: canEnterRoomResult.value?.interviewPhase,
    sid: session.value?.id,
    need: needCheckIn.value
  }),
  async (o) => {
    if (o.need || !o.sid || o.phase !== 'waiting_room') return;
    if (waitingRoomPosted.value) return;
    waitingRoomPosted.value = true;
    try {
      await postInterviewWaitingRoom(o.sid);
    } catch (_) {}
    try {
      await startMonitoring();
      await loadSideCameraQr();
    } catch (_) {}
  },
  { flush: 'post', deep: true }
);

watch([interviewAnswerStarted, () => session.value?.status, isPrerecordInterview, () => !!cameraStream], ([started, st, pre, hasCam]) => {
  if (!pre || !started || st !== 'ongoing' || !hasCam) return;
  if (prerecordFrontRecorder) return;
  nextTick(() => startPrerecordFrontCapture());
});

watch(
  () => [
    session.value?.status,
    isPrerecordInterview.value,
    interviewConfig.value?.unifiedStart,
    interviewAnswerStarted.value,
    canEnterRoomResult.value?.canEnter
  ],
  ([st, pre, unified, started, canEnter]) => {
    if (pre && unified && st === 'ongoing' && !started && canEnter === true) {
      beginPrerecordUnifiedAnswer();
    }
  }
);

function onBeforeUnloadWhileUpload(e) {
  if (!prerecordSubmitting.value) return;
  e.preventDefault();
  e.returnValue = '';
}

onBeforeRouteLeave((to, from, next) => {
  if (!prerecordSubmitting.value) {
    next();
    return;
  }
  ElMessageBox.confirm('正面录像仍在上传，离开页面可能导致上传失败且考官端无回放。确定要离开吗？', '请勿离开', {
    type: 'warning',
    confirmButtonText: '仍要离开',
    cancelButtonText: '继续等待'
  })
    .then(() => next())
    .catch(() => next(false));
});

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnloadWhileUpload);
  loadExam().catch((err) => {
    console.error('[ExamRoom] loadExam error:', err);
    ElMessage.error(err?.response?.data?.message || err?.message || '加载失败');
    router.push('/exams');
  });
});

watch(
  () => session.value?.status === 'submitted' && isInterviewExam.value && exam.value?.id,
  (shouldPoll) => {
    if (submittedScorePollTimer) clearInterval(submittedScorePollTimer);
    submittedScorePollTimer = null;
    if (!shouldPoll) return;
    let count = 0;
    submittedScorePollTimer = setInterval(async () => {
      count++;
      if (session.value?.total_score != null || count > 40) {
        if (submittedScorePollTimer) clearInterval(submittedScorePollTimer);
        submittedScorePollTimer = null;
        return;
      }
      try {
        const r = await getMySession(exam.value.id);
        if (r?.data) session.value = r.data;
      } catch (_) {}
    }, 15000);
  },
  { immediate: true }
);

// 顺序入场 + 统一开始：考官点击「开始答题」后，轮询会话状态，一旦 ongoing 则自动开始倒计时并进入作答
watch(
  [
    () => isInterviewExam.value,
    () => interviewConfig.value?.unifiedStart,
    interviewAnswerStarted,
    () => isSessionSubmitted.value,
    () => session.value?.id,
    () => session.value?.status,
    () => exam.value?.id
  ],
  () => {
    const shouldPoll =
      isInterviewExam.value &&
      !isPrerecordInterview.value &&
      interviewConfig.value?.unifiedStart &&
      !interviewAnswerStarted.value &&
      !isSessionSubmitted.value &&
      session.value?.id &&
      exam.value?.id &&
      session.value?.status === 'pending';
    if (!shouldPoll) {
      if (waitForOngoingPollId) {
        clearInterval(waitForOngoingPollId);
        waitForOngoingPollId = null;
      }
      return;
    }
    if (waitForOngoingPollId) return;
    const examId = exam.value?.id ?? route.params?.id;
    if (!examId) return;
    waitForOngoingPollId = setInterval(async () => {
      try {
        const r = await getMySession(examId);
        const s = r?.data;
        if (s && s.status === 'ongoing') {
          if (waitForOngoingPollId) {
            clearInterval(waitForOngoingPollId);
            waitForOngoingPollId = null;
          }
          applyOngoingAndStartTimer(s);
        }
      } catch (_) {}
    }, 2000);
  },
  { immediate: true }
);

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnloadWhileUpload);
  closePrerecordTimeUpNotification();
  if (canEnterRoomPollTimer) clearInterval(canEnterRoomPollTimer);
  canEnterRoomPollTimer = null;
  if (waitForOngoingPollId) clearInterval(waitForOngoingPollId);
  waitForOngoingPollId = null;
  if (submittedScorePollTimer) clearInterval(submittedScorePollTimer);
  submittedScorePollTimer = null;
  clearInterval(timerId);
  stopMonitorRecorders();
  stopSideCameraPreviewPoll();
  cameraStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  faceCheckInStream?.getTracks().forEach(t => t.stop());
  faceCheckInStream = null;
  antiCheatCleanup?.();
});
</script>

<style scoped>
.exam-room { min-height: 100vh; background: #fff; }
.exam-header { display: flex; align-items: center; gap: 16px; padding: 12px 24px; background: #409eff; color: #fff; }
.timer { font-size: 20px; font-weight: bold; margin-left: auto; }
.timer.warn { color: #f56c6c; }
.prerecord-submit-hint { font-size: 12px; opacity: 0.95; max-width: 280px; line-height: 1.35; }
.prerecord-submit-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.prerecord-submit-panel {
  background: #fff;
  border-radius: 12px;
  padding: 28px 32px;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.prerecord-submit-title { font-size: 18px; font-weight: 600; margin: 0 0 12px; color: #303133; }
.prerecord-submit-panel p { margin: 0 0 8px; font-size: 14px; color: #606266; line-height: 1.5; }
.prerecord-submit-sub { font-size: 12px; color: #909399; }
.prerecord-submit-phase { font-size: 14px; color: #303133; margin: 0 0 14px; font-weight: 500; }
.prerecord-upload-progress { margin-bottom: 14px; }
.exam-body { padding: 24px; overflow-y: auto; max-height: calc(100vh - 80px); }
.answer-mode-nav { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 20px; padding: 12px; background: #f5f7fa; border-radius: 8px; max-width: 900px; margin-left: auto; margin-right: auto; }
.answer-mode-nav .nav-label { font-weight: 500; color: #606266; min-width: 120px; text-align: center; }
.question-list { max-width: 900px; margin: 0 auto; }
.question-block { margin-bottom: 28px; padding: 20px; background: #fff; border: 1px solid #e4e7ed; border-radius: 8px; }
.question-content { margin-bottom: 16px; line-height: 1.8; font-size: 14px; }
.question-content :deep(img) { max-width: 100%; }
.interview-placeholder { font-style: italic; color: #909399; }
.interview-answer-hint { color: #606266; margin: 8px 0 0; font-size: 14px; }
.answer-box { padding-top: 12px; border-top: 1px dashed #ddd; }
.answer-box label { display: block; margin-bottom: 8px; font-weight: 500; color: #606266; }
.answer-actions { margin-top: 12px; display: flex; align-items: center; gap: 12px; }
.check-panel-stats { display: flex; gap: 20px; padding: 12px 0; margin-bottom: 12px; border-bottom: 1px solid #ebeef5; }
.check-panel-stats .stat-item { font-size: 13px; color: #606266; }
.check-panel-stats .stat-num { font-weight: 600; color: #409eff; }
.check-panel-list { display: flex; flex-wrap: wrap; gap: 8px; }
.check-slot-item { width: 48px; height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #dcdfe6; border-radius: 8px; cursor: pointer; font-size: 12px; transition: all 0.2s; }
.check-slot-item:hover { border-color: #409eff; background: #ecf5ff; }
.check-slot-item.answered { border-color: #67c23a; color: #67c23a; }
.check-slot-item.submitted { background: #f0f9eb; border-color: #67c23a; color: #67c23a; }
.check-slot-item .slot-num { font-weight: 600; }
.check-slot-item .slot-status { font-size: 10px; color: #909399; margin-top: 2px; }
.check-panel-footer { margin-top: 20px; padding-top: 16px; border-top: 1px solid #ebeef5; text-align: center; }
.check-panel-footer .unified-submit-btn { width: 100%; font-size: 15px; height: 44px; }
.check-panel-hint { font-size: 11px; color: #909399; margin-top: 8px; line-height: 1.4; }
.monitor-panel { position: fixed; top: 56px; right: 16px; z-index: 100; width: 320px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.15); padding: 12px; }
.monitor-panel-title { font-size: 13px; font-weight: 600; color: #303133; margin-bottom: 10px; }
.monitor-grid { display: flex; flex-direction: column; gap: 12px; }
.monitor-cell { border: 1px solid #e4e7ed; border-radius: 6px; overflow: hidden; background: #000; text-align: center; }
.monitor-cell-main .monitor-video { width: 100%; height: 180px; object-fit: cover; }
.monitor-cell:not(.monitor-cell-main) .monitor-video { width: 100%; height: 120px; object-fit: contain; }
.monitor-label { display: block; font-size: 12px; color: #909399; padding: 4px 0; background: #f5f7fa; }
.monitor-cell-qr .side-camera-qr-tip { font-size: 11px; color: #909399; margin: 4px 0; }
.monitor-cell-qr .side-camera-qr-tip.error { color: #f56c6c; }
.monitor-cell-qr .side-camera-qr-tip.dev-hint { font-size: 10px; color: #e6a23c; background: #fdf6ec; padding: 4px 6px; border-radius: 4px; margin: 6px 0; }
.monitor-cell-qr .side-camera-qr-tip.wechat-hint { font-size: 10px; color: #606266; line-height: 1.35; }
.monitor-cell-qr .side-camera-qr-img { display: block; width: 200px; height: 200px; margin: 0 auto 8px; }
.monitor-cell-qr .side-camera-link-row { display: flex; gap: 6px; align-items: center; margin-top: 8px; max-width: 100%; }
.monitor-cell-qr .side-camera-link-input { flex: 1; min-width: 0; }
.monitor-cell-qr .side-camera-link-input :deep(.el-input__inner) { font-size: 10px; }
.monitor-cell-side-live .side-camera-preview { width: 100%; max-height: 200px; object-fit: contain; background: #000; border-radius: 4px; }
.side-camera-qr-tip.connected { color: #67c23a; font-weight: 500; }
.examiner-video-panel { position: fixed; top: 56px; left: 16px; z-index: 99; width: 240px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); padding: 10px; border: 1px solid #e4e7ed; }
.examiner-video-title { font-size: 13px; font-weight: 600; color: #303133; margin-bottom: 8px; }
.examiner-video-wrap { position: relative; background: #000; border-radius: 6px; aspect-ratio: 4/3; display: flex; align-items: center; justify-content: center; min-height: 120px; }
.examiner-video-el { width: 100%; height: 100%; object-fit: cover; }
.examiner-video-tip { position: absolute; font-size: 12px; color: #909399; margin: 0; }
.fullscreen-lock-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.fullscreen-lock-content { text-align: center; color: #fff; }
.fullscreen-lock-title { font-size: 24px; font-weight: bold; margin-bottom: 12px; }
.fullscreen-lock-desc { font-size: 14px; margin-bottom: 24px; opacity: 0.9; }
.check-in-block { padding: 40px 24px; display: flex; align-items: center; justify-content: center; min-height: 60vh; }
.check-in-card { background: #fff; border: 1px solid #e4e7ed; border-radius: 12px; padding: 32px; text-align: center; max-width: 400px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.check-in-card h3 { margin: 0 0 12px; font-size: 18px; color: #303133; }
.check-in-tip { font-size: 14px; color: #606266; margin-bottom: 20px; line-height: 1.6; }
.check-in-card .el-button + .el-button { margin-left: 12px; }
.face-check-in-dialog { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.face-check-in-dialog .face-video { width: 100%; max-width: 320px; border-radius: 8px; background: #000; }
.waiting-room-block { padding: 40px 24px; display: flex; align-items: center; justify-content: center; min-height: 60vh; }
.waiting-room-card { background: #fff; border: 1px solid #e4e7ed; border-radius: 12px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.waiting-room-card h3 { margin: 0 0 12px; font-size: 18px; color: #303133; }
.waiting-tip { font-size: 15px; color: #606266; margin-bottom: 8px; }
.waiting-reason { font-size: 14px; color: #909399; margin-bottom: 16px; line-height: 1.6; }
.waiting-refresh { font-size: 13px; color: #c0c4cc; }
.prerecord-waiting-hint { margin-left: 12px; font-size: 14px; color: #606266; }
.prerecord-waiting .waiting-room-card { max-width: 520px; }
.interview-draw-greeting { font-size: 16px; font-weight: 600; margin: 0 0 16px; color: #303133; }
.interview-unified-start { padding: 24px; text-align: center; background: #f5f7fa; border-radius: 8px; margin-bottom: 20px; }
.unified-start-tip { margin: 0 0 16px; font-size: 14px; color: #606266; }
.exam-header .header-draw-number { margin: 0 12px; font-size: 15px; font-weight: 500; }
.exam-header .header-score { margin: 0 12px; font-size: 15px; font-weight: 500; }
.exam-header .header-confirmed { margin-right: 12px; font-size: 13px; color: #67c23a; }
</style>
