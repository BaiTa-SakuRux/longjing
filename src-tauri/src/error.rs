use serde::Serialize;

/// 统一错误：可序列化为前端可识别的 JSON（tag = kind）
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    /// 首次连接、主机指纹未知（TOFU 流程的起点）
    UnknownHost { message: String, fingerprint: String },
    /// 服务器指纹与库中记录不一致（可能是中间人，需用户显式处理）
    HostKeyChanged { message: String, fingerprint: String },
    /// 认证失败
    Auth { message: String },
    Ssh { message: String },
    Db { message: String },
    Io { message: String },
    Other { message: String },
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::UnknownHost { message, .. } => write!(f, "{message}"),
            AppError::HostKeyChanged { message, .. } => write!(f, "{message}"),
            AppError::Auth { message } => write!(f, "{message}"),
            AppError::Ssh { message } => write!(f, "{message}"),
            AppError::Db { message } => write!(f, "{message}"),
            AppError::Io { message } => write!(f, "{message}"),
            AppError::Other { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db { message: e.to_string() }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io { message: e.to_string() }
    }
}

impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self {
        AppError::Ssh { message: e.to_string() }
    }
}

impl From<russh_sftp::client::error::Error> for AppError {
    fn from(e: russh_sftp::client::error::Error) -> Self {
        AppError::Ssh { message: e.to_string() }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other { message: e.to_string() }
    }
}

impl AppError {
    pub fn other(msg: impl Into<String>) -> Self {
        AppError::Other { message: msg.into() }
    }
}
