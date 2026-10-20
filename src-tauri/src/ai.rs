use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel as IpcChannel, InvokeResponseBody};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use rusqlite::Connection;
use tokio::sync::Mutex as AsyncMutex;

use crate::crypto;
use crate::db::Db;
use crate::error::AppError;
use crate::security::{self, SecurityState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// 后端：api（自定义 OpenAI 兼容端点）| zcode | dsh
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    /// zcode.cjs 完整路径
    #[serde(default)]
    pub zcode_path: String,
    /// 会话归属工作目录（空 = 项目目录）
    #[serde(default)]
    pub zcode_cwd: String,
    /// zcode 权限模式（空 = ZCode 自身默认；可选 plan/guarded/build/yolo）
    #[serde(default)]
    pub zcode_mode: String,
    /// dsh.cmd 完整路径
    #[serde(default)]
    pub dsh_path: String,
    /// dsh 会话归属工作目录（空 = 项目目录）
    #[serde(default)]
    pub dsh_cwd: String,
}

fn default_backend() -> String {
    "api".into()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct AiState {
    cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    /// 后端子进程（zcode/dsh），供取消时强杀
    children: Mutex<HashMap<u64, Arc<AsyncMutex<tokio::process::Child>>>>,
    next_id: AtomicU64,
}

impl AiState {
    pub fn new() -> Self {
        Self {
            cancels: Mutex::new(HashMap::new()),
            children: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    fn register_child(
        &self,
        chat_id: u64,
        child: tokio::process::Child,
    ) -> Arc<AsyncMutex<tokio::process::Child>> {
        let arc = Arc::new(AsyncMutex::new(child));
        self.children.lock().unwrap().insert(chat_id, arc.clone());
        arc
    }

    fn unregister(&self, chat_id: u64) {
        self.children.lock().unwrap().remove(&chat_id);
    }
}

fn settings_get(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    crate::db::settings_get(conn, key)
}

fn settings_set(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), AppError> {
    crate::db::settings_set(conn, key, value)
}

#[tauri::command]
pub fn ai_get_config(
    db: tauri::State<'_, Db>,
    security: tauri::State<'_, SecurityState>,
    master: Option<String>,
) -> Result<Option<AiConfig>, AppError> {
    let conn = db.0.lock().unwrap();
    let mut config = settings_get(&conn, "ai").and_then(|v| serde_json::from_str::<AiConfig>(&v).ok());
    if let (Some(cfg), Some(key)) = (config.as_mut(), resolve_api_key(&security, &conn, master.as_deref())?) {
        cfg.api_key = key;
    }
    Ok(config)
}

/// 从存储中解析 AI API Key（未加密时原样；加密时用密钥解密；无法解密返回空）
fn resolve_api_key(
    security: &SecurityState,
    conn: &Connection,
    master: Option<&str>,
) -> Result<Option<String>, AppError> {
    let raw = settings_get(conn, "ai")
        .and_then(|v| serde_json::from_str::<AiConfig>(&v).ok())
        .map(|c| c.api_key)
        .unwrap_or_default();
    if raw.is_empty() {
        return Ok(None);
    }
    if !crypto::is_encrypted(&raw) {
        return Ok(Some(raw));
    }
    let key = security::resolve_key(security, conn, master)?;
    Ok(Some(crypto::decrypt_str(&key, &raw)?))
}

#[tauri::command]
pub fn ai_save_config(
    security: tauri::State<'_, SecurityState>,
    db: tauri::State<'_, Db>,
    master: Option<String>,
    mut config: AiConfig,
) -> Result<(), AppError> {
    let conn = db.0.lock().unwrap();
    // api_key 留空 = 保持已存值不变
    if config.api_key.trim().is_empty() {
        if let Some(old) = settings_get(&conn, "ai").and_then(|v| serde_json::from_str::<AiConfig>(&v).ok()) {
            config.api_key = old.api_key;
        }
    } else if !crypto::is_encrypted(&config.api_key) {
        let key = security::resolve_key(&security, &conn, master.as_deref())?;
        config.api_key = crypto::encrypt_str(&key, &config.api_key)?;
    }
    settings_set(&conn, "ai", &serde_json::to_string(&config)?)
}

fn emit(on_event: &IpcChannel, v: &Value) {
    let _ = on_event.send(InvokeResponseBody::Json(v.to_string()));
}

#[tauri::command]
pub async fn ai_chat(
    state: tauri::State<'_, Arc<AiState>>,
    db: tauri::State<'_, Db>,
    security: tauri::State<'_, SecurityState>,
    master: Option<String>,
    messages: Vec<ChatMessage>,
    // 非 API 后端：本次要发送的最新一条用户消息（历史由后端会话持有）
    prompt: Option<String>,
    // 非 API 后端：要延续的会话 id
    backend_session: Option<String>,
    on_event: IpcChannel,
) -> Result<u64, AppError> {
    let config: AiConfig = {
        let conn = db.0.lock().unwrap();
        let mut cfg: AiConfig = settings_get(&conn, "ai")
            .and_then(|v| serde_json::from_str(&v).ok())
            .ok_or_else(|| AppError::other("尚未配置 AI（baseURL/apiKey/model）"))?;
        if cfg.backend == "api" {
            if let Some(key) = resolve_api_key(&security, &conn, master.as_deref())? {
                cfg.api_key = key;
            }
        }
        cfg
    };

    let chat_id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .unwrap()
        .insert(chat_id, cancel.clone());

    match config.backend.as_str() {
        "zcode" => {
            let state2 = state.inner().clone();
            tokio::spawn(run_zcode(
                state2, chat_id, config, prompt, backend_session, on_event, cancel,
            ));
        }
        "dsh" => {
            let state2 = state.inner().clone();
            tokio::spawn(run_dsh(
                state2, chat_id, config, prompt, backend_session, on_event, cancel,
            ));
        }
        _ => {
            tokio::spawn(run_api(config, messages, on_event, cancel));
        }
    }
    Ok(chat_id)
}

#[tauri::command]
pub async fn ai_abort(state: tauri::State<'_, Arc<AiState>>, chat_id: u64) -> Result<(), AppError> {
    if let Some(cancel) = state.cancels.lock().unwrap().remove(&chat_id) {
        cancel.store(true, Ordering::SeqCst);
    }
    // 先把 Arc 克隆出来，避免 std 锁跨 await
    let child = state.children.lock().unwrap().get(&chat_id).cloned();
    if let Some(child) = child {
        let _ = child.lock().await.start_kill();
    }
    Ok(())
}

/// 拉取 OpenAI 兼容端点的 /models 模型列表，供设置页点选
#[tauri::command]
pub async fn ai_list_models(config: AiConfig) -> Result<Vec<String>, AppError> {
    let url = format!("{}/models", config.base_url.trim_end_matches('/'));
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::other(format!("HTTP 客户端构建失败：{e}")))?;

    let resp = client
        .get(&url)
        .bearer_auth(&config.api_key)
        .send()
        .await
        .map_err(|e| AppError::other(format!("请求失败：{e}")))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let clipped: String = text.chars().take(400).collect();
        return Err(AppError::other(format!("HTTP {status}：{clipped}")));
    }

    let v: Value =
        serde_json::from_str(&text).map_err(|e| AppError::other(format!("响应解析失败：{e}")))?;
    let mut models: Vec<String> = v["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    if models.is_empty() {
        return Err(AppError::other("端点未返回任何模型（可能不支持 /models）"));
    }
    Ok(models)
}

async fn run_api(
    config: AiConfig,
    messages: Vec<ChatMessage>,
    on_event: IpcChannel,
    cancel: Arc<AtomicBool>,
) {
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    let client = match Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            emit(&on_event, &json!({"t": "error", "v": format!("HTTP 客户端构建失败：{e}")}));
            return;
        }
    };

    let body = json!({
        "model": config.model,
        "messages": messages,
        "stream": true,
    });

    let resp = client
        .post(&url)
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            emit(&on_event, &json!({"t": "error", "v": format!("请求失败：{e}")}));
            return;
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let text: String = text.chars().take(800).collect();
        emit(&on_event, &json!({"t": "error", "v": format!("HTTP {status}：{text}")}));
        return;
    }

    // 部分网关会忽略 stream:true，返回整包 JSON —— 直接取完整回答
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if content_type.contains("application/json") {
        let text = resp.text().await.unwrap_or_default();
        match serde_json::from_str::<Value>(&text) {
            Ok(v) => {
                let content = v["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or_default();
                if content.is_empty() {
                    emit(&on_event, &json!({"t": "error", "v": "服务端返回了空回答", }));
                } else {
                    emit(&on_event, &json!({"t": "delta", "v": content}));
                    emit(&on_event, &json!({"t": "done"}));
                }
            }
            Err(e) => emit(&on_event, &json!({"t": "error", "v": format!("响应解析失败：{e}")})),
        }
        return;
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    // 最近一次收到实质 SSE 事件（data: 行）的时间；仅心跳不算进度
    let mut last_progress = std::time::Instant::now();

    loop {
        if cancel.load(Ordering::SeqCst) {
            emit(&on_event, &json!({"t": "aborted"}));
            return;
        }
        // 单次等待超时：服务端长时间不给任何数据时给出反馈而不是无限等待
        let item = match tokio::time::timeout(Duration::from_secs(90), stream.next()).await {
            Ok(it) => it,
            Err(_) => {
                emit(&on_event, &json!({"t": "error", "v": "90 秒未收到任何数据，已超时中止（服务商无响应或网络不通）"}));
                return;
            }
        };
        match item {
            Some(Ok(chunk)) => {
                buf.extend_from_slice(&chunk);
                // 逐行处理 SSE（行可能跨 chunk，留在 buf 里直到凑齐 \n）
                let mut saw_data_line = false;
                while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&line[..line.len() - 1]);
                    let line = line.trim();
                    let Some(data) = line.strip_prefix("data:") else {
                        continue; // 空行 / ": keep-alive" 注释等
                    };
                    saw_data_line = true;
                    let data = data.trim();
                    if data == "[DONE]" {
                        emit(&on_event, &json!({"t": "done"}));
                        return;
                    }
                    let Ok(v) = serde_json::from_str::<Value>(data) else {
                        continue;
                    };
                    let delta = &v["choices"][0]["delta"];
                    // 思考型模型（GLM-4.x / deepseek-reasoner 等）先输出推理内容
                    if let Some(text) = delta["reasoning_content"].as_str() {
                        if !text.is_empty() {
                            emit(&on_event, &json!({"t": "think", "v": text}));
                        }
                    }
                    if let Some(text) = delta["content"].as_str() {
                        if !text.is_empty() {
                            emit(&on_event, &json!({"t": "delta", "v": text}));
                        }
                    }
                }
                if saw_data_line {
                    last_progress = std::time::Instant::now();
                } else if last_progress.elapsed() > Duration::from_secs(120) {
                    emit(&on_event, &json!({"t": "error", "v": "连接有心跳但 120 秒无实质内容——多为网络链路异常（TLS 数据被破坏）或服务端排队过久，请点重试/更换网络后再试"}));
                    return;
                }
            }
            Some(Err(e)) => {
                emit(&on_event, &json!({"t": "error", "v": format!("流中断：{e}")}));
                return;
            }
            None => {
                emit(&on_event, &json!({"t": "done"}));
                return;
            }
        }
    }
}

/* ================= ZCode / dsh 子进程后端 ================= */

/// 未配置会话工作目录时的默认值：运行时数据目录（exe 旁 data\，随安装走，无编译期路径嵌入）
fn default_backend_cwd() -> std::path::PathBuf {
    crate::db::data_dir()
}

/// zcode 后端：node zcode.cjs -p <prompt> --json（保留 ZCode 原生工具能力）
async fn run_zcode(
    state: Arc<AiState>,
    chat_id: u64,
    config: AiConfig,
    prompt: Option<String>,
    backend_session: Option<String>,
    on_event: IpcChannel,
    cancel: Arc<AtomicBool>,
) {
    let Some(prompt) = prompt.filter(|p| !p.trim().is_empty()) else {
        emit(&on_event, &json!({"t": "error", "v": "消息为空"}));
        state.unregister(chat_id);
        return;
    };
    if config.zcode_path.trim().is_empty() {
        emit(
            &on_event,
            &json!({"t": "error", "v": "未配置 zcode.cjs 路径（设置 → AI 模型）"}),
        );
        state.unregister(chat_id);
        return;
    }
    let cwd = if config.zcode_cwd.trim().is_empty() {
        default_backend_cwd()
    } else {
        std::path::PathBuf::from(&config.zcode_cwd)
    };

    let mut cmd = Command::new("node");
    cmd.arg(&config.zcode_path)
        .arg("-p")
        .arg(&prompt)
        .arg("--json")
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    if let Some(sid) = backend_session.filter(|s| !s.trim().is_empty()) {
        cmd.arg("--resume").arg(sid);
    }
    if !config.zcode_mode.trim().is_empty() {
        cmd.arg("--mode").arg(config.zcode_mode.trim());
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit(
                &on_event,
                &json!({"t": "error", "v": format!("启动 zcode 失败：{e}")}),
            );
            state.unregister(chat_id);
            return;
        }
    };
    let mut stdout = child.stdout.take().expect("stdout piped");
    let child = state.register_child(chat_id, child);

    let mut out = String::new();
    let mut buf = vec![0u8; 65536];
    let mut io_err: Option<String> = None;
    loop {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        match tokio::time::timeout(Duration::from_secs(180), stdout.read(&mut buf)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => out.push_str(&String::from_utf8_lossy(&buf[..n])),
            Ok(Err(e)) => {
                io_err = Some(e.to_string());
                break;
            }
            Err(_) => {
                io_err = Some("180 秒无输出，已超时".into());
                break;
            }
        }
    }
    let _ = child.lock().await.kill().await;
    let aborted = cancel.load(Ordering::SeqCst);
    state.unregister(chat_id);

    if aborted {
        emit(&on_event, &json!({"t": "aborted"}));
        return;
    }
    if let Some(e) = io_err {
        emit(&on_event, &json!({"t": "error", "v": e}));
        return;
    }

    // 输出为完整 JSON（可能带首尾杂讯，取第一个 { 到最后一个 }）
    let parsed = out
        .find('{')
        .zip(out.rfind('}'))
        .and_then(|(s, e)| serde_json::from_str::<Value>(out[s..=e].trim()).ok());
    match parsed {
        Some(v) => {
            if let Some(sid) = v["sessionId"].as_str() {
                emit(&on_event, &json!({"t": "session", "v": sid}));
            }
            match v["response"].as_str() {
                Some(text) if !text.is_empty() => {
                    emit(&on_event, &json!({"t": "delta", "v": text}));
                    emit(&on_event, &json!({"t": "done"}));
                }
                _ => emit(
                    &on_event,
                    &json!({"t": "error", "v": "zcode 返回了空回答"}),
                ),
            }
        }
        None => {
            let raw = out.trim();
            if raw.is_empty() {
                emit(&on_event, &json!({"t": "error", "v": "zcode 无输出"}));
            } else {
                emit(&on_event, &json!({"t": "delta", "v": raw}));
                emit(&on_event, &json!({"t": "done"}));
            }
        }
    }
}

/// dsh 后端：dsh.cmd headless --json（NDJSON 事件流）。
/// 注意：headless 的 thinking/text 按「步」整段发出（无 token 级增量），status 阶段事件
/// 用作前端活性提示；dsh 进程任何形式的提前退出都必须给前端终止事件，否则转圈永不停止。
async fn run_dsh(
    state: Arc<AiState>,
    chat_id: u64,
    config: AiConfig,
    prompt: Option<String>,
    backend_session: Option<String>,
    on_event: IpcChannel,
    cancel: Arc<AtomicBool>,
) {
    let Some(prompt) = prompt.filter(|p| !p.trim().is_empty()) else {
        emit(&on_event, &json!({"t": "error", "v": "消息为空"}));
        state.unregister(chat_id);
        return;
    };
    if config.dsh_path.trim().is_empty() {
        emit(
            &on_event,
            &json!({"t": "error", "v": "未配置 dsh.cmd 路径（设置 → AI 模型）"}),
        );
        state.unregister(chat_id);
        return;
    }

    let mut sid = backend_session.filter(|s| !s.trim().is_empty());
    let mut attempt = 0;
    loop {
        attempt += 1;
        let (finished, aborted, stale) = run_dsh_attempt(
            &state, chat_id, &config, &prompt, sid.clone(), &on_event, &cancel,
        )
        .await;
        if aborted || (finished && !stale) {
            return;
        }
        if stale && sid.is_some() && attempt < 3 {
            // 存储的会话 id 已失效（如 Harness 清理会话）：自动换新会话重试
            emit(
                &on_event,
                &json!({"t": "stage", "v": "原会话已失效，已自动新建会话"}),
            );
            emit(&on_event, &json!({"t": "session", "v": ""}));
            sid = None;
            continue;
        }
        return;
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_dsh_attempt(
    state: &Arc<AiState>,
    chat_id: u64,
    config: &AiConfig,
    prompt: &str,
    sid: Option<String>,
    on_event: &IpcChannel,
    cancel: &Arc<AtomicBool>,
) -> (bool, bool, bool) {
    let cwd = if config.dsh_cwd.trim().is_empty() {
        default_backend_cwd()
    } else {
        std::path::PathBuf::from(&config.dsh_cwd)
    };
    let was_new = sid.is_none();
    let mut cmd = Command::new(&config.dsh_path);
    cmd.arg("headless").arg("--json");
    if let Some(s) = &sid {
        cmd.arg("--session-id").arg(s);
    }
    cmd.arg("-")
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit(on_event, &json!({"t": "error", "v": format!("启动 dsh 失败：{e}")}));
            return (false, false, false);
        }
    };
    let mut stdin = child.stdin.take().expect("stdin piped");
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let child = state.register_child(chat_id, child);

    // 后台收集 stderr，提前退出时用于诊断
    let err_task = tokio::spawn(async move {
        let mut out: Vec<u8> = Vec::new();
        let mut b = [0u8; 1024];
        loop {
            match stderr.read(&mut b).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    out.extend_from_slice(&b[..n]);
                    if out.len() > 8192 {
                        out.drain(..out.len() - 4096); // 只保留尾部
                    }
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    });

    if stdin.write_all(prompt.as_bytes()).await.is_err() {
        emit(on_event, &json!({"t": "error", "v": "写入 stdin 失败"}));
        let _ = child.lock().await.kill().await;
        return (false, false, false);
    }
    drop(stdin);

    let mut buf = vec![0u8; 65536];
    let mut linebuf: Vec<u8> = Vec::new();
    let mut finished = false;
    let mut stale = false;
    let mut got_text = false;
    let mut err_reason: Option<String> = None;
    loop {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        // ChildStdout 只有 AsyncRead，无 lines()：手动按行缓冲
        let n = match tokio::time::timeout(Duration::from_secs(180), stdout.read(&mut buf)).await {
            Err(_) => {
                emit(on_event, &json!({"t": "error", "v": "180 秒无输出，已超时"}));
                break;
            }
            Ok(Err(e)) => {
                emit(on_event, &json!({"t": "error", "v": format!("流中断：{e}")}));
                break;
            }
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => n,
        };
        linebuf.extend_from_slice(&buf[..n]);
        while let Some(pos) = linebuf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = linebuf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line[..line.len() - 1]);
            let new_sid = process_dsh_line(
                line.trim(),
                on_event,
                &mut finished,
                &mut stale,
                &mut got_text,
                &mut err_reason,
            );
            // headless 不写 Harness 桌面端的项目注册表，新会话需手动归组，否则桌面端显示「未分组」
            if was_new {
                if let Some(new_sid) = new_sid {
                    let cwd2 = cwd.clone();
                    std::thread::spawn(move || dsh_attach_session(&cwd2, &new_sid));
                }
            }
            if finished {
                break;
            }
        }
        if finished {
            break;
        }
    }
    let _ = child.lock().await.kill().await;
    let aborted = cancel.load(Ordering::SeqCst);
    let err_out = err_task.await.unwrap_or_default();
    state.unregister(chat_id);

    if aborted {
        emit(on_event, &json!({"t": "aborted"}));
    } else if finished && !stale {
        if let Some(reason) = err_reason.as_deref() {
            // turn 以错误收场（如凭据缺失、上游拒绝）：透传真实原因，绝不静默渲染空回复
            emit(on_event, &json!({"t": "error", "v": format!("dsh：{reason}")}));
        } else if !got_text {
            // 正常结束但一个字没吐：带上 stderr 尾部帮助定位
            let tail = err_out.trim();
            let why = if tail.is_empty() {
                String::new()
            } else {
                format!(
                    "：{}",
                    tail.chars()
                        .rev()
                        .take(300)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<String>()
                )
            };
            emit(on_event, &json!({"t": "error", "v": format!("dsh 返回空回复{why}")}));
        } else {
            // 正常完成：前端靠 done 提取命令按钮并结束转圈
            emit(on_event, &json!({"t": "done"}));
        }
    } else if !finished {
        // dsh 提前退出且未完成（如会话失效、参数错误）：给前端终止事件 + 诊断尾部
        let tail = err_out.trim();
        let why = if tail.is_empty() {
            String::new()
        } else {
            format!(
                "：{}",
                tail.chars()
                    .rev()
                    .take(300)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<String>()
            )
        };
        emit(on_event, &json!({"t": "error", "v": format!("dsh 异常退出{why}")}));
    }
    (finished, aborted, stale)
}

/// 把 headless 新建的 dsh 会话登记进 Harness 桌面端的项目注册表
/// （~/.dsh/storages/workspace.json，会话按工作区 path 匹配归属）。尽力而为：
/// 桌面端运行中可能用内存态整文件回写盖掉本次登记——仅影响分组显示，不影响会话数据本身。
fn dsh_attach_session(cwd: &std::path::Path, session_id: &str) {
    let Some(path) = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(|h| {
            std::path::PathBuf::from(h)
                .join(".dsh")
                .join("storages")
                .join("workspace.json")
        })
    else {
        return;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else { return };
    let Ok(mut v) = serde_json::from_str::<Value>(&raw) else { return };
    // 路径归一化：分隔符统一为 \、去尾分隔符、忽略大小写
    let norm = |p: &str| p.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let cwd_str = cwd.to_string_lossy();
    let target = norm(&cwd_str);
    let Some(workspaces) = v["tables"]["workspaces"].as_object_mut() else { return };
    let mut matched: Option<String> = None;
    for (k, w) in workspaces.iter() {
        if w["path"].as_str().is_some_and(|p| norm(p) == target) {
            matched = Some(k.clone());
            break;
        }
    }
    let now = iso_utc_now();
    match matched {
        Some(k) => {
            if let Some(w) = workspaces.get_mut(&k) {
                if let Some(ids) = w["sessionIds"].as_array_mut() {
                    if !ids.iter().any(|x| x.as_str() == Some(session_id)) {
                        ids.push(json!(session_id));
                        w["updatedAt"] = json!(now);
                    }
                }
            }
        }
        None => {
            // 该目录从未在桌面端打开过：新建工作区条目，标题取目录名
            let id = uuid_v4();
            workspaces.insert(
                id.clone(),
                json!({
                    "path": cwd_str,
                    "title": cwd
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| cwd_str.to_string()),
                    "sessionIds": [session_id],
                    "createdAt": now,
                    "updatedAt": now,
                }),
            );
            if let Some(ids) = v["global"]["workspaceIds"].as_array_mut() {
                if !ids.iter().any(|x| x.as_str() == Some(&id)) {
                    ids.push(json!(id));
                }
            }
        }
    }
    let tmp = path.with_extension("json.longjing-tmp");
    if std::fs::write(&tmp, serde_json::to_string_pretty(&v).unwrap_or_default()).is_ok() {
        for _ in 0..3 {
            if std::fs::rename(&tmp, &path).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        let _ = std::fs::remove_file(&tmp);
    }
}

fn uuid_v4() -> String {
    use ring::rand::SecureRandom;
    let mut b = [0u8; 16];
    if ring::rand::SystemRandom::new().fill(&mut b).is_err() {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        b = n.to_le_bytes();
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: Vec<String> = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}{}{}{}-{}{}-{}{}-{}{}-{}{}{}{}{}{}",
        h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10], h[11], h[12], h[13],
        h[14], h[15]
    )
}

/// UTC 当前时间，Harness workspace.json 使用的 ISO-8601 毫秒格式（2026-09-04T03:29:11.377Z）
fn iso_utc_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let (days, sod) = (secs / 86400, secs % 86400);
    // 天数 → 公历年月日（Howard Hinnant civil_from_days 算法）
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dday = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 };
    format!(
        "{y:04}-{m:02}-{dday:02}T{:02}:{:02}:{:02}.{ms:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        ms = d.subsec_millis()
    )
}

/// 解析 dsh headless 的 NDJSON 事件行并转发到前端；返回本次携带的会话 id（若有）
fn process_dsh_line(
    line: &str,
    on_event: &IpcChannel,
    finished: &mut bool,
    stale: &mut bool,
    got_text: &mut bool,
    err_reason: &mut Option<String>,
) -> Option<String> {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return None;
    };
    let mut new_sid = None;
    match v["type"].as_str() {
        Some("session") => {
            if let Some(sid) = v["sessionId"].as_str() {
                emit(&on_event, &json!({"t": "session", "v": sid}));
                new_sid = Some(sid.to_string());
            }
        }
        Some("status") => {
            // 阶段事件：headless 无 token 级流式，用它给前端活性提示
            let stage = match v["phase"].as_str() {
                Some("turn_start") => Some("开始处理"),
                Some("step_start") => Some("思考生成中"),
                _ => None,
            };
            if let Some(s) = stage {
                emit(&on_event, &json!({"t": "stage", "v": s}));
            }
            // turn 以错误收场（如凭据缺失、上游 4xx）：记录真实原因，final 空文本时透传前端
            if v["phase"].as_str() == Some("turn_end")
                && v["reason"]["kind"].as_str() == Some("error")
            {
                if let Some(msg) = v["reason"]["error"]["message"].as_str() {
                    if err_reason.is_none() {
                        *err_reason = Some(msg.to_string());
                    }
                }
            }
        }
        Some("thinking") => {
            if let Some(text) = v["text"].as_str() {
                if !text.is_empty() {
                    emit(&on_event, &json!({"t": "think", "v": text}));
                }
            }
        }
        Some("text") => {
            if let Some(text) = v["text"].as_str() {
                if !text.is_empty() {
                    emit(&on_event, &json!({"t": "delta", "v": text}));
                    *got_text = true;
                }
            }
        }
        Some("error") => {
            let msg = v["message"].as_str().unwrap_or("dsh 内部错误");
            if msg.contains("does not exist") {
                // 存储的会话 id 已失效：结束本次尝试，由外层自动新建会话重试
                *stale = true;
                *finished = true;
            } else {
                emit(&on_event, &json!({"t": "error", "v": msg}));
                *finished = true;
            }
        }
        Some("final") => *finished = true,
        _ => {}
    }
    new_sid
}
