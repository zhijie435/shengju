// 认证相关功能
window.auth = {
    // API基础URL（与当前打开页面的后端一致：3001=人才网/题库，3000=旧考试后端）
    getApiBase() {
        if (window.__TAURI__) {
            return 'http://localhost:3000';
        }
        const o = window.location.origin || '';
        // 从 3001 打开时用 3001，试卷保存到 3001 的 exam_papers，企业端才能看到
        if (o.includes('3001')) return o;
        if (o.includes('3000')) return o;
        return o || 'http://localhost:3001';
    },

    // 人才网 API 基地址（无 /api/v1 后缀）。用于「按批次从企业导入考生」等接口，必须请求 3001 才能拿到待导入批次。
    // 从企业端跳转时 URL 带 talent_api_base；否则用 getApiBase()（从 3001 打开时即 3001）。
    getTalentApiBase() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const fromUrl = params.get('talent_api_base') || params.get('talent_api_base'.replace(/_/g, ''));
            if (fromUrl && typeof fromUrl === 'string' && (fromUrl.startsWith('http://') || fromUrl.startsWith('https://'))) {
                const base = fromUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
                if (base) {
                    try { localStorage.setItem('talent_api_base', base); } catch (e) {}
                    return base;
                }
            }
        } catch (e) {}
        try {
            const fromStorage = localStorage.getItem('talent_api_base');
            if (fromStorage && (fromStorage.startsWith('http://') || fromStorage.startsWith('https://'))) {
                return fromStorage.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
            }
        } catch (e) {}
        return this.getApiBase();
    },

    // 拉取人才网待导入批次列表（供考生管理「按批次从企业导入」使用）。必须请求人才网 3001，否则会显示「暂无待导入的批次数据」。
    async fetchImportBatches(enterpriseId) {
        const base = this.getTalentApiBase();
        const url = base + '/api/v1/exam-imports/batches' + (enterpriseId ? '?sourceCompanyId=' + encodeURIComponent(enterpriseId) + '&enterpriseId=' + encodeURIComponent(enterpriseId) : '');
        const res = await fetch(url, { method: 'GET', cache: 'no-cache' });
        const json = await res.json().catch(() => ({}));
        if (json && json.success && Array.isArray(json.data)) return json.data;
        const fallbackUrl = base + '/api/batches' + (enterpriseId ? '?sourceCompanyId=' + encodeURIComponent(enterpriseId) : '');
        const res2 = await fetch(fallbackUrl, { method: 'GET', cache: 'no-cache' });
        const json2 = await res2.json().catch(() => ({}));
        if (json2 && json2.success && Array.isArray(json2.data)) return json2.data;
        return [];
    },
    
    // 获取存储的token
    getToken() {
        return localStorage.getItem('auth_token');
    },
    
    // 保存token
    setToken(token) {
        localStorage.setItem('auth_token', token);
    },
    
    // 获取用户信息
    getUser() {
        const userStr = localStorage.getItem('user_info');
        return userStr ? JSON.parse(userStr) : null;
    },
    
    // 保存用户信息
    setUser(user) {
        localStorage.setItem('user_info', JSON.stringify(user));
    },
    
    // 清除认证信息
    clearAuth() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_info');
    },
    
    // 检查是否已登录
    isAuthenticated() {
        return !!this.getToken();
    },
    
    // 检查后端服务是否可用
    async checkBackendHealth(retries = 2) {
        const apiBase = this.getApiBase();
        
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await fetch(`${apiBase}/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(3000), // 3秒超时
                    cache: 'no-cache'
                });
                
                if (response.ok) {
                    return { success: true, message: '后端服务正常' };
                }
                
                return { 
                    success: false, 
                    message: `后端服务响应异常 (HTTP ${response.status})` 
                };
            } catch (error) {
                // 如果是最后一次重试，返回详细错误信息
                if (i === retries) {
                    let errorMessage = '无法连接到后端服务';
                    
                    if (error.name === 'AbortError') {
                        errorMessage = '连接超时，后端服务可能未启动或响应缓慢';
                    } else if (error.message.includes('Failed to fetch') || 
                               error.message.includes('ERR_CONNECTION_REFUSED')) {
                        errorMessage = '连接被拒绝，后端服务未启动';
                    } else {
                        errorMessage = `连接失败: ${error.message}`;
                    }
                    
                    console.error('后端服务检查失败:', {
                        error: error.message,
                        apiBase: apiBase,
                        attempt: i + 1,
                        totalAttempts: retries + 1
                    });
                    
                    return { 
                        success: false, 
                        message: errorMessage,
                        details: {
                            apiBase: apiBase,
                            error: error.message
                        }
                    };
                }
                
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        return { success: false, message: '后端服务检查失败' };
    },
    
    // 登录
    async login(username, password) {
        try {
            // 先检查后端服务是否可用
            const healthCheck = await this.checkBackendHealth();
            if (!healthCheck.success) {
                return { 
                    success: false, 
                    message: healthCheck.message + '\n\n请确保：\n1. 后端服务已启动（运行"启动后端服务.bat"）\n2. 服务运行在端口 3000\n3. 防火墙未阻止连接',
                    details: healthCheck.details
                };
            }
            
            const apiBase = this.getApiBase();
            console.log('正在连接到:', `${apiBase}/api/auth/login`);
            
            const response = await fetch(`${apiBase}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password }),
                signal: AbortSignal.timeout(10000) // 10秒超时
            });
            
            // 检查响应状态
            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch {
                    errorData = { message: errorText || `HTTP ${response.status}` };
                }
                return { success: false, message: errorData.message || '登录请求失败' };
            }
            
            const data = await response.json();
            
            if (data.success && data.token) {
                this.setToken(data.token);
                this.setUser(data.user);
                return { success: true, user: data.user };
            } else {
                return { success: false, message: data.message || '登录失败' };
            }
        } catch (error) {
            console.error('Login error:', error);
            
            let errorMessage = '网络错误';
            
            if (error.name === 'AbortError') {
                errorMessage = '请求超时，请检查网络连接或后端服务状态';
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage = '无法连接到后端服务。请确保：\n1. 后端服务已启动（运行"启动后端服务.bat"）\n2. 服务运行在端口 3000\n3. 防火墙未阻止连接';
            } else {
                errorMessage = error.message || '网络错误，请检查后端服务是否启动';
            }
            
            return { success: false, message: errorMessage };
        }
    },
    
    // 注册（仅管理员可用）
    async register(userData) {
        try {
            const token = this.getToken();
            const response = await fetch(`${this.getApiBase()}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(userData)
            });
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Register error:', error);
            return { success: false, message: error.message };
        }
    },
    
    // 登出
    logout() {
        this.clearAuth();
        window.location.href = '/src/index.html';
    },
    
    // 刷新token
    async refreshToken() {
        try {
            const token = this.getToken();
            if (!token) {
                return { success: false };
            }
            
            const response = await fetch(`${this.getApiBase()}/api/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (data.success && data.token) {
                this.setToken(data.token);
                return { success: true };
            } else {
                this.clearAuth();
                return { success: false };
            }
        } catch (error) {
            console.error('Refresh token error:', error);
            this.clearAuth();
            return { success: false };
        }
    },
    
    // 获取带认证头的fetch选项
    getAuthHeaders() {
        const token = this.getToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    }
};
