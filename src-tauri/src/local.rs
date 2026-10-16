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
