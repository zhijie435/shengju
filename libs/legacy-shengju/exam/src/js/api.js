// API封装
window.api = {
    // 获取API基础URL
    getBaseUrl() {
        return window.auth.getApiBase();
    },
    
    // 通用请求方法
    async request(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...window.auth.getAuthHeaders(),
            ...(options.headers || {})
        };
        
        try {
            const response = await fetch(`${this.getBaseUrl()}${url}`, {
                ...options,
                headers,
                signal: AbortSignal.timeout(30000) // 30秒超时
            });
            
            // 如果token过期，尝试刷新
            if (response.status === 401) {
                const refreshResult = await window.auth.refreshToken();
                if (refreshResult.success) {
                    // 重试请求
                    headers.Authorization = `Bearer ${window.auth.getToken()}`;
                    return fetch(`${this.getBaseUrl()}${url}`, {
                        ...options,
                        headers,
                        signal: AbortSignal.timeout(30000)
                    });
                } else {
                    // 刷新失败，跳转到登录页
                    window.auth.logout();
                    throw new Error('登录已过期，请重新登录');
                }
            }
            
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请检查网络连接');
            } else if (error.message.includes('Failed to fetch')) {
                throw new Error('无法连接到后端服务，请确保后端服务已启动');
            }
            throw error;
        }
    },
    
    // GET请求
    async get(url) {
        const response = await this.request(url, { method: 'GET' });
        return response.json();
    },
    
    // POST请求
    async post(url, data) {
        const response = await this.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...window.auth.getAuthHeaders()
            },
            body: JSON.stringify(data)
        });
        return response.json();
    },
    
    // PUT请求
    async put(url, data) {
        const response = await this.request(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...window.auth.getAuthHeaders()
            },
            body: JSON.stringify(data)
        });
        return response.json();
    },
    
    // DELETE请求
    async delete(url) {
        const response = await this.request(url, { method: 'DELETE' });
        return response.json();
    },
    
    // 文件上传
    async upload(url, formData) {
        const token = window.auth.getToken();
        const response = await fetch(`${this.getBaseUrl()}${url}`, {
            method: 'POST',
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: formData
        });
        return response.json();
    }
};
