<template>
  <div>
    <el-page-header @back="$router.back()" :title="staffRoleTitle" />
    <!-- 工作人员仅看汇总：不显示试题、录音、评分表；展示与总管理端面试成绩汇总一致的列表与打印/导出 -->
    <div v-if="isStaffOnly" class="staff-summary-only">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px;">
        您以计时计分工作人员身份进入，仅可查看整体打分与汇总，不显示试题与评分表。
      </el-alert>
      <div v-if="staffDrawSchedule.length" class="staff-callboard">
        <div class="staff-callboard-block">
          <h4 class="staff-callboard-title">抽签顺序表（仅签号）</h4>
          <el-table :data="staffDrawSchedule" border size="small" max-height="220" class="staff-draw-table">
            <el-table-column prop="order" label="顺序" width="70" align="center" />
            <el-table-column prop="drawNumber" label="签号" width="90" align="center" />
            <el-table-column label="状态" min-width="120">
              <template #default="{ row }">
                <span v-if="row.isCurrent" class="tag-current">当前面试</span>
                <span v-else-if="row.isNext" class="tag-next">下一位</span>
                <span v-else-if="row.isWaiting" class="tag-wait">候考准备</span>
                <span v-else>—</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="staff-callboard-block staff-callboard-voice">
          <h4 class="staff-callboard-title">考场叫号</h4>
          <p class="staff-call-line"><strong>当前面试签号：</strong>{{ staffCallCurrentText }}</p>
          <p class="staff-call-line"><strong>下一位签号：</strong>{{ staffCallNextText }}</p>
          <p class="staff-call-line"><strong>候考准备签号：</strong>{{ staffCallWaitingText }}</p>
        </div>
      </div>
      <div v-if="staffIsPrerecordFlow" class="staff-prerecord-gate">
        <h4 class="staff-callboard-title">提前录制统一开考</h4>
        <p class="staff-prerecord-tip">考生抽签并签到后进入候考室（不显示试题）；计时计分（或监督员）点击下方「开始答题」后，全体考生进入试题界面并开始倒计时与录像上传。</p>
        <div v-if="staffPrerecordStatus" class="staff-prerecord-status">
          <p>
            <span class="staff-prerecord-label">闸门：</span>
            <strong>{{ staffPrerecordStatus.gateOpenAt ? '已开放（' + formatPrerecordDateTime(staffPrerecordStatus.gateOpenAt) + '）' : '未开放' }}</strong>
            <el-tag v-if="staffPrerecordStatus.confirmPending" type="warning" size="small" style="margin-left: 8px;">待确认开考</el-tag>
          </p>
          <p>
            <span class="staff-prerecord-label">开考策略：</span>
            {{ staffPrerecordStatus.prerecordStartPolicy || '—' }}
            <span v-if="staffPrerecordStatus.prerecordScheduledStartAt" class="text-muted">
              （计划：{{ formatPrerecordDateTime(staffPrerecordStatus.prerecordScheduledStartAt) }}）
            </span>
          </p>
        </div>
        <div class="staff-prerecord-actions">
          <el-button type="primary" :loading="staffPrerecordGateLoading" @click="onStaffOpenPrerecordGate">开始答题</el-button>
          <el-button
            v-if="staffPrerecordStatus && staffPrerecordStatus.confirmPending"
            type="success"
            :loading="staffPrerecordGateLoading"
            @click="onStaffConfirmPrerecordGate"
          >
            确认开放答题（定时+确认）
          </el-button>
          <el-button size="small" @click="loadStaffPrerecordStatus">刷新闸门状态</el-button>
        </div>
      </div>
      <div class="staff-summary-toolbar">
        <p v-if="staffIsPrerecordFlow" class="staff-seq-hint">
          本场为<strong>提前录制</strong>：请用上方「开始答题」统一开考（考生端届时才显示试题）；下方「开始答题」仅用于<strong>非提前录制</strong>顺序入场叫号。交卷后请考官按签号回看录像并保存评分，计时计分用<strong>上一位 / 下一位</strong>推进叫号指针（当前号须已交卷且各考官已保存评分后方可点「下一位」）。
        </p>
        <div class="staff-summary-toolbar-btns">
          <el-button type="primary" :loading="staffLoading" @click="loadStaffSummary">刷新</el-button>
          <el-button
            v-if="!staffIsPrerecordFlow"
            type="primary"
            size="small"
            :disabled="!staffSelectedPendingSession"
            @click="onStaffAllowStart"
          >
            开始答题
          </el-button>
          <el-button
            type="warning"
            size="small"
            :loading="staffPrevLoading"
            :disabled="!canStaffPreviousCandidate"
            @click="onStaffPreviousCandidate"
          >
            上一位
          </el-button>
          <el-button
            type="success"
            size="small"
            :loading="staffNextLoading"
            :disabled="!canStaffNextCandidate"
            @click="onStaffNextCandidate"
          >
            下一位
          </el-button>
          <el-button type="success" :loading="gradingTableLoading" @click="openStaffPrintDialog">打印汇总表</el-button>
          <el-button :loading="gradingTableLoading" @click="exportStaffGradingTableToExcel">下载汇总表（Excel）</el-button>
          <el-button :loading="gradingTableLoading" @click="openCandidateSignSheetDialog">打印考生签字确认表（一式两联）</el-button>
        </div>
      </div>
      <div v-if="staffCountdownVisible" class="staff-countdown-box">
        <span class="staff-countdown-label">当前答题考生倒计时：</span>
        <span class="staff-countdown-value">{{ staffCountdownText }}</span>
        <span v-if="staffReminderShown" class="staff-reminder-tip">（距离考试结束还有 {{ staffReminderMins }} 分钟）</span>
      </div>
      <el-table v-loading="staffLoading" :data="staffSummaryList" border stripe size="small">
        <el-table-column prop="drawNumber" label="签号" width="80" align="center" />
        <el-table-column v-for="label in staffExaminerColumnLabels" :key="label" :label="label + '得分'" width="100" align="center">
          <template #default="{ row }">
            {{ (row.graderTotals || []).find(t => t.examinerLabel === label)?.total != null ? Number((row.graderTotals || []).find(t => t.examinerLabel === label).total).toFixed(2) : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="去掉最高分" width="100" align="center">
          <template #default="{ row }">
            {{ row.droppedHighest != null ? Number(row.droppedHighest).toFixed(2) : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="去掉最低分" width="100" align="center">
          <template #default="{ row }">
            {{ row.droppedLowest != null ? Number(row.droppedLowest).toFixed(2) : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="考生成绩" width="120" align="center">
          <template #default="{ row }">
            {{ row.finalScore != null ? Number(row.finalScore).toFixed(2) : '—' }}
          </template>
        </el-table-column>
      </el-table>
      <div v-if="currentUserIsSupervisor" class="supervisor-sign-section">
        <span class="supervisor-label">监督员签字：</span>
        <el-button size="small" :loading="supervisorSignatureLoading" @click="openSupervisorSignPad">
          {{ supervisorSignatureImage ? '已手写，重新签名' : '手写签名' }}
        </el-button>
        <img v-if="supervisorSignatureImage" :src="supervisorSignatureImage" alt="监督员签名" class="signature-thumb" />
      </div>
      <el-dialog v-model="staffPrintVisible" title="面试成绩汇总表" width="90%" top="2vh" class="print-dialog print-dialog-summary" @open="loadStaffGradingTable">
        <div ref="staffPrintArea" class="print-area print-area-a4-landscape">
          <h2 v-if="staffGradingTable.examName" class="print-title">{{ staffGradingTable.examName }} - 面试成绩汇总表</h2>
          <table v-if="staffGradingTable.rows?.length" class="print-table">
            <thead>
              <tr>
                <th>签号</th>
                <th v-for="g in (staffGradingTable.rows[0] && staffGradingTable.rows[0].graderTotals) || []" :key="g.graderId">{{ g.name }}得分</th>
                <th>去掉最高分</th>
                <th>去掉最低分</th>
                <th>考生成绩</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in staffGradingTable.rows" :key="r.sessionId">
                <td>{{ r.drawNumber }}</td>
                <td v-for="g in r.graderTotals" :key="g.graderId">{{ g.total != null ? g.total : '—' }}</td>
                <td>{{ r.droppedHighest != null ? Number(r.droppedHighest).toFixed(2) : '—' }}</td>
                <td>{{ r.droppedLowest != null ? Number(r.droppedLowest).toFixed(2) : '—' }}</td>
                <td>{{ r.finalScore != null ? Number(r.finalScore).toFixed(2) : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="no-data">暂无数据</p>
          <div class="print-supervisor-sign">
            <span>监督员签字：</span>
            <img v-if="staffGradingTable.supervisorSignature" :src="staffGradingTable.supervisorSignature" alt="监督员签名" class="supervisor-sign-img" />
            <span v-else>__________</span>
          </div>
        </div>
        <template #footer>
          <el-button @click="staffPrintVisible = false">关闭</el-button>
          <el-button type="primary" @click="doStaffPrint">打印</el-button>
        </template>
      </el-dialog>
      <el-dialog v-model="candidateSignSheetVisible" title="考生签字确认表（一式两联）" width="90%" top="2vh" class="print-dialog" @open="loadStaffGradingTable">
        <div ref="candidateSignSheetArea" class="print-area candidate-sign-sheet-area">
          <div v-for="r in (staffGradingTable.rows || [])" :key="r.sessionId" class="sign-sheet-page">
            <div class="sign-sheet-twins">
              <div class="sign-sheet-copy">
                <p class="sign-sheet-title">{{ staffGradingTable.examName }} - 考生成绩签字确认表（存根联）</p>
                <p>签号：{{ r.drawNumber }} &nbsp; 姓名：{{ r.realName }} &nbsp; 准考证号：{{ r.examNumber }}</p>
                <p class="sign-sheet-score">最终成绩：<strong>{{ r.finalScore != null ? Number(r.finalScore).toFixed(2) : '—' }}</strong></p>
                <p>考生签字：__________ &nbsp; 日期：__________</p>
              </div>
              <div class="sign-sheet-copy">
                <p class="sign-sheet-title">{{ staffGradingTable.examName }} - 考生成绩签字确认表（考生联）</p>
                <p>签号：{{ r.drawNumber }} &nbsp; 姓名：{{ r.realName }} &nbsp; 准考证号：{{ r.examNumber }}</p>
                <p class="sign-sheet-score">最终成绩：<strong>{{ r.finalScore != null ? Number(r.finalScore).toFixed(2) : '—' }}</strong></p>
                <p>考生签字：__________ &nbsp; 日期：__________</p>
              </div>
            </div>
          </div>
          <p v-if="!staffGradingTable.rows?.length" class="no-data">暂无数据，请先加载</p>
        </div>
        <template #footer>
          <el-button @click="candidateSignSheetVisible = false">关闭</el-button>
          <el-button type="primary" @click="doPrintCandidateSignSheet">打印</el-button>
        </template>
      </el-dialog>
    </div>
    <template v-else>
    <!-- 考官端：无开始答题/下一位按钮，由计时计分端操作 -->
    <!-- 考官端：考生正面视频 -->
    <div v-if="currentSession && !isPrerecordExamMode" class="candidate-video-panel">
      <div class="candidate-video-title">考生正面视频</div>
      <div class="candidate-video-wrap">
        <video ref="candidateVideoRef" autoplay playsinline muted class="candidate-video-el" />
        <p class="candidate-video-tip">未接入实时视频；请在企业端打开本场「考试监控」查看考生分片画面（约每 6 秒刷新）</p>
      </div>
    </div>
    <div v-if="isPrerecordExamMode && currentSession" class="prerecord-video-panel">
      <div class="prerecord-video-panel-head">
        <div class="candidate-video-title">提前录制录像回放</div>
        <el-button size="small" :loading="prerecordVideoLoading" @click="loadPrerecordVideosForSession(selectedSessionId)">刷新录像</el-button>
      </div>
      <div v-if="prerecordVideoLoading" class="prerecord-video-loading">正在加载录像…</div>
      <div v-else-if="prerecordVideoList.length" class="prerecord-video-grid">
        <div v-for="v in prerecordVideoList" :key="(v.id || '') + '-' + (v.kind || '')" class="prerecord-video-cell">
          <span class="prerecord-video-label">{{ v.kind === 'side' ? '侧面' : '正面' }}</span>
          <video v-if="v.filePath" controls playsinline preload="metadata" class="candidate-video-el" :src="prerecordVideoUrl(v.filePath)" />
        </div>
      </div>
      <el-alert
        v-else-if="prerecordSubmittedNoVideo"
        type="warning"
        :closable="false"
        show-icon
        title="未找到提前录制录像"
        description="该考生已交卷但系统尚未查询到录像。请点「刷新录像」；并确认考生交卷时正面/手机侧摄已上传成功。"
      />
      <p v-else class="prerecord-video-empty">
        暂无录像（考生未交卷、录像未上传，或交卷时摄像头未就绪导致未录到）。请让考生重新测试：开考后保持正面摄像头开启至倒计时结束再交卷；侧面需手机扫侧摄二维码。
      </p>
    </div>
    <div class="layout">
      <aside class="session-list">
        <div class="session-list-header">
          <h3>考生列表</h3>
          <p v-if="interviewFlowModeLabel" class="interview-flow-mode-tip">
            <el-tag type="info" size="small">{{ interviewFlowModeLabel }}</el-tag>
            <span class="text-xs text-gray-500">（在企业/总管理端「面试设置」中配置）</span>
          </p>
          <p v-if="currentSession" class="current-draw-number-tip">当前叫号 / 答题签号：<strong>{{ displayCurrentDrawNumberForTip != null ? displayCurrentDrawNumberForTip + ' 号' : '—' }}</strong></p>
          <p v-if="!isStaffOnly" class="current-draw-number-tip">下一位要考的考生抽签号：<strong>{{ drawStatusNextDrawNumber != null ? drawStatusNextDrawNumber + ' 号' : '—' }}</strong></p>
          <el-select
            v-model="selectedSessionId"
            placeholder="选择考生"
            size="small"
            class="session-select"
          >
            <el-option
              v-for="s in sessions"
              :key="s.id"
              :label="sessionLabel(s)"
              :value="s.id"
            />
          </el-select>
        </div>
        <el-scrollbar class="session-scroll">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === selectedSessionId }"
            @click="selectSession(s.id)"
          >
            <div class="session-name">{{ sessionLabel(s) }}</div>
            <div class="session-status">
              <span>{{ sessionStatusLabel(s) }}</span>
              <span v-if="s.total_score != null" class="session-score">{{ s.total_score }} 分</span>
            </div>
          </div>
        </el-scrollbar>
      </aside>

      <main class="grading-main" :class="{ 'grading-main-fullscreen-rubric': hasNoQuestions }" v-loading="loading">
        <template v-if="currentSession">
          <!-- 无试题时：只显示评分表全屏 -->
          <template v-if="hasNoQuestions">
            <div class="rubric-fullscreen-wrap">
              <div class="rubric-fullscreen-toolbar">
                <el-button @click="exportRubricToExcel">导出评分表</el-button>
                <el-button @click="printRubric">打印</el-button>
                <el-button type="primary" :loading="saving" :disabled="!rubricItems.length || !hasAnyScore || prerecordSubmittedNoVideo" @click="saveGrades">保存评分</el-button>
              </div>
              <div class="rubric-fullscreen-meta">考生抽签号：<strong>{{ currentSession?.draw_number != null ? currentSession.draw_number + ' 号' : '—' }}</strong></div>
              <table class="rubric-table-image rubric-table-fullscreen" border="1" cellspacing="0" cellpadding="8">
                <thead>
                  <tr>
                    <td :colspan="rubricItems.length + 1" class="rubric-title-cell">结构化面试考官评分表</td>
                  </tr>
                  <tr>
                    <th class="rubric-label-col">测评要素</th>
                    <th v-for="item in rubricItems" :key="item.id" class="rubric-element-col">{{ item.item_name || '—' }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="rubric-label-col">要素分值</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ item.max_score ?? '—' }}</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">评分要点</td>
                    <td v-for="item in rubricItems" :key="item.id" class="scoring-points-cell"><span class="scoring-points">{{ getScoringPoints(item) }}</span></td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">好</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ getRatingLevels(item.max_score).good }} 分</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">中</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ getRatingLevels(item.max_score).medium }} 分</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">差</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ getRatingLevels(item.max_score).poor }} 分</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">得分</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center" class="score-input-cell">
                      <el-input-number
                        :model-value="scoreMap[item.id]"
                        :min="0"
                        :max="item.max_score || 100"
                        :step="0.01"
                        :precision="2"
                        size="small"
                        controls-position="right"
                        @update:model-value="(v) => onScoreChange(item.id, v)"
                      />
                      <el-button-group size="small" class="score-quick-btns">
                        <el-button @click="setScoreByLevel(item, 'good')">好</el-button>
                        <el-button @click="setScoreByLevel(item, 'medium')">中</el-button>
                        <el-button @click="setScoreByLevel(item, 'poor')">差</el-button>
                      </el-button-group>
                    </td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">评语</td>
                    <td :colspan="rubricItems.length" class="comment-cell">
                      <el-input v-model="overallComment" type="textarea" :rows="2" placeholder="请输入总评语" size="small" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="rubric-summary">总分：<strong>{{ (typeof totalScore === 'number' && !Number.isNaN(totalScore)) ? totalScore.toFixed(2) : totalScore }}</strong></div>
              <div class="direct-total-row">
                <span>直接打总分：</span>
                <el-input-number v-model="directTotalScore" :min="0" :max="999" :step="0.01" :precision="2" size="small" controls-position="right" placeholder="输入总分" style="width: 120px; margin-right: 8px;" />
                <el-button size="small" @click="applyDirectTotalScore">确认并填入</el-button>
              </div>
              <div class="rubric-dialog-sign">
                <span>考官签名：</span>
                <el-button size="small" @click="showSignaturePad = true">{{ examinerSignatureImage ? '已手写，重新签名' : '手写签名' }}</el-button>
                <img v-if="examinerSignatureImage" :src="examinerSignatureImage" alt="签名" class="signature-thumb" />
                <span style="margin-left: 16px;">日期：</span>
                <el-input v-model="examinerDate" placeholder="年 月 日" size="small" style="width: 160px;" readonly />
              </div>
            </div>
          </template>

          <!-- 有试题时：指导语、试题、结束语、录音、打开评分表 -->
          <template v-else>
            <div v-if="showQuestionsExaminer && guidingWordsHtml" class="interview-guide-block">
              <div class="interview-guide-title">指导语</div>
              <div class="interview-guide-sub">（供主考官使用）</div>
              <div class="interview-guide-content" v-html="guidingWordsHtml"></div>
            </div>
            <div v-if="showExaminerInstructions && examinerInstructionsContent" class="examiner-instructions-panel">
              <el-collapse>
                <el-collapse-item name="instructions">
                  <template #title>
                    <span class="examiner-instructions-title">考官题本使用说明</span>
                  </template>
                  <div class="examiner-instructions-content" v-html="examinerInstructionsContent"></div>
                </el-collapse-item>
              </el-collapse>
            </div>
            <div v-if="showQuestionsExaminer && paperQuestions.length" class="stem-panel">
              <h3>试题</h3>
              <div v-for="q in paperQuestions" :key="q.id" class="stem-question-block">
                <div class="stem-item">
                  <div class="stem-content" v-html="q.content_html"></div>
                </div>
                <div class="stem-ref-block">
                  <div class="stem-ref-row">
                    <span class="answer-ref-label">参考答案：</span>
                    <div class="stem-ref-value" v-html="getQuestionAnswer(q) || '（无）'"></div>
                  </div>
                  <div class="stem-ref-row">
                    <span class="answer-ref-label">解析：</span>
                    <div class="stem-ref-value" v-html="getQuestionExplanation(q) || '（无）'"></div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="showQuestionsExaminer && closingWordsHtml" class="interview-guide-block interview-closing-block">
              <div class="interview-guide-title">结束指导语</div>
              <div class="interview-guide-sub">（供主考官使用）</div>
              <div class="interview-guide-content" v-html="closingWordsHtml"></div>
            </div>
            <div class="rubric-entry">
              <el-button type="primary" :disabled="!rubricItems.length" @click="showRubricDialog = true">开始打分</el-button>
            </div>
          </template>

          <el-dialog
            v-model="showRubricDialog"
            title="结构化面试考官评分表"
            fullscreen
            class="rubric-dialog rubric-dialog-fullscreen"
            destroy-on-close
            @opened="onRubricDialogOpened"
            @closed="rubricDialogClosed"
          >
            <div ref="rubricDialogBodyRef" class="rubric-dialog-body">
              <div class="rubric-dialog-meta">
                考生抽签号：<strong>{{ currentSession?.draw_number != null ? currentSession.draw_number + ' 号' : '—' }}</strong>
              </div>
              <table class="rubric-table-image" border="1" cellspacing="0" cellpadding="8">
                <thead>
                  <tr>
                    <td :colspan="rubricItems.length + 1" class="rubric-title-cell">结构化面试考官评分表</td>
                  </tr>
                  <tr>
                    <th class="rubric-label-col">测评要素</th>
                    <th v-for="item in rubricItems" :key="item.id" class="rubric-element-col">{{ item.item_name || '—' }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="rubric-label-col">要素分值</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ item.max_score ?? '—' }}</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">评分要点</td>
                    <td v-for="item in rubricItems" :key="item.id" class="scoring-points-cell"><span class="scoring-points">{{ getScoringPoints(item) }}</span></td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">好</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ getRatingLevels(item.max_score).good }} 分</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">中</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ getRatingLevels(item.max_score).medium }} 分</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">差</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center">{{ getRatingLevels(item.max_score).poor }} 分</td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">得分</td>
                    <td v-for="item in rubricItems" :key="item.id" align="center" class="score-input-cell">
                      <el-input-number
                        :model-value="scoreMap[item.id]"
                        :min="0"
                        :max="item.max_score || 100"
                        :step="0.01"
                        :precision="2"
                        size="small"
                        controls-position="right"
                        @update:model-value="(v) => onScoreChange(item.id, v)"
                      />
                      <el-button-group size="small" class="score-quick-btns">
                        <el-button @click="setScoreByLevel(item, 'good')">好</el-button>
                        <el-button @click="setScoreByLevel(item, 'medium')">中</el-button>
                        <el-button @click="setScoreByLevel(item, 'poor')">差</el-button>
                      </el-button-group>
                    </td>
                  </tr>
                  <tr>
                    <td class="rubric-label-col">评语</td>
                    <td :colspan="rubricItems.length" class="comment-cell">
                      <el-input v-model="overallComment" type="textarea" :rows="2" placeholder="请输入总评语" size="small" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="rubric-summary">
                总分：<strong>{{ (typeof totalScore === 'number' && !Number.isNaN(totalScore)) ? totalScore.toFixed(2) : totalScore }}</strong>
              </div>
              <div class="direct-total-row">
                <span>直接打总分：</span>
                <el-input-number
                  v-model="directTotalScore"
                  :min="0"
                  :max="999"
                  :step="0.01"
                  :precision="2"
                  size="small"
                  controls-position="right"
                  placeholder="输入总分"
                  style="width: 120px; margin-right: 8px;"
                />
                <el-button size="small" @click="applyDirectTotalScore">确认并填入</el-button>
              </div>
              <div class="rubric-dialog-sign">
                <span>考官签名：</span>
                <el-button size="small" @click="showSignaturePad = true">{{ examinerSignatureImage ? '已手写，重新签名' : '手写签名' }}</el-button>
                <img v-if="examinerSignatureImage" :src="examinerSignatureImage" alt="签名" class="signature-thumb" />
                <span style="margin-left: 16px;">日期：</span>
                <el-input v-model="examinerDate" placeholder="年 月 日" size="small" style="width: 160px;" readonly />
              </div>
            </div>
            <template #footer>
              <div class="rubric-dialog-footer">
                <el-button @click="exportRubricToExcel">导出评分表</el-button>
                <el-button @click="printRubric">打印</el-button>
                <el-button type="primary" :loading="saving" :disabled="!rubricItems.length || !hasAnyScore || prerecordSubmittedNoVideo" @click="saveGrades">保存评分</el-button>
                <el-button @click="showRubricDialog = false">关闭</el-button>
              </div>
            </template>
          </el-dialog>

        </template>
        <el-empty v-else description="请选择左侧考生开始评分" />
      </main>
    </div>
    </template>
    <el-dialog
      v-model="showSignaturePad"
      :title="isSupervisorSignMode ? '监督员手写签名' : '考官手写签名'"
      fullscreen
      class="signature-pad-dialog"
      append-to-body
      @opened="onSignaturePadDialogOpened"
    >
      <div ref="signaturePadWrapRef" class="signature-pad-wrap">
        <canvas
          ref="signatureCanvasRef"
          class="signature-canvas"
          @mousedown="onSigMouseDown"
          @mousemove="onSigMouseMove"
          @mouseup="onSigMouseUp"
          @mouseleave="onSigMouseUp"
          @touchstart.prevent="onSigTouchStart"
          @touchmove.prevent="onSigTouchMove"
          @touchend.prevent="onSigTouchEnd"
          @touchcancel.prevent="onSigTouchEnd"
        />
      </div>
      <template #footer>
        <el-button @click="clearSignaturePad">清空</el-button>
        <el-button type="primary" @click="confirmSignaturePad">确认</el-button>
        <el-button @click="showSignaturePad = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as XLSX from 'xlsx';
import {
  getInterviewSessions,
  getInterviewRubric,
  getInterviewPrerecordVideos,
  getInterviewGrades,
  saveInterviewGrades,
  allowStartInterview,
  nextCandidate,
  previousCandidate,
  getCurrentDrawStatus,
  getExam,
  getPaper,
  getMyExaminerLabel,
  getInterviewStaffSummary,
  getInterviewGradingTable,
  getSupervisorSignature,
  postSupervisorSignature,
  getInterviewPrerecordStatus,
  openInterviewPrerecordGate,
  confirmInterviewPrerecordGate
} from '../api/grading';

const route = useRoute();
const examId = computed(() => Number(route.params.examId));
const isStaffOnly = computed(() => route.query.staffOnly === '1');
const staffSummaryList = ref([]);
const staffLoading = ref(false);
const staffPrintVisible = ref(false);
const staffPrintArea = ref(null);
const candidateSignSheetVisible = ref(false);
const candidateSignSheetArea = ref(null);
const staffGradingTable = ref({ examName: '', rows: [], supervisorSignature: '' });
const gradingTableLoading = ref(false);
const staffNextLoading = ref(false);
const staffPrevLoading = ref(false);
const staffCurrentDrawNumber = ref(null);
const currentUserIsSupervisor = ref(false);
const supervisorSignatureImage = ref('');
const supervisorSignatureLoading = ref(false);
const isSupervisorSignMode = ref(false);
const requiresStaffAdvanceAck = ref(false);
const advanceSupervisorPinConfigured = ref(false);

const loading = ref(false);
const saving = ref(false);
const sessions = ref([]);
const rubricItems = ref([]);
const gradesLoaded = ref(false);

const selectedSessionId = ref(null);
const examTitle = ref('面试评分');
const myExaminerLabel = ref('');
const staffRoleTitle = computed(() => {
  const base = examTitle.value || '面试评分';
  if (isStaffOnly.value) return base + (currentUserIsSupervisor.value ? ' - 监督员' : ' - 计时计分员');
  return myExaminerLabel.value ? base + ' - ' + myExaminerLabel.value : base;
});
const drawStatus = ref(null);
const drawStatusNextDrawNumber = computed(() => {
  const d = drawStatus.value;
  if (!d || !d.nextCandidate) return null;
  return d.nextCandidate.drawNumber != null ? Number(d.nextCandidate.drawNumber) : null;
});
const showExaminerInstructions = ref(false);
const examinerInstructionsContent = ref('');
const showQuestionsExaminer = ref(false);
const paperQuestions = ref([]);
const guidingWordsHtml = ref('');
const closingWordsHtml = ref('');
const directTotalScore = ref(null);

const staffExaminerOrder = ref([]);
const staffExaminerColumnLabels = computed(() => {
  const first = staffSummaryList.value[0];
  const totals = first?.graderTotals || [];
  const fromRow = totals.map((t) => t.examinerLabel || ('考官' + t.gradingAccountId));
  return fromRow.length ? fromRow : staffExaminerOrder.value;
});

const staffDrawSchedule = computed(() => {
  const d = drawStatus.value;
  if (!d || !Array.isArray(d.drawSchedule)) return [];
  return d.drawSchedule;
});

const staffCallCurrentText = computed(() => {
  const n = drawStatus.value?.currentDrawNumber;
  return n != null && n !== '' ? `${n} 号` : '—';
});
const staffCallNextText = computed(() => {
  const n = drawStatus.value?.nextCandidate?.drawNumber;
  return n != null && n !== '' ? `${n} 号` : '—';
});
const staffCallWaitingText = computed(() => {
  const n = drawStatus.value?.waitingCandidate?.drawNumber;
  return n != null && n !== '' ? `${n} 号` : '—';
});

const staffActiveDrawNumber = computed(() => {
  const d = drawStatus.value;
  if (d && d.currentDrawNumber != null && d.currentDrawNumber !== '') return Number(d.currentDrawNumber);
  if (staffCurrentDrawNumber.value != null) return Number(staffCurrentDrawNumber.value);
  return null;
});

const canStaffPreviousCandidate = computed(() => {
  const n = staffActiveDrawNumber.value;
  return n != null && !Number.isNaN(n);
});

const staffExamRef = ref(null);
const staffPaperRef = ref(null);
const staffPrerecordStatus = ref(null);
const staffPrerecordGateLoading = ref(false);
const staffIsPrerecordFlow = computed(
  () => isStaffOnly.value && staffExamRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode === 'prerecord'
);

function formatPrerecordDateTime(v) {
  if (!v) return '';
  try {
    const d = typeof v === 'string' ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return String(v);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(v);
  }
}

async function loadStaffPrerecordStatus() {
  if (!examId.value || !staffIsPrerecordFlow.value) return;
  try {
    const res = await getInterviewPrerecordStatus(examId.value);
    staffPrerecordStatus.value = res?.data ?? null;
  } catch (_) {
    staffPrerecordStatus.value = null;
  }
}

async function onStaffOpenPrerecordGate() {
  if (!examId.value) return;
  staffPrerecordGateLoading.value = true;
  try {
    await openInterviewPrerecordGate(examId.value);
    ElMessage.success('已开始答题，考生端将显示试题并开始倒计时');
    await loadStaffPrerecordStatus();
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '操作失败');
  } finally {
    staffPrerecordGateLoading.value = false;
  }
}

async function onStaffConfirmPrerecordGate() {
  if (!examId.value) return;
  staffPrerecordGateLoading.value = true;
  try {
    await confirmInterviewPrerecordGate(examId.value);
    ElMessage.success('已确认并开放答题');
    await loadStaffPrerecordStatus();
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '操作失败');
  } finally {
    staffPrerecordGateLoading.value = false;
  }
}
const staffDurationMinutes = computed(() => {
  const ic = staffExamRef.value?.answer_system_config?.interviewConfig || {};
  const m = ic.interviewDurationMinutes;
  return m != null && Number(m) >= 1 ? Number(m) : 10;
});
const staffReminderMins = computed(() => {
  const p = staffPaperRef.value?.project_info;
  const m = p?.reminderMinute;
  return m != null && Number(m) >= 1 ? Number(m) : 1;
});
const staffOngoingSession = computed(() =>
  staffSummaryList.value.find((s) => s.status === 'ongoing') || null
);
const staffSelectedPendingSession = computed(() => {
  const cur = staffActiveDrawNumber.value;
  if (cur == null) return null;
  return staffSummaryList.value.find((s) => s.drawNumber === cur && s.status === 'pending') || null;
});
const staffCurrentSession = computed(() => {
  const cur = staffActiveDrawNumber.value;
  if (cur == null) return null;
  return staffSummaryList.value.find((s) => s.drawNumber === cur) || null;
});

/** 按签号排序的汇总行（用于提前录制下判断能否「下一位」） */
const staffSummarySortedByDraw = computed(() =>
  [...staffSummaryList.value]
    .filter((s) => s.drawNumber != null && !Number.isNaN(Number(s.drawNumber)))
    .sort((a, b) => Number(a.drawNumber) - Number(b.drawNumber))
);

const canStaffNextCandidate = computed(() => {
  const sorted = staffSummarySortedByDraw.value;
  const cur = staffActiveDrawNumber.value;

  if (staffIsPrerecordFlow.value) {
    if (!sorted.length) return false;
    if (cur != null && !Number.isNaN(Number(cur))) {
      const idx = sorted.findIndex((s) => Number(s.drawNumber) === Number(cur));
      if (idx >= 0 && idx + 1 >= sorted.length) return false;
    }
  }

  // 叫号指针为空：仅提前录制允许首次点「下一位」落到第一位签号，进入录像评分流程
  if (cur == null || Number.isNaN(Number(cur))) {
    return staffIsPrerecordFlow.value && sorted.length > 0;
  }

  const s = staffCurrentSession.value;
  return !!(s && s.status === 'submitted');
});
const staffCountdownSeconds = ref(null);
const staffCountdownVisible = computed(
  () => isStaffOnly.value && staffOngoingSession.value && staffOngoingSession.value.startedAt && staffDurationMinutes.value > 0
);
const staffReminderShown = computed(() => {
  if (!staffCountdownVisible.value || staffCountdownSeconds.value == null) return false;
  return staffCountdownSeconds.value <= staffReminderMins.value * 60 && staffCountdownSeconds.value > 0;
});
const staffCountdownText = computed(() => {
  const sec = staffCountdownSeconds.value;
  if (sec == null || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} 分 ${s} 秒`;
});

let staffCountdownTimer = null;
let staffPollTimer = null;
function updateStaffCountdown() {
  const s = staffOngoingSession.value;
  if (!s?.startedAt || !staffDurationMinutes.value) {
    staffCountdownSeconds.value = null;
    return;
  }
  const start = new Date(s.startedAt).getTime();
  const end = start + staffDurationMinutes.value * 60 * 1000;
  const remain = Math.max(0, Math.floor((end - Date.now()) / 1000));
  staffCountdownSeconds.value = remain;
}

async function loadStaffSummary() {
  if (!examId.value) return;
  staffLoading.value = true;
  try {
    const res = await getInterviewStaffSummary(examId.value);
    const data = Array.isArray(res?.data) ? res.data : (res?.data ? [] : []);
    staffSummaryList.value = data;
    if (res?.currentUserIsSupervisor != null) currentUserIsSupervisor.value = res.currentUserIsSupervisor;
    if (Array.isArray(res?.examinerOrder)) staffExaminerOrder.value = res.examinerOrder;
    if (res?.requiresStaffAdvanceAck != null) requiresStaffAdvanceAck.value = !!res.requiresStaffAdvanceAck;
    if (res?.advanceSupervisorPinConfigured != null) advanceSupervisorPinConfigured.value = !!res.advanceSupervisorPinConfigured;
    staffCurrentDrawNumber.value = res?.currentDrawNumber != null ? res.currentDrawNumber : null;
    if (isStaffOnly.value && !staffExamRef.value) {
      const examRes = await getExam(examId.value).catch(() => null);
      const exam = examRes?.data ?? examRes ?? null;
      staffExamRef.value = exam;
      examRef.value = exam;
      const pid = exam?.paper_id ?? exam?.paperId;
      if (pid) {
        const paperRes = await getPaper(pid).catch(() => null);
        staffPaperRef.value = paperRes?.data ?? paperRes ?? null;
      } else {
        staffPaperRef.value = null;
      }
    }
    updateStaffCountdown();
    await loadDrawStatus();
    if (staffIsPrerecordFlow.value) await loadStaffPrerecordStatus();
  } catch (e) {
    staffSummaryList.value = [];
    ElMessage.error(e?.message || e?.response?.data?.message || '加载失败');
  } finally {
    staffLoading.value = false;
  }
}

function openStaffPrintDialog() {
  staffPrintVisible.value = true;
}

async function loadDrawStatus() {
  if (!examId.value) return;
  try {
    const res = await getCurrentDrawStatus(examId.value);
    drawStatus.value = res?.data ?? res ?? null;
  } catch (_) {
    drawStatus.value = null;
  }
}

async function confirmStaffAdvanceAction() {
  if (!requiresStaffAdvanceAck.value) return {};
  if (advanceSupervisorPinConfigured.value) {
    const { value } = await ElMessageBox.prompt(
      '请向监督员索取口令后填写，以确认切换叫号。',
      '监督员确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPattern: /\S+/,
        inputErrorMessage: '请输入口令'
      }
    );
    return { supervisorPin: String(value || '').trim() };
  }
  await ElMessageBox.confirm(
    '请确认监督员已在现场并同意切换上一位/下一位叫号。',
    '监督员确认',
    { type: 'warning', confirmButtonText: '监督员已确认', cancelButtonText: '取消' }
  );
  return { supervisorAcknowledged: true };
}

async function onStaffAllowStart() {
  const session = staffSelectedPendingSession.value;
  if (!session?.sessionId || !examId.value) return;
  try {
    await allowStartInterview(examId.value, session.sessionId);
    ElMessage.success('已开始答题');
    await loadStaffSummary();
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '操作失败');
  }
}

async function onStaffNextCandidate() {
  if (!examId.value) return;
  let body = {};
  try {
    body = await confirmStaffAdvanceAction();
  } catch {
    return;
  }
  staffNextLoading.value = true;
  try {
    await nextCandidate(examId.value, body);
    ElMessage.success('已切换到下一位考生');
    await loadStaffSummary();
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message;
    if (e?.response?.status === 400) {
      ElMessage.warning(msg || '请等待所有考官保存评分后再点击下一位');
    } else {
      ElMessage.error(msg || '操作失败');
    }
  } finally {
    staffNextLoading.value = false;
  }
}

async function onStaffPreviousCandidate() {
  if (!examId.value) return;
  let body = {};
  try {
    body = await confirmStaffAdvanceAction();
  } catch {
    return;
  }
  staffPrevLoading.value = true;
  try {
    await previousCandidate(examId.value, body);
    ElMessage.success('已回退叫号');
    await loadStaffSummary();
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message;
    if (e?.response?.status === 400) {
      ElMessage.warning(msg || '当前无法回退叫号');
    } else {
      ElMessage.error(msg || '操作失败');
    }
  } finally {
    staffPrevLoading.value = false;
  }
}

function openCandidateSignSheetDialog() {
  candidateSignSheetVisible.value = true;
}

function doPrintCandidateSignSheet() {
  if (!candidateSignSheetArea.value) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>考生签字确认表（一式两联）</title>
    <style>
      .sign-sheet-page { page-break-after: always; }
      .sign-sheet-twins { display: flex; gap: 24px; margin-bottom: 20px; }
      .sign-sheet-copy { flex: 1; border: 1px solid #333; padding: 16px; font-size: 14px; }
      .sign-sheet-title { font-weight: bold; margin-bottom: 12px; }
      .sign-sheet-score { margin: 12px 0; }
    </style></head><body>
    ${candidateSignSheetArea.value.innerHTML}
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

async function loadStaffGradingTable() {
  if (!examId.value) return;
  gradingTableLoading.value = true;
  try {
    const res = await getInterviewGradingTable(examId.value);
    const data = res?.data || res || {};
    staffGradingTable.value = {
      examName: data.examName || examTitle.value,
      rows: data.rows || [],
      supervisorSignature: data.supervisorSignature || ''
    };
  } catch (e) {
    staffGradingTable.value = { examName: examTitle.value, rows: [], supervisorSignature: '' };
  } finally {
    gradingTableLoading.value = false;
  }
}

function doStaffPrint() {
  if (!staffPrintArea.value) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>面试成绩汇总表</title>
    <style>
      @media print { @page { size: A4 landscape; margin: 12mm; } }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #333; padding: 6px 10px; text-align: center; font-size: 13px; }
      th { background: #f0f0f0; }
      h2 { text-align: center; margin-bottom: 16px; }
      .print-supervisor-sign { margin-top: 24px; font-size: 14px; }
      .print-supervisor-sign img { max-height: 40px; vertical-align: middle; }
      @media print {
        .print-supervisor-sign { position: fixed; bottom: 15mm; left: 12mm; right: 12mm; padding-top: 8px; border-top: 1px solid #333; }
      }
    </style></head><body>
    ${staffPrintArea.value.innerHTML}
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

function exportStaffGradingTableToExcel() {
  if (!staffGradingTable.value.rows || !staffGradingTable.value.rows.length) {
    ElMessage.warning('暂无可导出的数据，请先刷新或打开打印对话框加载数据');
    return;
  }
  const rows = staffGradingTable.value.rows;
  const first = rows[0];
  const header = ['签号'];
  const graderHeaders = (first.graderTotals || []).map((g) => `${g.name || '考官'}得分`);
  header.push(...graderHeaders, '去掉最高分', '去掉最低分', '考生成绩');
  const data = rows.map((r) => {
    const base = [r.drawNumber];
    const graderVals = (r.graderTotals || []).map((g) => g.total != null ? g.total : '');
    const droppedH = r.droppedHighest != null ? Number(r.droppedHighest).toFixed(2) : '';
    const droppedL = r.droppedLowest != null ? Number(r.droppedLowest).toFixed(2) : '';
    const final = r.finalScore != null ? Number(r.finalScore).toFixed(2) : '';
    return [...base, ...graderVals, droppedH, droppedL, final];
  });
  const worksheetData = [header, ...data];
  const ws = XLSX.utils.aoa_to_sheet(worksheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '面试成绩汇总表');
  XLSX.writeFile(wb, `${staffGradingTable.value.examName || '面试考试'}-面试成绩汇总表.xlsx`);
}

function getQuestionAnswer(q) {
  if (q.subItemCount > 1 && q.subAnswerItems && q.subAnswerItems.length > 0) {
    const parts = (q.subAnswerItems || []).map((s, i) => {
      const subNum = s.sub_number || `(${i + 1})`;
      const ans = s.answer_html || s.answer || '';
      return ans ? `${subNum}：${ans}` : '';
    }).filter(Boolean);
    return parts.length ? parts.join('<br/>') : (q.answer_html || q.answer || q.standard_answer || '');
  }
  return q.answer_html || q.answer || q.standard_answer || '';
}

function getQuestionExplanation(q) {
  if (q.subItemCount > 1 && q.sub_explanations) {
    try {
      const arr = typeof q.sub_explanations === 'string' ? JSON.parse(q.sub_explanations) : q.sub_explanations;
      if (Array.isArray(arr) && arr.length > 0) {
        const parts = arr.map((s, i) => {
          const subNum = s.sub_number || `(${i + 1})`;
          const exp = s.explanation_html || s.explanation || '';
          return exp ? `${subNum}：${exp}` : '';
        }).filter(Boolean);
        return parts.length ? parts.join('<br/>') : (q.explanation_html || q.explanation || q.answer_analysis || '');
      }
    } catch (e) {}
  }
  return q.explanation_html || q.explanation || q.answer_analysis || '';
}

const scoreMap = reactive({});
const commentMap = reactive({});

const currentSession = computed(() =>
  sessions.value.find((s) => s.id === selectedSessionId.value) || null
);

/** 无试题时只显示评分表并全屏 */
const hasNoQuestions = computed(() =>
  !showQuestionsExaminer.value || !paperQuestions.value.length
);

const examRef = ref(null);
const sequentialEntry = computed(() => {
  const ic = examRef.value?.answer_system_config?.interviewConfig;
  if (!ic) return false;
  return ic.sequentialEntry === true || ic.interviewFlowMode === 'online';
});

/** 考官端展示：企业/总管理在「面试设置」里配置的流程模式 */
const interviewFlowModeLabel = computed(() => {
  const mode = examRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode;
  if (mode === 'prerecord') return '提前录制';
  if (mode === 'online') return '线上顺序';
  if (mode === 'legacy') return '传统同步';
  return '';
});

/** 顺序/线上叫号时「当前答题签号」以服务端叫号为准，避免与选中项混淆 */
const displayCurrentDrawNumberForTip = computed(() => {
  if (sequentialEntry.value && drawStatus.value?.currentDrawNumber != null && drawStatus.value.currentDrawNumber !== '') {
    return drawStatus.value.currentDrawNumber;
  }
  const s = currentSession.value;
  return s?.draw_number != null && s.draw_number !== '' ? s.draw_number : null;
});

const drawNumberDuplicateSet = computed(() => {
  const m = new Map();
  for (const s of sessions.value) {
    const d = s.draw_number;
    if (d == null || d === '') continue;
    const k = Number(d);
    if (Number.isNaN(k)) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const dup = new Set();
  for (const [k, c] of m) {
    if (c > 1) dup.add(k);
  }
  return dup;
});
const canStartAnswer = computed(() => {
  const s = currentSession.value;
  if (!s || s.status !== 'pending') return false;
  if (!sequentialEntry.value) return true;
  return !!s.room_entered_at;
});

const isPrerecordExamMode = computed(
  () => examRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode === 'prerecord'
);
const prerecordVideoList = ref([]);
const prerecordVideoLoading = ref(false);

/** 提前录制且已交卷但无录像行：禁止保存评分，避免无依据打分 */
const prerecordSubmittedNoVideo = computed(
  () =>
    isPrerecordExamMode.value &&
    currentSession.value?.status === 'submitted' &&
    (prerecordVideoList.value?.length ?? 0) === 0
);

function prerecordVideoUrl(filePath) {
  if (!filePath) return '';
  const p = String(filePath).replace(/^\/+/, '').replace(/\\/g, '/');
  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
  const base =
    envBase || (typeof window !== 'undefined' ? window.location.origin : '');
  return base ? `${base}/${p}` : `/${p}`;
}

function normalizePrerecordVideoList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.data)) return res.data.data;
  return [];
}

async function loadPrerecordVideosForSession(sessionId) {
  prerecordVideoList.value = [];
  if (!sessionId || !examId.value || !isPrerecordExamMode.value) return;
  prerecordVideoLoading.value = true;
  try {
    const res = await getInterviewPrerecordVideos(examId.value, sessionId);
    prerecordVideoList.value = normalizePrerecordVideoList(res);
  } catch (_) {
    prerecordVideoList.value = [];
  } finally {
    prerecordVideoLoading.value = false;
  }
}

watch(selectedSessionId, (id) => {
  loadPrerecordVideosForSession(id);
});

const candidateVideoRef = ref(null);
const showRubricDialog = ref(false);
const rubricDialogBodyRef = ref(null);
const examinerSignature = ref('');
const examinerSignatureImage = ref(''); // 手写签名 data URL
const examinerDate = ref('');
const overallComment = ref('');
const showSignaturePad = ref(false);
const signatureCanvasRef = ref(null);
const signaturePadWrapRef = ref(null);

const hasAnyScore = computed(() =>
  rubricItems.value.some((r) => {
    const v = scoreMap[r.id];
    return v != null && !Number.isNaN(Number(v));
  })
);

const totalScore = computed(() =>
  rubricItems.value.reduce((sum, item) => {
    const v = Number(scoreMap[item.id]);
    if (!Number.isFinite(v)) return sum;
    return sum + v;
  }, 0)
);

function sessionStatusLabel(s) {
  const st = s?.status;
  if (st === 'submitted' || st === 'force_submitted') return '已交卷';
  if (st === 'ongoing') return '考试中';
  if (st === 'pending') return '候考';
  if (st === 'abnormal') return '异常';
  return st || '—';
}

function sessionLabel(s) {
  if (s.draw_number != null && s.draw_number !== '') {
    const dn = Number(s.draw_number);
    const base = `${s.draw_number} 号考生`;
    /** 同签号多条会话时仅用会话 id 区分，不展示姓名（多为不同账号重复抽签号，非「同人多条会话」） */
    if (!Number.isNaN(dn) && drawNumberDuplicateSet.value.has(dn) && s.id != null) {
      return `${base}（#${s.id}）`;
    }
    return base;
  }
  return `未分配签号（内部会话#${s.id}）`;
}

function selectSession(id) {
  if (selectedSessionId.value === id) return;
  selectedSessionId.value = id;
  loadSessionData();
}

function speak(text) {
  if (!text || typeof window.speechSynthesis === 'undefined') return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = 'zh-CN';
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

async function onAllowStart() {
  if (!currentSession.value?.id || !canStartAnswer.value) return;
  try {
    let plain = '请考生注意，即将开始答题';
    if (guidingWordsHtml.value) {
      const div = document.createElement('div');
      div.innerHTML = guidingWordsHtml.value;
      plain = (div.textContent || div.innerText || '').trim() || plain;
    }
    speak(plain);
    await allowStartInterview(examId.value, currentSession.value.id);
    ElMessage.success('已允许该考生开始答题');
    speak('请开始答题');
    const idx = sessions.value.findIndex((s) => s.id === currentSession.value.id);
    if (idx >= 0) sessions.value[idx] = { ...sessions.value[idx], status: 'ongoing', started_at: new Date().toISOString() };
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  }
}

async function onNextCandidate() {
  try {
    const res = await nextCandidate(examId.value);
    const data = res?.data?.data ?? res?.data;
    const msg = data?.message || res?.data?.message || '请下一位考生进入考试';
    if (msg) speak(msg);
    ElMessage.success(msg);
    showRubricDialog.value = false;
    await loadBaseData();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '操作失败');
  }
}

function formatDuration(sec) {
  const n = Number(sec) || 0;
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (!m && !s) return '0 秒';
  if (!m) return `${s} 秒`;
  return `${m} 分 ${s} 秒`;
}

function onScoreChange(rubricId, v) {
  if (v == null || Number.isNaN(Number(v))) {
    scoreMap[rubricId] = null;
  } else {
    scoreMap[rubricId] = Number(v);
  }
}

/** 标准测评要素对应的评分要点（与图片一致），按名称匹配后自动生成 */
const STANDARD_SCORING_POINTS = {
  综合分析能力: '*是否有逻辑、有体系地论述相关问题，判断分析问题是否全面、准确、深刻，阐述角度全面，有理有据。\n*是否思维敏捷，论述时有条理、有深度、有广度，且相对严密客观。',
  岗位专业技能和逻辑思维能力: '*是否具备胜任岗位工作的专业技能、能否清晰阐述工作中面临挑战的应对策略、对工作心态是否积极。\n*阐述问题过程中是否思路清晰、条理清楚、主次分明、逻辑性强，能有效解决实际工作中遇到的问题。',
  分析解决问题和应急应变能力: '*分析问题时是否能抓住问题重点、有顺序、有主次的解决问题。能否对事物的变化反应敏捷，有较强的应急能力。\n*是否具备出色的灵活应变能力，面对突发情况或紧急任务，能够冷静分析、迅速制定方案，确保工作顺利进行。',
  语言表达能力和仪容仪表举止: '*是否普通话标准，语言表达准确简洁，清晰流畅；语言表达层次清楚有条理、富有说服力，和感染力。\n*是否穿着打扮得体，仪表端正自信，有亲和力和影响力；言行举止符合礼仪，肢体动作自然得当，无多余动作。'
};

/** 常用简称或别名 -> 对应上方的标准键，用于自动生成评分要点 */
const SCORING_POINTS_ALIASES = {
  专业水平: '岗位专业技能和逻辑思维能力',
  专业技能: '岗位专业技能和逻辑思维能力',
  岗位专业: '岗位专业技能和逻辑思维能力',
  逻辑思维: '岗位专业技能和逻辑思维能力',
  语言表达: '语言表达能力和仪容仪表举止',
  语言表达能力: '语言表达能力和仪容仪表举止',
  仪容仪表: '语言表达能力和仪容仪表举止',
  综合分析: '综合分析能力',
  应急应变: '分析解决问题和应急应变能力',
  分析解决问题: '分析解决问题和应急应变能力'
};

function getScoringPoints(row) {
  const desc = (row.item_description || '').trim();
  if (desc) return desc;
  const name = (row.item_name || '').trim();
  if (!name) return '—';
  if (STANDARD_SCORING_POINTS[name]) return STANDARD_SCORING_POINTS[name];
  for (const key of Object.keys(STANDARD_SCORING_POINTS)) {
    if (name.includes(key)) return STANDARD_SCORING_POINTS[key];
  }
  const aliasKey = SCORING_POINTS_ALIASES[name];
  if (aliasKey && STANDARD_SCORING_POINTS[aliasKey]) return STANDARD_SCORING_POINTS[aliasKey];
  for (const [alias, standardKey] of Object.entries(SCORING_POINTS_ALIASES)) {
    if (name.includes(alias)) return STANDARD_SCORING_POINTS[standardKey];
  }
  return '—';
}

/** 按要素满分生成评分等级区间（好/中/差），与图中一致 */
function getRatingLevels(maxScore) {
  const m = Number(maxScore) || 0;
  const goodMin = Math.ceil(m * 0.8);
  const mediumMin = Math.ceil(m * 0.5);
  return {
    good: `${goodMin}-${m}`,
    medium: `${mediumMin}-${goodMin - 1}`,
    poor: `0-${mediumMin - 1}`
  };
}

function setScoreByLevel(row, level) {
  const m = Number(row.max_score) || 0;
  if (level === 'good') scoreMap[row.id] = m;
  else if (level === 'medium') scoreMap[row.id] = Math.ceil(m * 0.65);
  else if (level === 'poor') scoreMap[row.id] = Math.max(0, Math.ceil(m * 0.25));
}

function applyDirectTotalScore() {
  const total = Number(directTotalScore.value);
  if (!Number.isFinite(total) || total < 0 || !rubricItems.value.length) {
    ElMessage.warning('请输入有效的总分');
    return;
  }
  const sumMax = rubricItems.value.reduce((s, r) => s + (Number(r.max_score) || 0), 0);
  if (sumMax <= 0) return;
  const assigned = rubricItems.value.map((item) => {
    const max = Number(item.max_score) || 0;
    return Math.round((total * max) / sumMax);
  });
  const diff = total - assigned.reduce((a, b) => a + b, 0);
  if (diff !== 0 && assigned.length > 0) {
    assigned[assigned.length - 1] += diff;
  }
  rubricItems.value.forEach((item, i) => {
    scoreMap[item.id] = assigned[i];
  });
  ElMessage.success('已按比例填入各要素得分');
}

async function loadBaseData() {
  loading.value = true;
  try {
    if (isStaffOnly.value) {
      await loadStaffSummary();
      await loadSupervisorSignature();
      if (staffExamRef.value?.name) examTitle.value = staffExamRef.value.name;
      else if (examRef.value?.name) examTitle.value = examRef.value.name;
      loading.value = false;
      if (!staffCountdownTimer) {
        staffCountdownTimer = setInterval(() => { updateStaffCountdown(); }, 1000);
      }
      if (!staffPollTimer) {
        staffPollTimer = setInterval(() => {
          if (!isStaffOnly.value || !examId.value) return;
          getInterviewStaffSummary(examId.value).then((res) => {
            const data = Array.isArray(res?.data) ? res.data : [];
            staffSummaryList.value = data;
            if (res?.currentUserIsSupervisor != null) currentUserIsSupervisor.value = res.currentUserIsSupervisor;
            if (res?.requiresStaffAdvanceAck != null) requiresStaffAdvanceAck.value = !!res.requiresStaffAdvanceAck;
            if (res?.advanceSupervisorPinConfigured != null) advanceSupervisorPinConfigured.value = !!res.advanceSupervisorPinConfigured;
            staffCurrentDrawNumber.value = res?.currentDrawNumber != null ? res.currentDrawNumber : null;
            updateStaffCountdown();
          }).catch(() => {});
          loadDrawStatus().catch(() => {});
          if (staffExamRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode === 'prerecord') {
            loadStaffPrerecordStatus().catch(() => {});
          }
        }, 4000);
      }
      return;
    }
    const [sessionsRes, rubricRes, examRes] = await Promise.all([
      getInterviewSessions(examId.value),
      getInterviewRubric(examId.value),
      getExam(examId.value).catch(() => ({ data: null }))
    ]);
    sessions.value = sessionsRes.data || [];
    rubricItems.value = (rubricRes.data || []).map((r, idx) => ({
      ...r,
      item_order: r.item_order != null ? r.item_order : idx + 1,
      max_score: r.max_score != null ? Number(r.max_score) : 0
    }));

    const exam = examRes?.data;
    examRef.value = exam || null;
    if (exam?.answer_system_config?.interviewConfig?.interviewFlowMode === 'prerecord') {
      sessions.value = [...sessions.value].sort((a, b) => {
        const da = a.draw_number != null ? Number(a.draw_number) : 9999;
        const db = b.draw_number != null ? Number(b.draw_number) : 9999;
        return da - db;
      });
    }
    if (exam?.name) examTitle.value = exam.name;
    if (route.query.staffOnly !== '1') {
      try {
        const labelRes = await getMyExaminerLabel(examId.value);
        myExaminerLabel.value = labelRes?.data?.label || '';
      } catch (_) {
        myExaminerLabel.value = '';
      }
    }
    const ic = exam?.answer_system_config?.interviewConfig || {};
    showExaminerInstructions.value = !!ic.showExaminerInstructions;
    showQuestionsExaminer.value = ic.showQuestionsExaminer !== false;
    if ((showExaminerInstructions.value || showQuestionsExaminer.value) && exam?.paper_id) {
      try {
        const paperRes = await getPaper(exam.paper_id);
        const paper = paperRes?.data;
        const pi = paper?.project_info;
        if (pi && pi.examinerInstructions) examinerInstructionsContent.value = pi.examinerInstructions;
        else if (!showExaminerInstructions.value) examinerInstructionsContent.value = '';
        const rawGuiding = pi?.guidingWords || '';
        const rawClosing = pi?.closingWords || '';
        guidingWordsHtml.value = String(rawGuiding).replace(/\n/g, '<br>');
        closingWordsHtml.value = String(rawClosing).replace(/\n/g, '<br>');
        if (showQuestionsExaminer.value && paper?.majorQuestions) {
          paperQuestions.value = paper.majorQuestions.flatMap((mq) => (mq.subQuestions || []).map((sq) => {
            let subItemCount = 1;
            let subAnswerItems = [];
            if (sq.sub_answers) {
              try {
                const subAnswers = typeof sq.sub_answers === 'string' ? JSON.parse(sq.sub_answers) : sq.sub_answers;
                if (Array.isArray(subAnswers) && subAnswers.length > 0) {
                  subAnswerItems = subAnswers;
                  subItemCount = subAnswers.length;
                }
              } catch (e) {}
            }
            return {
              ...sq,
              content_html: sq.content_html || sq.full_content || '',
              subItemCount,
              subAnswerItems
            };
          }));
        } else {
          paperQuestions.value = [];
        }
      } catch (_) {
        examinerInstructionsContent.value = '';
        guidingWordsHtml.value = '';
        closingWordsHtml.value = '';
        paperQuestions.value = [];
      }
    } else {
      examinerInstructionsContent.value = '';
      guidingWordsHtml.value = '';
      closingWordsHtml.value = '';
      paperQuestions.value = [];
    }

    if (!selectedSessionId.value && sessions.value.length) {
      selectedSessionId.value = sessions.value[0].id;
    }

    if (!rubricItems.value.length) {
      ElMessage.warning('当前面试考试尚未配置评分表，请企业端在「面试考试设置」中完成配置。');
    }
    await loadDrawStatus();
  } catch (e) {
    const st = e?.response?.status;
    if (st === 502 || st === 504) {
      ElMessage.error('考官服务暂时不可用(502)，请稍后点击刷新或联系管理员重启后端；考生列表与录像需接口正常后才能加载');
    } else {
      ElMessage.error(e.response?.data?.message || e.message || '加载失败');
    }
  } finally {
    loading.value = false;
  }
}

async function loadSessionData() {
  if (!selectedSessionId.value) return;
  loading.value = true;
  gradesLoaded.value = false;
  try {
    const gradeRes = await getInterviewGrades(examId.value, selectedSessionId.value);
    const existing = gradeRes.data || [];
    rubricItems.value.forEach((item) => {
      const g = existing.find((row) => row.rubric_item_id === item.id);
      if (g) {
        scoreMap[item.id] = g.score != null ? Number(g.score) : null;
        commentMap[item.id] = g.comment || '';
      } else {
        scoreMap[item.id] = null;
        commentMap[item.id] = '';
      }
    });
    gradesLoaded.value = true;
    examinerDate.value = formatRubricDate();
    if (isPrerecordExamMode.value) {
      await loadPrerecordVideosForSession(selectedSessionId.value);
    }
  } catch (e) {
    rubricItems.value.forEach((item) => {
      scoreMap[item.id] = null;
      commentMap[item.id] = '';
    });
    ElMessage.error(e.response?.data?.message || e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function saveGrades() {
  if (!currentSession.value) return;
  if (prerecordSubmittedNoVideo.value) {
    ElMessage.warning('提前录制模式下未找到录像，无法保存评分');
    return;
  }
  saving.value = true;
  try {
    const grades = rubricItems.value
      .map((item) => ({
        rubricItemId: item.id,
        score: scoreMap[item.id],
        comment: commentMap[item.id]
      }))
      .filter((g) => g.score != null && !Number.isNaN(Number(g.score)));

    if (!grades.length) {
      ElMessage.warning('请至少为一个测评要素填写分数');
      saving.value = false;
      return;
    }

    const res = await saveInterviewGrades(examId.value, currentSession.value.id, grades);
    ElMessage.success(res.message || '评分已保存');
    // 更新 sessions 列表中的总分
    const total = res.data?.totalScore;
    if (total != null) {
      const idx = sessions.value.findIndex((s) => s.id === currentSession.value.id);
      if (idx >= 0) {
        sessions.value[idx] = { ...sessions.value[idx], total_score: total };
      }
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function formatRubricDate(d) {
  const date = d ? new Date(d) : new Date();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const day = date.getDate();
  return `${y} 年 ${m} 月 ${day} 日`;
}

function onRubricDialogOpened() {
  examinerDate.value = formatRubricDate();
}

function rubricDialogClosed() {
  examinerSignature.value = '';
  examinerSignatureImage.value = '';
  examinerDate.value = '';
  overallComment.value = '';
}

const sigDrawing = ref(false);
let sigLastX = 0;
let sigLastY = 0;

/** 按容器实际像素设置画布位图尺寸（全屏弹窗首帧 getBoundingClientRect 常为 0，会导致无法书写） */
function resizeSignatureCanvasFromWrap() {
  const canvas = signatureCanvasRef.value;
  const wrap = signaturePadWrapRef.value;
  if (!canvas) return null;
  let w = Math.round(canvas.getBoundingClientRect().width);
  let h = Math.round(canvas.getBoundingClientRect().height);
  if ((w <= 1 || h <= 1) && wrap) {
    w = Math.round(wrap.clientWidth);
    h = Math.round(wrap.clientHeight);
  }
  if (w <= 1) w = Math.max(320, Math.round(window.innerWidth - 48));
  if (h <= 1) h = Math.max(400, Math.round(window.innerHeight - 160));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
  }
  return canvas;
}

function getSignatureCanvas() {
  const canvas = signatureCanvasRef.value;
  if (!canvas) return null;
  resizeSignatureCanvasFromWrap();
  return canvas;
}

function sigPointerXY(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches?.[0] || e.changedTouches?.[0];
  if (t) {
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onSigMouseDown(e) {
  const canvas = getSignatureCanvas();
  if (!canvas) return;
  sigDrawing.value = true;
  const { x, y } = sigPointerXY(e, canvas);
  sigLastX = x;
  sigLastY = y;
}

function onSigMouseMove(e) {
  if (!sigDrawing.value) return;
  const canvas = signatureCanvasRef.value;
  if (!canvas || canvas.width < 2 || canvas.height < 2) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { x, y } = sigPointerXY(e, canvas);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sigLastX, sigLastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  sigLastX = x;
  sigLastY = y;
}

function onSigMouseUp() {
  sigDrawing.value = false;
}

function onSigTouchStart(e) {
  onSigMouseDown(e);
}

function onSigTouchMove(e) {
  onSigMouseMove(e);
}

function onSigTouchEnd() {
  onSigMouseUp();
}

async function onSignaturePadDialogOpened() {
  await nextTick();
  requestAnimationFrame(() => {
    resizeSignatureCanvasFromWrap();
  });
}

function clearSignaturePad() {
  const canvas = getSignatureCanvas();
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

async function confirmSignaturePad() {
  const canvas = getSignatureCanvas();
  if (!canvas) {
    showSignaturePad.value = false;
    isSupervisorSignMode.value = false;
    return;
  }
  const dataUrl = canvas.toDataURL('image/png');
  if (isSupervisorSignMode.value) {
    supervisorSignatureLoading.value = true;
    try {
      await postSupervisorSignature(examId.value, { signatureImage: dataUrl });
      supervisorSignatureImage.value = dataUrl;
      ElMessage.success('监督员签名已保存');
    } catch (e) {
      ElMessage.error(e?.response?.data?.message || e?.message || '保存失败');
    } finally {
      supervisorSignatureLoading.value = false;
    }
    isSupervisorSignMode.value = false;
    showSignaturePad.value = false;
    return;
  }
  examinerSignatureImage.value = dataUrl;
  examinerSignature.value = '已手写签名';
  showSignaturePad.value = false;
  ElMessage.success('签名已保存');
}

async function loadSupervisorSignature() {
  if (!isStaffOnly.value || !examId.value) return;
  supervisorSignatureLoading.value = true;
  try {
    const res = await getSupervisorSignature(examId.value);
    const data = res?.data;
    if (data && data.signatureImage) supervisorSignatureImage.value = data.signatureImage;
  } catch (_) {}
  finally {
    supervisorSignatureLoading.value = false;
  }
}

function openSupervisorSignPad() {
  isSupervisorSignMode.value = true;
  showSignaturePad.value = true;
}

watch(showSignaturePad, (v) => {
  if (v) {
    nextTick(() => {
      requestAnimationFrame(() => {
        resizeSignatureCanvasFromWrap();
      });
    });
  } else {
    isSupervisorSignMode.value = false;
  }
});

/** 导出与页面一致的横向评分表：行数、格式、内容一致（含抽签号、评语、签名说明） */
function exportRubricToExcel() {
  const drawNumber = currentSession.value?.draw_number != null ? `${currentSession.value.draw_number}号` : '—';
  const items = rubricItems.value;
  const rows = [
    ['结构化面试考官评分表'],
    ['考生抽签号：', drawNumber],
    []
  ];
  const labelCol = ['测评要素', '要素分值', '评分要点', '好', '中', '差', '得分'];
  const headerRow = [labelCol[0], ...items.map((i) => i.item_name || '—')];
  rows.push(headerRow);
  rows.push([labelCol[1], ...items.map((i) => i.max_score ?? '—')]);
  rows.push([labelCol[2], ...items.map((i) => getScoringPoints(i).replace(/\n/g, ' ') || '—')]);
  rows.push([labelCol[3], ...items.map((i) => getRatingLevels(i.max_score).good + ' 分')]);
  rows.push([labelCol[4], ...items.map((i) => getRatingLevels(i.max_score).medium + ' 分')]);
  rows.push([labelCol[5], ...items.map((i) => getRatingLevels(i.max_score).poor + ' 分')]);
  rows.push([labelCol[6], ...items.map((i) => (scoreMap[i.id] != null && !Number.isNaN(Number(scoreMap[i.id])) ? Number(scoreMap[i.id]).toFixed(2) : ''))]);
  const commentRow = ['评语', overallComment.value || '—'];
  for (let i = 0; i < items.length - 1; i++) commentRow.push('');
  rows.push(commentRow);
  const totalRow = ['总分', (totalScore.value != null && !Number.isNaN(totalScore.value)) ? Number(totalScore.value).toFixed(2) : totalScore.value];
  if (items.length >= 2) {
    for (let i = 0; i < items.length - 2; i++) totalRow.push('');
    totalRow.push('考官签名：' + (examinerSignatureImage.value ? '已手写签名' : (examinerSignature.value || '')) + ' 年 月 日：' + (examinerDate.value || ''));
  }
  rows.push(totalRow);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colWidths = [{ wch: 12 }, ...items.map(() => ({ wch: 22 }))];
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '评分表');
  const fileName = `结构化面试考官评分表_考生${drawNumber}_${examTitle.value || '面试'}.xlsx`;
  XLSX.writeFile(wb, fileName);
  ElMessage.success('已导出评分表');
}

/** 打印与页面一致：字体14px、padding 8px、边框、行数与页面一致，含标题行、抽签号、评语、手写签名图 */
function printRubric() {
  const drawNumber = currentSession.value?.draw_number != null ? `${currentSession.value.draw_number}号` : '—';
  const title = '结构化面试考官评分表';
  const items = rubricItems.value;
  const esc = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const titleRow = `<tr><td colspan="${items.length + 1}" class="title-cell">${title}</td></tr>`;
  const thead = `<tr><th class="lb">测评要素</th>${items.map((i) => `<th>${esc(i.item_name)}</th>`).join('')}</tr>`;
  const row2 = `<tr><td class="lb">要素分值</td>${items.map((i) => `<td align="center">${i.max_score ?? '—'}</td>`).join('')}</tr>`;
  const row3 = `<tr><td class="lb">评分要点</td>${items.map((i) => `<td class="points">${esc(getScoringPoints(i)).replace(/\n/g, '<br/>')}</td>`).join('')}</tr>`;
  const row4 = `<tr><td class="lb">好</td>${items.map((i) => `<td align="center">${getRatingLevels(i.max_score).good} 分</td>`).join('')}</tr>`;
  const row5 = `<tr><td class="lb">中</td>${items.map((i) => `<td align="center">${getRatingLevels(i.max_score).medium} 分</td>`).join('')}</tr>`;
  const row6 = `<tr><td class="lb">差</td>${items.map((i) => `<td align="center">${getRatingLevels(i.max_score).poor} 分</td>`).join('')}</tr>`;
  const fmtScore = (v) => (v != null && !Number.isNaN(Number(v))) ? Number(v).toFixed(2) : '';
  const row7 = `<tr><td class="lb">得分</td>${items.map((i) => `<td align="center">${fmtScore(scoreMap[i.id])}</td>`).join('')}</tr>`;
  const rowComment = `<tr><td class="lb">评语</td><td colspan="${items.length}" class="comment-cell">${esc(overallComment.value)}</td></tr>`;
  const signImg = examinerSignatureImage.value ? `<img src="${examinerSignatureImage.value}" alt="签名" style="max-height:40px;max-width:120px;vertical-align:middle;" />` : esc(examinerSignature.value);
  const signCell = `<td class="sign-cell">考官签名：${signImg} &nbsp;&nbsp; 年 月 日：${esc(examinerDate.value)}</td>`;
  const totalStr = fmtScore(totalScore.value);
  const row8 = items.length <= 1
    ? `<tr><td class="lb">总分</td><td>${totalStr}</td></tr>`
    : `<tr><td class="lb">总分</td><td>${totalStr}</td><td colspan="${Math.max(0, items.length - 2)}"></td>${signCell}</tr>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:SimSun,serif;padding:16px;font-size:14px;}
.meta{margin-bottom:12px;font-size:14px;}
table{border-collapse:collapse;width:100%;max-width:960px;table-layout:fixed;font-size:14px;border:1px solid #333;}
th,td{border:1px solid #333;padding:8px;font-size:14px;vertical-align:top;}
th,td.lb{background:#f5f7fa;font-weight:600;width:100px;}
.title-cell{text-align:center;font-weight:bold;font-size:16px;padding:10px 8px;background:#fff;}
.points{font-size:13px;line-height:1.6;}
.comment-cell{font-size:14px;}
.sign-cell{text-align:right;font-size:14px;}
</style>
</head><body>
<p class="meta">考生抽签号：<strong>${drawNumber}</strong></p>
<table>
<thead>${titleRow}${thead}</thead>
<tbody>${row2}${row3}${row4}${row5}${row6}${row7}${rowComment}${row8}</tbody>
</table>
</body></html>`;
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}

let examinerSessionsPollTimer = null;

async function refreshSessionsQuiet() {
  if (!examId.value || isStaffOnly.value) return;
  try {
    const sessionsRes = await getInterviewSessions(examId.value);
    let fresh = sessionsRes.data || [];
    if (examRef.value?.answer_system_config?.interviewConfig?.interviewFlowMode === 'prerecord') {
      fresh = [...fresh].sort((a, b) => {
        const da = a.draw_number != null ? Number(a.draw_number) : 9999;
        const db = b.draw_number != null ? Number(b.draw_number) : 9999;
        return da - db;
      });
    }
    const sel = selectedSessionId.value;
    sessions.value = fresh;
    if (sel) {
      const cur = fresh.find((s) => s.id === sel);
      if (cur?.status === 'submitted' && isPrerecordExamMode.value) {
        loadPrerecordVideosForSession(sel);
      }
    }
  } catch (_) {}
}

onMounted(async () => {
  await loadBaseData();
  if (selectedSessionId.value) {
    await loadSessionData();
  }
  if (!isStaffOnly.value && examId.value) {
    examinerSessionsPollTimer = setInterval(() => {
      refreshSessionsQuiet();
    }, 6000);
  }
});

onUnmounted(() => {
  if (staffCountdownTimer) {
    clearInterval(staffCountdownTimer);
    staffCountdownTimer = null;
  }
  if (staffPollTimer) {
    clearInterval(staffPollTimer);
    staffPollTimer = null;
  }
  if (examinerSessionsPollTimer) {
    clearInterval(examinerSessionsPollTimer);
    examinerSessionsPollTimer = null;
  }
});
</script>

<style scoped>
.examiner-allow-start-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #ecf5ff 0%, #f0f9ff 100%);
  border: 1px solid #b3d8ff;
  border-radius: 8px;
}
.examiner-allow-start-hint {
  font-size: 14px;
  color: #606266;
}
.examiner-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  margin-top: 16px;
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.session-list {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #f5f7fa;
}

.session-list-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.interview-flow-mode-tip {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.current-draw-number-tip {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.session-select {
  width: 100%;
}

.session-scroll {
  max-height: 420px;
}

.session-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.2s, border-color 0.2s;
  border: 1px solid transparent;
}

.session-item:hover {
  background: #ecf5ff;
}

.session-item.active {
  background: #ecf5ff;
  border-color: #409eff;
}

.session-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.session-status {
  font-size: 12px;
  color: #909399;
  display: flex;
  justify-content: space-between;
}

.session-score {
  font-weight: 600;
  color: #409eff;
}

.grading-main {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px 20px;
  background: #fff;
}

.stem-panel {
  margin-bottom: 20px;
  padding: 12px 0;
  border-bottom: 1px solid #ebeef5;
}

.stem-panel h3 {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
}

.stem-question-block {
  margin-bottom: 20px;
}

.stem-item {
  margin-bottom: 8px;
  font-size: 14px;
}

.stem-content {
  line-height: 1.6;
}

.stem-ref-block {
  margin-top: 10px;
  padding: 10px 12px;
  background: #f0f9ff;
  border-left: 4px solid #409eff;
  border-radius: 4px;
  font-size: 13px;
}

.stem-ref-row {
  margin-bottom: 10px;
}

.stem-ref-row:last-child {
  margin-bottom: 0;
}

.stem-ref-row .stem-ref-value {
  margin-top: 4px;
  line-height: 1.6;
  color: #303133;
}

.stem-ref-value :deep(img) {
  max-width: 100%;
}

.answer-ref-block {
  margin-top: 8px;
  padding: 8px 0;
  font-size: 13px;
}

.answer-ref-label {
  font-weight: 600;
  color: #606266;
  margin-bottom: 4px;
}

.answer-ref-content {
  line-height: 1.6;
  color: #303133;
}

.answer-ref-content :deep(img) {
  max-width: 100%;
}

.interview-guide-block {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafafa;
}

.interview-guide-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.interview-guide-sub {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.interview-guide-content {
  font-size: 14px;
  line-height: 1.8;
}

.interview-guide-content :deep(img) {
  max-width: 100%;
}

.interview-closing-block {
  margin-bottom: 20px;
}

.stem-content :deep(img) {
  max-width: 100%;
}

.audio-panel {
  margin-bottom: 20px;
}

.audio-panel h3,
.rubric-panel h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
}

.hint {
  font-size: 13px;
  color: #909399;
  margin-bottom: 10px;
}

.audio-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.audio-item {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
  background: #f5f7fa;
}

.audio-label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 4px;
}

.audio-item audio {
  width: 100%;
}

.rubric-entry {
  margin-top: 8px;
}

.rubric-dialog-body {
  max-height: 70vh;
  overflow-y: auto;
}

.rubric-dialog-meta {
  margin-bottom: 12px;
  font-size: 14px;
  color: #606266;
}

.rubric-dialog-sign {
  margin-top: 16px;
  font-size: 14px;
  color: #606266;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.rubric-dialog-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

/* 与图片一致的横向评分表：大小、格式、行数一致 */
.rubric-table-image {
  width: 100%;
  max-width: 960px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 14px;
  margin-top: 12px;
  border: 1px solid #333;
}
.rubric-table-image th,
.rubric-table-image td {
  border: 1px solid #333;
  padding: 8px;
  vertical-align: top;
  font-size: 14px;
}
.rubric-table-image th {
  background: #f5f7fa;
  font-weight: 600;
  color: #303133;
}
.rubric-label-col {
  width: 100px;
  min-width: 100px;
  font-weight: 600;
  color: #303133;
  background: #f5f7fa !important;
}
.rubric-element-col {
  min-width: 140px;
}
.scoring-points-cell {
  font-size: 13px;
  color: #303133;
  line-height: 1.6;
  white-space: pre-line;
}
.scoring-points {
  white-space: pre-line;
}
.score-input-cell {
  vertical-align: middle;
}
.score-input-cell .el-input-number {
  margin-right: 8px;
}
.score-quick-btns {
  margin-top: 4px;
}

.rubric-title-cell {
  text-align: center;
  font-weight: bold;
  font-size: 16px;
  padding: 10px 8px;
  background: #fff;
}

.comment-cell {
  vertical-align: middle;
}

.signature-thumb {
  max-height: 36px;
  max-width: 120px;
  vertical-align: middle;
  margin-left: 8px;
}

/* 手写签名大页 */
.signature-pad-dialog .el-dialog__body {
  padding: 12px;
}
.signature-pad-wrap {
  width: 100%;
  height: calc(100vh - 120px);
  min-height: 400px;
  background: #f5f5f5;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
}
.signature-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
  background: #fff;
  border-radius: 6px;
}

/* 全屏评分表弹窗 */
.rubric-dialog-fullscreen .el-dialog__body {
  padding: 16px 20px;
  overflow-y: auto;
}
.rubric-dialog-fullscreen .rubric-dialog-body {
  max-height: none;
}

/* 无试题时评分表全屏 */
.grading-main-fullscreen-rubric {
  padding: 12px 16px;
  min-height: 80vh;
}
.rubric-fullscreen-wrap {
  max-width: 1200px;
  margin: 0 auto;
}
.rubric-fullscreen-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
}
.rubric-fullscreen-meta {
  margin-bottom: 12px;
  font-size: 14px;
  color: #606266;
}
.rubric-table-fullscreen {
  margin-bottom: 16px;
}

.rubric-summary {
  margin-top: 10px;
  font-size: 14px;
  color: #606266;
}

.scoring-points,
.rating-levels {
  font-size: 12px;
  color: #606266;
}

.direct-total-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 14px;
  color: #606266;
}

.actions {
  margin-top: 12px;
  text-align: right;
}

.examiner-instructions-panel {
  margin-bottom: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
}

.examiner-instructions-panel :deep(.el-collapse-item__header) {
  background: #fef9e7;
  color: #b7950b;
  font-weight: 600;
}

.examiner-instructions-title {
  font-size: 14px;
}

.examiner-instructions-content {
  font-size: 13px;
  line-height: 1.8;
  padding: 4px 0;
}

.examiner-instructions-content :deep(img) {
  max-width: 100%;
}

.candidate-video-panel {
  position: fixed;
  top: 56px;
  right: 16px;
  z-index: 99;
  width: 240px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
  padding: 10px;
  border: 1px solid #e4e7ed;
}
.candidate-video-title { font-size: 13px; font-weight: 600; color: #303133; margin-bottom: 8px; }
.candidate-video-wrap { position: relative; background: #000; border-radius: 6px; aspect-ratio: 4/3; display: flex; align-items: center; justify-content: center; min-height: 120px; }
.candidate-video-el { width: 100%; height: 100%; object-fit: cover; }
.candidate-video-tip { position: absolute; font-size: 12px; color: #909399; margin: 0; }
.staff-summary-only { padding: 0 16px 24px; }
.staff-callboard { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 16px; }
.staff-callboard-block { flex: 1; min-width: 260px; background: #f5f7fa; border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px 14px; }
.staff-callboard-title { margin: 0 0 10px; font-size: 14px; color: #303133; }
.staff-prerecord-gate {
  margin-bottom: 16px;
  padding: 12px 14px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 8px;
}
.staff-prerecord-tip { margin: 0 0 10px; font-size: 13px; color: #606266; line-height: 1.5; }
.staff-prerecord-status p { margin: 6px 0; font-size: 13px; }
.staff-prerecord-label { color: #909399; margin-right: 4px; }
.staff-prerecord-actions { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.text-muted { color: #909399; font-size: 12px; }
.staff-call-line { margin: 6px 0; font-size: 14px; color: #606266; }
.staff-draw-table { background: #fff; }
.tag-current { color: #409eff; font-weight: 600; }
.tag-next { color: #67c23a; font-weight: 600; }
.tag-wait { color: #e6a23c; }
.staff-summary-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.staff-seq-hint { margin: 0; font-size: 13px; color: #606266; line-height: 1.5; max-width: 960px; }
.staff-summary-toolbar-btns { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.staff-countdown-box { margin-bottom: 16px; padding: 12px 16px; background: #ecf5ff; border: 1px solid #b3d8ff; border-radius: 8px; }
.staff-countdown-box .staff-countdown-label { font-weight: 600; margin-right: 8px; }
.staff-countdown-box .staff-countdown-value { font-size: 18px; color: #409eff; }
.staff-countdown-box .staff-reminder-tip { margin-left: 12px; color: #e6a23c; }
.supervisor-sign-section { margin-top: 20px; padding: 12px; background: #f5f7fa; border-radius: 6px; }
.supervisor-sign-section .supervisor-label { font-weight: 600; margin-right: 12px; }
.supervisor-sign-section .signature-thumb { margin-left: 12px; }
.print-dialog :deep(.el-dialog__body) { max-height: 75vh; overflow: auto; }
.print-area { padding: 8px; }
.print-area-a4-landscape .print-table { font-size: 12px; }
.print-supervisor-sign { margin-top: 24px; font-size: 14px; }
.print-supervisor-sign .supervisor-sign-img { max-height: 40px; vertical-align: middle; margin-left: 8px; }
.candidate-sign-sheet-area .sign-sheet-page { margin-bottom: 24px; }
.candidate-sign-sheet-area .sign-sheet-twins { display: flex; gap: 24px; margin-bottom: 16px; }
.candidate-sign-sheet-area .sign-sheet-copy { flex: 1; border: 1px solid #333; padding: 16px; font-size: 14px; }
.candidate-sign-sheet-area .sign-sheet-title { font-weight: bold; margin-bottom: 12px; }
.candidate-sign-sheet-area .sign-sheet-score { margin: 12px 0; }
.print-title { font-size: 18px; margin-bottom: 16px; text-align: center; }
.print-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.print-table th, .print-table td { border: 1px solid #333; padding: 6px 10px; text-align: center; }
.print-table th { background: #f0f0f0; }
.no-data { color: #909399; text-align: center; padding: 24px; }
.prerecord-video-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.prerecord-video-loading,
.prerecord-video-empty {
  font-size: 13px;
  color: #909399;
  padding: 8px 0;
}
.prerecord-video-panel {
  position: fixed;
  top: 200px;
  right: 16px;
  z-index: 98;
  width: 280px;
  max-height: 55vh;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 10px;
  border: 1px solid #e4e7ed;
}
.prerecord-video-grid { display: flex; flex-direction: column; gap: 10px; }
.prerecord-video-cell { display: flex; flex-direction: column; gap: 4px; }
.prerecord-video-label { font-size: 12px; color: #909399; }
</style>

