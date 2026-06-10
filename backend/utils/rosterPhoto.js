/** 懒加载：避免服务器未安装/不兼容 sharp 时 require 即崩溃导致全站 502 */
function getSharp() {
  try {
    return require('sharp');
  } catch (e) {
    return null;
  }
}

/** 原始嵌入图上限（超过则先压缩，仍过大则放弃） */
const MAX_BINARY_BYTES = 2 * 1024 * 1024;
/** 压缩后目标：避免 data: URL 在浏览器中超长导致 <img> 加载失败 */
const TARGET_JPEG_BYTES = 380 * 1024;
/** 超过此大小一律压缩（手机原图常见 1–3MB） */
const COMPRESS_IF_LARGER_THAN = 120 * 1024;

function bufferToDataUrl(buffer, ext) {
  if (!buffer || !buffer.length) return '';
  const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(String(ext || '').toLowerCase())
    ? String(ext).toLowerCase().replace('jpeg', 'jpg')
    : 'jpg';
  const mime =
    safeExt === 'png'
      ? 'image/png'
      : safeExt === 'gif'
        ? 'image/gif'
        : safeExt === 'webp'
          ? 'image/webp'
          : safeExt === 'bmp'
            ? 'image/bmp'
            : 'image/jpeg';
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

/**
 * 将 Excel 嵌入照片缩到准考证尺寸，避免 base64 过大导致前端「照片未加载」。
 */
async function compressRosterPhotoBuffer(buffer, ext) {
  if (!buffer || !buffer.length) return null;
  const sharp = getSharp();
  if (!sharp) return { buffer, ext: ext || 'jpg' };
  try {
    let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
    const meta = await pipeline.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    const maxSide = Math.max(w, h);
    if (maxSide > 640) {
      pipeline = pipeline.resize({
        width: w >= h ? 480 : undefined,
        height: h > w ? 640 : undefined,
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    let out = await pipeline.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    if (out.length > TARGET_JPEG_BYTES) {
      out = await sharp(out).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    }
    if (out.length > TARGET_JPEG_BYTES) {
      out = await sharp(out)
        .resize(360, 480, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
    }
    return { buffer: out, ext: 'jpg' };
  } catch (e) {
    return { buffer, ext: ext || 'jpg' };
  }
}

/**
 * @returns {{ photoDataUrl: string, warning?: string, compressed?: boolean }}
 */
async function prepareRosterEmbeddedPhotoDataUrl(photoBufferMeta, candidateName) {
  const name = String(candidateName || '').trim() || '考生';
  const buf = photoBufferMeta && photoBufferMeta.data;
  if (!buf || !buf.length) {
    return { photoDataUrl: '' };
  }
  const ext = photoBufferMeta.ext || 'jpg';
  let workBuf = buf;
  let workExt = ext;
  let compressed = false;

  if (buf.length > COMPRESS_IF_LARGER_THAN || buf.length > MAX_BINARY_BYTES) {
    const c = await compressRosterPhotoBuffer(buf, ext);
    if (c && c.buffer && c.buffer.length) {
      workBuf = c.buffer;
      workExt = c.ext;
      compressed = true;
    }
  }

  if (workBuf.length > MAX_BINARY_BYTES) {
    return {
      photoDataUrl: '',
      warning: `「${name}」照片超过 2MB 且自动压缩失败，已省略（请将单张压缩到 500KB 以内后重传）`
    };
  }

  const photoDataUrl = bufferToDataUrl(workBuf, workExt);
  const dataUrlMax = 1.45 * 1024 * 1024;
  if (photoDataUrl.length > dataUrlMax) {
    const c2 = await compressRosterPhotoBuffer(workBuf, workExt);
    if (c2 && c2.buffer && c2.buffer.length) {
      const retry = bufferToDataUrl(c2.buffer, c2.ext);
      if (retry.length <= dataUrlMax) {
        return { photoDataUrl: retry, compressed: true };
      }
    }
    return {
      photoDataUrl: '',
      warning: `「${name}」照片过大，浏览器无法显示（已省略；建议单张小于 500KB）`
    };
  }

  return {
    photoDataUrl,
    compressed,
    warning: compressed ? `「${name}」照片已自动压缩以便预览` : undefined
  };
}

/** WPS 公式、本地路径等不能作为 <img src> */
function isLikelyInvalidRosterPhotoCellText(s) {
  const t = String(s ?? '').trim();
  if (!t || t.length < 8) return true;
  if (/^data:image\//i.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^=?\s*DISPIMG/i.test(t)) return true;
  if (/^=?\s*IMAGE\s*\(/i.test(t)) return true;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (/^file:\/\//i.test(t)) return true;
  return !/^https?:\/\//i.test(t) && !/^data:image\//i.test(t);
}

module.exports = {
  MAX_BINARY_BYTES,
  bufferToDataUrl,
  compressRosterPhotoBuffer,
  prepareRosterEmbeddedPhotoDataUrl,
  isLikelyInvalidRosterPhotoCellText
};
