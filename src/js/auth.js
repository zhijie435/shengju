// 认证相关功能
window.auth = {
    // API基础URL
    getApiBase() {
        // 桌面端：后端固定在本机
        if (window.__TAURI__) {
            return 'http://localhost:3000';
        }
        // 直接打开本地文件时仍指向本机后端
        if (window.location.protocol === 'file:') {
            return 'http://localhost:3000';
        }
        const origin = window.location.origin;
        const host = window.location.hostname;
        const port = window.location.port;
        const loopback = host === 'localhost' || host === '127.0.0.1';
        // 公网 IP / 域名：必须与页面同源，否则浏览器会拦截对 localhost 的请求（Private Network Access）
        if (!loopback) {
            return origin;
        }
        // 本机：页面已在 80/443/3000 或与 Nginx 同源时，用当前 origin；否则（如 Vite 5173）直连本机后端端口
        if (port === '3000' || port === '80' || port === '443' || port === '') {
            return origin;
        }
        return 'http://localhost:3000';
    },
    
    // 获取存储的token（兼容旧版 login 页只写了 authToken）
    getToken() {
        return localStorage.getItem('auth_token') || localStorage.getItem('authToken');
    },
    
    // 保存token
    setToken(token) {
        localStorage.setItem('auth_token', token);
        try {
            localStorage.setItem('authToken', token);
        } catch (e) { /* ignore */ }
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
        localStorage.removeItem('authToken');
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
                    message: healthCheck.message + '\n\n请确保：\n1. 后端服务已启动（PM2 / 启动脚本）\n2. 通过浏览器访问时，API 与页面同源（Nginx 反代到 Node）\n3. 防火墙与安全组放行端口',
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
                errorMessage = '无法连接到后端服务。请确保：\n1. 后端已启动\n2. 公网访问时勿写 localhost，应使用当前站点地址（Nginx 反代）\n3. 防火墙与安全组已放行';
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
