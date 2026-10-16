use russh_sftp::client::SftpSession;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel as IpcChannel, InvokeResponseBody};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::AppError;
use crate::ssh::SshState;

/// 进行中传输的取消标志表：前端用自生成的 transfer_id 注册与取消
pub struct TransferState {
    cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

impl TransferState {
    pub fn new() -> Self {
        Self { cancels: Mutex::new(HashMap::new()) }
    }

    fn register(&self, transfer_id: u64) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels.lock().unwrap().insert(transfer_id, flag.clone());
        flag
    }

    fn unregister(&self, transfer_id: u64) {
        self.cancels.lock().unwrap().remove(&transfer_id);
    }
}

#[tauri::command]
pub fn transfer_cancel(
    state: tauri::State<'_, TransferState>,
    transfer_id: u64,
) -> Result<(), AppError> {
    if let Some(flag) = state.cancels.lock().unwrap().get(&transfer_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// 编辑器单文件上限：2 MiB
const EDIT_SIZE_CAP: u64 = 2 * 1024 * 1024;

/// 取会话对应的 SFTP 会话；首个 SFTP 命令时才开 subsystem channel 惰性建立
async fn get_sftp(ssh: &SshState, session_id: u64) -> Result<Arc<SftpSession>, AppError> {
    let Some((handle, slot)) = ssh.entry_parts(session_id) else {
        return Err(AppError::other("会话不存在或已关闭，请先连接主机"));
    };
    let mut guard = slot.lock().await;
    if let Some(sftp) = guard.as_ref() {
        return Ok(sftp.clone());
    }
    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(false, "sftp").await?;
    let sftp = Arc::new(SftpSession::new(channel.into_stream()).await?);
    *guard = Some(sftp.clone());
    Ok(sftp)
}

#[derive(Debug, Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: Option<u32>,
}

#[tauri::command]
pub async fn sftp_home(ssh: tauri::State<'_, SshState>, session_id: u64) -> Result<String, AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    let home = sftp.canonicalize(".").await?;
    Ok(home)
}

#[tauri::command]
pub async fn sftp_list(
    ssh: tauri::State<'_, SshState>,
    session_id: u64,
    path: String,
) -> Result<Vec<FsEntry>, AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    let entries = sftp.read_dir(&path).await?;
    let mut out = Vec::new();
    for e in entries {
        let name = e.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let md = e.metadata();
        out.push(FsEntry {
            is_dir: md.file_type().is_dir(),
            size: md.size.unwrap_or(0),
            mtime: md.mtime,
            name,
        });
    }
    // 目录优先，其次按名称
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub async fn sftp_mkdir(ssh: tauri::State<'_, SshState>, session_id: u64, path: String) -> Result<(), AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    sftp.create_dir(&path).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    ssh: tauri::State<'_, SshState>,
    session_id: u64,
    from: String,
    to: String,
) -> Result<(), AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    sftp.rename(&from, &to).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_remove(
    ssh: tauri::State<'_, SshState>,
    session_id: u64,
    path: String,
    is_dir: bool,
) -> Result<(), AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    if is_dir {
        sftp.remove_dir(&path).await?;
    } else {
        sftp.remove_file(&path).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_read_text(
    ssh: tauri::State<'_, SshState>,
    session_id: u64,
    path: String,
) -> Result<String, AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    let size = sftp.metadata(&path).await?.size.unwrap_or(0);
    if size > EDIT_SIZE_CAP {
        return Err(AppError::other(format!(
            "文件过大（{}字节 > 2MiB 上限），不支持在线编辑",
            size
        )));
    }
    let bytes = sftp.read(&path).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn sftp_write_text(
    ssh: tauri::State<'_, SshState>,
    session_id: u64,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    sftp.write(&path, content.as_bytes()).await?;
    Ok(())
}

fn emit_progress(on_progress: &IpcChannel, done: u64, total: u64) {
    let _ = on_progress.send(InvokeResponseBody::Json(
        json!({ "t": "progress", "done": done, "total": total }).to_string(),
    ));
}

#[tauri::command]
pub async fn sftp_upload(
    ssh: tauri::State<'_, SshState>,
    transfer: tauri::State<'_, TransferState>,
    session_id: u64,
    transfer_id: u64,
    local_path: String,
    remote_path: String,
    on_progress: IpcChannel,
) -> Result<(), AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    let cancel = transfer.register(transfer_id);
    let total = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
    let mut local = tokio::fs::File::open(&local_path).await?;
    let mut remote = sftp.create(&remote_path).await?;

    let mut buf = vec![0u8; 64 * 1024];
    let mut done: u64 = 0;
    let mut last_emit = 0u64;
    let canceled = loop {
        if cancel.load(Ordering::SeqCst) {
            break true;
        }
        let n = match local.read(&mut buf).await {
            Ok(0) => break false,
            Ok(n) => n,
            Err(e) => {
                transfer.unregister(transfer_id);
                return Err(e.into());
            }
        };
        if remote.write_all(&buf[..n]).await.is_err() {
            transfer.unregister(transfer_id);
            return Err(AppError::other("远端写入失败"));
        }
        done += n as u64;
        if done - last_emit >= 256 * 1024 {
            last_emit = done;
            emit_progress(&on_progress, done, total);
        }
    };

    if canceled {
        // 清理半成品
        let _ = remote.sync_all().await;
        let _ = remote.close().await;
        let _ = sftp.remove_file(&remote_path).await;
        emit_progress(&on_progress, done, total);
        let _ = on_progress.send(InvokeResponseBody::Json(json!({"t": "canceled"}).to_string()));
    } else {
        let _ = remote.sync_all().await;
        let _ = remote.close().await;
        emit_progress(&on_progress, done, total);
        let _ = on_progress.send(InvokeResponseBody::Json(json!({"t": "done"}).to_string()));
    }
    transfer.unregister(transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    ssh: tauri::State<'_, SshState>,
    transfer: tauri::State<'_, TransferState>,
    session_id: u64,
    transfer_id: u64,
    remote_path: String,
    local_path: String,
    on_progress: IpcChannel,
) -> Result<(), AppError> {
    let sftp = get_sftp(&ssh, session_id).await?;
    let cancel = transfer.register(transfer_id);
    let total = sftp.metadata(&remote_path).await?.size.unwrap_or(0);
    let mut remote = sftp.open(&remote_path).await?;
    let mut local = tokio::fs::File::create(&local_path).await?;

    let mut buf = vec![0u8; 64 * 1024];
    let mut done: u64 = 0;
    let mut last_emit = 0u64;
    let canceled = loop {
        if cancel.load(Ordering::SeqCst) {
            break true;
        }
        let n = match remote.read(&mut buf).await {
            Ok(0) => break false,
            Ok(n) => n,
            Err(e) => {
                transfer.unregister(transfer_id);
                return Err(e.into());
            }
        };
        if local.write_all(&buf[..n]).await.is_err() {
            transfer.unregister(transfer_id);
            return Err(AppError::other("本地写入失败"));
        }
        done += n as u64;
        if done - last_emit >= 256 * 1024 {
            last_emit = done;
            emit_progress(&on_progress, done, total);
        }
    };

    if canceled {
        let _ = local.sync_all().await;
        let _ = tokio::fs::remove_file(&local_path).await; // 清理半成品
        emit_progress(&on_progress, done, total);
        let _ = on_progress.send(InvokeResponseBody::Json(json!({"t": "canceled"}).to_string()));
    } else {
        let _ = local.sync_all().await;
        emit_progress(&on_progress, done, total);
        let _ = on_progress.send(InvokeResponseBody::Json(json!({"t": "done"}).to_string()));
    }
    transfer.unregister(transfer_id);
    Ok(())
}
