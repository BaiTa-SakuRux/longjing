//! 敏感信息加密：
//! - 未设主密码：随机密钥存入 Windows 凭据管理器（系统级 DPAPI 保护）
//! - 设置主密码：密钥由主密码 PBKDF2-SHA256 派生（31 万轮），AES-256-GCM 加密
//! 数据库存的是 `enc:v1:` 前缀的密文（nonce ‖ tag ‖ ciphertext，base64）

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ring::aead::{Aad, Algorithm, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, CHACHA20_POLY1305};
use ring::pbkdf2;
use ring::rand::SecureRandom;
use std::num::NonZeroU32;

pub const PREFIX: &str = "enc:v1:";
const ITERATIONS: u32 = 310_000;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
pub type Key32 = [u8; 32];

pub fn is_encrypted(s: &str) -> bool {
    s.starts_with(PREFIX)
}

pub fn random_key() -> Result<Key32, String> {
    let rng = ring::rand::SystemRandom::new();
    let mut key = Key32::default();
    rng.fill(&mut key).map_err(|_| "生成随机密钥失败".to_string())?;
    Ok(key)
}

pub fn random_nonce() -> Result<[u8; NONCE_LEN], String> {
    let rng = ring::rand::SystemRandom::new();
    let mut n = [0u8; NONCE_LEN];
    rng.fill(&mut n).map_err(|_| "生成随机数失败".to_string())?;
    Ok(n)
}

pub fn key_to_b64(key: &Key32) -> String {
    B64.encode(key)
}

pub fn key_from_b64(s: &str) -> Result<Key32, String> {
    let raw = B64.decode(s).map_err(|e| format!("密钥解码失败：{e}"))?;
    raw.try_into().map_err(|_| "密钥长度不正确".to_string())
}

pub fn derive_key(master: &str, salt: &[u8]) -> Key32 {
    let mut key = Key32::default();
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(ITERATIONS).unwrap(),
        salt,
        master.as_bytes(),
        &mut key,
    );
    key
}

/// AES-256-GCM 加密，输出 `enc:v1:<b64(nonce ‖ tag ‖ ciphertext)>`
pub fn encrypt(key: &Key32, plain: &[u8]) -> Result<String, String> {
    let unbound = UnboundKey::new(&AES_256_GCM, key).map_err(|e| e.to_string())?;
    let sealing = LessSafeKey::new(unbound);
    let nonce_bytes = random_nonce()?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut in_out = plain.to_vec();
    let tag = sealing
        .seal_in_place_separate_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| e.to_string())?;
    let mut packed = Vec::with_capacity(NONCE_LEN + TAG_LEN + in_out.len());
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(tag.as_ref());
    packed.extend_from_slice(&in_out);
    Ok(format!("{}{}", PREFIX, B64.encode(packed)))
}

/// 解密 `enc:v1:` 前缀的密文。存储布局为 `nonce ‖ tag ‖ ciphertext`，
/// 而 ring 的 `open_in_place` 要求 `ciphertext ‖ tag`，须重排后再校验；
/// 同时容忍历史上 ChaCha20-Poly1305 写出的密文（同样布局）。
pub fn decrypt(key: &Key32, stored: &str) -> Result<Vec<u8>, String> {
    let data = stored
        .strip_prefix(PREFIX)
        .ok_or_else(|| "不是加密数据".to_string())?;
    let raw = B64.decode(data).map_err(|e| format!("密文解码失败：{e}"))?;
    if raw.len() < NONCE_LEN + TAG_LEN {
        return Err("密文过短".to_string());
    }
    let nonce_bytes: [u8; NONCE_LEN] = raw[..NONCE_LEN]
        .try_into()
        .map_err(|_| "nonce 长度错误".to_string())?;
    let tag = &raw[NONCE_LEN..NONCE_LEN + TAG_LEN];
    let algs: [&Algorithm; 2] = [&AES_256_GCM, &CHACHA20_POLY1305];
    for alg in algs {
        let unbound = UnboundKey::new(alg, key).map_err(|e| e.to_string())?;
        let mut in_out = raw[NONCE_LEN + TAG_LEN..].to_vec();
        in_out.extend_from_slice(tag);
        let opening = LessSafeKey::new(unbound);
        let nonce =
            Nonce::try_assume_unique_for_key(&nonce_bytes).map_err(|e| e.to_string())?;
        if let Ok(plain) = opening.open_in_place(nonce, Aad::empty(), &mut in_out) {
            return Ok(plain.to_vec());
        }
    }
    Err("解密失败（主密码错误或数据损坏）".to_string())
}

/// 加密明文字符串（空值原样返回）
pub fn encrypt_str(key: &Key32, plain: &str) -> Result<String, String> {
    if plain.is_empty() {
        return Ok(String::new());
    }
    if is_encrypted(plain) {
        return Ok(plain.to_string());
    }
    encrypt(key, plain.as_bytes())
}

/// 解密字符串（未加密的原样返回）
pub fn decrypt_str(key: &Key32, stored: &str) -> Result<String, String> {
    if !is_encrypted(stored) {
        return Ok(stored.to_string());
    }
    let bytes = decrypt(key, stored)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aes_roundtrip_minimal() {
        let key = [42u8; 32];
        let ct = encrypt(&key, b"hello world").unwrap();
        eprintln!("[T1] ct={}", ct);
        let pt = decrypt(&key, &ct).unwrap();
        assert_eq!(pt, b"hello world");
    }

    #[test]
    fn aes_roundtrip_random_key() {
        let key = random_key().unwrap();
        let mut fail = 0;
        for i in 0..200 {
            let msg = format!("message-{i}");
            let ct = encrypt(&key, msg.as_bytes()).unwrap();
            let pt = decrypt(&key, &ct).unwrap();
            if pt != msg.as_bytes() {
                fail += 1;
            }
        }
        eprintln!("[RATE] 200 次回环失败 {} 次", fail);
        assert_eq!(fail, 0, "回环解密失败");
    }

    #[test]
    fn decrypt_tolerates_legacy_chacha() {
        let key = [7u8; 32];
        // 手工构造 ChaCha20-Poly1305、与 encrypt 相同布局的密文（历史上误切算法时期写出的格式）
        let unbound = UnboundKey::new(&CHACHA20_POLY1305, &key).unwrap();
        let sealing = LessSafeKey::new(unbound);
        let nonce_bytes = random_nonce().unwrap();
        let mut in_out = b"legacy secret".to_vec();
        let tag = sealing
            .seal_in_place_separate_tag(
                Nonce::assume_unique_for_key(nonce_bytes),
                Aad::empty(),
                &mut in_out,
            )
            .unwrap();
        let mut packed = Vec::new();
        packed.extend_from_slice(&nonce_bytes);
        packed.extend_from_slice(tag.as_ref());
        packed.extend_from_slice(&in_out);
        let stored = format!("{}{}", PREFIX, B64.encode(packed));
        assert_eq!(decrypt(&key, &stored).unwrap(), b"legacy secret");
    }

    #[test]
    fn derive_is_deterministic() {
        let salt = [
            1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        ];
        let k1 = derive_key("same-password", &salt);
        let k2 = derive_key("same-password", &salt);
        assert_eq!(k1, k2);
        let k3 = derive_key("other-password", &salt);
        assert_ne!(k1, k3);
    }
}
