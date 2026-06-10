/**
 * 报名表截图导出：供企业端 tests.html、求职者 profile.html 共用。
 * 依赖全局 html2canvas；ZIP 打包由调用方使用 JSZip。
 */
(function (g) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 从 extraJson（与后端 compat 报名表结构一致）生成与 enterprise mapApiCandidateToViewModel 相近的展示对象。
   * base 可传 { name, phone, jobTitle, applyDate, photo } 等兜底字段。
   */
  function viewModelFromExtraJson(extra, base, normalizeUrl) {
    extra = extra && typeof extra === 'object' ? extra : {};
    base = base && typeof base === 'object' ? base : {};
    var norm =
      typeof normalizeUrl === 'function'
        ? normalizeUrl
        : function (u) {
            return u || '';
          };
    var basic = extra.basicInfo || {};
    var eduInfo = extra.educationInfo || {};
    var resumeTimeline = Array.isArray(extra.resumeTimeline) ? extra.resumeTimeline : [];
    var attachments = extra.attachments || {};
    var eduItems = resumeTimeline.filter(function (item) {
      return item.type === 'edu';
    });
    var workItems = resumeTimeline.filter(function (item) {
      return item.type === 'work';
    });
    var eduResume = eduItems.map(function (item) {
      return {
        period: (item.from || item.to) ? (item.from || '') + (item.to ? ' - ' + item.to : '') : '',
        content: item.content || ''
      };
    });
    var workResume = workItems.map(function (item) {
      return {
        period: (item.from || item.to) ? (item.from || '') + (item.to ? ' - ' + item.to : '') : '',
        content: item.content || ''
      };
    });
    var familyMembers = Array.isArray(extra.familyMembers)
      ? extra.familyMembers.map(function (m) {
          return {
            relation: m.relation || '',
            name: m.name || '',
            birthDate: m.birthDate || '',
            politicalStatus: m.politicalStatus || '',
            workUnit: m.workUnit || '',
            position: m.position || ''
          };
        })
      : [];
    var signature = extra.signature || {};
    var sigSrc = signature.imageUrl || signature.image;
    var photoUrl = norm(attachments.photo);
    var idFront = norm(attachments.id_card_front || attachments.id_card);
    var idBack = norm(attachments.id_card_back);
    var eduCerts = [];
    if (Array.isArray(attachments.education_certs)) {
      attachments.education_certs.forEach(function (img) {
        var x = norm(img);
        if (x) eduCerts.push(x);
      });
    }
    if (attachments.education) {
      var e1 = norm(attachments.education);
      if (e1) eduCerts.push(e1);
    }
    if (attachments.certificate) {
      var e2 = norm(attachments.certificate);
      if (e2) eduCerts.push(e2);
    }
    var displayName =
      (basic.name && String(basic.name).trim()) ||
      (base.name != null && String(base.name).trim()) ||
      '未知';
    var eduLines = eduResume
      .map(function (item) {
        return (item.period ? item.period + ' ' : '') + (item.content || '');
      })
      .filter(Boolean);
    var workLines = workResume
      .map(function (item) {
        return (item.period ? item.period + ' ' : '') + (item.content || '');
      })
      .filter(Boolean);
    var resumeNarrativeParts = [];
    if (basic.resumeDetail && String(basic.resumeDetail).trim()) {
      resumeNarrativeParts.push(String(basic.resumeDetail).trim());
    }
    resumeTimeline.forEach(function (t) {
      if (t && t.type === 'resumeDetail' && t.content && String(t.content).trim()) {
        var c0 = String(t.content).trim();
        if (resumeNarrativeParts.indexOf(c0) === -1) resumeNarrativeParts.push(c0);
      }
    });
    eduLines.forEach(function (line) {
      resumeNarrativeParts.push(line);
    });
    workLines.forEach(function (line) {
      resumeNarrativeParts.push(line);
    });
    var resumeNarrative = resumeNarrativeParts.length ? resumeNarrativeParts.join('\n') : '';

    return {
      formTitle: (base && base.formTitle) || '招聘报名表',
      name: displayName,
      gender: basic.gender || base.gender || '',
      birthDate: basic.birthDate || '',
      ethnicity: basic.ethnicity || '',
      birthPlace: basic.birthPlace || '',
      politicalStatus: basic.politicalStatus || '',
      hukou: basic.hukou || '',
      workStartDate: basic.workStartDate || '',
      partyJoinDate: basic.partyJoinDate || '无',
      healthStatus: basic.healthStatus || '',
      landline: basic.landline || '',
      specialties: basic.specialties || '',
      englishLevel: basic.englishLevel || '',
      mailAddress: basic.mailAddress || '',
      meetsJobExperience: basic.meetsJobExperience || '',
      techQualification: basic.techQualification || '',
      vocationalQualification: basic.vocationalQualification || '',
      major: basic.major || '',
      degree: basic.degree || '',
      graduationSchool: basic.graduationSchool || '',
      fillDate: basic.fillDate || base.applyDate || '',
      photo:
        photoUrl ||
        base.photo ||
        'https://ui-avatars.com/api/?name=' +
          encodeURIComponent(displayName) +
          '&background=4F46E5&color=fff&size=200',
      idCardFront: idFront,
      idCardBack: idBack,
      educationCertificates: eduCerts,
      fulltimeEducation: {
        level: eduInfo.fulltimeEducation || base.education || '',
        university: basic.graduationSchool || '',
        major: basic.major || eduInfo.fulltimeMajor || ''
      },
      workUnit: basic.workUnit || '',
      currentPosition: basic.currentPosition || '',
      applyUnit: basic.applyUnit || '',
      appliedJobName: basic.appliedJobName || base.jobTitle || base.jobName || '',
      positionCode: basic.positionCode || '',
      idNumber: basic.idNumber || '',
      phone: basic.phone || base.phone || '',
      email: basic.email || base.email || '',
      eduResume: eduResume,
      workResume: workResume,
      resumeNarrative: resumeNarrative,
      universityAwards: extra.universityAwards != null && String(extra.universityAwards).trim() !== '' ? String(extra.universityAwards) : '',
      awards: extra.awards || '',
      familyMembers: familyMembers,
      signatureImageUrl: sigSrc ? norm(sigSrc) : null,
      signatureDate: signature.signDate || base.applyDate || ''
    };
  }

  /** 单页高度随内容收缩，避免预览/详情里大块空白；导出截图仍按内容分页 */
  var RF_A4_PAGE_STYLE =
    'width:794px;min-height:0;max-width:100%;box-sizing:border-box;padding:12px 16px 14px;margin:0 auto 6px;background:#fff;border:1px solid #bbb;position:relative;';
  var RF_PRINT_STYLE =
    '@page{size:A4;margin:12mm 10mm;}' +
    'html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '.rf-export-root{max-width:none;}' +
    '.rf-a4-page{width:auto !important;max-width:none !important;border:none !important;margin:0 auto;page-break-after:always;break-after:page;}' +
    '.rf-a4-page:last-child{page-break-after:auto;break-after:auto;}' +
    'table{page-break-inside:avoid;break-inside:avoid;}' +
    'tr,td,th{page-break-inside:avoid;break-inside:avoid;}' +
    'img{page-break-inside:avoid;break-inside:avoid;}';

  function openPrintWindow(html) {
    var w = window.open('', '_blank');
    if (!w || !w.document) return null;
    w.document.open();
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"/><title>报名表打印</title>' +
        '<style>' +
        RF_PRINT_STYLE +
        '</style></head><body>' +
        html +
        '</body></html>'
    );
    w.document.close();
    return w;
  }

  /**
   * @param {object} vm viewModel
   * @param {{ layout?: 'continuous' | 'paged' }} opts continuous=一整张纵向长表（无「报名表（续）」分页标题）；paged=原 A4 三页分页
   */
  function buildHtml(vm, opts) {
    opts = opts || {};
    var layout = opts.layout === 'paged' ? 'paged' : 'continuous';
    vm = vm || {};
    var title = vm.formTitle || '招聘报名表';
    var eduLines = (vm.eduResume || [])
      .map(function (item) {
        return (item.period ? item.period + ' ' : '') + (item.content || '');
      })
      .filter(Boolean);
    var workLines = (vm.workResume || [])
      .map(function (item) {
        return (item.period ? item.period + ' ' : '') + (item.content || '');
      })
      .filter(Boolean);
    var eduText = eduLines.length ? eduLines.join('\n') : '—';
    var workText = workLines.length ? workLines.join('\n') : '—';
    var resumeBlock =
      (vm.resumeNarrative && String(vm.resumeNarrative).trim()) ||
      [eduText !== '—' ? '【学习经历】\n' + eduText : '', workText !== '—' ? '【工作经历】\n' + workText : ''].filter(Boolean).join('\n\n') ||
      '—';
    var uniAward =
      (vm.universityAwards && String(vm.universityAwards).trim()) || (vm.awards && String(vm.awards).trim()) || '—';
    var famRows = (vm.familyMembers || [])
      .map(function (m) {
        return (
          '<tr>' +
          '<td style="border:1px solid #111;padding:4px;">' +
          esc(m.relation) +
          '</td>' +
          '<td style="border:1px solid #111;padding:4px;">' +
          esc(m.name) +
          '</td>' +
          '<td style="border:1px solid #111;padding:4px;">' +
          esc(m.birthDate) +
          '</td>' +
          '<td style="border:1px solid #111;padding:4px;">' +
          esc(m.politicalStatus) +
          '</td>' +
          '<td style="border:1px solid #111;padding:4px;">' +
          esc((m.workUnit || '') + ' ' + (m.position || '')) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
    if (!famRows) {
      famRows = '<tr><td colspan="5" style="border:1px solid #111;padding:4px;">无</td></tr>';
    }
    var sigHtml = vm.signatureImageUrl
      ? '<img src="' +
        esc(vm.signatureImageUrl) +
        '" alt="签名" loading="lazy" decoding="async" style="max-height:40px;max-width:160px;border:1px solid #999;" />'
      : '___________';
    var photoSrc = esc(vm.photo || '');
    var lab = 'border:1px solid #111;padding:1px 3px;background:#e5e7eb;font-weight:600;width:88px;line-height:1.15;font-size:11px;';
    var cell = 'border:1px solid #111;padding:1px 3px;line-height:1.15;font-size:11px;';

    var pageTag = function (i, n) {
      return (
        '<p style="position:absolute;top:14px;right:32px;font-size:10px;color:#666;margin:0;z-index:1;">第 ' +
        i +
        ' 页 / 共 ' +
        n +
        ' 页</p>'
      );
    };

    var page1Body =
      '<h2 style="text-align:center;margin:0 0 6px;font-size:18px;font-weight:700;letter-spacing:1px;">' +
      esc(title) +
      '</h2>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:2px;"><tr>' +
      '<td style="padding:2px 0;border:none;font-size:11px;">报考岗位：<span style="border-bottom:1px solid #111;min-width:200px;display:inline-block;">' +
      esc(vm.appliedJobName) +
      '</span></td>' +
      '<td style="padding:2px 0;border:none;text-align:right;font-size:11px;">填表日期：<span style="border-bottom:1px solid #111;min-width:100px;display:inline-block;">' +
      esc(vm.fillDate) +
      '</span></td></tr></table>' +
      '<table style="width:100%;border-collapse:collapse;border:2px solid #111;">' +
      '<tr>' +
      '<td style="' + lab + '">姓名</td><td style="' + cell + '">' + esc(vm.name) + '</td>' +
      '<td style="' + lab + '">性别</td><td style="' + cell + '">' + esc(vm.gender) + '</td>' +
      '<td style="' + lab + '" rowspan="4">照片</td>' +
      '<td style="' + cell + ';text-align:center;" rowspan="4"><img src="' +
      photoSrc +
      '" alt="" loading="lazy" decoding="async" style="width:100px;height:130px;object-fit:cover;border:1px solid #111;" /></td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">民族</td><td style="' + cell + '">' + esc(vm.ethnicity) + '</td>' +
      '<td style="' + lab + '">出生年月</td><td style="' + cell + '">' + esc(vm.birthDate) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">政治面貌</td><td style="' + cell + '">' + esc(vm.politicalStatus) + '</td>' +
      '<td style="' + lab + '">健康状况</td><td style="' + cell + '">' + esc(vm.healthStatus) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">户籍所在地</td><td style="' + cell + '">' + esc(vm.hukou || vm.birthPlace) + '</td>' +
      '<td style="' + lab + '">身份证号</td><td style="' + cell + '">' + esc(vm.idNumber) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">学历</td><td style="' + cell + '">' + esc((vm.fulltimeEducation && vm.fulltimeEducation.level) || '') + '</td>' +
      '<td style="' + lab + '">专业</td><td style="' + cell + '" colspan="3">' +
      esc(vm.major || (vm.fulltimeEducation && vm.fulltimeEducation.major) || '') +
      '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">学位</td><td style="' + cell + '">' + esc(vm.degree) + '</td>' +
      '<td style="' + lab + '">毕业院校及时间</td><td style="' + cell + '" colspan="3">' +
      esc(
        [
          (vm.fulltimeEducation && vm.fulltimeEducation.university) || vm.graduationSchool || '',
          (vm.fulltimeEducation && vm.fulltimeEducation.major) || vm.major || ''
        ]
          .filter(Boolean)
          .join(' ')
      ) +
      '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">固定电话</td><td style="' + cell + '">' + esc(vm.landline) + '</td>' +
      '<td style="' + lab + '">何种特长</td><td style="' + cell + '" colspan="3">' + esc(vm.specialties) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">手机号码</td><td style="' + cell + '">' + esc(vm.phone) + '</td>' +
      '<td style="' + lab + '">英语等级</td><td style="' + cell + '" colspan="3">' + esc(vm.englishLevel) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">通信地址</td><td style="' + cell + '" colspan="2">' +
      esc(vm.mailAddress) +
      '</td>' +
      '<td style="' + lab + '">是否符合岗位工作经验</td><td style="' + cell + '" colspan="2">' +
      esc(vm.meetsJobExperience) +
      '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">专业技术资格</td><td style="' + cell + '" colspan="2">' + esc(vm.techQualification) + '</td>' +
      '<td style="' + lab + '">职(执)业资格</td><td style="' + cell + '" colspan="2">' + esc(vm.vocationalQualification) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">工作单位</td><td style="' + cell + '" colspan="2">' + esc(vm.workUnit) + '</td>' +
      '<td style="' + lab + '">现任岗位及等级</td><td style="' + cell + '" colspan="2">' + esc(vm.currentPosition) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">报考单位</td><td style="' + cell + '" colspan="2">' + esc(vm.applyUnit) + '</td>' +
      '<td style="' + lab + '">报考岗位名称</td><td style="' + cell + '" colspan="2">' + esc(vm.appliedJobName) + '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + '">岗位代码</td><td style="' + cell + '">' + esc(vm.positionCode) + '</td>' +
      '<td style="' + lab + '">电子邮箱</td><td style="' + cell + '" colspan="3">' + esc(vm.email) + '</td>' +
      '</tr>' +
      '</table>';

    var page2Body =
      '<p style="text-align:center;margin:0 0 6px;font-size:15px;font-weight:700;letter-spacing:1px;">' +
      esc(title) +
      '（续）</p>' +
      '<table style="width:100%;border-collapse:collapse;border:2px solid #111;">' +
      '<tr>' +
      '<td style="' + lab + ';vertical-align:top;">简历<br/><span style="font-weight:400;font-size:11px;">（工作学习经历）</span></td>' +
      '<td style="' +
      cell +
      ';vertical-align:top;white-space:pre-wrap;min-height:96px;font-size:11px;line-height:1.3;" colspan="5">' +
      esc(resumeBlock) +
      '</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="' + lab + ';vertical-align:top;">大学期间奖惩和处分</td>' +
      '<td style="' + cell + ';white-space:pre-wrap;font-size:11px;" colspan="5">' +
      esc(uniAward) +
      '</td>' +
      '</tr>' +
      '</table>' +
      '<table style="width:100%;border-collapse:collapse;border:2px solid #111;border-top:none;margin-bottom:0;">' +
      '<tr><td style="' + lab + ';text-align:center;" colspan="5">家庭成员及主要社会关系</td></tr>' +
      '<tr>' +
      '<td style="' + lab + '">称谓</td>' +
      '<td style="' + lab + '">姓名</td>' +
      '<td style="' + lab + '">出生年月</td>' +
      '<td style="' + lab + '">政治面貌</td>' +
      '<td style="' + lab + '">工作(学习)单位及职务</td>' +
      '</tr>' +
      famRows +
      '</table>';

    var page3Body =
      '<p style="text-align:center;margin:0 0 6px;font-size:15px;font-weight:700;letter-spacing:1px;">' +
      esc(title) +
      '（续）</p>' +
      '<table style="width:100%;border-collapse:collapse;border:2px solid #111;margin-bottom:4px;">' +
      '<tr><td style="' + cell + ';padding:8px;">' +
      '<p style="margin:0 0 8px;text-indent:2em;">本人承诺所填信息及所附材料真实有效，如有虚假，愿承担相应责任。</p>' +
      '<p style="margin:0;">应聘人员签字：' +
      sigHtml +
      '<span style="margin-left:28px;">日期：' +
      esc(vm.signatureDate || '') +
      '</span></p>' +
      '</td></tr></table>' +
      '<p style="font-size:11px;color:#444;margin:0;">说明：审查意见栏由招聘单位填写。</p>';

    var nPages = 3;
    var page2BodyContinuous =
      '<h3 style="margin:14px 0 10px;font-size:15px;font-weight:700;text-align:center;letter-spacing:1px;color:#111;">简历、奖惩与家庭成员</h3>' +
      page2Body.replace(/^<p[^>]*>[\s\S]*?<\/p>\s*/, '');
    var page3BodyContinuous =
      '<h3 style="margin:14px 0 10px;font-size:15px;font-weight:700;text-align:center;letter-spacing:1px;color:#111;">承诺与签名</h3>' +
      page3Body.replace(/^<p[^>]*>[\s\S]*?<\/p>\s*/, '');

    var pages;
    if (layout === 'continuous') {
      pages =
        '<div class="rf-a4-page rf-a4-continuous" style="' +
        RF_A4_PAGE_STYLE +
        '">' +
        page1Body +
        page2BodyContinuous +
        page3BodyContinuous +
        '</div>';
    } else {
      pages =
        '<div class="rf-a4-page" style="' +
        RF_A4_PAGE_STYLE +
        '">' +
        pageTag(1, nPages) +
        page1Body +
        '</div>' +
        '<div class="rf-a4-page" style="' +
        RF_A4_PAGE_STYLE +
        '">' +
        pageTag(2, nPages) +
        page2Body +
        '</div>' +
        '<div class="rf-a4-page" style="' +
        RF_A4_PAGE_STYLE +
        '">' +
        pageTag(3, nPages) +
        page3Body +
        '</div>';
    }

    return (
      '<div class="rf-export-root" style="width:100%;max-width:820px;margin:0 auto;background:#f3f4f6;color:#111;font-size:12px;line-height:1.45;font-family:\'SimSun\',\'Songti SC\',serif,system-ui,sans-serif;">' +
      pages +
      '</div>'
    );
  }

  async function inlineImages(root, fetchOpts) {
    var imgs = root.querySelectorAll('img');
    var revokes = [];
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var src = img.getAttribute('src');
      if (!src || src.indexOf('data:') === 0 || src.indexOf('blob:') === 0) {
        await new Promise(function (res) {
          if (img.complete) return res();
          img.onload = function () {
            res();
          };
          img.onerror = function () {
            res();
          };
        });
        continue;
      }
      try {
        var r = await fetch(src, fetchOpts || { mode: 'cors', credentials: 'include' });
        if (!r.ok) throw new Error(String(r.status));
        var b = await r.blob();
        var u = URL.createObjectURL(b);
        revokes.push(u);
        img.setAttribute('src', u);
      } catch (e) {
        /* 跨域或失败时保留原 src，html2canvas 可能无法绘制该图 */
      }
      await new Promise(function (res) {
        if (img.complete) return res();
        img.onload = function () {
          res();
        };
        img.onerror = function () {
          res();
        };
      });
    }
    return revokes;
  }

  function revokeUrls(urls) {
    (urls || []).forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {}
    });
  }

  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败'));
      };
      img.src = url;
    });
  }

  /** 将多页 A4 截图纵向合并为一张 PNG（便于旧版单文件下载） */
  async function mergePngBlobsVertical(blobs, gapPx) {
    gapPx = gapPx == null ? 8 : gapPx;
    if (!blobs || !blobs.length) return null;
    if (blobs.length === 1) return blobs[0];
    var imgs = [];
    for (var i = 0; i < blobs.length; i++) {
      imgs.push(await blobToImage(blobs[i]));
    }
    var w = 0;
    var h = gapPx * (imgs.length - 1);
    imgs.forEach(function (im) {
      w = Math.max(w, im.width);
      h += im.height;
    });
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    var y = 0;
    imgs.forEach(function (im, idx) {
      var x = Math.floor((w - im.width) / 2);
      ctx.drawImage(im, x, y);
      y += im.height + (idx < imgs.length - 1 ? gapPx : 0);
    });
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) {
        resolve(b);
      }, 'image/png');
    });
  }

  /**
   * 按 A4 分页截取报名表，返回每页一张 PNG。
   */
  async function captureToPngBlobs(vm, fetchOpts, layoutOpts) {
    layoutOpts = layoutOpts || {};
    if (typeof html2canvas === 'undefined') {
      throw new Error('未加载 html2canvas');
    }
    var wrap = document.createElement('div');
    wrap.innerHTML = buildHtml(vm, { layout: layoutOpts.layout || 'continuous' });
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;width:820px;';
    document.body.appendChild(wrap);
    var pages = wrap.querySelectorAll('.rf-a4-page');
    var blobs = [];
    try {
      var list = pages && pages.length ? Array.prototype.slice.call(pages) : [wrap.querySelector('.rf-export-root') || wrap.firstElementChild];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el) continue;
        var revokes = await inlineImages(el, fetchOpts);
        var canvas;
        try {
          canvas = await html2canvas(el, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#ffffff'
          });
        } finally {
          revokeUrls(revokes);
        }
        var b = await new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            resolve(blob);
          }, 'image/png');
        });
        if (b) blobs.push(b);
      }
    } finally {
      document.body.removeChild(wrap);
    }
    return blobs;
  }

  async function captureToPngBlob(vm, fetchOpts) {
    var parts = await captureToPngBlobs(vm, fetchOpts, { layout: 'continuous' });
    if (!parts || !parts.length) return null;
    return mergePngBlobsVertical(parts, 8);
  }

  function extForImageBlob(blob) {
    var t = (blob && blob.type) || '';
    if (t.indexOf('png') !== -1) return '.png';
    if (t.indexOf('jpeg') !== -1 || t.indexOf('jpg') !== -1) return '.jpg';
    if (t.indexOf('webp') !== -1) return '.webp';
    return '.jpg';
  }

  async function fetchUrlAsBlob(absUrl, fetchOpts) {
    if (!absUrl) return null;
    if (absUrl.indexOf('data:') === 0) {
      try {
        var r0 = await fetch(absUrl);
        return await r0.blob();
      } catch (e) {
        return null;
      }
    }
    try {
      var r = await fetch(absUrl, fetchOpts || { mode: 'cors', credentials: 'include' });
      if (!r.ok) return null;
      return await r.blob();
    } catch (e) {
      return null;
    }
  }

  /** A4 打印：带页边距，尽量避免表格跨页拆分 */
  async function printA4(vm, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var html = buildHtml(vm, { layout: opts.continuousPrint === false ? 'paged' : 'continuous' });
    var w = openPrintWindow(html);
    if (!w) throw new Error('无法打开打印窗口，请检查浏览器拦截设置');
    // 等待图片加载完成后再打印，避免空白（简单延时，足够覆盖常见场景）
    var waitMs = Number(opts.waitMs) > 0 ? Number(opts.waitMs) : 500;
    await new Promise(function (r) {
      setTimeout(r, waitMs);
    });
    try {
      w.focus();
      w.print();
    } catch (e) {}
    return true;
  }

  /**
   * 将 vm（viewModelFromExtraJson / mapApiCandidateToViewModel 形状）写入 zip 子目录：报名表.png + 证件照与附件图片。
   */
  async function addViewModelFolderToZip(zip, folderName, vm, options) {
    options = options || {};
    var fetchOpts = options.fetchOpts || { mode: 'cors', credentials: 'include' };
    var norm = options.normalizeUrl || function (u) {
      return u || '';
    };
    var folder = zip.folder(folderName);
    var onePng = await captureToPngBlob(vm, fetchOpts);
    if (onePng) {
      folder.file('报名表.png', onePng);
    } else {
      var pngParts = await captureToPngBlobs(vm, fetchOpts, { layout: 'paged' });
      if (pngParts && pngParts.length) {
        if (pngParts.length === 1) {
          folder.file('报名表.png', pngParts[0]);
        } else {
          for (var pi = 0; pi < pngParts.length; pi++) {
            var n = pi + 1;
            var num = n < 10 ? '0' + n : String(n);
            folder.file('报名表_第' + num + '页.png', pngParts[pi]);
          }
        }
      }
    }
    async function addImg(url, baseName) {
      var abs = norm(url);
      if (!abs) return;
      var blob = await fetchUrlAsBlob(abs, fetchOpts);
      if (blob) folder.file(baseName + extForImageBlob(blob), blob);
    }
    await addImg(vm.photo, '证件照');
    await addImg(vm.idCardFront, '身份证正面');
    await addImg(vm.idCardBack, '身份证反面');
    var certs = vm.educationCertificates || [];
    for (var j = 0; j < certs.length; j++) {
      var label = j === 0 ? '学历证明' : '证书' + (j + 1);
      await addImg(certs[j], label);
    }
  }

  g.registrationFormExport = {
    esc: esc,
    viewModelFromExtraJson: viewModelFromExtraJson,
    buildHtml: buildHtml,
    captureToPngBlob: captureToPngBlob,
    captureToPngBlobs: captureToPngBlobs,
    mergePngBlobsVertical: mergePngBlobsVertical,
    inlineImages: inlineImages,
    addViewModelFolderToZip: addViewModelFolderToZip,
    printA4: printA4
  };
})(typeof window !== 'undefined' ? window : this);
