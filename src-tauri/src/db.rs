use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::AppError;

pub struct Db(pub Mutex<Connection>);

/// 运行时数据目录：编译期常量指向项目 data\，支持 LONGJING_DATA_DIR 环境变量覆盖
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("LONGJING_DATA_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
}

pub fn init() -> Result<Connection, AppError> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("longjing.db"))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS hosts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            username TEXT NOT NULL,
            auth_type TEXT NOT NULL DEFAULT 'password',
            password TEXT,
            key_path TEXT,
            key_passphrase TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS known_hosts (
            addr TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            added_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            name TEXT PRIMARY KEY,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );",
    )?;
    // 增量迁移：hosts.project（项目分组）
    let has_project: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('hosts') WHERE name = 'project'",
        [],
        |r| r.get(0),
    )?;
    if has_project == 0 {
        conn.execute("ALTER TABLE hosts ADD COLUMN project TEXT NOT NULL DEFAULT ''", [])?;
    }
    Ok(conn)
}

/* ---- 通用键值设置（终端偏好等） ---- */

pub(crate) fn settings_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0)).ok()
}

pub(crate) fn settings_set(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_setting(db: tauri::State<'_, Db>, key: String) -> Result<Option<String>, AppError> {
    let conn = db.0.lock().unwrap();
    Ok(settings_get(&conn, &key))
}

#[tauri::command]
pub fn set_setting(db: tauri::State<'_, Db>, key: String, value: String) -> Result<(), AppError> {
    let conn = db.0.lock().unwrap();
    settings_set(&conn, &key, &value)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String, // "password" | "key"
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub key_passphrase: Option<String>,
    #[serde(default)]
    pub project: String,
}

#[derive(Debug, Deserialize)]
pub struct NewHost {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
}

fn host_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Host> {
    Ok(Host {
        id: row.get("id")?,
        name: row.get("name")?,
        host: row.get("host")?,
        port: row.get::<_, i64>("port")? as u16,
        username: row.get("username")?,
        auth_type: row.get("auth_type")?,
        password: row.get("password")?,
        key_path: row.get("key_path")?,
        key_passphrase: row.get("key_passphrase")?,
        project: row.get("project").unwrap_or_default(),
    })
}

pub fn get_host(conn: &Connection, id: i64) -> Result<Host, AppError> {
    Ok(conn.query_row("SELECT * FROM hosts WHERE id = ?1", [id], host_from_row)?)
}

pub fn get_known_fingerprint(conn: &Connection, addr: &str) -> Result<Option<String>, AppError> {
    let mut stmt = conn.prepare("SELECT fingerprint FROM known_hosts WHERE addr = ?1")?;
    let mut rows = stmt.query([addr])?;
    Ok(match rows.next()? {
        Some(row) => Some(row.get(0)?),
        None => None,
    })
}

pub fn save_known_fingerprint(conn: &Connection, addr: &str, fingerprint: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO known_hosts (addr, fingerprint) VALUES (?1, ?2)
         ON CONFLICT(addr) DO UPDATE SET fingerprint = excluded.fingerprint",
        [addr, fingerprint],
    )?;
    Ok(())
}

#[tauri::command]
pub fn list_hosts(db: tauri::State<'_, Db>) -> Result<Vec<Host>, AppError> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT * FROM hosts ORDER BY id")?;
    let hosts = stmt
        .query_map([], host_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(hosts)
}

#[tauri::command]
pub fn add_host(db: tauri::State<'_, Db>, host: NewHost) -> Result<Host, AppError> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO hosts (name, host, port, username, auth_type, password, key_path, key_passphrase, project)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            host.name,
            host.host,
            host.port,
            host.username,
            host.auth_type,
            host.password,
            host.key_path,
            host.key_passphrase,
            host.project.clone().unwrap_or_default(),
        ],
    )?;
    Ok(get_host(&conn, conn.last_insert_rowid())?)
}

#[tauri::command]
pub fn update_host(db: tauri::State<'_, Db>, host: Host) -> Result<(), AppError> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE hosts SET name=?1, host=?2, port=?3, username=?4, auth_type=?5, password=?6, key_path=?7, key_passphrase=?8, project=?9 WHERE id=?10",
        rusqlite::params![
            host.name,
            host.host,
            host.port,
            host.username,
            host.auth_type,
            host.password,
            host.key_path,
            host.key_passphrase,
            host.project,
            host.id,
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub fn delete_host(db: tauri::State<'_, Db>, id: i64) -> Result<(), AppError> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM hosts WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub fn accept_fingerprint(db: tauri::State<'_, Db>, host_id: i64, fingerprint: String) -> Result<(), AppError> {
    let host = {
        let conn = db.0.lock().unwrap();
        save_known_fingerprint(&conn, &addr_of(&get_host(&conn, host_id)?), &fingerprint)
    };
    host
}

pub fn addr_of(host: &Host) -> String {
    format!("{}:{}", host.host, host.port)
}

/// 导出主机列表（含明文密码/密钥路径）到 JSON 文件，供换机迁移
#[tauri::command]
pub fn hosts_export(db: tauri::State<'_, Db>, path: String) -> Result<usize, AppError> {
    let hosts = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM hosts ORDER BY id")?;
        stmt.query_map([], host_from_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    let json = serde_json::to_string_pretty(&hosts)?;
    std::fs::write(&path, json)?;
    Ok(hosts.len())
}

/* ---- 项目分组 ---- */

#[tauri::command]
pub fn list_projects(db: tauri::State<'_, Db>) -> Result<Vec<String>, AppError> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT name FROM projects ORDER BY name COLLATE NOCASE")?;
    let list = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub fn create_project(db: tauri::State<'_, Db>, name: String) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() || name == "未分组" {
        return Err(AppError::other("项目名不能为空或「未分组」"));
    }
    let conn = db.0.lock().unwrap();
    conn.execute("INSERT OR IGNORE INTO projects (name) VALUES (?1)", [name])?;
    Ok(())
}

#[tauri::command]
pub fn rename_project(db: tauri::State<'_, Db>, old: String, new: String) -> Result<(), AppError> {
    let new = new.trim();
    if new.is_empty() || new == "未分组" {
        return Err(AppError::other("项目名不能为空或「未分组」"));
    }
    let conn = db.0.lock().unwrap();
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE name = ?1",
        [new],
        |r| r.get(0),
    )?;
    if exists > 0 {
        return Err(AppError::other(format!("项目「{new}」已存在")));
    }
    conn.execute("UPDATE projects SET name = ?2 WHERE name = ?1", rusqlite::params![old, new])?;
    conn.execute("UPDATE hosts SET project = ?2 WHERE project = ?1", rusqlite::params![old, new])?;
    Ok(())
}

/// 删除项目（该项目下的主机移入「未分组」）
#[tauri::command]
pub fn delete_project(db: tauri::State<'_, Db>, name: String) -> Result<(), AppError> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM projects WHERE name = ?1", [&name])?;
    conn.execute("UPDATE hosts SET project = '' WHERE project = ?1", [&name])?;
    Ok(())
}

/// 从 JSON 导入主机：按「名称+地址+端口」去重，只增不改，返回新增数量
#[tauri::command]
pub fn hosts_import(db: tauri::State<'_, Db>, path: String) -> Result<usize, AppError> {
    let text = std::fs::read_to_string(&path)?;
    let hosts: Vec<Host> = serde_json::from_str(&text)
        .map_err(|e| AppError::other(format!("文件格式不正确（需要本应用导出的 JSON）：{e}")))?;
    let conn = db.0.lock().unwrap();
    let mut inserted = 0;
    for h in hosts {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM hosts WHERE name = ?1 AND host = ?2 AND port = ?3",
            rusqlite::params![h.name, h.host, h.port],
            |r| r.get(0),
        )?;
        if exists > 0 {
            continue;
        }
        conn.execute(
            "INSERT INTO hosts (name, host, port, username, auth_type, password, key_path, key_passphrase, project)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                h.name,
                h.host,
                h.port,
                h.username,
                h.auth_type,
                h.password,
                h.key_path,
                h.key_passphrase,
                h.project,
            ],
        )?;
        inserted += 1;
    }
    Ok(inserted)
}
