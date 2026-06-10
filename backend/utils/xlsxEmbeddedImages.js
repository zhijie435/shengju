const JSZip = require('jszip');
const xml2js = require('xml2js');

const parseXml = (xml) =>
  xml2js.parseStringPromise(xml, {
    explicitArray: false,
    trim: true,
    tagNameProcessors: [xml2js.processors.stripPrefix]
  });

async function loadRels(zip, relsPath) {
  const file = zip.file(relsPath);
  if (!file) return {};
  const xml = await file.async('string');
  const parsed = await parseXml(xml);
  const rels = parsed?.Relationships?.Relationship;
  const list = Array.isArray(rels) ? rels : rels ? [rels] : [];
  const map = {};
  for (const r of list) {
    const id = r.$?.Id || r.Id;
    const target = r.$?.Target || r.Target;
    if (id && target) map[id] = target;
  }
  return map;
}

function normalizeMediaPath(target) {
  let t = String(target || '')
    .replace(/^\.\.\//, '')
    .replace(/\\/g, '/');
  if (!t.startsWith('xl/')) t = `xl/${t}`;
  return t;
}

async function loadMediaFromZip(zip, target) {
  const norm = normalizeMediaPath(target);
  const mediaFile = zip.file(norm) || zip.file(norm.replace(/\//g, '\\'));
  if (!mediaFile) return null;
  const data = await mediaFile.async('nodebuffer');
  if (!data || !data.length) return null;
  const extRaw = (norm.split('.').pop() || 'png').toLowerCase();
  const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
  return { data, ext };
}

function collectAnchors(wsDr) {
  if (!wsDr || typeof wsDr !== 'object') return [];
  const out = [];
  for (const tag of ['twoCellAnchor', 'oneCellAnchor']) {
    const v = wsDr[tag];
    if (!v) continue;
    out.push(...(Array.isArray(v) ? v : [v]));
  }
  return out;
}

function anchorRowCol(anchor) {
  const from = anchor?.from;
  if (!from) return null;
  const row = parseInt(from.row != null ? from.row : 0, 10);
  const col = parseInt(from.col != null ? from.col : 0, 10);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

function anchorEmbedId(anchor) {
  const pic = anchor?.pic;
  const blip = pic?.blipFill?.blip || pic?.['xdr:blipFill']?.['a:blip'];
  if (!blip) return null;
  return blip.$?.embed || blip.embed || blip['r:embed'] || null;
}

/** 从 DISPIMG / 单元格文本提取 WPS 图片 ID */
function extractDispimgIdFromText(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const mDisp = t.match(/DISPIMG\s*\(\s*["']([^"']+)["']/i);
  if (mDisp && mDisp[1]) return String(mDisp[1]).trim();
  const mId = t.match(/(ID_[0-9A-F]{8,})/i);
  if (mId) return String(mId[1]).toUpperCase();
  return '';
}

/**
 * WPS「嵌入单元格」：xl/cellimages.xml + DISPIMG
 * @returns {Promise<{ byDispimgId: Map<string, {data:Buffer,ext:string}>, mediaOrdered: Array }>}
 */
async function extractWpsCellImages(zip) {
  const byDispimgId = new Map();
  const mediaOrdered = [];
  if (!zip) return { byDispimgId, mediaOrdered };

  const mediaPaths = Object.keys(zip.files)
    .filter((p) => /^xl\/media\//i.test(p.replace(/\\/g, '/')) && /\.(png|jpe?g|gif|webp|bmp)$/i.test(p))
    .sort();
  for (const p of mediaPaths) {
    const img = await loadMediaFromZip(zip, p);
    if (img) mediaOrdered.push(img);
  }

  const cellImagesFile =
    zip.file('xl/cellimages.xml') || zip.file('xl\\cellimages.xml');
  if (!cellImagesFile) return { byDispimgId, mediaOrdered };

  let relMap = {};
  try {
    relMap = await loadRels(zip, 'xl/_rels/cellimages.xml.rels');
  } catch {
    relMap = {};
  }

  let xml = '';
  try {
    xml = await cellImagesFile.async('string');
  } catch {
    return { byDispimgId, mediaOrdered };
  }

  // 结构化解析
  try {
    const parsed = await parseXml(xml);
    const root = parsed?.cellImages || parsed?.etc?.cellImages || parsed;
    const items = root?.cellImage;
    const list = Array.isArray(items) ? items : items ? [items] : [];
    for (const item of list) {
      const pic = item?.pic || item?.['xdr:pic'];
      const picNode = Array.isArray(pic) ? pic[0] : pic;
      if (!picNode) continue;
      const nv = picNode.nvPicPr?.cNvPr || picNode['xdr:nvPicPr']?.['xdr:cNvPr'];
      const nvNode = Array.isArray(nv) ? nv[0] : nv;
      const imageId = (nvNode?.$?.name || nvNode?.name || '').trim();
      const blip = picNode.blipFill?.blip || picNode['xdr:blipFill']?.['a:blip'];
      const blipNode = Array.isArray(blip) ? blip[0] : blip;
      const embed = blipNode?.$?.embed || blipNode?.embed || blipNode?.['r:embed'];
      if (!embed || !imageId) continue;
      const target = relMap[embed];
      if (!target) continue;
      const img = await loadMediaFromZip(zip, target);
      if (img) byDispimgId.set(imageId, img);
    }
  } catch {
    /* regex fallback below */
  }

  // 正则兜底：name="ID_…" 与 r:embed="rIdN" 就近配对
  if (byDispimgId.size === 0 && xml) {
    const embedRe = /r:embed="([^"]+)"/gi;
    const nameRe = /name="(ID_[^"]+)"/gi;
    const embeds = [];
    const names = [];
    let m;
    while ((m = embedRe.exec(xml))) embeds.push(m[1]);
    while ((m = nameRe.exec(xml))) names.push(m[1]);
    const n = Math.min(embeds.length, names.length);
    for (let i = 0; i < n; i++) {
      const target = relMap[embeds[i]];
      if (!target) continue;
      const img = await loadMediaFromZip(zip, target);
      if (img) byDispimgId.set(names[i], img);
    }
  }

  return { byDispimgId, mediaOrdered };
}

async function extractDrawingAnchors(zip) {
  const byCell = new Map();
  if (!zip) return byCell;
  const drawingPaths = Object.keys(zip.files).filter((p) =>
    /^xl\/drawings\/drawing\d+\.xml$/i.test(p.replace(/\\/g, '/'))
  );
  for (const drawingPath of drawingPaths) {
    const normPath = drawingPath.replace(/\\/g, '/');
    const relsPath = normPath
      .replace('/drawings/', '/drawings/_rels/')
      .replace(/\.xml$/i, '.xml.rels');
    const relMap = await loadRels(zip, relsPath);
    const drawFile = zip.file(drawingPath);
    if (!drawFile) continue;
    const drawXml = await drawFile.async('string');
    let parsed;
    try {
      parsed = await parseXml(drawXml);
    } catch {
      continue;
    }
    const wsDr = parsed?.worksheetDrawing || parsed?.wsDr;
    const anchors = collectAnchors(wsDr);
    for (const anchor of anchors) {
      const pos = anchorRowCol(anchor);
      const embed = anchorEmbedId(anchor);
      if (!pos || !embed) continue;
      const target = relMap[embed];
      if (!target) continue;
      const img = await loadMediaFromZip(zip, target);
      if (!img) continue;
      const key = `${pos.row}:${pos.col}`;
      if (!byCell.has(key)) byCell.set(key, img);
    }
  }
  return byCell;
}

/**
 * 从 xlsx 读取嵌入照片（Microsoft 浮动图 + WPS 单元格图 + media 顺序兜底）
 * @returns {Promise<{ byCell: Map, byDispimgId: Map, mediaOrdered: Array }>}
 */
async function extractRosterImagesFromXlsx(buffer) {
  const byCell = new Map();
  const byDispimgId = new Map();
  let mediaOrdered = [];
  if (!buffer || !buffer.length) {
    return { byCell, byDispimgId, mediaOrdered };
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { byCell, byDispimgId, mediaOrdered };
  }

  const wps = await extractWpsCellImages(zip);
  for (const [k, v] of wps.byDispimgId) byDispimgId.set(k, v);
  mediaOrdered = wps.mediaOrdered;

  const drawn = await extractDrawingAnchors(zip);
  for (const [k, v] of drawn) byCell.set(k, v);

  // 无锚点时按 media 顺序映射到数据行（键 1:0, 2:0 … 与 _sheetRow 对齐）
  if (byCell.size === 0 && mediaOrdered.length) {
    for (let i = 0; i < mediaOrdered.length; i++) {
      byCell.set(`${i + 1}:0`, mediaOrdered[i]);
    }
  }

  return { byCell, byDispimgId, mediaOrdered };
}

/** @deprecated 使用 extractRosterImagesFromXlsx；保留兼容仅返回 byCell */
async function extractEmbeddedImagesFromXlsx(buffer) {
  const { byCell } = await extractRosterImagesFromXlsx(buffer);
  return byCell;
}

module.exports = {
  extractDispimgIdFromText,
  extractEmbeddedImagesFromXlsx,
  extractRosterImagesFromXlsx
};
