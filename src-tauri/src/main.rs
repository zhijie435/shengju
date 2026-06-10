// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{start_backend, stop_backend, get_backend_status};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            get_backend_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
