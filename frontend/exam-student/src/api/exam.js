import api from './index';

export function login(data) {
  return api.post('/auth/login', { ...data, examStudentLogin: true });
}

/** 招聘公告考生端顶栏/页脚配置（公开接口，无需登录） */
export function getAnnouncementBranding(announcementId) {
  const id = encodeURIComponent(String(announcementId || '').trim());
  return api.get(`/v1/announcements/${id}/navbar-branding`);
}

export function sendSms(phone) {
  return api.post('/auth/send-sms', { phone });
}

export function loginByPhone(phone, code) {
  return api.post('/auth/login-by-phone', { phone, code, examStudentLogin: true });
}

export function getMe() {
  return api.get('/auth/me');
}

export function getInviteInfo(inviteCode) {
  return api.get(`/exam-sessions/invite/${inviteCode}`);
}

export function getSessionByInvite(inviteCode) {
  return api.get(`/exam-sessions/by-invite/${inviteCode}`);
}

/** 已登录：凭单场公共考场码获取会话与试卷（全员同码，按账号匹配名单） */
export function getSessionByPublicRoom(code) {
  const c = encodeURIComponent(String(code || '').trim());
  return api.get(`/exam-sessions/by-public-room/${c}`);
}

/** 免登录进入考试：凭邀请码获取 session + exam + paper + guestToken，后续 start/submit 携带 guestToken */
export function getEnterByInvite(inviteCode) {
  return api.get(`/exam-sessions/enter-by-invite/${inviteCode}`);
}

export function getMyEnrollments() {
  return api.get('/exam-enrollments/my');
}

/** 我的专业测评邀请（个人中心-专业测评用） */
export function getMyExamInvitations() {
  return api.get('/exam-invitations/mine');
}

export function getMySession(examId) {
  return api.get(`/exam-sessions/my/${examId}`);
}

export function getExam(examId) {
  return api.get(`/exams/${examId}`);
}

export function getPaper(paperId) {
  return api.get(`/exam-papers/${paperId}`);
}

export function startSession(sessionId) {
  return api.post(`/exam-sessions/${sessionId}/start`);
}

/** 顺序入场：检查是否可进入考场 */
export function canEnterRoom(sessionId) {
  return api.get(`/exam-sessions/${sessionId}/can-enter-room`);
}

/** 顺序入场：考生进入考场（进入考试页后调用，供考官端「开始答题」仅在有考生进入后可用） */
export function enterRoomSession(sessionId) {
  return api.post(`/exam-sessions/${sessionId}/enter-room`);
}

/** 提前录制：进入统一候考室 */
export function postInterviewWaitingRoom(sessionId) {
  return api.post(`/exam-sessions/${sessionId}/interview-waiting-room`);
}

/** 提前录制：上报正面录像上传失败（写入 interview_prerecord_video_status） */
export function postPrerecordVideoStatus(sessionId, status) {
  return api.post(`/exam-sessions/${sessionId}/prerecord-video-status`, { status });
}

/** 签到（面试）；若考试开启身份核验可传 faceImage base64 */
export function checkInSession(sessionId, body = {}) {
  return api.post(`/exam-sessions/${sessionId}/check-in`, body);
}

export function submitSession(sessionId, payload = {}) {
  const body = typeof payload === 'boolean'
    ? { force: payload }
    : { force: payload.force === true, objectiveAnswers: payload.objectiveAnswers, subjectiveAnswers: payload.subjectiveAnswers };
  return api.post(`/exam-sessions/${sessionId}/submit`, body);
}

export function saveAnswer(data) {
  return api.post('/exam-answers', data);
}

export function saveAnswersBatch(data) {
  return api.post('/exam-answers/batch', data);
}

export function getMyAnswers(sessionId) {
  return api.get(`/exam-answers/session/${sessionId}`);
}

export function reportMonitorEvent(data) {
  return api.post('/exam-monitor/events', data);
}

export function getSideCameraToken(sessionId) {
  return api.get('/exam-monitor/side-camera-token', { params: { sessionId } });
}

/** 本考生会话最新监控分片（侧摄连接后用于 PC 端替换二维码预览） */
export function getMyLatestMonitorChunks(sessionId) {
  return api.get(`/exam-monitor/chunks/session/${sessionId}/latest`);
}

export function faceVerify(tempToken, faceImageBase64) {
  return api.post('/auth/face-verify', { tempToken, faceImage: faceImageBase64 });
}

/** 面试成绩签字确认（考生本人） */
export function confirmInterviewScore(examId, sessionId) {
  return api.post(`/interview/interview-exams/${examId}/sessions/${sessionId}/confirm-score`);
}

/** 提前录制：上传正面/侧录整段视频（multipart，字段 kind=front|side） */
export function uploadPrerecordVideo(examId, sessionId, formData, onUploadProgress) {
  return api.post(`/interview/interview-exams/${examId}/sessions/${sessionId}/prerecord-videos`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600000,
    onUploadProgress: onUploadProgress
      ? (e) => {
          if (e.total && e.total > 0) {
            onUploadProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
          }
        }
      : undefined
  });
}
