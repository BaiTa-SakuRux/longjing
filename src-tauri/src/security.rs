//! 安全状态与主密码管理：
//! - 未设主密码：随机密钥存入系统凭据管理器（DPAPI 保护）
//! - 设置主密码：密钥由主密码派生，启动后需解锁一次（缓存在内存，重启即失）

use rusqlite::Connection;
use std::sync::Mutex;

use crate::crypto::{self, Key32};
use crate::db::{settings_get, settings_set, Db};
use crate::error::AppError;

const SALT_LEN: usize = 16;

#[derive(Default)]
pub struct SecurityState {
    /// 已解锁的密钥（仅内存，重启即失）
    cached_key: Mutex<Option<Key32>>,
}

impl SecurityState {
    pub fn new() -> Self {
        Self { cached_key: Mutex::new(None) }
    }

    pub fn cache_key(&self, key: Key32) {
        *self.cached_key.lock().unwrap() = Some(key);
    }

    /// 手动/闲置锁定：清除内存中的主密码派生密钥（下次敏感操作需重新解锁）
    pub fn clear_cache(&self) {
        *self.cached_key.lock().unwrap() = None;
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hex_decode(s: &str) -> Result<Vec<u8>, AppError> {
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| AppError::other(e.to_string()))
        })
        .collect()
}

/// 手动锁定：清除内存缓存的主密码派生密钥
#[tauri::command]
pub fn security_lock(security: tauri::State<'_, SecurityState>) -> Result<(), AppError> {
    security.clear_cache();
    Ok(())
}

/// 是否处于主密码模式
pub fn master_mode(conn: &Connection) -> bool {
    settings_get(conn, "mp_check").is_some()
}

/// 解析当前加密密钥：
/// - 主密码模式：派生密钥（优先用内存缓存，首次需传入主密码并校验）
/// - 普通模式：凭据管理器中的系统保护密钥
pub fn resolve_key(
    security: &SecurityState,
    conn: &Connection,
    master: Option<&str>,
) -> Result<Key32, AppError> {
    if !master_mode(conn) {
        return system_key();
    }
    if let Some(key) = *security.cached_key.lock().unwrap() {
        return Ok(key);
    }
    let master = master
        .filter(|m| !m.is_empty())
        .ok_or(AppError::MasterLocked)?;
    let key = derive_master_key(conn, master)?;
    security.cache_key(key);
    Ok(key)
}

/// 由主密码派生密钥并校验 mp_check
fn derive_master_key(conn: &Connection, master: &str) -> Result<Key32, AppError> {
    let salt_hex = settings_get(conn, "mp_salt")
        .ok_or_else(|| AppError::other("主密码数据损坏（缺 salt）"))?;
    let salt = hex_decode(&salt_hex)?;
    let key = crypto::derive_key(master, &salt);
    let check = settings_get(conn, "mp_check")
        .ok_or_else(|| AppError::other("主密码数据损坏（缺校验）"))?;
    #[cfg(test)]
    eprintln!("[D] 读取 mp_check={}", check);
    let check_dec = crypto::decrypt(&key, &check);
    check_dec.map_err(|e| AppError::other(format!("主密码错误（原始错误：{e}）")))?;
    Ok(key)
}

/// 普通模式的系统保护密钥：存于凭据管理器，首次访问时生成
pub fn system_key() -> Result<Key32, AppError> {
    let entry = keyring::Entry::new("LongjingX", "dbkey")
        .map_err(|e| AppError::other(e.to_string()))?;
    match entry.get_password() {
        Ok(b64) => crypto::key_from_b64(&b64).map_err(AppError::other),
        Err(keyring::Error::NoEntry) => {
            let key = crypto::random_key().map_err(AppError::other)?;
            entry
                .set_password(&crypto::key_to_b64(&key))
                .map_err(|e| AppError::other(e.to_string()))?;
            Ok(key)
        }
        Err(e) => Err(AppError::other(e.to_string())),
    }
}

/* ---------- 待重加密密文的收集与回写 ---------- */

struct PlainSecrets {
    /// (host_id, password, key_passphrase) —— 已解密为明文
    hosts: Vec<(i64, Option<String>, Option<String>)>,
    ai_api_key: Option<String>,
}

fn collect_plaintext(conn: &Connection, key: &Key32) -> Result<PlainSecrets, AppError> {
    let mut stmt = conn.prepare("SELECT id, password, key_passphrase FROM hosts")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut hosts = Vec::new();
    for (id, password, kp) in rows {
        let dec = |v: Option<String>| -> Result<Option<String>, AppError> {
            match v {
                Some(s) if !s.is_empty() => Ok(Some(crypto::decrypt_str(key, &s)?)),
                _ => Ok(None),
            }
        };
        hosts.push((id, dec(password)?, dec(kp)?));
    }
    let ai_api_key = settings_get(conn, "ai").map(|raw| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            v["api_key"]
                .as_str()
                .filter(|s| crypto::is_encrypted(s))
                .map(|s| crypto::decrypt_str(key, s).unwrap_or_default())
        } else {
            None
        }
    }).flatten();
    Ok(PlainSecrets { hosts, ai_api_key })
}

fn write_encrypted(conn: &Connection, key: &Key32, secrets: &PlainSecrets) -> Result<(), AppError> {
    for (id, password, kp) in &secrets.hosts {
        let enc_pw = password.as_deref().map(|p| crypto::encrypt_str(key, p)).transpose()?;
        let enc_kp = kp.as_deref().map(|p| crypto::encrypt_str(key, p)).transpose()?;
        conn.execute(
            "UPDATE hosts SET password = ?2, key_passphrase = ?3 WHERE id = ?1",
            rusqlite::params![id, enc_pw, enc_kp],
        )?;
    }
    if let Some(ai_raw) = settings_get(conn, "ai") {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&ai_raw) {
            if let Some(k) = &secrets.ai_api_key {
                if !k.is_empty() {
                    v["api_key"] = serde_json::Value::String(crypto::encrypt_str(key, k)?);
                }
            }
            settings_set(conn, "ai", &serde_json::to_string(&v)?)?;
        }
    }
    Ok(())
}

/* ---------- 命令 ---------- */

/// 主密码是否已设置（前端据此决定是否弹解锁框）
#[tauri::command]
pub fn security_status(db: tauri::State<'_, Db>) -> Result<bool, AppError> {
    let conn = db.0.lock().unwrap();
    Ok(master_mode(&conn))
}

/// 设置主密码：重加密全部敏感信息（需要当前主密码或无需解锁）
#[tauri::command]
pub async fn mp_setup(
    security: tauri::State<'_, SecurityState>,
    db: tauri::State<'_, Db>,
    password: String,
    current_master: Option<String>,
) -> Result<(), AppError> {
    if password.len() < 6 {
        return Err(AppError::other("主密码至少 6 个字符"));
    }
    tokio::task::block_in_place(|| {
        let conn = db.0.lock().unwrap();
        let current_key = resolve_key(&security, &conn, current_master.as_deref())?;
        let plain = collect_plaintext(&conn, &current_key)?;

        let salt: [u8; SALT_LEN] = rand_bytes()?;
        let new_key = crypto::derive_key(&password, &salt);
        settings_set(&conn, "mp_salt", &hex_encode(&salt))?;
        settings_set(
            &conn,
            "mp_check",
            &crypto::encrypt(&new_key, b"longjing-verify")?,
        )?;
        write_encrypted(&conn, &new_key, &plain)?;
        security.cache_key(new_key);
        Ok(())
    })
}

/// 清除主密码：全部敏感信息改回系统级存储加密
#[tauri::command]
pub async fn mp_clear(
    security: tauri::State<'_, SecurityState>,
    db: tauri::State<'_, Db>,
    password: String,
) -> Result<(), AppError> {
    tokio::task::block_in_place(|| {
        let conn = db.0.lock().unwrap();
        let current_key = derive_master_key(&conn, &password)?;
        let plain = collect_plaintext(&conn, &current_key)?;

        let sys_key = system_key()?;
        settings_set(&conn, "mp_check", "")?;
        settings_set(&conn, "mp_salt", "")?;
        conn.execute("DELETE FROM settings WHERE key IN ('mp_check','mp_salt')", [])?;
        write_encrypted(&conn, &sys_key, &plain)?;
        security.cache_key(sys_key);
        Ok(())
    })
}

/// 校验主密码并缓存派生密钥（解锁）
#[tauri::command]
pub async fn mp_verify(
    security: tauri::State<'_, SecurityState>,
    db: tauri::State<'_, Db>,
    password: String,
) -> Result<bool, AppError> {
    tokio::task::block_in_place(|| {
        let conn = db.0.lock().unwrap();
        match derive_master_key(&conn, &password) {
            Ok(key) => {
                security.cache_key(key);
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    })
}

fn rand_bytes<const N: usize>() -> Result<[u8; N], AppError> {
    use ring::rand::SecureRandom;
    let rng = ring::rand::SystemRandom::new();
    let mut b = [0u8; N];
    rng.fill(&mut b).map_err(|_| AppError::other("生成随机数失败"))?;
    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, host TEXT, port INTEGER, username TEXT, auth_type TEXT, password TEXT, key_path TEXT, key_passphrase TEXT, project TEXT DEFAULT '', created_at TEXT);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO hosts (name, host, port, username, auth_type, password, project) VALUES ('h1','1.2.3.4',22,'root','password','secret123','p1')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn master_password_full_flow() {
        let security = SecurityState::new();
        let conn = test_db();
        let master = "test123";

        // mp_setup 等效流程：先用系统密钥加密存量明文 → 再切换主密码密钥
        let sys_key = system_key().unwrap();
        let plain = collect_plaintext(&conn, &sys_key).unwrap();
        assert_eq!(plain.hosts[0].1.as_deref(), Some("secret123"));
        assert_eq!(plain.hosts[0].2.as_deref(), None);

        let salt: [u8; SALT_LEN] = rand_bytes().unwrap();
        let new_key = crypto::derive_key(master, &salt);
        #[cfg(test)]
        eprintln!("[dbg-setup] salt={} key[..4]={:02x?}", hex_encode(&salt), &new_key[..4]);
        settings_set(&conn, "mp_salt", &hex_encode(&salt)).unwrap();

        // 原语回环自检：同一密钥加密后立即解密
        {
            let ct = crypto::encrypt(&new_key, b"longjing-verify").unwrap();
            let pt = crypto::decrypt(&new_key, &ct).unwrap();
            assert_eq!(pt, b"longjing-verify", "AES-GCM 原语回环失败");
        }
        let mp_check_ct = crypto::encrypt(&new_key, b"longjing-verify").unwrap();
        eprintln!("[E] 写入 mp_check={}", mp_check_ct);
        eprintln!("[E] setup salt={} new_key={}", hex_encode(&salt), hex_encode(&new_key));
        eprintln!("[E] mp_check_ct={}", mp_check_ct);
        settings_set(&conn, "mp_salt", &hex_encode(&salt)).unwrap();
        settings_set(&conn, "mp_check", &mp_check_ct).unwrap();
        write_encrypted(&conn, &new_key, &plain).unwrap();
        security.cache_key(new_key);

        // mp_verify 等效：正确密码 → 解出 mp_check
        let readback_salt = settings_get(&conn, "mp_salt").unwrap();
        let decoded_salt = hex_decode(&readback_salt).unwrap();
        let key_re = crypto::derive_key(master, &decoded_salt);
        eprintln!("[S2] 库中salt={} 重派生key[..4]={:02x?}", readback_salt, &key_re[..4]);
        assert_eq!(key_re[..4], new_key[..4], "重派生密钥与加密时不一致");
        assert_eq!(readback_salt, hex_encode(&salt), "存储的 salt 与写入不一致");

        let key2 = derive_master_key(&conn, master).unwrap();
        let check = settings_get(&conn, "mp_check").unwrap();
        let plain_check = crypto::decrypt(&key2, &check).unwrap();
        assert_eq!(plain_check, b"longjing-verify");

        // 错误密码 → 解密必须失败
        let wrong = crypto::derive_key("wrong", &salt);
        assert!(crypto::decrypt(&wrong, &check).is_err());

        // 解密主机密码 → 与原文一致
        let stored = settings_get; // 占位避免未使用告警
        let _ = stored;
        let pw: String = conn
            .query_row("SELECT password FROM hosts WHERE name='h1'", [], |r| r.get(0))
            .unwrap();
        assert!(crypto::is_encrypted(&pw));
        let dec = crypto::decrypt(&key2, &pw).unwrap();
        assert_eq!(String::from_utf8(dec).unwrap(), "secret123");
    }
}
