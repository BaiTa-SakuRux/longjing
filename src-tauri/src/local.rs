use crate::error::AppError;
use crate::sftp::FsEntry;

/// path 为空时列出 Windows 盘符
#[tauri::command]
pub fn local_list(path: String) -> Result<(String, Vec<FsEntry>), AppError> {
    // 空路径 = 盘符列表层
    if path.trim().is_empty() {
        let mut roots = Vec::new();
        for c in b'A'..=b'Z' {
            let drive = format!("{}:\\", c as char);
            if std::path::Path::new(&drive).exists() {
                roots.push(FsEntry {
                    name: drive.clone(),
                    is_dir: true,
                    size: 0,
                    mtime: None,
                });
            }
        }
        return Ok(("".to_string(), roots));
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as u32);
        out.push(FsEntry {
            is_dir: meta.is_dir(),
            size: meta.len(),
            mtime,
            name,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok((path, out))
}

#[tauri::command]
pub fn local_home() -> Result<String, AppError> {
    std::env::var("USERPROFILE").map_err(|_| AppError::other("无法获取用户主目录"))
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<(), AppError> {
    std::fs::create_dir(&path)?;
    Ok(())
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> Result<(), AppError> {
    std::fs::rename(&from, &to)?;
    Ok(())
}

#[tauri::command]
pub fn local_remove(path: String, is_dir: bool) -> Result<(), AppError> {
    if is_dir {
        // 仅允许删空目录；递归删除太危险，交给用户用资源管理器
        std::fs::remove_dir(&path)?;
    } else {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct TextFile {
    pub content: String,
    /// 超过 200KB 被截断
    pub truncated: bool,
}

/// 读取本地文本文件（AI 附件用）：前 8KB 含 NUL 字节判为二进制拒绝；上限 200KB
#[tauri::command]
pub fn local_read_text(path: String) -> Result<TextFile, AppError> {
    use std::io::Read;
    const MAX: usize = 200 * 1024;
    let file = std::fs::File::open(&path)
        .map_err(|e| AppError::other(format!("无法打开文件：{e}")))?;
    let mut buf = Vec::new();
    file.take((MAX + 1) as u64)
        .read_to_end(&mut buf)
        .map_err(|e| AppError::other(format!("读取失败：{e}")))?;
    if buf.first_chunk::<8>().is_some_and(|head| head.contains(&0)) {
        return Err(AppError::other("疑似二进制文件，仅支持文本内容"));
    }
    let truncated = buf.len() > MAX;
    if truncated {
        buf.truncate(MAX);
    }
    Ok(TextFile {
        content: String::from_utf8_lossy(&buf).into_owned(),
        truncated,
    })
}
