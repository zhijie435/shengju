// 求职者岗位/项目统一报名大表单（岗位推荐 + 公告附加岗位共用）
// 暴露全局对象：window.JobApplyForm.openForJob(job, jobId) / openForProject(job, projectId)

(function (window) {
    if (window.JobApplyForm && window.JobApplyForm._version === '1.5') {
        return;
    }

    const APPLY_IMAGE_MAX_SIZE = 2 * 1024 * 1024;

    function getAuthToken() {
        try {
            const a = (typeof AuthHelper !== 'undefined') ? AuthHelper.get('jobseeker') : null;
            return (a && a.token) || localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
        } catch (e) {
            return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
        }
    }

    function getApiBase() {
        if (typeof window !== 'undefined' && window.API_BASE_URL) return window.API_BASE_URL;
        try {
            const origin = typeof location !== 'undefined' && location.origin;
            const protocol = typeof location !== 'undefined' && location.protocol;
            if (origin && (protocol === 'http:' || protocol === 'https:')) {
                return origin.replace(/\/+$/, '') + '/api/v1';
            }
        } catch (e) {}
        if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.indexOf('http') === 0) {
            return window.location.origin + '/api/v1';
        }
        return (window.API_BASE_URL || (window.location.origin.replace(/\/+$/, '') + '/api/v1'));
    }

    const API_BASE = getApiBase();

    async function apiRequest(path, options) {
        const url = /^https?:\/\//.test(path) ? path : (API_BASE + path);
        const token = getAuthToken();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, (options && options.headers) || {});
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(url, Object.assign({}, options, { headers }));
        if (res.status === 401) {
            if (typeof AuthHelper !== 'undefined') AuthHelper.clear('jobseeker');
            window.location.href = 'login.html';
            throw new Error('未登录');
        }
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(text || res.statusText);
        }
    }

    function normalizeYmdInput(v) {
        if (v == null) return '';
        return String(v).trim().replace(/\//g, '-').slice(0, 10);
    }

    function resolveMediaUrlForPreview(url) {
        if (!url || typeof url !== 'string') return '';
        var u = url.trim();
        if (!u) return '';
        if (u.indexOf('data:') === 0 || /^https?:\/\//i.test(u)) return u;
        var base = '';
        try {
            base = getApiBase().replace(/\/api\/v1\/?$/i, '');
        } catch (e) {
            base = '';
        }
        if (!base && typeof location !== 'undefined') base = location.origin || '';
        if (u.indexOf('/') === 0) return base + u;
        return base + '/' + u.replace(/^\/+/, '');
    }

    function ensureApplyImageLightbox() {
        var el = document.getElementById('apply-form-image-lightbox');
        if (el) return el;
        var wrap = document.createElement('div');
        wrap.id = 'apply-form-image-lightbox';
        wrap.className = 'fixed inset-0 z-[80] hidden flex items-center justify-center bg-black bg-opacity-80 p-4';
        wrap.innerHTML =
            '<button type="button" class="apply-form-lightbox-close absolute top-4 right-4 text-white text-3xl leading-none font-light hover:text-gray-300" aria-label="关闭">&times;</button>' +
            '<img alt="预览" class="apply-form-lightbox-img max-w-full max-h-[90vh] object-contain rounded shadow-lg" src=""/>';
        document.body.appendChild(wrap);
        wrap.querySelector('.apply-form-lightbox-close').addEventListener('click', function () {
            wrap.classList.add('hidden');
        });
        wrap.addEventListener('click', function (e) {
            if (e.target === wrap) wrap.classList.add('hidden');
        });
        return wrap;
    }

    function openApplyImageLightbox(src) {
        if (!src) return;
        var lb = ensureApplyImageLightbox();
        var img = lb.querySelector('.apply-form-lightbox-img');
        if (img) img.src = src;
        lb.classList.remove('hidden');
    }

    function fileToBase64(file) {
        return new Promise(function (resolve, reject) {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function applyAttachmentFields(req) {
        const out = [];
        if (!Array.isArray(req)) return out;
        req.forEach(function (k) {
            if (k === 'id_card') {
                out.push({ key: 'id_card_front', label: '身份证正面', required: true });
                out.push({ key: 'id_card_back', label: '身份证反面', required: true });
            } else if (k === 'certificate') {
                out.push({ key: 'certificate', label: '其他证书（选填）', required: false });
            } else {
                out.push({
                    key: k,
                    label: (k === 'photo' ? '寸照' : k === 'education' ? '学历证明' : k),
                    required: true
                });
            }
        });
        return out;
    }

    /** 与后端 talentSiteCompat __EDU_RANK_MAP 保持一致，用于提交前学历档位校验 */
    var EDU_RANK_MAP_APPLY = {
        初中: 1,
        高中: 2,
        中专: 3,
        中技: 3,
        '中专/中技': 3,
        大专: 4,
        专科: 4,
        本科: 5,
        学士: 5,
        硕士: 6,
        硕士研究生: 6,
        研究生: 6,
        博士: 7
    };
    function educationRankFromLabelApply(s) {
        if (!s || !String(s).trim()) return 0;
        var str = String(s).trim();
        var keys = Object.keys(EDU_RANK_MAP_APPLY).sort(function (a, b) { return b.length - a.length; });
        var best = 0;
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (str.indexOf(k) !== -1) best = Math.max(best, EDU_RANK_MAP_APPLY[k]);
        }
        return best;
    }
    function computeAgeYearsFromBirth(birthYmd) {
        if (!birthYmd || !String(birthYmd).trim()) return null;
        var d = new Date(String(birthYmd).trim().slice(0, 10));
        if (isNaN(d.getTime())) return null;
        var today = new Date();
        var age = today.getFullYear() - d.getFullYear();
        var m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
        return age;
    }

    // 简单签名板：在 canvas 上手写签名，返回一个获取签名图片的函数
    function initSignaturePad(canvas, clearBtn, preloadImageUrl) {
        if (!canvas) {
            return {
                getDataUrl: function () { return null; },
                preloadFromUrl: function () {}
            };
        }
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let hasDrawn = false;

        function tryPreload(url) {
            if (!url || typeof url !== 'string') return;
            const u = url.trim();
            if (!u) return;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                try {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    hasDrawn = true;
                } catch (e) { /* ignore */ }
            };
            img.src = u;
        }
        if (preloadImageUrl) tryPreload(preloadImageUrl);

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            if (e.touches && e.touches[0]) {
                return {
                    x: e.touches[0].clientX - rect.left,
                    y: e.touches[0].clientY - rect.top
                };
            }
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }

        function start(e) {
            e.preventDefault();
            drawing = true;
            hasDrawn = true;
            const p = getPos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        }

        function move(e) {
            if (!drawing) return;
            e.preventDefault();
            const p = getPos(e);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        function end(e) {
            if (!drawing) return;
            e && e.preventDefault();
            drawing = false;
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                hasDrawn = false;
            });
        }

        return {
            getDataUrl: function getSignatureDataUrl() {
                if (!hasDrawn) return null;
                try {
                    return canvas.toDataURL('image/png');
                } catch (e) {
                    return null;
                }
            },
            preloadFromUrl: tryPreload
        };
    }

    function rf(key, inner) {
        return '<div class="rf-field" data-rf="' + key + '">' + inner + '</div>';
    }

    /**
     * 纸质报名表与公招常用表：考生端始终展示全部表单项，与截图/纸质栏位一致。
     * 政企端「报名表条件」仅用于必填校验（fieldRequired），不再用来隐藏字段（避免勾选「考生端不显示」后表单缺项）。
     */
    function applyRegistrationFieldVisibility(modal, schemaFields) {
        void modal;
        void schemaFields;
    }

    function fieldVisible(modal, key, schemaFields) {
        void modal;
        void key;
        void schemaFields;
        return true;
    }

    function fieldRequired(schemaFields, key) {
        if (!schemaFields || !schemaFields.length) {
            return key === 'name' || key === 'idNumber' || key === 'mobile' || key === 'appliedJob';
        }
        var f = schemaFields.filter(function (x) { return x.key === key; })[0];
        return !!(f && f.required);
    }

    function applyCoopExtraJsonToModal(modal, ex, existingAttachmentKeys) {
        if (!modal || !ex) return;
        var b = ex.basicInfo || {};
        function fset(id, val) {
            var el = document.getElementById(id);
            if (!el || val == null || val === '') return;
            el.value = String(val);
        }
        fset('apply-fill-date', normalizeYmdInput(b.fillDate));
        fset('apply-job-name', b.appliedJobName);
        fset('apply-name', b.name);
        if (b.gender) {
            var g = document.getElementById('apply-gender');
            if (g) g.value = b.gender;
        }
        fset('apply-ethnicity', b.ethnicity);
        fset('apply-birth-date', normalizeYmdInput(b.birthDate));
        fset('apply-political-status', b.politicalStatus);
        fset('apply-health', b.healthStatus);
        fset('apply-hukou', b.hukou);
        fset('apply-birth-place', b.birthPlace);
        fset('apply-work-start', normalizeYmdInput(b.workStartDate));
        fset('apply-id-number', b.idNumber);
        var fe = document.getElementById('apply-fulltime-education');
        if (fe && ex.educationInfo && ex.educationInfo.fulltimeEducation) fe.value = ex.educationInfo.fulltimeEducation;
        fset('apply-major', b.major);
        fset('apply-degree', b.degree);
        fset('apply-graduation-school', b.graduationSchool);
        fset('apply-landline', b.landline);
        fset('apply-specialties', b.specialties);
        fset('apply-phone', b.phone);
        fset('apply-english-level', b.englishLevel);
        fset('apply-mail-address', b.mailAddress);
        if (b.meetsJobExperience) {
            var mx = document.getElementById('apply-meets-exp');
            if (mx) mx.value = b.meetsJobExperience;
        }
        fset('apply-tech-qual', b.techQualification);
        fset('apply-vocational-qual', b.vocationalQualification);
        fset('apply-party-join', b.partyJoinDate);
        fset('apply-work-unit', b.workUnit);
        fset('apply-current-position', b.currentPosition);
        fset('apply-unit', b.applyUnit);
        fset('apply-position-code', b.positionCode);
        fset('apply-email', b.email);
        fset('apply-resume-detail', b.resumeDetail);
        if (ex.universityAwards != null) fset('apply-university-awards', ex.universityAwards);
        var rt = Array.isArray(ex.resumeTimeline) ? ex.resumeTimeline : [];
        var rd = rt
            .filter(function (t) {
                return t && t.type === 'resumeDetail' && t.content;
            })
            .map(function (t) {
                return String(t.content).trim();
            })
            .filter(Boolean)
            .join('\n');
        if (rd) {
            var ta = document.getElementById('apply-resume-detail');
            if (ta && !String(ta.value || '').trim()) ta.value = rd;
        }
        var box = document.getElementById('apply-family-rows');
        if (box && Array.isArray(ex.familyMembers) && ex.familyMembers.length) {
            box.innerHTML = '';
            ex.familyMembers.forEach(function (m) {
                box.insertAdjacentHTML('beforeend', applyFamilyRowMarkup());
                var row = box.lastElementChild;
                if (!row) return;
                var rel = row.querySelector('.af-rel');
                var nm = row.querySelector('.af-name');
                var bd = row.querySelector('.af-birth');
                var pol = row.querySelector('.af-poli');
                var wu = row.querySelector('.af-work');
                if (rel) rel.value = m.relation || '';
                if (nm) nm.value = m.name || '';
                if (bd) bd.value = m.birthDate || '';
                if (pol) pol.value = m.politicalStatus || '';
                if (wu) wu.value = m.workUnit || '';
            });
            box.querySelectorAll('.af-remove').forEach(function (btn) {
                btn.onclick = function () {
                    if (box.querySelectorAll('.apply-family-row').length <= 1) return;
                    var row = btn.closest('.apply-family-row');
                    if (row) row.remove();
                };
            });
        }
        var att = ex.attachments || {};
        Object.keys(att).forEach(function (k) {
            var val = att[k];
            if (val == null || val === '') return;
            var s = typeof val === 'string' ? val.trim() : '';
            if (!s || s.length < 8) return;
            existingAttachmentKeys[k] = true;
            var previewEl = modal.querySelector('.apply-attach-preview[data-type="' + k + '"]');
            var full = resolveMediaUrlForPreview(s);
            if (!previewEl || !full) return;
            var esc = full.replace(/"/g, '&quot;');
            previewEl.innerHTML =
                '<img src="' + esc + '" alt="已有附件" class="max-h-24 rounded border border-gray-300 object-contain cursor-zoom-in"/>';
            var img = previewEl.querySelector('img');
            if (img) {
                img.addEventListener('click', function () {
                    openApplyImageLightbox(full);
                });
            }
        });
    }

    function applyFamilyRowMarkup() {
        return (
            '<div class="apply-family-row grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-3 border border-gray-200 rounded-lg bg-gray-50">' +
            '<div><label class="text-xs text-gray-600">称谓</label><input type="text" class="af-rel w-full px-2 py-1.5 border border-gray-300 rounded text-sm"/></div>' +
            '<div><label class="text-xs text-gray-600">姓名</label><input type="text" class="af-name w-full px-2 py-1.5 border border-gray-300 rounded text-sm"/></div>' +
            '<div><label class="text-xs text-gray-600">出生年月</label><input type="text" class="af-birth w-full px-2 py-1.5 border border-gray-300 rounded text-sm" placeholder="如 1990-01"/></div>' +
            '<div><label class="text-xs text-gray-600">政治面貌</label><input type="text" class="af-poli w-full px-2 py-1.5 border border-gray-300 rounded text-sm"/></div>' +
            '<div class="sm:col-span-2 lg:col-span-1 flex flex-col gap-1"><label class="text-xs text-gray-600">工作单位及职务</label><input type="text" class="af-work w-full px-2 py-1.5 border border-gray-300 rounded text-sm"/><button type="button" class="af-remove text-xs text-red-600 self-end hover:underline">移除此行</button></div>' +
            '</div>'
        );
    }

    function openApplyFormModalInternal(job, targetType, targetId, options) {
        options = options || {};
        var regSchema = options.registrationFormSchema || null;
        var cooperationApplicationId = NaN;
        if (options.cooperationApplicationId != null && String(options.cooperationApplicationId).trim() !== '') {
            cooperationApplicationId = parseInt(String(options.cooperationApplicationId).trim(), 10);
        }
        var isCoopResubmit =
            targetType === 'project' && Number.isFinite(cooperationApplicationId) && cooperationApplicationId > 0;

        const existing = document.getElementById('apply-form-modal');
        if (existing) existing.remove();

        const req = job && Array.isArray(job.requireAttachments) ? job.requireAttachments : [];
        const fields = applyAttachmentFields(req);
        const photoFields = fields.filter(function (f) { return f.key === 'photo'; });
        const attachFieldsRest = fields.filter(function (f) { return f.key !== 'photo'; });
        const coEsc = String(job.companyName || '招聘单位').replace(/</g, '&lt;');
        const jobNameEsc = String(job.name || job.title || '').replace(/</g, '&lt;');
        const jobCoAttr = String(job.companyName || '').replace(/"/g, '&quot;');

        const parts = [];
        parts.push('<div id="apply-form-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">');
        parts.push('<div class="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[95vh] flex flex-col overflow-hidden">');
        parts.push('<div class="p-6 border-b flex items-center justify-between shrink-0">');
        parts.push('<div>');
        parts.push('<h3 class="text-xl font-bold text-gray-900">' + coEsc + ' 招聘报名表</h3>');
        parts.push('<p class="text-sm text-gray-500 mt-1">报考岗位：<span class="font-medium text-gray-800">' + jobNameEsc + '</span></p>');
        parts.push('</div>');
        parts.push('<button type="button" id="apply-form-close" class="text-gray-400 hover:text-gray-600"><i class="fa fa-times text-xl"></i></button>');
        parts.push('</div>');

        parts.push('<div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">');

        // 一、基本信息（与纸质报名表字段顺序一致；右侧寸照）
        parts.push('<section>');
        parts.push('<h4 class="text-lg font-semibold text-gray-800 mb-3">一、基本信息</h4>');
        parts.push('<div class="flex flex-col lg:flex-row gap-6 items-start">');
        parts.push('<div class="flex-1 min-w-0 w-full"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">');
        parts.push(rf('fillDate', '<div><label class="block text-sm font-medium text-gray-700 mb-1">填表日期</label><input id="apply-fill-date" type="date" lang="zh-CN" class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('appliedJob', '<div><label class="block text-sm font-medium text-gray-700 mb-1">报考岗位</label><input id="apply-job-name" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" value="' + (job.name || job.title || '') + '"/></div>'));
        parts.push(rf('name', '<div><label class="block text-sm font-medium text-gray-700 mb-1">姓名 *</label><input id="apply-name" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('gender', '<div><label class="block text-sm font-medium text-gray-700 mb-1">性别</label><select id="apply-gender" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"><option value="">请选择</option><option value="男">男</option><option value="女">女</option><option value="保密">保密</option></select></div>'));
        parts.push(rf('ethnicity', '<div><label class="block text-sm font-medium text-gray-700 mb-1">民族</label><input id="apply-ethnicity" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如：汉族"/></div>'));
        parts.push(rf('birthDate', '<div><label class="block text-sm font-medium text-gray-700 mb-1">出生年月</label><input id="apply-birth-date" type="date" lang="zh-CN" class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('politicalStatus', '<div><label class="block text-sm font-medium text-gray-700 mb-1">政治面貌</label><input id="apply-political-status" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如：群众、中共党员"/></div>'));
        parts.push(rf('health', '<div><label class="block text-sm font-medium text-gray-700 mb-1">健康状况</label><input id="apply-health" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如：良好"/></div>'));
        parts.push(rf('hukou', '<div><label class="block text-sm font-medium text-gray-700 mb-1">户籍所在地</label><input id="apply-hukou" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="省市区县"/></div>'));
        parts.push(rf('birthPlace', '<div><label class="block text-sm font-medium text-gray-700 mb-1">出生地</label><input id="apply-birth-place" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('workStart', '<div><label class="block text-sm font-medium text-gray-700 mb-1">参加工作时间</label><input id="apply-work-start" type="date" lang="zh-CN" class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('idNumber', '<div><label class="block text-sm font-medium text-gray-700 mb-1">身份证号 *</label><input id="apply-id-number" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('education', '<div><label class="block text-sm font-medium text-gray-700 mb-1">学历</label><select id="apply-fulltime-education" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"><option value="">请选择</option><option value="博士">博士</option><option value="硕士">硕士</option><option value="本科">本科</option><option value="大专">大专</option><option value="中专/中技">中专/中技</option><option value="高中">高中</option><option value="初中">初中</option><option value="其他">其他</option></select></div>'));
        parts.push(rf('major', '<div><label class="block text-sm font-medium text-gray-700 mb-1">专业</label><input id="apply-major" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="所学专业"/></div>'));
        parts.push(rf('degree', '<div><label class="block text-sm font-medium text-gray-700 mb-1">学位</label><input id="apply-degree" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如：学士、硕士"/></div>'));
        parts.push(rf('graduationSchool', '<div><label class="block text-sm font-medium text-gray-700 mb-1">毕业院校及时间</label><input id="apply-graduation-school" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="院校与毕业时间"/></div>'));
        parts.push(rf('landline', '<div><label class="block text-sm font-medium text-gray-700 mb-1">固定电话</label><input id="apply-landline" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('specialties', '<div><label class="block text-sm font-medium text-gray-700 mb-1">何种特长</label><input id="apply-specialties" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('mobile', '<div><label class="block text-sm font-medium text-gray-700 mb-1">手机号码 *</label><input id="apply-phone" type="tel" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('englishLevel', '<div><label class="block text-sm font-medium text-gray-700 mb-1">英语等级</label><input id="apply-english-level" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如：CET4"/></div>'));
        parts.push(rf('mailAddress', '<div><label class="block text-sm font-medium text-gray-700 mb-1">通信地址</label><input id="apply-mail-address" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('meetsJobExperience', '<div><label class="block text-sm font-medium text-gray-700 mb-1">是否符合岗位工作经验</label><select id="apply-meets-exp" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"><option value="">请选择</option><option value="是">是</option><option value="否">否</option></select></div>'));
        parts.push(rf('techQualification', '<div><label class="block text-sm font-medium text-gray-700 mb-1">专业技术资格</label><input id="apply-tech-qual" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如：中级"/></div>'));
        parts.push(rf('vocationalQualification', '<div><label class="block text-sm font-medium text-gray-700 mb-1">职(执)业资格</label><input id="apply-vocational-qual" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('partyJoin', '<div><label class="block text-sm font-medium text-gray-700 mb-1">入党时间</label><input id="apply-party-join" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="可选 yyyy-mm-dd；群众填「无」或留空"/></div>'));
        parts.push(rf('workUnit', '<div><label class="block text-sm font-medium text-gray-700 mb-1">工作单位</label><input id="apply-work-unit" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('currentPosition', '<div><label class="block text-sm font-medium text-gray-700 mb-1">现任岗位及等级</label><input id="apply-current-position" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push(rf('applyUnit', '<div><label class="block text-sm font-medium text-gray-700 mb-1">报考单位</label><input id="apply-unit" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" value="' + jobCoAttr + '"/></div>'));
        parts.push(rf('positionCode', '<div><label class="block text-sm font-medium text-gray-700 mb-1">岗位代码</label><input id="apply-position-code" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" value="' + (job.jobCode || '') + '"/></div>'));
        parts.push(rf('email', '<div><label class="block text-sm font-medium text-gray-700 mb-1">电子邮箱</label><input id="apply-email" type="email" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/></div>'));
        parts.push('</div></div>');
        parts.push('<div class="w-full lg:w-36 flex-shrink-0 rf-field" data-rf="candidatePhoto">');
        parts.push('<label class="block text-sm font-medium text-gray-700 mb-1">' + (photoFields.length ? photoFields[0].label : '寸照') + (photoFields.length && photoFields[0].required ? ' *' : '') + '</label>');
        parts.push('<input type="file" accept="image/*" class="apply-attach-file block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-primary file:text-white" data-type="photo">');
        parts.push('<div class="apply-attach-preview mt-2 min-h-[128px] flex items-center justify-center bg-gray-50 rounded border border-dashed border-gray-300 text-xs text-gray-400" data-type="photo">预览</div>');
        parts.push('<p class="text-xs text-gray-400 mt-1">白底证件照，与纸质表一致。</p>');
        parts.push('</div>');
        parts.push('</div>');
        parts.push('</section>');

        // 二、教育与简历信息
        parts.push('<section>');
        parts.push('<h4 class="text-lg font-semibold text-gray-800 mb-3">二、简历（工作学习经历）</h4>');
        parts.push(rf('resumeDetail', '<div class="mb-4"><label class="block text-sm font-medium text-gray-700 mb-1">简历（工作学习经历详述）</label><textarea id="apply-resume-detail" rows="8" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="按时间顺序填写工作、学习经历"></textarea></div>'));
        parts.push(rf('resumeAttachment', '<div class="mt-4 border-t border-dashed border-gray-200 pt-4"><label class="block text-sm font-medium text-gray-700 mb-1">随本次申请附加简历</label><p class="text-xs text-gray-500 mb-2">可选将一份在个人中心生成/优化的简历，作为附件一并提交给企业。</p><select id="resume-attachment-select" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"><option value="">（不附加简历）</option></select><p class="text-xs text-gray-400 mt-1">如需管理简历内容，请前往“个人中心 - 我的简历”。</p></div>'));
        parts.push('</section>');

        parts.push('<section>');
        parts.push('<h4 class="text-lg font-semibold text-gray-800 mb-3">三、大学期间奖惩和处分</h4>');
        parts.push(rf('universityAwards', '<div><label class="block text-sm font-medium text-gray-700 mb-1">大学期间奖惩和处分</label><textarea id="apply-university-awards" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="如无请填「无」或「表现良好，无处分」"></textarea></div>'));
        parts.push('</section>');

        parts.push('<section class="rf-field" data-rf="familySection">');
        parts.push('<h4 class="text-lg font-semibold text-gray-800 mb-3">四、家庭成员及主要社会关系</h4>');
        parts.push('<p class="text-xs text-gray-500 mb-2">含配偶、子女、父母等；主要社会关系选填。无配偶等可填一行「无」。</p>');
        parts.push('<div id="apply-family-rows" class="space-y-3"></div>');
        parts.push('<button type="button" id="apply-family-add" class="mt-2 text-sm px-3 py-1.5 border border-primary text-primary rounded-lg hover:bg-indigo-50">+ 添加一行</button>');
        parts.push('</section>');

        // 五、附件上传（寸照已在基本信息右侧，此处不再重复）
        parts.push('<section class="rf-field" data-rf="attachmentsSection">');
        parts.push('<h4 class="text-lg font-semibold text-gray-800 mb-3">五、其他附件上传</h4>');
        if (!attachFieldsRest.length) {
            if (req.length) {
                parts.push('<p class="text-sm text-gray-500 mb-2">以下岗位要求的附件中，寸照已在上方「基本信息」右侧上传；其余材料请在此上传（单张不超过 2MB）。</p>');
            } else {
                parts.push('<p class="text-sm text-gray-500">该岗位未要求必须上传附件，如有身份证、学历证书等资料可在下方自愿上传（单张不超过 2MB）。</p>');
            }
        } else if (attachFieldsRest.length) {
            var reqNames2 = attachFieldsRest.map(function (ff) { return ff.label; });
            parts.push('<p class="text-sm text-gray-500 mb-2">须上传：' + reqNames2.join('、') + '（单张图片不超过 2MB）。寸照请在上方基本信息栏上传。</p>');
        }
        parts.push('<div class="space-y-4">');
        attachFieldsRest.forEach(function (f) {
            parts.push('<div>');
            parts.push('<label class="block text-sm font-medium text-gray-700 mb-1">' + f.label + (f.required ? ' *' : '') + '</label>');
            parts.push('<input type="file" accept="image/*" class="apply-attach-file block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-primary file:text-white" data-type="' + f.key + '">');
            parts.push('<div class="apply-attach-preview mt-2" data-type="' + f.key + '" style="min-height:24px;"></div>');
            parts.push('</div>');
        });
        parts.push('</div>');
        parts.push('</section>');

        // 六、签字承诺
        parts.push('<section class="rf-field" data-rf="signatureSection">');
        parts.push('<h4 class="text-lg font-semibold text-gray-800 mb-3">六、本人承诺与签字</h4>');
        parts.push('<p class="text-sm text-gray-600 mb-3">本人承诺所填信息及所附材料真实有效，如有虚假，愿承担相应责任。（与纸质报名表诚信承诺一致）</p>');
        parts.push('<div class="space-y-4">');
        parts.push('<div>');
        parts.push('<label class="block text-sm font-medium text-gray-700 mb-2">考生签字（在下方区域手写签名，推荐使用全屏宽度）</label>');
        parts.push('<div class="border border-gray-300 rounded-lg p-3 bg-gray-50">');
        parts.push('<div class="w-full overflow-x-auto">');
        parts.push('<canvas id="apply-signature-canvas" class="w-full h-48 md:h-56 bg-white rounded shadow-inner" width="900" height="260"></canvas>');
        parts.push('</div>');
        parts.push('<div class="mt-2 flex items-center justify-between text-xs text-gray-500">');
        parts.push('<span>可使用鼠标或触摸板/触屏进行签名，如签名不满意可重写。</span>');
        parts.push('<button type="button" id="apply-signature-clear" class="text-xs text-primary hover:text-blue-700">重写签名</button>');
        parts.push('</div>');
        parts.push('<button type="button" id="apply-signature-fullscreen" class="mt-2 w-full sm:w-auto text-sm px-3 py-1.5 border border-indigo-300 rounded-lg text-indigo-800 hover:bg-indigo-50">全屏签字（手机推荐）</button>');
        parts.push('</div>');
        parts.push('</div>');
        parts.push('</div>');
        parts.push('<div class="max-w-xs">');
        parts.push('<label class="block text-sm font-medium text-gray-700 mb-1">签字日期</label>');
        parts.push('<input id="apply-sign-date" type="date" lang="zh-CN" class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"/>');
        parts.push('</div>');
        parts.push('</div>');
        parts.push('</section>');

        parts.push('</div>'); // scroll body
        parts.push('<div class="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 shrink-0">');
        parts.push('<button type="button" id="apply-form-cancel" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100">取消</button>');
        parts.push(
            '<button type="button" id="apply-form-submit" class="px-6 py-2 bg-primary text-white rounded-lg hover:bg-blue-700">' +
                (isCoopResubmit ? '保存修改并重新提交' : '提交申请') +
                '</button>'
        );
        parts.push('</div>');
        parts.push('</div></div>');

        const wrap = document.createElement('div');
        wrap.innerHTML = parts.join('');
        document.body.appendChild(wrap.firstElementChild);

        const modal = document.getElementById('apply-form-modal');
        if (!modal) return;
        if (isCoopResubmit) modal.setAttribute('data-coop-resubmit', '1');

        applyRegistrationFieldVisibility(modal, regSchema);

        const existingAttachmentKeys = {};

        (function initFamilyRows() {
            var box = document.getElementById('apply-family-rows');
            var addBtn = document.getElementById('apply-family-add');
            if (!box || !addBtn) return;
            function bindRemove() {
                box.querySelectorAll('.af-remove').forEach(function (btn) {
                    btn.onclick = function () {
                        if (box.querySelectorAll('.apply-family-row').length <= 1) return;
                        var row = btn.closest('.apply-family-row');
                        if (row) row.remove();
                    };
                });
            }
            box.innerHTML = applyFamilyRowMarkup();
            bindRemove();
            addBtn.addEventListener('click', function () {
                box.insertAdjacentHTML('beforeend', applyFamilyRowMarkup());
                bindRemove();
            });
        })();

        function closeModal() {
            const m = document.getElementById('apply-form-modal');
            if (m) m.remove();
        }
        document.getElementById('apply-form-close').addEventListener('click', closeModal);
        document.getElementById('apply-form-cancel').addEventListener('click', closeModal);

        const canvas = document.getElementById('apply-signature-canvas');
        const clearBtn = document.getElementById('apply-signature-clear');
        const sigPad = initSignaturePad(canvas, clearBtn);
        const getSignatureDataUrl = function () {
            return sigPad.getDataUrl();
        };
        const preloadSignatureFromUrl = function (u) {
            if (u) sigPad.preloadFromUrl(resolveMediaUrlForPreview(u));
        };
        const signDateInput = document.getElementById('apply-sign-date');
        if (signDateInput && !signDateInput.value) {
            try {
                signDateInput.value = new Date().toISOString().slice(0, 10);
            } catch (e) { }
        }
        const fillDateInput0 = document.getElementById('apply-fill-date');
        if (fillDateInput0 && !fillDateInput0.value && !isCoopResubmit) {
            try {
                fillDateInput0.value = new Date().toISOString().slice(0, 10);
            } catch (e) { }
        }

        (function bindSignatureFullscreen() {
            var fsBtn = document.getElementById('apply-signature-fullscreen');
            if (!fsBtn || !canvas) return;
            fsBtn.addEventListener('click', function () {
                var w = window.innerWidth;
                var h = Math.max(280, window.innerHeight - 120);
                var overlay = document.createElement('div');
                overlay.className = 'fixed inset-0 z-[95] bg-gray-900 flex flex-col';
                overlay.innerHTML =
                    '<div class="flex items-center justify-between px-4 py-3 bg-gray-800 text-white text-sm">' +
                    '<span>全屏签字</span>' +
                    '<div class="flex gap-2">' +
                    '<button type="button" class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 apply-fs-clear">清除</button>' +
                    '<button type="button" class="px-3 py-1 rounded bg-primary hover:bg-blue-700 apply-fs-done">完成</button>' +
                    '</div></div>' +
                    '<div class="flex-1 flex items-stretch justify-center bg-gray-100 p-2">' +
                    '<canvas class="w-full h-full touch-none bg-white rounded shadow apply-fs-canvas" width="' +
                    w +
                    '" height="' +
                    h +
                    '"></canvas></div>';
                document.body.appendChild(overlay);
                var c2 = overlay.querySelector('.apply-fs-canvas');
                var pad2 = initSignaturePad(c2, overlay.querySelector('.apply-fs-clear'));
                overlay.querySelector('.apply-fs-done').addEventListener('click', function () {
                    var url = pad2.getDataUrl();
                    if (url) preloadSignatureFromUrl(url);
                    overlay.remove();
                });
            });
        })();

        if (isCoopResubmit) {
            (async function loadCoopDraft() {
                try {
                    var gr = await apiRequest('/cooperations/my-application/' + cooperationApplicationId);
                    if (!gr || !gr.success || !gr.data || !gr.data.extraJson) return;
                    applyCoopExtraJsonToModal(modal, gr.data.extraJson, existingAttachmentKeys);
                    var sig = (gr.data.extraJson.signature || {});
                    var sigSrc = sig.image || sig.imageUrl;
                    if (sigSrc) preloadSignatureFromUrl(sigSrc);
                    var sd = normalizeYmdInput(sig.signDate);
                    var sdi = document.getElementById('apply-sign-date');
                    if (sdi && sd) sdi.value = sd;
                } catch (e) {
                    console.warn('加载报名草稿失败', e);
                }
            })();
        }

        // 附件预览
        modal.querySelectorAll('.apply-attach-file').forEach(function (input) {
            input.addEventListener('change', function () {
                const type = input.getAttribute('data-type');
                const previewEl = modal.querySelector('.apply-attach-preview[data-type="' + type + '"]');
                if (!previewEl) return;
                const file = input.files && input.files[0];
                if (!file) {
                    previewEl.innerHTML = '';
                    return;
                }
                try {
                    delete existingAttachmentKeys[type];
                } catch (eDel) {}
                if (!file.type || !file.type.startsWith('image/')) {
                    previewEl.innerHTML = '<span class="text-sm text-gray-500">仅支持图片预览</span>';
                    return;
                }
                if (file.size > APPLY_IMAGE_MAX_SIZE) {
                    previewEl.innerHTML = '<span class="text-sm text-red-600">图片超过 2MB，请重新选择</span>';
                    return;
                }
                const url = URL.createObjectURL(file);
                try {
                    delete existingAttachmentKeys[type];
                } catch (eDel) {}
                previewEl.innerHTML =
                    '<img src="' + url + '" alt="预览" class="max-h-24 rounded border border-gray-300 object-contain cursor-zoom-in apply-preview-thumb"/>';
                var pim = previewEl.querySelector('img');
                if (pim) {
                    pim.addEventListener('click', function () {
                        openApplyImageLightbox(pim.src);
                    });
                }
                input._previewUrl = url;
            });
        });

        // 预填充个人资料和简历关键信息
        (async function initProfileAndResume() {
            if (isCoopResubmit) return;
            try {
                const profileRes = await apiRequest('/users/profile');
                if (profileRes && profileRes.success && profileRes.data) {
                    const p = profileRes.data;
                    const nameInput = document.getElementById('apply-name');
                    if (nameInput && !nameInput.value) nameInput.value = p.realName || p.username || '';
                    const genderInput = document.getElementById('apply-gender');
                    if (genderInput && !genderInput.value && p.gender) {
                        let g = p.gender;
                        if (g === 'male') g = '男';
                        else if (g === 'female') g = '女';
                        genderInput.value = g;
                    }
                    const phoneInput = document.getElementById('apply-phone');
                    if (phoneInput && !phoneInput.value) phoneInput.value = p.phone || '';
                    const emailInput = document.getElementById('apply-email');
                    if (emailInput && !emailInput.value) emailInput.value = p.email || '';
                    const birthInput = document.getElementById('apply-birth-date');
                    if (birthInput && !birthInput.value && p.birthDate) birthInput.value = normalizeYmdInput(p.birthDate);
                    const locationInput = document.getElementById('apply-work-unit');
                    if (locationInput && !locationInput.value && p.location) locationInput.value = p.location;
                }
            } catch (e) { }
            try {
                const resumeRes = await apiRequest('/users/resume');
                if (resumeRes && resumeRes.success && resumeRes.data) {
                    const r = resumeRes.data;
                    const fullEdu = document.getElementById('apply-fulltime-education');
                    if (fullEdu && !fullEdu.value && r.education) fullEdu.value = r.education;
                    const majorEl = document.getElementById('apply-major');
                    if (majorEl && !majorEl.value && r.major) majorEl.value = r.major;
                }
            } catch (e) { }
        })();

        // 填充「随本次申请附加简历」下拉选项（来自个人中心生成/优化的简历）
        try {
            const resumeSelect = document.getElementById('resume-attachment-select');
            if (resumeSelect) {
                let userResumeData = [];
                try {
                    userResumeData = JSON.parse(localStorage.getItem('userResumeData') || '[]');
                } catch (e) {
                    userResumeData = [];
                }
                userResumeData
                    .filter(function (r) { return r && r.id && r.content; })
                    .forEach(function (r) {
                        const opt = document.createElement('option');
                        opt.value = r.id;
                        const label = (r.optimized ? '优化简历' : '自动生成') + ' · ' + (r.name || '我的简历');
                        opt.textContent = label;
                        resumeSelect.appendChild(opt);
                    });
            }
        } catch (e) {
            console.warn('加载本地简历列表失败：', e);
        }

        document.getElementById('apply-form-submit').addEventListener('click', function () {
            function gv(id) {
                var el = document.getElementById(id);
                return el && el.value != null ? String(el.value).trim() : '';
            }
            var labelMap = {
                name: '姓名', idNumber: '身份证号', mobile: '手机号码', appliedJob: '报考岗位',
                gender: '性别', birthDate: '出生年月', fillDate: '填表日期', signatureSection: '本人签字',
                universityAwards: '大学期间奖惩和处分', familySection: '家庭成员及主要社会关系'
            };
            var jobReq = job || {};
            var rg = jobReq.requiredGender && String(jobReq.requiredGender).trim();
            if (rg && rg !== '不限') {
                var gx = gv('apply-gender');
                if (!gx || gx === '保密') {
                    alert('本岗位性别要求为「' + rg + '」，请如实选择性别');
                    return;
                }
                if (rg === '男' && gx !== '男') {
                    alert('本岗位仅限男性报名');
                    return;
                }
                if (rg === '女' && gx !== '女') {
                    alert('本岗位仅限女性报名');
                    return;
                }
            }
            var reqEdu = jobReq.requiredTalentType && String(jobReq.requiredTalentType).trim();
            if (reqEdu) {
                var eduSel = (document.getElementById('apply-fulltime-education') || {}).value || '';
                if (!String(eduSel).trim()) {
                    alert('本岗位学历要求为「' + reqEdu + '」，请选择您的学历');
                    return;
                }
                var needRank = educationRankFromLabelApply(reqEdu);
                if (needRank > 0) {
                    var haveRank = educationRankFromLabelApply(eduSel);
                    if (haveRank <= 0 || haveRank < needRank) {
                        alert('本岗位学历要求为「' + reqEdu + '」及以上，您不符合报名条件');
                        return;
                    }
                }
            }
            var minAgeJ = jobReq.minAge;
            var maxAgeJ = jobReq.maxAge;
            if ((minAgeJ != null && minAgeJ !== '') || (maxAgeJ != null && maxAgeJ !== '')) {
                if (!gv('apply-birth-date')) {
                    alert('本岗位设置了年龄要求，请填写出生年月');
                    return;
                }
                var ageYears = computeAgeYearsFromBirth(gv('apply-birth-date'));
                if (ageYears == null) {
                    alert('出生年月无效，无法校验年龄要求');
                    return;
                }
                var minN = minAgeJ != null && minAgeJ !== '' ? parseInt(minAgeJ, 10) : NaN;
                var maxN = maxAgeJ != null && maxAgeJ !== '' ? parseInt(maxAgeJ, 10) : NaN;
                if (!isNaN(minN) && ageYears < minN) {
                    alert('本岗位要求年龄不少于 ' + minN + ' 周岁');
                    return;
                }
                if (!isNaN(maxN) && ageYears > maxN) {
                    alert('本岗位要求年龄不超过 ' + maxN + ' 周岁');
                    return;
                }
            }
            var checks = regSchema && regSchema.length
                ? regSchema.filter(function (f) { return f.showOnCandidate && f.required; })
                : [
                    { key: 'name', label: '姓名' }, { key: 'idNumber', label: '身份证号' },
                    { key: 'mobile', label: '手机号码' }, { key: 'appliedJob', label: '报考岗位' }
                ];
            for (var ci = 0; ci < checks.length; ci++) {
                var ck = checks[ci].key;
                var lab = checks[ci].label || labelMap[ck] || ck;
                if (ck === 'signatureSection') {
                    var sigOk = getSignatureDataUrl && getSignatureDataUrl();
                    if (!sigOk) { alert('请完成「' + lab + '」'); return; }
                    continue;
                }
                if (ck === 'attachmentsSection') continue;
                var ok = true;
                if (ck === 'name') ok = !!gv('apply-name');
                else if (ck === 'idNumber') ok = !!gv('apply-id-number');
                else if (ck === 'mobile') ok = !!gv('apply-phone');
                else if (ck === 'appliedJob') ok = !!gv('apply-job-name');
                else if (ck === 'fillDate') ok = !!gv('apply-fill-date');
                else if (ck === 'gender') ok = !!gv('apply-gender');
                else if (ck === 'birthDate') ok = !!gv('apply-birth-date');
                else if (ck === 'universityAwards') ok = !!gv('apply-university-awards');
                else if (ck === 'familySection') {
                    var fr = modal.querySelectorAll('#apply-family-rows .apply-family-row');
                    var anyFam = false;
                    fr.forEach(function (row) {
                        var t = '';
                        row.querySelectorAll('input').forEach(function (inp) {
                            t += (inp.value || '').trim();
                        });
                        if (t) anyFam = true;
                    });
                    ok = anyFam;
                } else if (ck === 'candidatePhoto') {
                    var phIn = modal.querySelector('.apply-attach-file[data-type="photo"]');
                    ok = phIn && phIn.files && phIn.files[0];
                } else {
                    var el = modal.querySelector('.rf-field[data-rf="' + ck + '"] input, .rf-field[data-rf="' + ck + '"] select, .rf-field[data-rf="' + ck + '"] textarea');
                    ok = !el || !!String(el.value || '').trim();
                }
                if (!ok) { alert('请填写「' + lab + '」'); return; }
            }
            if (!regSchema || !regSchema.length) {
                if (!getSignatureDataUrl || !getSignatureDataUrl()) {
                    alert('请完成手写签名');
                    return;
                }
            }

            const name = gv('apply-name');
            const idNumber = gv('apply-id-number');
            const phone = gv('apply-phone');

            const basicInfo = {
                name: name,
                gender: gv('apply-gender') || null,
                birthDate: gv('apply-birth-date') || null,
                fillDate: gv('apply-fill-date') || null,
                politicalStatus: gv('apply-political-status') || null,
                hukou: gv('apply-hukou') || null,
                ethnicity: gv('apply-ethnicity') || null,
                birthPlace: gv('apply-birth-place') || null,
                workStartDate: gv('apply-work-start') || null,
                partyJoinDate: gv('apply-party-join') || null,
                healthStatus: gv('apply-health') || null,
                workUnit: gv('apply-work-unit') || null,
                currentPosition: gv('apply-current-position') || null,
                applyUnit: gv('apply-unit') || (job.companyName || null),
                appliedJobName: gv('apply-job-name') || (job.name || job.title || null),
                positionCode: gv('apply-position-code') || (job.jobCode || null),
                idNumber: idNumber,
                phone: phone,
                major: gv('apply-major') || null,
                degree: gv('apply-degree') || null,
                graduationSchool: gv('apply-graduation-school') || null,
                landline: gv('apply-landline') || null,
                specialties: gv('apply-specialties') || null,
                englishLevel: gv('apply-english-level') || null,
                mailAddress: gv('apply-mail-address') || null,
                meetsJobExperience: gv('apply-meets-exp') || null,
                techQualification: gv('apply-tech-qual') || null,
                vocationalQualification: gv('apply-vocational-qual') || null,
                resumeDetail: gv('apply-resume-detail') || null,
                email: gv('apply-email') || null
            };

            const educationInfo = {
                fulltimeEducation: (document.getElementById('apply-fulltime-education') || {}).value || null,
                fulltimeMajor: [gv('apply-major'), gv('apply-graduation-school')].filter(Boolean).join('；') || null
            };

            const resumeTimeline = [];
            const eduTextVal = (document.getElementById('apply-edu-exp-text') || {}).value || '';
            eduTextVal.split(/\r?\n/).forEach(function (line) {
                const t = line.trim();
                if (!t) return;
                resumeTimeline.push({ from: null, to: null, content: t, type: 'edu' });
            });
            const workTextVal = (document.getElementById('apply-work-exp-text') || {}).value || '';
            workTextVal.split(/\r?\n/).forEach(function (line) {
                const t = line.trim();
                if (!t) return;
                resumeTimeline.push({ from: null, to: null, content: t, type: 'work' });
            });
            var resumeDet = gv('apply-resume-detail');
            if (resumeDet) {
                resumeTimeline.push({ from: null, to: null, content: resumeDet, type: 'resumeDetail' });
            }

            const signatureImage = getSignatureDataUrl ? getSignatureDataUrl() : null;
            const signature = {
                image: signatureImage,
                signDate: (document.getElementById('apply-sign-date') || {}).value || null
            };

            function collectFamilyMembers() {
                var box = modal.querySelector('#apply-family-rows');
                if (!box) return [];
                var list = [];
                box.querySelectorAll('.apply-family-row').forEach(function (row) {
                    var relation = (row.querySelector('.af-rel') || {}).value != null ? String(row.querySelector('.af-rel').value).trim() : '';
                    var fn = (row.querySelector('.af-name') || {}).value != null ? String(row.querySelector('.af-name').value).trim() : '';
                    var birthDate = (row.querySelector('.af-birth') || {}).value != null ? String(row.querySelector('.af-birth').value).trim() : '';
                    var politicalStatus = (row.querySelector('.af-poli') || {}).value != null ? String(row.querySelector('.af-poli').value).trim() : '';
                    var workUnit = (row.querySelector('.af-work') || {}).value != null ? String(row.querySelector('.af-work').value).trim() : '';
                    if (!relation && !fn && !birthDate && !politicalStatus && !workUnit) return;
                    list.push({
                        relation: relation,
                        name: fn,
                        birthDate: birthDate,
                        politicalStatus: politicalStatus,
                        workUnit: workUnit,
                        position: ''
                    });
                });
                return list;
            }

            const form = {
                basicInfo: basicInfo,
                educationInfo: educationInfo,
                resumeTimeline: resumeTimeline,
                signature: signature,
                universityAwards: gv('apply-university-awards') || null,
                familyMembers: collectFamilyMembers()
            };

            // 同步部分信息到个人中心
            (async function syncProfileFromApplyForm() {
                try {
                    function mapGenderToBackend(g) {
                        if (g === '男') return 'male';
                        if (g === '女') return 'female';
                        if (!g) return null;
                        return 'other';
                    }
                    const payload = {
                        realName: basicInfo.name || undefined,
                        gender: mapGenderToBackend(basicInfo.gender),
                        birthDate: basicInfo.birthDate || undefined,
                        location: basicInfo.workUnit || basicInfo.birthPlace || undefined,
                        education: educationInfo.fulltimeEducation || undefined
                    };
                    const body = {};
                    Object.keys(payload).forEach(function (k) {
                        if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') {
                            body[k] = payload[k];
                        }
                    });
                    if (Object.keys(body).length === 0) return;
                    await apiRequest('/users/profile', {
                        method: 'PUT',
                        body: JSON.stringify(body)
                    });
                } catch (e) {
                    console.warn('同步个人资料失败:', e);
                }
            })();

            const attachments = {};
            const requiredKeys = fields.filter(function (f) { return f.required; }).map(function (f) { return f.key; });
            var allKeys = fields.map(function (f) { return f.key; });
            if (modal.querySelector('.apply-attach-file[data-type="photo"]') && allKeys.indexOf('photo') === -1) {
                allKeys.push('photo');
            }
            var attachVisible = !regSchema || !regSchema.length || fieldVisible(modal, 'attachmentsSection', regSchema);
            const missing = [];
            if (attachVisible) {
                requiredKeys.forEach(function (k) {
                    if (existingAttachmentKeys[k]) return;
                    const input = modal.querySelector('.apply-attach-file[data-type="' + k + '"]');
                    if (!input || !input.files || !input.files[0]) {
                        missing.push(k === 'id_card_front' ? '身份证正面' : k === 'id_card_back' ? '身份证反面' : k === 'photo' ? '寸照' : k === 'education' ? '学历证明' : k);
                    }
                });
                if (missing.length && fields.length) {
                    alert('请上传必填附件：' + missing.join('、'));
                    return;
                }
            }

            let pending = 0;
            let hasSizeError = false;

            function finishIfDone() {
                if (pending > 0 || hasSizeError) return;
                let body;
                let path;
                let method = 'POST';
                if (targetType === 'project') {
                    if (isCoopResubmit) {
                        body = { form: form };
                        if (Object.keys(attachments).length > 0) body.attachments = attachments;
                        path = '/cooperations/my-application/' + cooperationApplicationId;
                        method = 'PUT';
                    } else {
                        body = { projectId: targetId, form: form };
                        if (Object.keys(attachments).length > 0) body.attachments = attachments;
                        path = '/cooperations';
                    }
                } else {
                    body = { form: form };
                    if (Object.keys(attachments).length > 0) body.attachments = attachments;
                    path = '/jobs/' + targetId + '/apply';
                }
                (async function () {
                    try {
                        const res = await apiRequest(path, {
                            method: method,
                            body: JSON.stringify(body)
                        });
                        if (res && res.success) {
                            if ((res.message || '').indexOf('已申请过') !== -1) {
                                alert('一个岗位只能申请一次，您已申请过该岗位，无需重复提交。');
                                closeModal();
                                return;
                            }
                            if (targetType === 'job') {
                                try {
                                    const applications = JSON.parse(localStorage.getItem('jobApplications') || '[]');
                                    applications.push({
                                        jobId: job.id,
                                        jobName: job.name || job.title,
                                        companyName: job.companyName,
                                        applyDate: new Date().toISOString().split('T')[0],
                                        status: '待处理'
                                    });
                                    localStorage.setItem('jobApplications', JSON.stringify(applications));
                                } catch (e) { }
                            }
                            alert(
                                isCoopResubmit
                                    ? '修改已保存，企业可继续审核您的报名表。'
                                    : '申请已提交！您填写的报名表和上传的附件已同步到政企端候选人管理。'
                            );
                            closeModal();
                            return;
                        }
                        alert(res && res.message ? res.message : '申请失败');
                    } catch (e) {
                        const msg = (e && e.message) ? String(e.message) : '申请失败';
                        if (msg.indexOf('已申请') !== -1) alert('您已申请过该岗位');
                        else if (msg.indexOf('未登录') !== -1) alert('请先登录后再申请');
                        else alert('申请失败：' + msg);
                    }
                })();
            }

            if (!attachVisible) {
                finishIfDone();
                return;
            }
            if (!allKeys.length) {
                finishIfDone();
                return;
            }

            allKeys.forEach(function (k) {
                const input = modal.querySelector('.apply-attach-file[data-type="' + k + '"]');
                if (!input || !input.files || !input.files[0]) return;
                const file = input.files[0];
                if (file.size > APPLY_IMAGE_MAX_SIZE) {
                    alert('图片大小不能超过 2MB，请压缩后重试：' + file.name);
                    hasSizeError = true;
                    return;
                }
                pending++;
                fileToBase64(file).then(function (base64) {
                    if (base64) attachments[k] = base64;
                    pending--;
                    finishIfDone();
                }).catch(function () {
                    pending--;
                    finishIfDone();
                });
            });
            if (pending === 0 && !hasSizeError) finishIfDone();
        });
    }

    window.JobApplyForm = {
        _version: '1.5',
        openForJob: function (job, jobId) {
            if (!job || !jobId) return;
            openApplyFormModalInternal(job, 'job', jobId, null);
        },
        openForProject: function (job, projectId, opts) {
            if (!job || !projectId) return;
            openApplyFormModalInternal(job, 'project', projectId, opts || {});
        }
    };
})(window);

