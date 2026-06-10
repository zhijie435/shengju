// 管理员功能
let currentTab = 'users';

// 检查登录状态
if (!window.auth.isAuthenticated()) {
    window.location.href = '/src/index.html';
}

// 检查管理员权限
async function checkAdmin() {
    const user = window.auth.getUser();
    if (!user || user.role !== 'admin') {
        alert('您没有管理员权限');
        window.location.href = '/src/app.html';
        return false;
    }
    return true;
}

// 显示用户信息
function displayUserInfo() {
    const user = window.auth.getUser();
    if (user) {
        document.getElementById('userInfo').textContent = `欢迎，${user.real_name || user.username}`;
    }
}

// 切换标签页
function switchTab(tab) {
    currentTab = tab;
    
    // 更新标签样式
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        const tabTexts = {
            'users': '用户管理',
            'reviews': '题库审核',
            'enterprises': '企业管理',
            'exams': '考试管理'
        };
        if (t.textContent.includes(tabTexts[tab] || '')) {
            t.classList.add('active');
        }
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const tabElement = document.getElementById(`${tab}-tab`);
    if (tabElement) {
        tabElement.classList.add('active');
    }
    
    // 加载对应数据
    if (tab === 'users') {
        loadUsers();
    } else if (tab === 'reviews') {
        loadPendingQuestions();
    } else if (tab === 'enterprises') {
        loadEnterprises();
    } else if (tab === 'exams') {
        // 考试管理标签页已通过iframe加载，无需额外操作
    }
}

// 加载用户列表
async function loadUsers() {
    try {
        const result = await window.api.get('/api/users');
        if (result.success) {
            displayUsers(result.users);
        } else {
            alert('加载用户列表失败：' + result.message);
        }
    } catch (error) {
        console.error('Load users error:', error);
        alert('加载用户列表失败：' + error.message);
    }
}

// 显示用户列表
function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px;">暂无用户</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.role === 'admin' ? '<span style="color: #667eea;">管理员</span>' : '普通用户'}</td>
            <td>
                <span class="status-badge status-${user.status === 'active' ? 'approved' : 'rejected'}">
                    ${user.status === 'active' ? '正常' : user.status === 'suspended' ? '已暂停' : '未激活'}
                </span>
            </td>
            <td>${new Date(user.created_at).toLocaleString('zh-CN')}</td>
            <td>
                <button class="btn btn-primary" onclick="editUser(${user.id})" style="padding: 4px 8px; font-size: 12px;">编辑</button>
                <button class="btn btn-danger" onclick="deleteUser(${user.id})" style="padding: 4px 8px; font-size: 12px;">删除</button>
            </td>
        </tr>
    `).join('');
}

// 显示创建用户模态框
function showCreateUserModal() {
    document.getElementById('createUserModal').classList.add('active');
}

// 关闭创建用户模态框
function closeCreateUserModal() {
    document.getElementById('createUserModal').classList.remove('active');
    document.getElementById('createUserForm').reset();
}

// 创建用户
document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const userData = {
        username: formData.get('username'),
        password: formData.get('password'),
        role: formData.get('role'),
        real_name: formData.get('real_name'),
        email: formData.get('email')
    };
    
    try {
        const result = await window.api.post('/api/users', userData);
        if (result.success) {
            alert('用户创建成功');
            closeCreateUserModal();
            loadUsers();
        } else {
            alert('创建失败：' + result.message);
        }
    } catch (error) {
        console.error('Create user error:', error);
        alert('创建失败：' + error.message);
    }
});

// 删除用户
async function deleteUser(userId) {
    if (!confirm('确定要删除这个用户吗？此操作将同时删除该用户的所有数据，且无法恢复！')) {
        return;
    }
    
    try {
        const result = await window.api.delete(`/api/users/${userId}`);
        if (result.success) {
            alert('用户删除成功');
            loadUsers();
        } else {
            alert('删除失败：' + result.message);
        }
    } catch (error) {
        console.error('Delete user error:', error);
        alert('删除失败：' + error.message);
    }
}

// 编辑用户（简化版）
function editUser(userId) {
    alert('编辑功能开发中...');
}

// 加载待审核题目
async function loadPendingQuestions() {
    try {
        const result = await window.api.get('/api/question-bank/pending');
        if (result.success) {
            displayPendingQuestions(result.data.questions);
        } else {
            alert('加载待审核题目失败：' + result.message);
        }
    } catch (error) {
        console.error('Load pending questions error:', error);
        alert('加载待审核题目失败：' + error.message);
    }
}

// 显示待审核题目
function displayPendingQuestions(questions) {
    const container = document.getElementById('pendingQuestionsList');
    
    if (questions.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px;">暂无待审核题目</div>';
        return;
    }
    
    container.innerHTML = questions.map(q => `
        <div class="card" style="margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                <div>
                    <strong>题号：</strong>${q.number}${q.sub_number ? ' ' + q.sub_number : ''}<br>
                    <strong>分类：</strong>${q.category} / ${q.subject}<br>
                    <strong>贡献者：</strong>${q.contributor_real_name || q.contributor_name}<br>
                    <strong>提交时间：</strong>${new Date(q.created_at).toLocaleString('zh-CN')}
                </div>
                <div>
                    <button class="btn btn-primary" onclick="reviewQuestion(${q.id}, 'approved')" style="margin-right: 5px;">
                        <i class="fas fa-check"></i> 通过
                    </button>
                    <button class="btn btn-danger" onclick="reviewQuestion(${q.id}, 'rejected')">
                        <i class="fas fa-times"></i> 拒绝
                    </button>
                </div>
            </div>
            <div style="border-top: 1px solid #e0e0e0; padding-top: 15px;">
                <div style="max-height: 200px; overflow-y: auto;" id="question-content-${q.id}">
                    ${q.content_html}
                </div>
            </div>
        </div>
    `).join('');
}

// 审核题目
async function reviewQuestion(questionId, status) {
    const comment = status === 'rejected' ? prompt('请输入拒绝原因（可选）：') : null;
    
    try {
        const result = await window.api.post('/api/question-bank/review', {
            questionId,
            status,
            comment
        });
        
        if (result.success) {
            alert(status === 'approved' ? '题目已审核通过' : '题目已拒绝');
            loadPendingQuestions();
        } else {
            alert('审核失败：' + result.message);
        }
    } catch (error) {
        console.error('Review question error:', error);
        alert('审核失败：' + error.message);
    }
}

// ==================== 企业管理功能 ====================

function normalizeEnterpriseForAdminView(ent) {
    const statusRaw = String(ent?.status || '').trim();
    const certificationRaw = String(ent?.certification || '').trim();
    const statusLower = statusRaw.toLowerCase();
    const certLower = certificationRaw.toLowerCase();

    let normalizedStatus = 'pending';
    if (statusRaw === '禁用' || statusLower === 'disabled') {
        normalizedStatus = 'disabled';
    } else if (
        certificationRaw === '已认证' ||
        certLower === 'approved' ||
        certLower === 'active' ||
        statusRaw === '正常' ||
        statusLower === 'approved' ||
        statusLower === 'active'
    ) {
        normalizedStatus = 'approved';
    } else if (
        certificationRaw === '待认证' ||
        certLower === 'pending' ||
        statusLower === 'pending'
    ) {
        normalizedStatus = 'pending';
    } else if (
        certificationRaw === '未认证' ||
        certLower === 'rejected' ||
        statusLower === 'rejected'
    ) {
        normalizedStatus = 'rejected';
    }

    return {
        id: ent?.id,
        name: ent?.name || '-',
        contact_name: ent?.contact_name || ent?.contact || '-',
        contact_phone: ent?.contact_phone || ent?.phone || '-',
        contact_email: ent?.contact_email || ent?.email || '-',
        created_at: ent?.created_at || ent?.registerDate || null,
        status: normalizedStatus
    };
}

// 加载企业列表
async function loadEnterprises() {
    try {
        const nameFilter = document.getElementById('enterpriseNameFilter')?.value || '';
        const statusFilter = document.getElementById('enterpriseStatusFilter')?.value || '';

        // 统一口径：优先走 adminCompat（与政企端企业管理一致），失败再降级到旧接口
        const adminStatusMap = {
            pending: '待认证',
            approved: '已认证',
            rejected: '未认证',
            disabled: ''
        };
        const params = [];
        if (nameFilter) params.push(`keyword=${encodeURIComponent(nameFilter)}`);
        if (statusFilter && adminStatusMap[statusFilter] !== undefined && adminStatusMap[statusFilter]) {
            params.push(`certification=${encodeURIComponent(adminStatusMap[statusFilter])}`);
        }
        params.push('size=5000');

        const compatUrl = '/api/v1/admin/companies?' + params.join('&');
        const compatResult = await window.api.get(compatUrl);
        if (compatResult && compatResult.success) {
            const rows = Array.isArray(compatResult.data) ? compatResult.data : [];
            displayEnterprises(rows.map(normalizeEnterpriseForAdminView));
            return;
        }

        let fallbackUrl = '/api/enterprises?';
        const fallbackParams = [];
        if (nameFilter) fallbackParams.push(`name=${encodeURIComponent(nameFilter)}`);
        if (statusFilter) fallbackParams.push(`status=${encodeURIComponent(statusFilter)}`);
        fallbackUrl += fallbackParams.join('&');
        const fallbackResult = await window.api.get(fallbackUrl);
        if (fallbackResult.success) {
            const rows = Array.isArray(fallbackResult.data) ? fallbackResult.data : [];
            displayEnterprises(rows.map(normalizeEnterpriseForAdminView));
        } else {
            alert('加载企业列表失败：' + fallbackResult.message);
        }
    } catch (error) {
        console.error('Load enterprises error:', error);
        alert('加载企业列表失败：' + error.message);
    }
}

// 显示企业列表
function displayEnterprises(enterprises) {
    const tbody = document.getElementById('enterprisesTableBody');
    if (enterprises.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">暂无企业</td></tr>';
        return;
    }
    
    tbody.innerHTML = enterprises.map(ent => {
        const statusClass = {
            'pending': 'status-pending',
            'approved': 'status-approved',
            'rejected': 'status-rejected',
            'disabled': 'status-disabled'
        }[ent.status] || 'status-pending';
        
        const statusText = {
            'pending': '待审核',
            'approved': '已通过',
            'rejected': '已拒绝',
            'disabled': '已禁用'
        }[ent.status] || ent.status;
        
        // 根据状态显示不同的操作按钮
        let actionButtons = '';
        if (ent.status === 'disabled') {
            actionButtons = `
                <button class="btn btn-success" onclick="enableEnterprise(${ent.id})" style="padding: 4px 8px; font-size: 12px; margin-right: 5px;">
                    <i class="fas fa-check"></i> 开启
                </button>
                <button class="btn btn-danger" onclick="deleteEnterprise(${ent.id})" style="padding: 4px 8px; font-size: 12px;">
                    <i class="fas fa-trash"></i> 删除
                </button>
            `;
        } else if (ent.status === 'approved') {
            actionButtons = `
                <button class="btn btn-warning" onclick="disableEnterprise(${ent.id})" style="padding: 4px 8px; font-size: 12px; margin-right: 5px;">
                    <i class="fas fa-ban"></i> 禁用
                </button>
                <button class="btn btn-danger" onclick="deleteEnterprise(${ent.id})" style="padding: 4px 8px; font-size: 12px;">
                    <i class="fas fa-trash"></i> 删除
                </button>
            `;
        } else {
            // pending 或 rejected 状态
            actionButtons = `
                <button class="btn btn-primary" onclick="updateEnterpriseStatus(${ent.id}, 'approved')" style="padding: 4px 8px; font-size: 12px; margin-right: 5px;">
                    <i class="fas fa-check"></i> 通过
                </button>
                <button class="btn btn-warning" onclick="disableEnterprise(${ent.id})" style="padding: 4px 8px; font-size: 12px; margin-right: 5px;">
                    <i class="fas fa-ban"></i> 禁用
                </button>
                <button class="btn btn-danger" onclick="deleteEnterprise(${ent.id})" style="padding: 4px 8px; font-size: 12px;">
                    <i class="fas fa-trash"></i> 删除
                </button>
            `;
        }
        
        return `
            <tr>
                <td>${ent.id}</td>
                <td>${ent.name || '-'}</td>
                <td>${ent.contact_name || '-'}</td>
                <td>${ent.contact_phone || '-'}</td>
                <td>${ent.contact_email || '-'}</td>
                <td>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td>${new Date(ent.created_at).toLocaleString('zh-CN')}</td>
                <td>
                    ${actionButtons}
                </td>
            </tr>
        `;
    }).join('');
}

// 禁用企业
async function disableEnterprise(id) {
    if (!confirm('确定要禁用这个企业吗？禁用后该企业将无法使用系统功能。')) {
        return;
    }
    
    try {
        const result = await window.api.put(`/api/enterprises/${id}`, {
            status: 'disabled'
        });
        if (result.success) {
            alert('企业已禁用');
            loadEnterprises();
        } else {
            alert('禁用失败：' + result.message);
        }
    } catch (error) {
        console.error('Disable enterprise error:', error);
        alert('禁用失败：' + error.message);
    }
}

// 开启企业
async function enableEnterprise(id) {
    if (!confirm('确定要开启这个企业吗？开启后该企业将恢复使用系统功能。')) {
        return;
    }
    
    try {
        const result = await window.api.put(`/api/enterprises/${id}`, {
            status: 'approved'
        });
        if (result.success) {
            alert('企业已开启');
            loadEnterprises();
        } else {
            alert('开启失败：' + result.message);
        }
    } catch (error) {
        console.error('Enable enterprise error:', error);
        alert('开启失败：' + error.message);
    }
}

// 更新企业状态（通用函数）
async function updateEnterpriseStatus(id, status) {
    const statusText = {
        'approved': '通过',
        'rejected': '拒绝',
        'disabled': '禁用'
    }[status] || status;
    
    if (!confirm(`确定要将该企业状态设置为"${statusText}"吗？`)) {
        return;
    }
    
    try {
        const result = await window.api.put(`/api/enterprises/${id}`, {
            status: status
        });
        if (result.success) {
            alert(`企业状态已更新为"${statusText}"`);
            loadEnterprises();
        } else {
            alert('更新失败：' + result.message);
        }
    } catch (error) {
        console.error('Update enterprise status error:', error);
        alert('更新失败：' + error.message);
    }
}

// 删除企业
async function deleteEnterprise(id) {
    if (!confirm('确定要删除这个企业吗？此操作将同时删除该企业的所有关联数据（如考试、用户等），且无法恢复！')) {
        return;
    }
    
    try {
        const result = await window.api.delete(`/api/enterprises/${id}`);
        if (result.success) {
            alert('企业删除成功');
            loadEnterprises();
        } else {
            alert('删除失败：' + result.message);
        }
    } catch (error) {
        console.error('Delete enterprise error:', error);
        alert('删除失败：' + error.message);
    }
}

// 退出登录
function logout() {
    if (confirm('确定要退出登录吗？')) {
        window.auth.logout();
    }
}

// 初始化
(async function() {
    if (await checkAdmin()) {
        displayUserInfo();
        // 根据当前hash或默认标签页加载数据
        const hash = window.location.hash.replace('#', '');
        if (hash.includes('enterprises') || currentTab === 'enterprises') {
            currentTab = 'enterprises';
            switchTab('enterprises');
        } else {
            loadUsers();
        }
    }
})();
