/**
 * 考生现场人脸 vs 已上传身份证人像（1:1）
 *
 * 配置真实比对（阿里云视觉智能开放平台 Facebody — CompareFace）：
 *   ALIYUN_VIAPI_ACCESS_KEY_ID
 *   ALIYUN_VIAPI_ACCESS_KEY_SECRET
 *   可选 ALIYUN_VIAPI_ENDPOINT  默认 https://facebody.cn-shanghai.aliyuncs.com
 *   可选 ALIYUN_VIAPI_REGION_ID  默认 cn-shanghai
 *   可选 ALIYUN_FACE_COMPARE_MIN_CONFIDENCE  相似度阈值 0–100，默认 72（更严；可用 60–65 略放宽）
 *
 * 未配置密钥时（占位 mock）：
 *   - NODE_ENV=production：默认拒绝通过（避免任意照片过关）；须配置阿里云 CompareFace，或临时设 FACE_VERIFY_ALLOW_MOCK=1。
 *   - 非 production：默认仍占位通过（本地开发）；也可设 FACE_VERIFY_STRICT=1 强制必须接云。
 */
'use strict';

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const Core = require('@alicloud/pop-core');

function clean(s) {
  return String(s || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function isStrictNoMock() {
  const v = String(process.env.FACE_VERIFY_STRICT || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** 是否允许未接云时的占位通过（仅应在开发/联调环境开启） */
function allowMockPass() {
  if (isStrictNoMock()) return false;
  const v = String(process.env.FACE_VERIFY_ALLOW_MOCK || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return false;
  return true;
}

function getFaceVerifyMode() {
  const v = clean(process.env.FACE_VERIFY_PROVIDER).toLowerCase();
  const id = clean(process.env.ALIYUN_VIAPI_ACCESS_KEY_ID);
  const sec = clean(process.env.ALIYUN_VIAPI_ACCESS_KEY_SECRET);
  const keysOk = !!(id && sec);
  if (v === 'mock' || v === 'none' || v === 'off') return 'mock';
  if (v === 'aliyun') return keysOk ? 'aliyun' : 'aliyun_unconfigured';
  return keysOk ? 'aliyun' : 'mock';
}

async function fetchUrlToBuffer(u) {
  return new Promise((resolve, reject) => {
    const lib = u.startsWith('https') ? https : http;
    const req = lib.get(u, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function resolveIdCardImageBuffer(idCardRef) {
  const ref = clean(idCardRef);
  if (!ref) return null;
  try {
    if (/^https?:\/\//i.test(ref)) {
      return await fetchUrlToBuffer(ref);
    }
    const abs = path.isAbsolute(ref) ? ref : path.join(__dirname, '..', ref);
    return await fs.readFile(abs);
  } catch (e) {
    console.warn('[faceIdCompare] load id card image failed:', e.message);
    return null;
  }
}

function humanizeCompareFaceError(data) {
  if (!data || typeof data !== 'object') return '人脸比对失败，请稍后重试';
  const code = data.Code || data.code || '';
  const msg = data.Message || data.message || '';
  const s = `${code} ${msg}`;
  if (s.includes('NoFace') || s.includes('not found face') || s.includes('人脸')) {
    return '未在照片中清晰检测到人脸，请调整光线与角度后重试';
  }
  if (s.includes('Image') && (s.includes('Invalid') || s.includes('illegal'))) {
    return '照片格式无效，请重新拍摄';
  }
  if (s.includes('Quota') || s.includes('限流')) {
    return '人脸比对服务繁忙，请稍后重试';
  }
  return '人脸比对失败，请稍后重试';
}

async function compareAliyun(imageDataA, imageDataB) {
  const accessKeyId = clean(process.env.ALIYUN_VIAPI_ACCESS_KEY_ID);
  const accessKeySecret = clean(process.env.ALIYUN_VIAPI_ACCESS_KEY_SECRET);
  const endpoint = clean(process.env.ALIYUN_VIAPI_ENDPOINT) || 'https://facebody.cn-shanghai.aliyuncs.com';
  const regionId = clean(process.env.ALIYUN_VIAPI_REGION_ID) || 'cn-shanghai';
  const minConf = parseFloat(process.env.ALIYUN_FACE_COMPARE_MIN_CONFIDENCE || '72', 10) || 72;

  const client = new Core({
    accessKeyId,
    accessKeySecret,
    endpoint,
    apiVersion: '2019-12-30'
  });
  try {
    const res = await client.request(
      'CompareFace',
      {
        RegionId: regionId,
        ImageDataA: imageDataA,
        ImageDataB: imageDataB
      },
      { method: 'POST' }
    );
    const data = res && (res.Data || res.data);
    const conf = data && (data.Confidence != null ? data.Confidence : data.confidence);
    const score = conf != null ? Number(conf) : NaN;
    if (!Number.isFinite(score)) {
      console.warn('[faceIdCompare] CompareFace unexpected response:', JSON.stringify(res).slice(0, 800));
      return { ok: false, message: '人脸比对服务返回异常，请稍后重试' };
    }
    if (score < minConf) {
      return {
        ok: false,
        message: `人脸与身份证照片相似度过低（${score.toFixed(1)}），请本人出镜并重试`,
        score
      };
    }
    return { ok: true, score, message: 'ok' };
  } catch (e) {
    const data = e && e.data;
    console.warn('[faceIdCompare] CompareFace API error:', data ? JSON.stringify(data) : e.message);
    return { ok: false, message: humanizeCompareFaceError(data) };
  }
}

/**
 * @param {{ idCardImageRef: string, liveFaceImageBase64: string }} opts
 * @returns {Promise<{ ok: boolean, message?: string, score?: number|null, mode?: string }>}
 */
async function compareLiveFaceWithIdCard(opts) {
  const idCardImageRef = opts && opts.idCardImageRef;
  const liveFaceImageBase64 = opts && opts.liveFaceImageBase64;
  const liveB64 = String(liveFaceImageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!liveB64 || liveB64.length < 100) {
    return { ok: false, message: '请正对摄像头完成人脸采集' };
  }
  const idBuf = await resolveIdCardImageBuffer(idCardImageRef);
  if (!idBuf || idBuf.length < 50) {
    return { ok: false, message: '未找到身份证底库照片，请联系管理员上传身份证后再试' };
  }
  const idB64 = idBuf.toString('base64');

  const mode = getFaceVerifyMode();
  if (mode === 'aliyun_unconfigured') {
    return {
      ok: false,
      mode: 'aliyun_unconfigured',
      message:
        '已要求使用阿里云人脸比对，但未配置 ALIYUN_VIAPI_ACCESS_KEY_ID / ALIYUN_VIAPI_ACCESS_KEY_SECRET，请联系管理员'
    };
  }
  if (mode === 'aliyun') {
    const r = await compareAliyun(idB64, liveB64);
    return { ...r, mode: 'aliyun' };
  }

  if (isStrictNoMock()) {
    return {
      ok: false,
      mode: 'mock',
      message:
        '服务端未配置人脸比对服务。请配置环境变量 ALIYUN_VIAPI_ACCESS_KEY_ID 与 ALIYUN_VIAPI_ACCESS_KEY_SECRET（阿里云视觉智能 CompareFace），或关闭 FACE_VERIFY_STRICT。'
    };
  }

  if (!allowMockPass()) {
    return {
      ok: false,
      mode: 'mock_disabled',
      message:
        '当前环境未接入真实人脸比对（阿里云 CompareFace），无法完成核验。请在后端配置 ALIYUN_VIAPI_ACCESS_KEY_ID 与 ALIYUN_VIAPI_ACCESS_KEY_SECRET；若仅为临时联调，可设置 FACE_VERIFY_ALLOW_MOCK=1（勿用于正式考试）。'
    };
  }

  console.warn(
    '[faceIdCompare] 未配置 ALIYUN_VIAPI 密钥：占位通过（仅非 production 或已设 FACE_VERIFY_ALLOW_MOCK）。正式考试请务必配置阿里云 CompareFace。'
  );
  return { ok: true, score: null, message: 'mock', mode: 'mock' };
}

module.exports = {
  compareLiveFaceWithIdCard,
  getFaceVerifyMode,
  resolveIdCardImageBuffer
};
