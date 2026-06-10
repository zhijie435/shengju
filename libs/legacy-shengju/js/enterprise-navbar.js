/**
 * 政企端导航栏 Logo 统一：
 * - 从 /api/v1/public/site-settings（回退 /admin/settings/public）读取 siteLogo / siteName
 * - 应用到所有带 data-site-logo 的 <img>
 */
(function() {
    'use strict';

    function getApiBase() {
        if (typeof window !== 'undefined' && window.API_BASE_URL) return window.API_BASE_URL;
        try {
            var u = localStorage.getItem('apiBaseUrl');
            if (u) return u.replace(/\/$/, '');
        } catch (e) {}
        return (window.API_BASE_URL || (window.location.origin.replace(/\/+$/, '') + '/api/v1'));
    }

    async function ensureSystemSettingsLoaded() {
        var sys = {};
        try {
            sys = JSON.parse(localStorage.getItem('systemSettings') || '{}') || {};
        } catch (e) { sys = {}; }
        var hasLogo = !!(localStorage.getItem('siteLogo') || sys.siteLogo);
        var hasName = !!(localStorage.getItem('siteName') || sys.siteName);
        if (hasLogo && hasName) return;

        try {
            var base = getApiBase().replace(/\/$/, '');
            var urls = [base + '/public/site-settings', base + '/admin/settings/public'];
            var json = null;
            for (var i = 0; i < urls.length; i++) {
                try {
                    var res = await fetch(urls[i]);
                    if (!res.ok) continue;
                    var j = await res.json();
                    if (j && j.success && j.data) { json = j; break; }
                } catch (e) {}
            }
            if (!json) return;
            var d = json.data;
            if (d.siteName != null) {
                localStorage.setItem('siteName', typeof d.siteName === 'string' ? d.siteName : JSON.stringify(d.siteName));
                sys.siteName = d.siteName;
            }
            if (d.siteLogo != null) {
                localStorage.setItem('siteLogo', typeof d.siteLogo === 'string' ? d.siteLogo : JSON.stringify(d.siteLogo));
                sys.siteLogo = d.siteLogo;
            }
            if (d.contactInfo != null) {
                localStorage.setItem('contactInfo', JSON.stringify(typeof d.contactInfo === 'object' ? d.contactInfo : {}));
                sys.contactInfo = d.contactInfo;
            }
            localStorage.setItem('systemSettings', JSON.stringify(sys));
        } catch (e) {
            // 忽略，使用本地缓存或默认值
        }
    }

    function applyEnterpriseLogo() {
        var sys = {};
        try {
            sys = JSON.parse(localStorage.getItem('systemSettings') || '{}') || {};
        } catch (e) { sys = {}; }
        var defaultLogo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%231E40AF' rx='4'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='bold' fill='white'%3E圣%3C/text%3E%3C/svg%3E";
        var siteLogo = localStorage.getItem('siteLogo') || sys.siteLogo || defaultLogo;
        var siteName = localStorage.getItem('siteName') || sys.siteName || '圣举人才网';

        var logoImgs = document.querySelectorAll('img[data-site-logo]');
        logoImgs.forEach(function(img) {
            img.src = siteLogo;
            if (!img.alt || img.alt.indexOf('圣举') !== -1) {
                img.alt = siteName;
            }
        });

        var headerTitle = document.querySelector('header h1');
        if (headerTitle && (!headerTitle.dataset.fixedTitle)) {
            headerTitle.textContent = siteName;
        }
    }

    function currentPageFile() {
        var pathname = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
        var f = (pathname.split('/').pop() || '').split('?')[0].split('#')[0] || '';
        return f;
    }

    /** 企业端页面：若当前 token 为求职者门户签发，强制退出并去政企登录 */
    async function guardEnterprisePortal() {
        try {
            if (currentPageFile() === 'login.html') return;
            if (typeof AuthHelper === 'undefined' || !AuthHelper.getEnterpriseApiToken) return;
            var tok = AuthHelper.getEnterpriseApiToken();
            if (!tok) return;
            var base = getApiBase().replace(/\/$/, '');
            var res = await fetch(base + '/auth/whoami', { headers: { Authorization: 'Bearer ' + tok } });
            if (res.status === 401) {
                AuthHelper.clear('enterprise');
                window.location.href = 'login.html';
                return;
            }
            var j = await res.json().catch(function() { return null; });
            var lp = j && j.data && j.data.loginPortal;
            if (lp === 'jobseeker') {
                AuthHelper.clear('enterprise');
                localStorage.removeItem('authToken');
                sessionStorage.removeItem('authToken');
                window.location.href = 'login.html?reason=wrong_portal';
            }
        } catch (e) {}
    }

    function onReady() {
        guardEnterprisePortal();
        ensureSystemSettingsLoaded().then(function() {
            applyEnterpriseLogo();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }

    window.applyEnterpriseLogo = applyEnterpriseLogo;
})();

