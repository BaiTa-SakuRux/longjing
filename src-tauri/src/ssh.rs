use russh::client::{self, Handle};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg, Disconnect};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel as IpcChannel, InvokeResponseBody};
use tokio::sync::mpsc;

use crate::crypto;
use crate::db::{self, Db, Host};
use crate::error::AppError;
use crate::security::{self, SecurityState};

/// 每个会话：SSH 连接句柄 + 控制 channel 的命令入口 + 惰性创建的 SFTP 会话
struct SessionEntry {
    handle: Arc<Handle<ClientHandler>>,
    cmd_tx: mpsc::Sender<SessionCmd>,
    sftp: SftpSlot,
}

/// 会话级 SFTP 槽位：首个 SFTP 命令时才建 subsystem channel
pub(crate) type SftpSlot = Arc<tokio::sync::Mutex<Option<Arc<russh_sftp::client::SftpSession>>>>;

pub struct SshState {
    sessions: Arc<Mutex<HashMap<u64, SessionEntry>>>,
    next_id: AtomicU64,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }

    /// 供 sftp 模块取连接句柄与 SFTP 槽位
    pub(crate) fn entry_parts(
        &self,
        session_id: u64,
    ) -> Option<(Arc<Handle<ClientHandler>>, SftpSlot)> {
        self.sessions
            .lock()
            .unwrap()
            .get(&session_id)
            .map(|e| (e.handle.clone(), e.sftp.clone()))
    }
}

enum SessionCmd {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// check_server_key 实现 TOFU：库中有指纹则严格比对，没有则拒绝并由上层引导用户确认
pub(crate) struct ClientHandler {
    known_fingerprint: Option<String>,
    seen_fingerprint: Arc<Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fp = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => {
                key.fingerprint(HashAlg::Sha256).to_string()
            }
            PublicKeyOrCertificate::Certificate(cert) => cert
                .public_key()
                .fingerprint(HashAlg::Sha256)
                .to_string(),
        };
        *self.seen_fingerprint.lock().unwrap() = Some(fp.clone());
        Ok(self.known_fingerprint.as_deref() == Some(fp.as_str()))
    }
}

fn classify_connect_error(
    err: russh::Error,
    seen: &Arc<Mutex<Option<String>>>,
    had_known: bool,
) -> AppError {
    let seen_fp = seen.lock().unwrap().clone();
    match seen_fp {
        Some(fp) if had_known => AppError::HostKeyChanged {
            message: format!("服务器主机密钥已变化（可能为中间人攻击或服务器重装）：{err}"),
            fingerprint: fp,
        },
        Some(fp) => AppError::UnknownHost {
            message: format!("首次连接，主机指纹未确认：{err}"),
            fingerprint: fp,
        },
        None => AppError::Ssh { message: err.to_string() },
    }
}

#[tauri::command]
pub async fn ssh_connect(
    ssh: tauri::State<'_, SshState>,
    security: tauri::State<'_, SecurityState>,
    db: tauri::State<'_, Db>,
    master: Option<String>,
    host_id: i64,
    cols: u32,
    rows: u32,
    on_event: IpcChannel,
) -> Result<u64, AppError> {
    // 取主机配置与已知指纹：锁不跨 await
    let (mut host, known_fp) = {
        let conn = db.0.lock().unwrap();
        let mut h = db::get_host(&conn, host_id)?;
        let fp = db::get_known_fingerprint(&conn, &db::addr_of(&h))?;
        // 解密敏感字段；未解锁时返回 MasterLocked 让前端弹解锁框
        let key = security::resolve_key(&security, &conn, master.as_deref())?;
        if let Some(p) = &h.password {
            if crypto::is_encrypted(p) {
                h.password = Some(crypto::decrypt_str(&key, p)?);
            }
        }
        if let Some(k) = &h.key_passphrase {
            if crypto::is_encrypted(k) {
                h.key_passphrase = Some(crypto::decrypt_str(&key, k)?);
            }
        }
        (h, fp)
    };

    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let seen_fp = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        known_fingerprint: known_fp.clone(),
        seen_fingerprint: seen_fp.clone(),
    };

    let addr = (host.host.as_str(), host.port);
    let mut handle = client::connect(config, addr, handler)
        .await
        .map_err(|e| classify_connect_error(e, &seen_fp, known_fp.is_some()))?;

    authenticate(&mut handle, &host).await?;

    let channel = handle.channel_open_session().await?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    channel.request_shell(false).await?;

    let session_id = ssh.next_id.fetch_add(1, Ordering::SeqCst);
    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCmd>(64);

    ssh.sessions
        .lock()
        .unwrap()
        .insert(session_id, SessionEntry {
            handle: Arc::new(handle),
            cmd_tx,
            sftp: Arc::new(tokio::sync::Mutex::new(None)),
        });

    spawn_session_task(session_id, channel, cmd_rx, on_event, ssh.sessions.clone());

    Ok(session_id)
}

async fn authenticate<H: client::Handler>(
    handle: &mut Handle<H>,
    host: &Host,
) -> Result<(), AppError> {
    match host.auth_type.as_str() {
        "password" => {
            let password = host
                .password
                .clone()
                .ok_or_else(|| AppError::Auth { message: "未配置密码".into() })?;
            let result = handle
                .authenticate_password(&host.username, password)
                .await?;
            if !result.success() {
                return Err(AppError::Auth { message: "密码认证失败".into() });
            }
        }
        "key" => {
            let path = host
                .key_path
                .clone()
                .ok_or_else(|| AppError::Auth { message: "未配置私钥路径".into() })?;
            let key = load_secret_key(&path, host.key_passphrase.as_deref())
                .map_err(|e| AppError::Auth { message: format!("读取私钥失败：{e}") })?;
            let result = handle
                .authenticate_publickey(
                    &host.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await?;
            if !result.success() {
                return Err(AppError::Auth { message: "密钥认证失败".into() });
            }
        }
        other => {
            return Err(AppError::Auth {
                message: format!("未知认证类型：{other}"),
            })
        }
    }
    Ok(())
}

/// 独占 channel 的 actor：转发输出到前端 Channel，接收输入/缩放/关闭命令
fn spawn_session_task(
    session_id: u64,
    mut channel: Channel<client::Msg>,
    mut cmd_rx: mpsc::Receiver<SessionCmd>,
    on_event: IpcChannel,
    sessions: Arc<Mutex<HashMap<u64, SessionEntry>>>,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => match cmd {
                    Some(SessionCmd::Input(data)) => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(SessionCmd::Resize(cols, rows)) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(SessionCmd::Close) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                },
                msg = channel.wait() => match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let _ = on_event.send(InvokeResponseBody::Raw(data.to_vec()));
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        let _ = on_event.send(InvokeResponseBody::Raw(data.to_vec()));
                    }
                    Some(ChannelMsg::ExitStatus { .. }) => {}
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                },
            }
        }
        if sessions.lock().unwrap().remove(&session_id).is_some() {
            let _ = on_event.send(InvokeResponseBody::Json(r#"{"event":"closed"}"#.to_string()));
        }
    });
}

#[tauri::command]
pub async fn ssh_input(ssh: tauri::State<'_, SshState>, session_id: u64, data: Vec<u8>) -> Result<(), AppError> {
    let cmd_tx = ssh
        .sessions
        .lock()
        .unwrap()
        .get(&session_id)
        .map(|e| e.cmd_tx.clone());
    match cmd_tx {
        Some(tx) => tx.send(SessionCmd::Input(data)).await.map_err(|_| AppError::other("会话已关闭")),
        None => Err(AppError::other("会话不存在或已关闭")),
    }
}

#[tauri::command]
pub async fn ssh_resize(ssh: tauri::State<'_, SshState>, session_id: u64, cols: u32, rows: u32) -> Result<(), AppError> {
    let cmd_tx = ssh
        .sessions
        .lock()
        .unwrap()
        .get(&session_id)
        .map(|e| e.cmd_tx.clone());
    match cmd_tx {
        Some(tx) => tx.send(SessionCmd::Resize(cols, rows)).await.map_err(|_| AppError::other("会话已关闭")),
        None => Err(AppError::other("会话不存在或已关闭")),
    }
}

#[tauri::command]
pub async fn ssh_disconnect(ssh: tauri::State<'_, SshState>, session_id: u64) -> Result<(), AppError> {
    let entry = ssh.sessions.lock().unwrap().remove(&session_id);
    if let Some(entry) = entry {
        let _ = entry.cmd_tx.send(SessionCmd::Close).await;
        let handle = entry.handle;
        tokio::spawn(async move {
            let _ = handle.disconnect(Disconnect::ByApplication, "", "english").await;
        });
    }
    Ok(())
}

/// 连接测试结果：ok=false 时 message 为失败原因
#[derive(Debug, serde::Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fp_note: Option<String>,
}

/// 测试用 Handler：库中有指纹则严格比对；没有（新主机）则内存内接受，正式连接仍走 TOFU
struct TestHandler {
    known_fingerprint: Option<String>,
    seen_fingerprint: Arc<Mutex<Option<String>>>,
}

impl client::Handler for TestHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fp = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => {
                key.fingerprint(HashAlg::Sha256).to_string()
            }
            PublicKeyOrCertificate::Certificate(cert) => cert
                .public_key()
                .fingerprint(HashAlg::Sha256)
                .to_string(),
        };
        *self.seen_fingerprint.lock().unwrap() = Some(fp.clone());
        Ok(match &self.known_fingerprint {
            Some(k) => k == &fp,
            None => true,
        })
    }
}

/// 用表单当前值测试 SSH 连接与认证，不建会话、不入库。
/// 编辑已有主机时，留空的密码/密钥字段沿用已存值（可能是密文，需主密码解锁解密）。
#[tauri::command]
pub async fn ssh_test(
    security: tauri::State<'_, SecurityState>,
    db: tauri::State<'_, Db>,
    master: Option<String>,
    host_id: Option<i64>,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
) -> Result<TestResult, AppError> {
    let t0 = std::time::Instant::now();
    let empty_or_none = |v: &Option<String>| v.as_deref().map(str::is_empty).unwrap_or(true);

    let mut h = Host {
        id: host_id.unwrap_or(0),
        name: "test".into(),
        host,
        port,
        username,
        auth_type,
        password,
        key_path,
        key_passphrase,
        project: String::new(),
    };

    // 编辑已有主机：留空的敏感字段沿用已存值；同时取该地址的已知指纹
    let (stored_fp, key) = {
        let conn = db.0.lock().unwrap();
        let stored_fp = match host_id {
            Some(id) => match db::get_host(&conn, id) {
                Ok(stored) => {
                    if empty_or_none(&h.password) {
                        h.password = stored.password.clone();
                    }
                    if empty_or_none(&h.key_path) {
                        h.key_path = stored.key_path.clone();
                    }
                    if empty_or_none(&h.key_passphrase) {
                        h.key_passphrase = stored.key_passphrase.clone();
                    }
                    db::get_known_fingerprint(&conn, &db::addr_of(&stored))
                        .ok()
                        .flatten()
                }
                Err(_) => None,
            },
            None => None,
        };
        let key = security::resolve_key(&security, &conn, master.as_deref())?;
        (stored_fp, key)
    };

    // 密文字段解密（编辑场景）
    if let Some(p) = &mut h.password {
        if crypto::is_encrypted(p) {
            *p = crypto::decrypt_str(&key, p)?;
        }
    }
    if let Some(k) = &mut h.key_passphrase {
        if crypto::is_encrypted(k) {
            *k = crypto::decrypt_str(&key, k)?;
        }
    }

    let fail = |message: String, fp: Option<String>, t: std::time::Instant| TestResult {
        ok: false,
        latency_ms: t.elapsed().as_millis() as u64,
        message,
        fingerprint: fp,
        fp_note: None,
    };

    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: None,
        ..Default::default()
    });
    let seen = Arc::new(Mutex::new(None));
    let handler = TestHandler {
        known_fingerprint: stored_fp.clone(),
        seen_fingerprint: seen.clone(),
    };
    let addr = (h.host.as_str(), h.port);

    let mut handle = match tokio::time::timeout(
        Duration::from_secs(8),
        client::connect(config, addr, handler),
    )
    .await
    {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            let fp = seen.lock().unwrap().clone();
            let msg = classify_connect_error(e, &seen, stored_fp.is_some()).to_string();
            let msg = if msg.contains("首次连接") {
                format!("SSH 握手成功，但主机指纹未确认（{msg}）")
            } else {
                msg
            };
            return Ok(fail(msg, fp, t0));
        }
        Err(_) => {
            return Ok(fail(
                "连接超时（8 秒无响应），请检查主机地址、端口与网络".into(),
                None,
                t0,
            ))
        }
    };

    if let Err(e) = authenticate(&mut handle, &h).await {
        let _ = handle.disconnect(Disconnect::ByApplication, "", "english").await;
        return Ok(fail(e.to_string(), seen.lock().unwrap().clone(), t0));
    }
    let _ = handle.disconnect(Disconnect::ByApplication, "", "english").await;

    let fp_note = if stored_fp.is_none() {
        Some("首次连接：指纹未入库，保存主机后的正式连接将按 TOFU 确认".to_string())
    } else {
        None
    };
    Ok(TestResult {
        ok: true,
        latency_ms: t0.elapsed().as_millis() as u64,
        message: format!("SSH 连接与认证成功（{}@{}:{}）", h.username, h.host, h.port),
        fingerprint: seen.lock().unwrap().clone(),
        fp_note,
    })
}
