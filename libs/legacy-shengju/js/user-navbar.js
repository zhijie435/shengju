/**
 * 求职者端导航栏统一：
 * - 左上角品牌区：仅 img[data-site-brand-logo] 与 header 内主标题 h1（.text-primary.font-bold）
 * - 勿在头像上使用 data-site-brand-logo，否则会被站点 Logo 覆盖导致顶栏错乱
 * - 全站默认：/public/site-settings 的 siteLogo、siteName
 * - 公告详情页等：若有 window.__ANNOUNCEMENT_NAV_ID 或 URL ?id=，GET /announcements/:id/navbar-branding（公开）拉取该企业配置的 candidateNavBranding，未登录也可显示
 * - 其他已登录求职者：GET /users/announcement-navbar-branding（基于最近一次带公告的报名记录）；纯岗位推荐报名不受影响
 */
(function() {
    'use strict';

    function getJobseekerUsername() {
        try {
            if (typeof AuthHelper !== 'undefined' && AuthHelper.get) {
                var o = AuthHelper.get('jobseeker');
                if (o && o.username) return o.username;
            }
            return localStorage.getItem('username_jobseeker') || localStorage.getItem('username') || '';
        } catch (e) { return ''; }
    }

    function getApiBase() {
        if (typeof window !== 'undefined' && window.API_BASE_URL) return window.API_BASE_URL;
        try {
            var u = localStorage.getItem('apiBaseUrl');
            if (u) return u.replace(/\/$/, '');
        } catch (e) {}
        return (window.API_BASE_URL || (window.location.origin.replace(/\/+$/, '') + '/api/v1'));
    }

    function getJobseekerToken() {
        try {
            if (typeof AuthHelper !== 'undefined' && AuthHelper.get) {
                var o = AuthHelper.get('jobseeker');
                if (o && o.token) return o.token;
            }
        } catch (e) {}
        return localStorage.getItem('authToken_jobseeker') || sessionStorage.getItem('authToken_jobseeker')
            || localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || null;
    }

    function updateNavbarUser() {
        var name = getJobseekerUsername() || '求职者';
        var displayName = name.trim() || '求职者';
        var nameEl = document.getElementById('user-name-display');
        if (nameEl) nameEl.textContent = displayName;
    }

    var DEFAULT_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%231E40AF' rx='4'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='bold' fill='white'%3E圣%3C/text%3E%3C/svg%3E";

    async function fetchPublicSiteDefaults() {
        var logoUrl = DEFAULT_LOGO;
        var siteName = '圣举人才网';
        try {
            var base = getApiBase().replace(/\/$/, '');
            var urls = [base + '/public/site-settings', base + '/admin/settings/public'];
            var json = null;
            for (var u = 0; u < urls.length; u++) {
                try {
                    var res = await fetch(urls[u]);
                    if (!res.ok) continue;
                    var j = await res.json();
                    if (j && j.success && j.data) { json = j; break; }
                } catch (e) {}
            }
            if (json && json.data) {
                var d = json.data;
                if (d.siteLogo) {
                    if (typeof d.siteLogo === 'string') logoUrl = d.siteLogo;
                    else if (d.siteLogo.url) logoUrl = d.siteLogo.url;
                }
                if (d.siteName != null && String(d.siteName).trim() !== '') {
                    siteName = String(d.siteName).trim();
                }
            }
        } catch (e) {}
        return { logoUrl: logoUrl, siteName: siteName };
    }

    function getAnnouncementNavIdFromPage() {
        try {
            if (typeof window !== 'undefined' && window.__ANNOUNCEMENT_NAV_ID != null && String(window.__ANNOUNCEMENT_NAV_ID).trim() !== '') {
                return String(window.__ANNOUNCEMENT_NAV_ID).trim();
            }
            try {
                var qAnn = new URLSearchParams(window.location.search || '');
                var qId = qAnn.get('announcementId') || qAnn.get('announcement');
                if (qId != null && /^[0-9]+$/.test(String(qId).trim())) {
                    return String(qId).trim();
                }
            } catch (eQ) {}
            try {
                var stored = sessionStorage.getItem('jobseeker_announcement_id');
                if (stored && /^[0-9]+$/.test(String(stored).trim())) {
                    return String(stored).trim();
                }
            } catch (eS) {}
            var path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
            var file = (path.split('/').pop() || '').split('?')[0].split('#')[0] || '';
            if (file !== 'announcement-detail.html') return null;
            var q = new URLSearchParams(typeof window !== 'undefined' && window.location.search ? window.location.search : '');
            var id = q.get('id');
            return id != null && String(id).trim() !== '' ? String(id).trim() : null;
        } catch (e) {
            return null;
        }
    }

    async function fetchPublicAnnouncementNavbarBranding(announcementId) {
        if (!announcementId || !/^[0-9]+$/.test(String(announcementId))) return null;
        try {
            var base = getApiBase().replace(/\/$/, '');
            var w = typeof window !== 'undefined' ? window : null;
            var pf = w && w.__ANNOUNCEMENT_NAV_BRANDING_PREFETCH;
            if (pf && w.__ANNOUNCEMENT_NAV_ID != null && String(w.__ANNOUNCEMENT_NAV_ID) === String(announcementId)) {
                try {
                    var j0 = await pf;
                    w.__ANNOUNCEMENT_NAV_BRANDING_PREFETCH = null;
                    if (j0 && j0.success) return j0.data || null;
                } catch (e1) {
                    w.__ANNOUNCEMENT_NAV_BRANDING_PREFETCH = null;
                }
            }
            var res = await fetch(base + '/announcements/' + encodeURIComponent(announcementId) + '/navbar-branding');
            if (!res.ok) return null;
            var j = await res.json();
            if (j && j.success && j.data) return j.data;
        } catch (e) {}
        return null;
    }

    async function fetchAnnouncementNavbarBranding() {
        var token = getJobseekerToken();
        if (!token) return null;
        try {
            var base = getApiBase().replace(/\/$/, '');
            var annQ = getAnnouncementNavIdFromPage();
            var url = base + '/users/announcement-navbar-branding';
            if (annQ) url += '?announcementId=' + encodeURIComponent(annQ);
            var res = await fetch(url, {
                headers: { Authorization: 'Bearer ' + token }
            });
            if (!res.ok) return null;
            var j = await res.json();
            if (j && j.success && j.data) return j.data;
        } catch (e) {}
        return null;
    }

    /** 公告配置的导航项显隐与顶栏用户名/头像（仅对已返回的 data 生效） */
    function applyAnnouncementNavOverrides(ann) {
        var header = document.querySelector('header');
        if (!header) return;
        var hrefToKey = {
            'index.html': 'index',
            'assessment.html': 'assessment',
            'recommendation.html': 'recommendation',
            'announcements.html': 'announcements',
            'talent-pool.html': 'talentPool',
            'payment.html': 'payment',
            'profile.html': 'profile'
        };
        if (ann && ann.navItems && typeof ann.navItems === 'object') {
            header.querySelectorAll('nav a[href*=".html"], #mobile-menu a[href*=".html"]').forEach(function(a) {
                var href = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
                var file = href.replace(/^.*\//, '') || '';
                var key = hrefToKey[file];
                if (!key) return;
                if (ann.navItems[key] === false) {
                    a.classList.add('hidden');
                    a.setAttribute('aria-hidden', 'true');
                } else {
                    a.classList.remove('hidden');
                    a.removeAttribute('aria-hidden');
                }
            });
        }
        if (ann && ann.navUserName) {
            var nameEl = document.getElementById('user-name-display');
            if (nameEl) nameEl.textContent = String(ann.navUserName);
        }
        if (ann && ann.navUserAvatar) {
            var av = document.getElementById('user-avatar-img');
            if (av) av.src = ann.navUserAvatar;
        }
    }

    /** 页脚：整体显隐 + 各栏（与常见求职者页 footer 四列网格顺序一致） */
    function applyAnnouncementFooterOverrides(ann) {
        var footer = document.querySelector('body > footer');
        if (!footer || !ann) return;
        if (ann.showFooter === false) {
            footer.classList.add('hidden');
            return;
        }
        footer.classList.remove('hidden');
        if (!ann.footerItems || typeof ann.footerItems !== 'object') return;
        var grid = footer.querySelector('.container .grid');
        if (!grid) return;
        var keys = ['about', 'jobseeker', 'help', 'contact'];
        var children = grid.children;
        for (var i = 0; i < keys.length && i < children.length; i++) {
            if (ann.footerItems[keys[i]] === false) {
                children[i].classList.add('hidden');
            } else {
                children[i].classList.remove('hidden');
            }
        }
        var copyRow = footer.querySelector('.border-t');
        if (copyRow) {
            if (ann.footerItems.copyright === false) {
                copyRow.classList.add('hidden');
            } else {
                copyRow.classList.remove('hidden');
            }
        }
    }

    /** 品牌区 + 公告导航覆盖（不含 setActiveNav） */
    async function loadHeaderBrand() {
        var brandHold = document.querySelector('header [data-brand-hold]');
        if (brandHold) {
            brandHold.classList.add('opacity-0');
            brandHold.setAttribute('aria-busy', 'true');
        }
        try {
            var brandImgs = document.querySelectorAll('img[data-site-brand-logo]');
            var titleEl = document.querySelector('header h1.font-bold.text-primary');
            var defaults = await fetchPublicSiteDefaults();
            var annId = getAnnouncementNavIdFromPage();
            var ann = annId ? await fetchPublicAnnouncementNavbarBranding(annId) : null;
            if (!ann) {
                ann = await fetchAnnouncementNavbarBranding();
            }

            if (brandImgs.length || titleEl) {
                var logoUrl = (ann && ann.logo) ? ann.logo : defaults.logoUrl;
                var titleText = (ann && ann.title) ? ann.title : defaults.siteName;
                brandImgs.forEach(function(img) {
                    img.src = logoUrl;
                    if (!img.alt) img.alt = '网站Logo';
                });
                if (titleEl && titleText) {
                    titleEl.textContent = titleText;
                }
            }
            applyAnnouncementNavOverrides(ann);
            applyAnnouncementFooterOverrides(ann);
            if (ann && ann.announcementId != null && /^[0-9]+$/.test(String(ann.announcementId))) {
                try {
                    sessionStorage.setItem('jobseeker_announcement_id', String(ann.announcementId));
                } catch (eSt) {}
            }
            window.__jobseekerAnnouncementBranding = ann || null;
            try {
                window.dispatchEvent(new CustomEvent('jobseekerNavBrandingReady', { detail: ann || null }));
            } catch (eEv) {}
        } finally {
            if (brandHold) {
                brandHold.classList.remove('opacity-0');
                brandHold.removeAttribute('aria-busy');
            }
        }
    }

    /** @deprecated 使用 loadHeaderBrand；保留别名避免旧代码报错 */
    async function loadSiteLogo() {
        return loadHeaderBrand();
    }

    /** 求职者端导航：「个人中心」统一显示为「个人端」 */
    function applyProfileNavLabel() {
        var header = document.querySelector('header');
        if (!header) return;
        header.querySelectorAll('a[href*="profile.html"]').forEach(function (a) {
            var t = (a.textContent || '').trim();
            if (t === '个人中心') a.textContent = '个人端';
        });
    }

    /** 根据当前页面高亮对应导航项（下划线/左边框） */
    function setActiveNav() {
        var pathname = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
        var currentFile = pathname.split('/').pop() || 'index.html';
        currentFile = currentFile.split('?')[0].split('#')[0] || 'index.html';
        var activePage = currentFile;
        if (currentFile === 'system-assessment.html' || currentFile === 'assessment-detail.html' || currentFile === 'professional-assessment-detail.html') {
            activePage = 'assessment.html';
        }
        if (currentFile === 'announcement-detail.html') {
            activePage = 'announcements.html';
        }
        var header = document.querySelector('header');
        if (!header) return;
        var navLinks = header.querySelectorAll('nav a[href*=".html"], #mobile-menu a[href*=".html"]');
        var desktopActive = 'text-primary font-medium border-b-2 border-primary';
        var desktopInactive = 'text-gray-700 hover:text-primary font-medium border-b-2 border-transparent';
        var mobileActive = 'block py-2 text-primary font-medium border-l-4 border-primary pl-2';
        var mobileInactive = 'block py-2 text-gray-700 hover:text-primary pl-2';
        navLinks.forEach(function(a) {
            var href = a.getAttribute('href') || '';
            var linkPage = href.split('?')[0].split('#')[0].replace(/^.*\//, '') || 'index.html';
            var isMobile = !!a.closest('#mobile-menu');
            var isActive = (linkPage === activePage);
            a.classList.remove('text-primary', 'font-medium', 'border-b-2', 'border-primary', 'border-transparent', 'border-l-4', 'text-gray-700', 'hover:text-primary', 'pl-2', 'block', 'py-2');
            if (isMobile) {
                a.classList.add('block', 'py-2', 'pl-2');
                if (isActive) {
                    a.classList.add('text-primary', 'font-medium', 'border-l-4', 'border-primary');
                } else {
                    a.classList.add('text-gray-700', 'hover:text-primary');
                }
            } else {
                a.classList.add('font-medium', 'border-b-2');
                if (isActive) {
                    a.classList.add('text-primary', 'border-primary');
                } else {
                    a.classList.add('text-gray-700', 'hover:text-primary', 'border-transparent');
                }
            }
        });
    }

    async function guardJobseekerPortal() {
        try {
            var pathname = (window.location && window.location.pathname) ? window.location.pathname : '';
            var f = (pathname.split('/').pop() || '').split('?')[0].split('#')[0] || '';
            if (f === 'login.html' || f === 'register.html') return;
            if (typeof AuthHelper === 'undefined' || !AuthHelper.get) return;
            var sess = AuthHelper.get('jobseeker');
            if (!sess || !sess.token) return;
            var base = getApiBase().replace(/\/$/, '');
            var res = await fetch(base + '/auth/whoami', { headers: { Authorization: 'Bearer ' + sess.token } });
            if (res.status === 401) {
                AuthHelper.clear('jobseeker');
                return;
            }
            var j = await res.json().catch(function() { return null; });
            var lp = j && j.data && j.data.loginPortal;
            if (lp === 'enterprise' || lp === 'grader') {
                AuthHelper.clear('jobseeker');
                localStorage.removeItem('authToken');
                sessionStorage.removeItem('authToken');
                window.location.href = '../enterprise/login.html?reason=wrong_portal';
            }
        } catch (e) {}
    }

    function onReady() {
        guardJobseekerPortal().finally(function() {
            updateNavbarUser();
            loadHeaderBrand().finally(function() {
                applyProfileNavLabel();
                setActiveNav();
            });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
    window.updateUserNavbar = updateNavbarUser;
    window.loadSiteLogo = loadSiteLogo;
    window.loadHeaderBrand = loadHeaderBrand;
})();
