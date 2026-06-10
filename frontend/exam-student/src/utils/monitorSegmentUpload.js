/**
 * 监考端监控：按固定时长切片上传 webm（可含麦克风），企业端以视频展示并可导出存档。
 */
import { buildMediaRecorderOptions, pickRecorderMimeType } from './examMediaCapture';

export const MONITOR_SEGMENT_MS = 6000;

/** @param {MediaStream} [stream] */
export function getMonitorRecorderMimeType(stream) {
  if (stream) return pickRecorderMimeType(stream);
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/**
 * @param {MediaStream} stream
 * @param {'camera'|'screen'|'side_camera'} chunkType
 * @param {{ sessionId: number|string, examId?: number|string, getToken: () => string, onError?: (e: Error) => void }} ctx
 * @returns {{ stop: () => void } | null}
 */
export function startMonitorSegmentRecorder(stream, chunkType, ctx) {
  const mime = getMonitorRecorderMimeType(stream);
  if (!mime || !stream || !ctx?.sessionId) return null;
  const recorderOpts = buildMediaRecorderOptions(stream, { videoBitsPerSecond: 500000, audioBitsPerSecond: 48000 });

  let mr = null;
  let stopped = false;

  const uploadBlob = async (blob) => {
    if (!blob || blob.size < 200 || stopped) return;
    const fd = new FormData();
    const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm';
    fd.append('file', blob, `${chunkType}_${Date.now()}.${ext}`);
    fd.append('sessionId', String(ctx.sessionId));
    fd.append('chunkType', chunkType);
    fd.append('durationSeconds', String(MONITOR_SEGMENT_MS / 1000));
    if (ctx.examId != null && ctx.examId !== '') fd.append('examId', String(ctx.examId));
    const token = ctx.getToken?.();
    try {
      const base = String(import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
      const res = await fetch(`${base}/exam-monitor/upload-chunk`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `上传失败 ${res.status}`);
      }
    } catch (e) {
      ctx.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  try {
    mr = new MediaRecorder(stream, recorderOpts);
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size) uploadBlob(e.data);
    };
    mr.start(MONITOR_SEGMENT_MS);
  } catch (e) {
    ctx.onError?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  }

  return {
    stop() {
      stopped = true;
      if (!mr || mr.state === 'inactive') {
        mr = null;
        return;
      }
      try {
        mr.onstop = () => {
          mr = null;
        };
        mr.stop();
      } catch (_) {
        mr = null;
      }
    }
  };
}

/** 手机侧摄 Token 上传（无 sessionId 表单，走 upload-chunk-mobile） */
export function startMonitorSegmentRecorderMobile(stream, ctx) {
  const mime = getMonitorRecorderMimeType(stream);
  if (!mime || !stream || !ctx?.token) return null;
  const recorderOpts = buildMediaRecorderOptions(stream, { videoBitsPerSecond: 500000, audioBitsPerSecond: 48000 });

  let mr = null;
  let stopped = false;

  const uploadBlob = async (blob) => {
    if (!blob || blob.size < 200 || stopped) return;
    const fd = new FormData();
    const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm';
    fd.append('file', blob, `side_camera_${Date.now()}.${ext}`);
    fd.append('durationSeconds', String(MONITOR_SEGMENT_MS / 1000));
    const base = String(import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/exam-monitor/upload-chunk-mobile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}` },
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `上传失败 ${res.status}`);
      }
    } catch (e) {
      ctx.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  try {
    mr = new MediaRecorder(stream, recorderOpts);
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size) uploadBlob(e.data);
    };
    mr.start(MONITOR_SEGMENT_MS);
  } catch (e) {
    ctx.onError?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  }

  return { stop() {
    stopped = true;
    if (mr && mr.state !== 'inactive') {
      try { mr.stop(); } catch (_) {}
    }
    mr = null;
  } };
}
