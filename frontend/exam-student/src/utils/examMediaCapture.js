/**
 * 考试监控/录像：摄像头、屏幕录制与 MediaRecorder 参数（含麦克风）。
 */

export const CAMERA_VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640, max: 1280 },
  height: { ideal: 480, max: 720 },
  frameRate: { ideal: 15, max: 24 }
};

export const CAMERA_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

export const SIDE_CAMERA_VIDEO_CONSTRAINTS = {
  facingMode: 'environment'
};

/** @param {{ audio?: boolean }} [opts] */
export function buildCameraGetUserMediaConstraints(opts = {}) {
  const wantAudio = opts.audio !== false;
  if (wantAudio) {
    return {
      video: { ...CAMERA_VIDEO_CONSTRAINTS },
      audio: { ...CAMERA_AUDIO_CONSTRAINTS }
    };
  }
  return { video: { ...CAMERA_VIDEO_CONSTRAINTS } };
}

/** @param {{ preferCurrentTab?: boolean, audio?: boolean }} [opts] */
export function buildDisplayMediaConstraints(opts = {}) {
  const base = { video: true };
  if (opts.preferCurrentTab) base.preferCurrentTab = true;
  if (opts.audio !== false) base.audio = true;
  return base;
}

export function streamHasAudio(stream) {
  return !!(stream && typeof stream.getAudioTracks === 'function' && stream.getAudioTracks().length > 0);
}

/** 优先 vp8+opus，便于监考分片与交卷录像带声音 */
export function pickRecorderMimeType(stream) {
  if (typeof MediaRecorder === 'undefined') return '';
  const withAudio = streamHasAudio(stream);
  const candidates = withAudio
    ? [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,vorbis',
        'video/webm'
      ]
    : ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/**
 * @param {MediaStream} stream
 * @param {{ videoBitsPerSecond?: number, audioBitsPerSecond?: number }} [overrides]
 */
export function buildMediaRecorderOptions(stream, overrides = {}) {
  const mimeType = pickRecorderMimeType(stream);
  const opts = { ...overrides };
  if (mimeType) opts.mimeType = mimeType;
  opts.videoBitsPerSecond = opts.videoBitsPerSecond ?? 600000;
  if (streamHasAudio(stream)) {
    opts.audioBitsPerSecond = opts.audioBitsPerSecond ?? 64000;
  }
  return opts;
}

/**
 * 打开正面摄像头（先尝试音视频，失败则仅视频）
 * @returns {Promise<{ stream: MediaStream|null, hasAudio: boolean, warning?: string }>}
 */
export async function openCameraStreamWithOptionalAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildCameraGetUserMediaConstraints({ audio: true }));
    return { stream, hasAudio: streamHasAudio(stream) };
  } catch (e) {
    const denyMic =
      e?.name === 'NotAllowedError' ||
      e?.name === 'PermissionDeniedError' ||
      /permission|denied|麦克风|microphone/i.test(e?.message || '');
    if (!denyMic && e?.name !== 'NotFoundError' && !/not found/i.test(e?.message || '')) {
      throw e;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(buildCameraGetUserMediaConstraints({ audio: false }));
      return {
        stream,
        hasAudio: false,
        warning: denyMic ? '未授权麦克风，监控与录像将无声音' : '未检测到麦克风，监控与录像将无声音'
      };
    } catch (e2) {
      if (e2?.name === 'NotFoundError' || /not found/i.test(e2?.message || '')) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        return { stream, hasAudio: false, warning: '未检测到摄像头或麦克风，录像将无声音' };
      }
      throw e2;
    }
  }
}

/**
 * @returns {Promise<{ stream: MediaStream|null, hasAudio: boolean }>}
 */
export async function openSideCameraStreamWithOptionalAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { ...SIDE_CAMERA_VIDEO_CONSTRAINTS },
      audio: { ...CAMERA_AUDIO_CONSTRAINTS }
    });
    return { stream, hasAudio: streamHasAudio(stream) };
  } catch (_) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...SIDE_CAMERA_VIDEO_CONSTRAINTS }
      });
      return { stream, hasAudio: false };
    } catch (e) {
      throw e;
    }
  }
}
