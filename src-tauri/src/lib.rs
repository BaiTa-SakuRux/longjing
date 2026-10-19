mod ai;
mod crypto;
mod db;
mod error;
mod local;
mod security;
mod sftp;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::init().expect("初始化数据库失败");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(db::Db(std::sync::Mutex::new(conn)))
        .manage(ssh::SshState::new())
        .manage(std::sync::Arc::new(ai::AiState::new()))
        .manage(security::SecurityState::new())
        .manage(sftp::TransferState::new())
        .setup(|app| {
            #[cfg(desktop)]
            apply_dark_theme(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::list_hosts,
            db::add_host,
            db::update_host,
            db::delete_host,
            db::move_host,
            db::accept_fingerprint,
            db::hosts_export,
            db::hosts_import,
            db::duplicate_host,
            db::hosts_batch_add,
            db::snippets_list,
            db::snippet_add,
            db::snippet_update,
            db::snippet_delete,
            security::security_lock,
            db::list_projects,
            db::create_project,
            db::rename_project,
            db::delete_project,
            db::get_setting,
            db::set_setting,
            security::security_status,
            security::mp_setup,
            security::mp_clear,
            security::mp_verify,
            ssh::ssh_connect,
            ssh::ssh_input,
            ssh::ssh_resize,
            ssh::ssh_disconnect,
            ssh::ssh_test,
            ai::ai_get_config,
            ai::ai_save_config,
            ai::ai_chat,
            ai::ai_abort,
            ai::ai_list_models,
            sftp::sftp_home,
            sftp::sftp_list,
            sftp::sftp_mkdir,
            sftp::sftp_rename,
            sftp::sftp_remove,
            sftp::sftp_read_text,
            sftp::sftp_write_text,
            sftp::sftp_upload,
            sftp::sftp_download,
            sftp::transfer_cancel,
            local::local_list,
            local::local_home,
            local::local_mkdir,
            local::local_rename,
            local::local_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 应用启动后把主窗口切到深色主题（Windows 标题栏跟随，消除白边）
#[cfg(desktop)]
fn apply_dark_theme(app: &tauri::App) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_theme(Some(tauri::Theme::Dark));
    }
}
