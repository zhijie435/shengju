// Tauri后端服务管理
let backendProcess = null;

// 检查是否在Tauri环境中
const isTauri = typeof window !== 'undefined' && window.__TAURI__;

// 启动后端服务
async function startBackend() {
    if (!isTauri) {
        console.log('不在Tauri环境中，跳过后端启动');
        return;
    }

    try {
        const { invoke } = window.__TAURI__.tauri;
        const result = await invoke('start_backend');
        console.log('后端服务:', result);
        return true;
    } catch (error) {
        console.error('启动后端服务失败:', error);
        return false;
    }
}

// 停止后端服务
async function stopBackend() {
    if (!isTauri) {
        return;
    }

    try {
        const { invoke } = window.__TAURI__.tauri;
        await invoke('stop_backend');
        console.log('后端服务已停止');
    } catch (error) {
        console.error('停止后端服务失败:', error);
    }
}

// 获取后端状态
async function getBackendStatus() {
    if (!isTauri) {
        return { running: false, port: 3000 };
    }

    try {
        const { invoke } = window.__TAURI__.tauri;
        return await invoke('get_backend_status');
    } catch (error) {
        console.error('获取后端状态失败:', error);
        return { running: false, port: 3000 };
    }
}

// 等待后端服务就绪
async function waitForBackend(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch('http://localhost:3000/health');
            if (response.ok) {
                console.log('后端服务已就绪');
                return true;
            }
        } catch (error) {
            // 服务还未启动，继续等待
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
}

// 初始化后端服务（在Tauri环境中）
if (isTauri) {
    // 页面加载时自动启动后端服务
    window.addEventListener('DOMContentLoaded', async () => {
        console.log('检测到Tauri环境，正在启动后端服务...');
        const started = await startBackend();
        if (started) {
            const ready = await waitForBackend();
            if (!ready) {
                console.warn('后端服务启动超时，请检查后端服务是否正常运行');
            }
        }
    });

    // 页面卸载时停止后端服务
    window.addEventListener('beforeunload', () => {
        // 注意：在实际应用中，可能不希望关闭应用时停止后端
        // stopBackend();
    });
}

// 导出函数
window.tauriBackend = {
    start: startBackend,
    stop: stopBackend,
    getStatus: getBackendStatus,
    waitFor: waitForBackend,
    isTauri: isTauri
};
