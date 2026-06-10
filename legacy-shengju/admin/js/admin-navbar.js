/**
 * 管理端导航栏统一逻辑：通知栏、头像、用户菜单、退出登录
 * 与 index.html 行为一致，各子页面引入此脚本即可同步
 * 使用 safeStorage 避免浏览器「防止跟踪」拦截 storage 时抛错导致页面白屏
 */
(function() {
    'use strict';
    const API_BASE = window.API_BASE_URL || 'http://127.0.0.1:3001/api/v1';

    // 安全访问 storage：被防止跟踪拦截时不抛错，回退到内存对象
    var _mem = {};
    function safeStorageGet(key, store) {
        try {
            if (store === 'session') return sessionStorage.getItem(key);
            return localStorage.getItem(key);
        } catch (e) { return store === 'session' ? null : (_mem[key] !== undefined ? _mem[key] : null); }
    }
    function safeStorageSet(key, value, store) {
        try {
            if (store === 'session') { sessionStorage.setItem(key, value); return; }
            localStorage.setItem(key, value);
        } catch (e) { if (store !== 'session') _mem[key] = value; }
    }
    function safeStorageRemove(key) {
        try {
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
        } catch (e) {}
        delete _mem[key];
    }

    function getToken() {
        var t = safeStorageGet('authToken', 'session') || safeStorageGet('authToken');
        return t || '';
    }

    if (typeof window.showNotification !== 'function') {
        window.showNotification = function(message, type) {
            type = type || 'info';
            var el = document.createElement('div');
            el.className = 'fixed top-4 right-4 px-4 py-3 rounded-md shadow-lg z-[100] ' +
                (type === 'success' ? 'bg-green-500 text-white' : type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white');
            el.innerHTML = '<i class="fa fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle') + ' mr-2"></i>' + message;
            document.body.appendChild(el);
            setTimeout(function() { el.remove(); }, 3000);
        };
    }

    async function loadAdminNotificationsForBell() {
        var countEl = document.getElementById('notification-count');
        var listEl = document.getElementById('notification-list');
        var token = getToken();
        if (!countEl || !listEl || !token) return;
        try {
            var res = await fetch(API_BASE + '/admin/notifications?limit=10', { headers: { 'Authorization': 'Bearer ' + token } });
            var data = await res.json();
            if (!data || !data.success || !data.data) return;
            var items = Array.isArray(data.data.items) ? data.data.items : [];
            var unreadCount = typeof data.data.unreadCount === 'number' ? data.data.unreadCount : 0;
            if (unreadCount > 0) {
                countEl.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
                countEl.classList.remove('hidden');
            } else {
                countEl.textContent = '0';
                countEl.classList.add('hidden');
            }
            if (!items.length) {
                listEl.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500">当前暂无新的通知。</div>';
                return;
            }
            listEl.innerHTML = items.map(function(item) {
                var typeText = item.type === 'membership_purchase' ? '会员购买' : '系统通知';
                var roleText = item.sourceRole === 'enterprise' ? '企业' : item.sourceRole === 'jobseeker' ? '求职者' : '系统';
                var timeText = item.createdAt ? (item.createdAt.replace('T', ' ').slice(0, 19)) : '';
                return '<div class="block px-4 py-3 hover:bg-gray-50 border-b border-gray-100">' +
                    '<div class="flex items-start"><div class="flex-shrink-0"><i class="fa fa-bell text-blue-500"></i></div>' +
                    '<div class="ml-3 flex-1">' +
                    '<p class="text-sm font-medium text-gray-900">' + (item.title || (roleText + typeText)) + '</p>' +
                    '<p class="text-xs text-gray-500 mt-1">' + (item.content || '') + '</p>' +
                    '<p class="text-xs text-gray-400 mt-1">' + timeText + '</p></div></div></div>';
            }).join('');
        } catch (e) { console.warn('加载管理员通知失败', e); }
    }

    function loadAdminInfoToMenu() {
        var settings = {};
        var adminInfo = {};
        try {
            settings = JSON.parse(safeStorageGet('systemSettings') || '{}');
            adminInfo = JSON.parse(safeStorageGet('adminInfo') || '{}');
        } catch (e) {}
        var userNameEl = document.getElementById('user-menu-name');
        var userEmailEl = document.getElementById('user-menu-email');
        var avatarImg = document.getElementById('user-avatar-img');
        var username = settings.adminUsername || adminInfo.username || '管理员';
        var email = settings.adminEmail || adminInfo.email || 'admin@shengju.com';
        if (userNameEl) userNameEl.textContent = username;
        if (userEmailEl) userEmailEl.textContent = email;
        if (avatarImg) {
            avatarImg.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(username) + '&background=1E40AF&color=fff';
            avatarImg.alt = username + '头像';
        }
    }
    window.loadAdminInfoToMenu = loadAdminInfoToMenu;

    var userMenuInitialized = false;
    function initUserMenu() {
        if (userMenuInitialized) return;
        userMenuInitialized = true;
        var userMenuButton = document.getElementById('user-menu-button');
        var userMenu = document.getElementById('user-menu');
        if (userMenuButton && userMenu) {
            userMenuButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                userMenu.classList.toggle('hidden');
            });
        }
        var notificationButton = document.getElementById('notification-button');
        var notificationMenu = document.getElementById('notification-menu');
        if (notificationButton && notificationMenu) {
            notificationButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                notificationMenu.classList.toggle('hidden');
            });
        }
        if (!window._adminNavbarClickHandler) {
            window._adminNavbarClickHandler = function(event) {
                var userMenuBtn = document.getElementById('user-menu-button');
                var userMenuEl = document.getElementById('user-menu');
                var notificationBtn = document.getElementById('notification-button');
                var notificationMenuEl = document.getElementById('notification-menu');
                if (userMenuBtn && userMenuEl && !userMenuBtn.contains(event.target) && !userMenuEl.contains(event.target)) userMenuEl.classList.add('hidden');
                if (notificationBtn && notificationMenuEl && !notificationBtn.contains(event.target) && !notificationMenuEl.contains(event.target)) notificationMenuEl.classList.add('hidden');
            };
            document.addEventListener('click', window._adminNavbarClickHandler);
        }
    }

    window.logout = function() {
        if (confirm('确定要退出登录吗？')) {
            safeStorageRemove('authToken');
            safeStorageRemove('username');
            safeStorageRemove('userType');
            safeStorageRemove('loginMethod');
            safeStorageRemove('adminLoginStatus');
            try { localStorage.removeItem('authToken'); sessionStorage.removeItem('authToken'); localStorage.removeItem('username'); localStorage.removeItem('userType'); localStorage.removeItem('loginMethod'); localStorage.removeItem('adminLoginStatus'); } catch (e) {}
            window.location.href = 'index.html';
        }
    };

    async function loadAllNotifications(filter) {
        filter = filter || 'all';
        var listContainer = document.getElementById('all-notifications-list');
        var totalCountEl = document.getElementById('notification-total-count');
        if (!listContainer) return;
        var token = getToken();
        var verificationItems = [];
        if (token) {
            try {
                var res = await fetch(API_BASE + '/admin/verifications', { headers: { 'Authorization': 'Bearer ' + token } });
                var data = await res.json();
                if (data && data.success && Array.isArray(data.data)) {
                    verificationItems = data.data.map(function(v) {
                        return {
                            id: 'verification_' + v.id,
                            type: 'verification',
                            companyId: v.id,
                            companyName: v.companyName,
                            title: '企业认证待审核',
                            content: (v.companyName || '企业') + ' 提交了认证材料，请审核。',
                            time: v.verificationSubmittedAt ? new Date(v.verificationSubmittedAt).toLocaleString('zh-CN') : '待审核',
                            read: false,
                            icon: 'id-card',
                            color: 'amber'
                        };
                    });
                }
            } catch (e) {}
        }
        var systemNotifications = [
            { id: 1, type: 'system', title: '系统更新通知', content: '系统已更新至最新版本，请查看更新日志了解详情。', time: '2小时前', read: false, icon: 'info-circle', color: 'blue' },
            { id: 2, type: 'security', title: '安全提醒', content: '检测到异常登录尝试，请检查账户安全。', time: '5小时前', read: false, icon: 'exclamation-triangle', color: 'yellow' },
            { id: 3, type: 'backup', title: '数据备份完成', content: '系统数据备份已成功完成。', time: '1天前', read: true, icon: 'check-circle', color: 'green' }
        ];
        var allNotifications = verificationItems.concat(systemNotifications);
        var filtered = filter === 'all' ? allNotifications : allNotifications.filter(function(n) { return n.type === filter; });
        if (totalCountEl) totalCountEl.textContent = filtered.length;
        if (filtered.length === 0) {
            listContainer.innerHTML = '<div class="text-center py-12"><i class="fa fa-bell-slash text-4xl text-gray-300 mb-4"></i><p class="text-gray-500">暂无通知</p></div>';
            return;
        }
        listContainer.innerHTML = filtered.map(function(n) {
            if (n.type === 'verification') {
                return '<div class="border border-gray-200 rounded-lg p-4 mb-4 hover:bg-gray-50 transition">' +
                    '<div class="flex items-start"><div class="flex-shrink-0"><i class="fa fa-' + n.icon + ' text-' + n.color + '-500 text-xl"></i></div>' +
                    '<div class="ml-4 flex-1"><div class="flex items-start justify-between"><div class="flex-1">' +
                    '<h4 class="text-sm font-medium text-gray-900">' + n.title + '</h4><p class="text-sm text-gray-600 mt-1">' + n.content + '</p><p class="text-xs text-gray-400 mt-2">' + n.time + '</p></div>' +
                    '<div class="ml-4 flex items-center gap-2">' +
                    '<button type="button" class="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 admin-verify-approve" data-id="' + n.companyId + '">通过</button>' +
                    '<button type="button" class="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 admin-verify-reject" data-id="' + n.companyId + '">拒绝</button>' +
                    '</div></div></div></div></div>';
            }
            return '<div class="border border-gray-200 rounded-lg p-4 mb-4 hover:bg-gray-50 transition ' + (n.read ? 'opacity-60' : '') + '">' +
                '<div class="flex items-start"><div class="flex-shrink-0"><i class="fa fa-' + n.icon + ' text-' + n.color + '-500 text-xl"></i></div>' +
                '<div class="ml-4 flex-1"><h4 class="text-sm font-medium text-gray-900">' + n.title + '</h4>' +
                '<p class="text-sm text-gray-600 mt-1">' + n.content + '</p><p class="text-xs text-gray-400 mt-2">' + n.time + '</p></div></div></div>';
        }).join('');
        listContainer.querySelectorAll('.admin-verify-approve').forEach(function(btn) {
            btn.addEventListener('click', function() { window.approveVerification(parseInt(btn.dataset.id, 10)); });
        });
        listContainer.querySelectorAll('.admin-verify-reject').forEach(function(btn) {
            btn.addEventListener('click', function() { window.rejectVerification(parseInt(btn.dataset.id, 10)); });
        });
    }

    window.showAllNotifications = function() {
        var notificationMenu = document.getElementById('notification-menu');
        if (notificationMenu) notificationMenu.classList.add('hidden');
        var modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = '<div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">' +
            '<div class="flex justify-between items-center px-6 py-4 border-b border-gray-200">' +
            '<h3 class="text-lg font-medium text-gray-900">所有通知</h3>' +
            '<div class="flex items-center gap-4">' +
            '<select id="notification-filter" class="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary">' +
            '<option value="all">全部通知</option><option value="verification">企业认证待审核</option><option value="system">系统通知</option></select>' +
            '<button type="button" class="text-gray-400 hover:text-gray-500 admin-navbar-close-modal"><i class="fa fa-times text-xl"></i></button></div></div>' +
            '<div class="p-6 overflow-y-auto max-h-[calc(90vh-180px)]" id="all-notifications-list"></div>' +
            '<div class="flex justify-between items-center px-6 py-4 bg-gray-50 border-t border-gray-200">' +
            '<div class="text-sm text-gray-500">共 <span id="notification-total-count">0</span> 条通知</div></div></div>';
        document.body.appendChild(modal);
        document.getElementById('notification-filter').addEventListener('change', function() { loadAllNotifications(this.value); });
        modal.querySelector('.admin-navbar-close-modal').addEventListener('click', function() { modal.remove(); });
        modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
        loadAllNotifications('all');
    };

    window.approveVerification = async function(companyId) {
        var token = getToken();
        if (!token) { alert('请先登录'); return; }
        try {
            var res = await fetch(API_BASE + '/admin/verifications/' + companyId + '/approve', { method: 'PUT', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } });
            var data = await res.json();
            if (data && data.success) { window.showNotification('审核通过', 'success'); loadAdminNotificationsForBell(); var f = document.getElementById('notification-filter'); if (f) loadAllNotifications(f.value); } else { window.showNotification(data && data.message ? data.message : '操作失败', 'error'); }
        } catch (e) { window.showNotification('操作失败', 'error'); }
    };
    window.rejectVerification = async function(companyId) {
        var reason = prompt('请输入拒绝原因（可选）：');
        var token = getToken();
        if (!token) { alert('请先登录'); return; }
        try {
            var res = await fetch(API_BASE + '/admin/verifications/' + companyId + '/reject', { method: 'PUT', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ verificationReason: reason || '' }) });
            var data = await res.json();
            if (data && data.success) { window.showNotification('已拒绝', 'success'); loadAdminNotificationsForBell(); var f = document.getElementById('notification-filter'); if (f) loadAllNotifications(f.value); } else { window.showNotification(data && data.message ? data.message : '操作失败', 'error'); }
        } catch (e) { window.showNotification('操作失败', 'error'); }
    };

    function onDomReady() {
        if (document.getElementById('user-menu-button') || document.getElementById('notification-button')) {
            initUserMenu();
            loadAdminInfoToMenu();
            loadAdminNotificationsForBell();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onDomReady);
    } else {
        onDomReady();
    }
})();
