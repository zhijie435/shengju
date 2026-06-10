/**
 * 求职者端公告：顶栏 branding、发布方、报名入口/打印准考证（与 /announcements/:id/navbar-branding 一致）
 */
(function (global) {
    'use strict';

    function parseExtraJson(ann) {
        if (!ann) return {};
        var ex = ann.extraJson;
        if (typeof ex === 'string') {
            try { ex = JSON.parse(ex || '{}'); } catch (e) { ex = {}; }
        }
        return ex && typeof ex === 'object' ? ex : {};
    }

    function getAnnNavBranding(ann) {
        var ex = parseExtraJson(ann);
        var fromAnn = ex.candidateNavBranding || (ann && ann.candidateNavBranding) || {};
        var fromWin = (ann && ann._navBranding) || (typeof global !== 'undefined' && global.__jobseekerAnnouncementBranding) || {};
        return Object.assign({}, fromAnn, fromWin && typeof fromWin === 'object' ? fromWin : {});
    }

    function applyAnnNavBranding(ann, branding) {
        if (!ann || !branding || typeof branding !== 'object') return ann;
        ann.extraJson = parseExtraJson(ann);
        var cur = ann.extraJson.candidateNavBranding || {};
        ann.extraJson.candidateNavBranding = Object.assign({}, cur, {
            admitCardTemplate: branding.admitCardTemplate || cur.admitCardTemplate,
            publisherLabel: (branding.publisherLabel != null ? String(branding.publisherLabel) : (cur.publisherLabel || '')).trim()
        });
        if (branding.publisherLabel != null && String(branding.publisherLabel).trim() !== '') {
            ann.publisherLabel = String(branding.publisherLabel).trim();
        }
        ann._navBranding = branding;
        return ann;
    }

    async function fetchAnnNavBranding(apiBase, annId) {
        var nid = annId != null ? String(annId).trim() : '';
        if (!nid || !/^[0-9]+$/.test(nid)) return null;
        var base = (apiBase || (typeof global !== 'undefined' && global.API_BASE_URL) || '').replace(/\/$/, '');
        if (!base) return null;
        var w = typeof global !== 'undefined' ? global.__ANNOUNCEMENT_NAV_BRANDING_PREFETCH : null;
        if (w && global.__ANNOUNCEMENT_NAV_ID != null && String(global.__ANNOUNCEMENT_NAV_ID) === nid) {
            try {
                var j0 = await w;
                if (typeof global !== 'undefined') global.__ANNOUNCEMENT_NAV_BRANDING_PREFETCH = null;
                if (j0 && j0.success && j0.data) return j0.data;
            } catch (e1) {
                if (typeof global !== 'undefined') global.__ANNOUNCEMENT_NAV_BRANDING_PREFETCH = null;
            }
        }
        try {
            var res = await fetch(base + '/announcements/' + encodeURIComponent(nid) + '/navbar-branding');
            if (!res.ok) return null;
            var j = await res.json();
            if (j && j.success && j.data) return j.data;
        } catch (e2) {}
        return null;
    }

    function isInterviewStyleAnnouncement(ann) {
        if (!ann) return false;
        var ex = parseExtraJson(ann);
        var bn = getAnnNavBranding(ann);
        if (bn.admitCardTemplate === 'interview_official') return true;
        if (ex.registrationEntryMode === 'print_admit_card') return true;
        var url = (ann.registrationUrl || ex.registrationUrl || '').trim();
        if (/profile\.html/i.test(url)) return true;
        return /#messages|messages/i.test(url);
    }

    function buildProfileMessagesUrl(ann) {
        var aid = ann && ann.id != null ? String(ann.id) : '';
        if (/^[0-9]+$/.test(aid)) {
            return 'profile.html?announcementId=' + encodeURIComponent(aid) + '#messages';
        }
        return 'profile.html#messages';
    }

    function resolveRegistrationUrl(ann) {
        if (isInterviewStyleAnnouncement(ann)) {
            var url = (ann.registrationUrl || parseExtraJson(ann).registrationUrl || '').trim();
            if (!url || url === 'assessment.html' || !/profile\.html/i.test(url)) {
                return buildProfileMessagesUrl(ann);
            }
            return url;
        }
        var url2 = (ann.registrationUrl || '').trim();
        return url2 || 'assessment.html';
    }

    function getRegistrationEntryUi(ann, signupClosed) {
        if (isInterviewStyleAnnouncement(ann)) {
            return {
                title: '打印准考证',
                closedText: '本公告已截止，暂无法打印准考证。',
                hint: '请使用求职者账号登录（与考务导入名单一致），登录后在个人端「消息」中查看并打印面试通知书。',
                btn: '打印准考证',
                icon: 'fa-print'
            };
        }
        return {
            title: '报名入口',
            closedText: '本公告报名已截止，不再开放报名入口。',
            hint: '参与报名请先登录求职者账号（与招聘平台账号一致）。',
            btn: '进入报名系统',
            icon: 'fa-external-link'
        };
    }

    function displayPublisherLabel(ann) {
        var custom = '';
        if (ann) {
            custom = (ann.publisherLabel || '').trim();
            if (!custom) {
                var bn = getAnnNavBranding(ann);
                custom = (bn.publisherLabel || '').trim();
            }
        }
        if (custom) return custom;
        var generic = ['企业端', '管理者端', '政企端', ''];
        var s = (ann && ann.source || '').trim();
        var c = (ann && ann.companyName || '').trim();
        if (c && generic.indexOf(s) >= 0) return c;
        if (s) return s;
        return c || '官方';
    }

    global.AnnouncementBranding = {
        parseExtraJson: parseExtraJson,
        getAnnNavBranding: getAnnNavBranding,
        applyAnnNavBranding: applyAnnNavBranding,
        fetchAnnNavBranding: fetchAnnNavBranding,
        isInterviewStyleAnnouncement: isInterviewStyleAnnouncement,
        buildProfileMessagesUrl: buildProfileMessagesUrl,
        resolveRegistrationUrl: resolveRegistrationUrl,
        getRegistrationEntryUi: getRegistrationEntryUi,
        displayPublisherLabel: displayPublisherLabel
    };
})(typeof window !== 'undefined' ? window : global);
