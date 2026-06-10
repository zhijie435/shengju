/**
 * sj_exam_imported_candidates 各环境列名不一致时归一化（与 examImports 逻辑一致）。
 */
const { pickLoginUsernameFromRow } = require('./candidateLoginUsername');
/** sj 表列名不一：从行根级 + extra 里抓第一张可用的证件/人像图 URL */
function firstPhotoUrlFromSjRow(r, ex) {
  const candidates = [];
  const push = (v) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s.length > 8 && !s.startsWith('blob:')) candidates.push(s);
  };
  if (r && typeof r === 'object') {
    push(r.id_card_front);
    push(r.idCardFront);
    push(r.id_card_image_path);
    push(r.id_card_image_url);
    push(r.idCardImageUrl);
    push(r.photo_url);
    push(r.photoUrl);
    push(r.photo);
    push(r.face_photo);
    push(r.facePhoto);
    push(r.avatar_url);
    push(r.portrait_url);
    push(r['身份证正面']);
    push(r['人像照']);
  }
  if (ex && typeof ex === 'object') {
    push(ex.id_card_front);
    push(ex.id_card);
    push(ex.photo_url);
    push(ex.photoUrl);
    push(ex.photo);
    push(ex.face_photo);
    push(ex.idCardImageUrl);
    push(ex.id_card_image_url);
  }
  return candidates[0] || '';
}

function parseExtraInfoObject(r) {
  const raw = r && (r.extra_info || r.extraInfo);
  if (raw == null || raw === '') return null;
  try {
    if (typeof raw === 'object') return raw;
    const s = String(raw).trim();
    if (!s || s[0] !== '{') return null;
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

function normalizeSjImportedRow(r) {
  if (!r || typeof r !== 'object') return null;
  const name = (r.real_name || r.name || r.candidate_name || r.candidateName || '').toString().trim();
  if (!name) return null;
  const ex = parseExtraInfoObject(r);
  const cnExam = String(r['准考证号'] || r['考号'] || r['准考证'] || '').trim();
  const cnId = String(r['身份证号'] || r['证件号码'] || '').trim();
  const cnJobCode = String(r['岗位代码'] || r['职位代码'] || '').trim();
  let exam_no = String(
    r.exam_number ??
      r.exam_no ??
      r.examNo ??
      r.admit_card_number ??
      r.admitCardNumber ??
      r.examNumber ??
      r.ticket_no ??
      r.admit_no ??
      ''
  ).trim();
  if (!exam_no && cnExam) exam_no = cnExam;
  let id_number = String(r.id_card || r.id_number || r.idNumber || r.certificate_no || r.idcard || '').trim();
  if (!id_number && cnId) id_number = cnId;
  let mobile = String(
    r.mobile || r.phone || r.candidate_phone || r.candidatePhone || r.telephone || r.contact_phone || ''
  ).trim();
  const email = String(r.email || r.mail || '').trim();
  let position_name = String(
    r.position_name || r.position || r.job_title || r.jobTitle || r.post_name || r.applied_position || ''
  ).trim();
  const edu = String(r.education || r.degree || (ex && ex.education) || '').trim();
  let jc = String(r.job_code || r.position_code || r.jobCode || cnJobCode || (ex && ex.job_code) || (ex && ex.position_code) || '').trim();
  if (ex) {
    if (!exam_no) {
      exam_no = String(
        ex.exam_number ||
          ex.exam_no ||
          ex.examNo ||
          ex.admit_card_number ||
          ex.admitCardNumber ||
          ex.examNumber ||
          ex.ticket_no ||
          ex.ticketNo ||
          ex.admit_no ||
          ex.准考证号 ||
          ex.考号 ||
          ''
      ).trim();
    }
    if (!id_number) {
      id_number = String(
        ex.id_card || ex.id_number || ex.idNumber || ex.certificate_no || ex.certificateNo || ex.身份证号 || ''
      ).trim();
    }
    if (!mobile) {
      mobile = String(ex.mobile || ex.phone || ex.candidate_phone || ex.手机号 || ex.联系电话 || '').replace(/\D/g, '');
    }
    if (!position_name) {
      position_name = String(
        ex.position_name ||
          ex.position ||
          ex.jobTitle ||
          ex.job_title ||
          ex.post_name ||
          ex.applied_position ||
          ex.岗位 ||
          ex.报考岗位 ||
          ''
      ).trim();
    }
    if (!jc) {
      jc = String(ex.job_code || ex.position_code || ex.jobCode || ex.岗位代码 || ex.职位代码 || ex.报考代码 || '').trim();
    }
  }
  const idPhotoUrl = firstPhotoUrlFromSjRow(r, ex);
  const login_username = pickLoginUsernameFromRow(r, ex, exam_no);
  let extra_info = r.extra_info || r.extraInfo || null;
  if ((!extra_info || String(extra_info).trim() === '') && (edu || jc)) {
    extra_info = JSON.stringify({ ...(edu ? { education: edu } : {}), ...(jc ? { job_code: jc } : {}) });
  } else if (extra_info && typeof extra_info === 'string' && (edu || jc)) {
    try {
      const o = JSON.parse(extra_info);
      if (edu) o.education = edu;
      if (jc) o.job_code = jc;
      extra_info = JSON.stringify(o);
    } catch (_) {
      /* 保留原样 */
    }
  }
  return {
    id: r.id,
    exam_no,
    name,
    login_username,
    id_number,
    mobile,
    email,
    position_name,
    job_code: jc,
    extra_info,
    /** 供 mergePoolRowIntoUser / pickIdCardUrlFromPoolExtra 顶层读取（不必只在 extra_info JSON 里） */
    id_card_front: idPhotoUrl || undefined,
    photo_url: idPhotoUrl || undefined
  };
}

module.exports = { normalizeSjImportedRow };
