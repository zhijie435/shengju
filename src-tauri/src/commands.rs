use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct BackendStatus {
    pub running: bool,
    pub port: u16,
}

lazy_static::lazy_static! {
    static ref BACKEND_PROCESS: Arc<Mutex<Option<std::process::Child>>> = Arc::new(Mutex::new(None));
}

#[tauri::command]
pub async fn start_backend() -> Result<String, String> {
    let mut process_guard = BACKEND_PROCESS.lock().await;
    
    if process_guard.is_some() {
        return Ok("后端服务已在运行".to_string());
    }

    // 获取后端目录路径
    let backend_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .and_then(|p| p.parent().map(|p| p.join("backend")))
        .ok_or_else(|| "无法找到后端目录".to_string())?;

    // 启动Node.js后端服务
    let mut cmd = Command::new("node");
    cmd.arg("server.js")
        .current_dir(&backend_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd.spawn().map_err(|e| format!("启动后端服务失败: {}", e))?;
    
    *process_guard = Some(child);
    
    Ok("后端服务已启动".to_string())
}

#[tauri::command]
pub async fn stop_backend() -> Result<String, String> {
    let mut process_guard = BACKEND_PROCESS.lock().await;
    
    if let Some(mut child) = process_guard.take() {
        child.kill().map_err(|e| format!("停止后端服务失败: {}", e))?;
        Ok("后端服务已停止".to_string())
    } else {
        Ok("后端服务未运行".to_string())
    }
}

#[tauri::command]
pub async fn get_backend_status() -> Result<BackendStatus, String> {
    let process_guard = BACKEND_PROCESS.lock().await;
    Ok(BackendStatus {
        running: process_guard.is_some(),
        port: 3000,
    })
}
