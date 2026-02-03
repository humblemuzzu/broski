use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

const ENC_SALT: &[u8] = b"broski-license-v1";
const ENC_INFO: &[u8] = b"broski-license-aes256gcm";
const LICENSE_JWS_TYP: &str = "BRSK-LICENSE";
const LICENSE_JWS_KID: &str = "v1";
const CLOCK_SKEW_SEC: i64 = 30;

// NOTE: This is a PUBLIC key (safe to ship). The corresponding private key
// must be set in Convex env as BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL.
const LICENSE_PUBLIC_KEY_SPKI_DER_B64URL: &str =
    "MCowBQYDK2VwAyEAmJztoQK7jSP-KJAmaNn30hizv9NzOhc-QNbUMO1kWgc";

static VERIFYING_KEY: OnceLock<VerifyingKey> = OnceLock::new();
static LAST_STRING: Mutex<Option<CString>> = Mutex::new(None);

fn store_string(s: String) -> *const std::os::raw::c_char {
    let c = CString::new(s).unwrap_or_else(|_| CString::new("").unwrap());
    let ptr = c.as_ptr();
    *LAST_STRING.lock().unwrap() = Some(c);
    ptr
}

fn get_verifying_key() -> &'static VerifyingKey {
    VERIFYING_KEY.get_or_init(|| {
        let der = URL_SAFE_NO_PAD
            .decode(LICENSE_PUBLIC_KEY_SPKI_DER_B64URL.as_bytes())
            .expect("invalid embedded public key");
        VerifyingKey::from_public_key_der(&der).expect("invalid public key der")
    })
}

fn sha256_base64url(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    let out = hasher.finalize();
    URL_SAFE_NO_PAD.encode(out)
}

fn read_machine_source() -> String {
    #[cfg(target_os = "linux")]
    {
        for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(s) = std::fs::read_to_string(p) {
                let t = s.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Best-effort: IOPlatformUUID is stable per machine install.
        let out = Command::new("/usr/sbin/ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                for line in s.lines() {
                    if line.contains("IOPlatformUUID") {
                        // "IOPlatformUUID" = "XXXX-...."
                        if let Some(idx) = line.find('=') {
                            let v = line[idx + 1..].trim().trim_matches('"').trim();
                            if !v.is_empty() {
                                return v.to_string();
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Best-effort: WMIC uuid (may be disabled on newer Windows).
        let out = Command::new("wmic")
            .args(["csproduct", "get", "uuid"])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                for line in s.lines() {
                    let t = line.trim();
                    if t.is_empty() || t.eq_ignore_ascii_case("uuid") {
                        continue;
                    }
                    return t.to_string();
                }
            }
        }
    }

    // Fallback: hostname + platform. Not ideal, but better than nothing.
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());
    format!(
        "{}:{}:{}",
        host,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

fn derive_key(machine_id_hash: &str) -> [u8; 32] {
    let ikm = machine_id_hash.as_bytes();
    let hk = Hkdf::<Sha256>::new(Some(ENC_SALT), ikm);
    let mut okm = [0u8; 32];
    hk.expand(ENC_INFO, &mut okm).expect("hkdf expand");
    okm
}

fn aes_encrypt(plaintext: &[u8], machine_id_hash: &str) -> String {
    let key = derive_key(machine_id_hash);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes init");
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext).expect("encrypt");
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    URL_SAFE_NO_PAD.encode(out)
}

fn aes_decrypt(enc_b64url: &str, machine_id_hash: &str) -> Result<Vec<u8>, String> {
    let raw = URL_SAFE_NO_PAD
        .decode(enc_b64url.as_bytes())
        .map_err(|_| "invalid base64".to_string())?;
    if raw.len() < 12 + 16 {
        return Err("ciphertext too short".to_string());
    }
    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let key = derive_key(machine_id_hash);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "aes init".to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decrypt failed".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LicenseClaims {
    pub appUserId: String,
    pub sessionTokenHash: String,
    pub machineIdHash: String,
    pub entitled: bool,
    pub status: String,
    pub iat: i64,
    pub exp: i64,
}

fn verify_jws_and_extract_claims(
    jws: &str,
    machine_id_hash: &str,
) -> Result<LicenseClaims, String> {
    let parts: Vec<&str> = jws.split('.').collect();
    if parts.len() != 3 {
        return Err("invalid jws".to_string());
    }
    let header_b64 = parts[0];
    let payload_b64 = parts[1];
    let sig_b64 = parts[2];

    // Header check: require our expected typ/kid and alg.
    let header_bytes = URL_SAFE_NO_PAD
        .decode(header_b64.as_bytes())
        .map_err(|_| "bad header".to_string())?;
    let header_json: serde_json::Value =
        serde_json::from_slice(&header_bytes).map_err(|_| "bad header json".to_string())?;
    let alg = header_json
        .get("alg")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if alg != "EdDSA" {
        return Err("unsupported alg".to_string());
    }
    let typ = header_json
        .get("typ")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if typ != LICENSE_JWS_TYP {
        return Err("unsupported typ".to_string());
    }
    let kid = header_json
        .get("kid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if kid != LICENSE_JWS_KID {
        return Err("unsupported kid".to_string());
    }

    let signing_input = format!("{}.{}", header_b64, payload_b64);
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64.as_bytes())
        .map_err(|_| "bad sig".to_string())?;
    if sig_bytes.len() != 64 {
        return Err("bad sig len".to_string());
    }
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| "bad sig".to_string())?;
    get_verifying_key()
        .verify(signing_input.as_bytes(), &sig)
        .map_err(|_| "signature invalid".to_string())?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64.as_bytes())
        .map_err(|_| "bad payload".to_string())?;
    let claims: LicenseClaims =
        serde_json::from_slice(&payload_bytes).map_err(|_| "bad claims".to_string())?;

    if claims.machineIdHash != machine_id_hash {
        return Err("machine mismatch".to_string());
    }
    let now = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()) as i64;
    if now > claims.exp + CLOCK_SKEW_SEC {
        return Err("license expired".to_string());
    }

    Ok(claims)
}

#[no_mangle]
pub extern "C" fn broski_machine_id_hash() -> *const std::os::raw::c_char {
    let src = read_machine_source();
    let id = sha256_base64url(src.as_bytes());
    store_string(id)
}

#[no_mangle]
pub extern "C" fn broski_license_encrypt_jws(
    jws_ptr: *const std::os::raw::c_char,
    machine_id_hash_ptr: *const std::os::raw::c_char,
) -> *const std::os::raw::c_char {
    if jws_ptr.is_null() || machine_id_hash_ptr.is_null() {
        return store_string("".to_string());
    }
    let jws = unsafe { std::ffi::CStr::from_ptr(jws_ptr) }
        .to_string_lossy()
        .to_string();
    let machine_id_hash = unsafe { std::ffi::CStr::from_ptr(machine_id_hash_ptr) }
        .to_string_lossy()
        .to_string();
    let enc = aes_encrypt(jws.as_bytes(), &machine_id_hash);
    store_string(enc)
}

#[no_mangle]
pub extern "C" fn broski_license_decrypt_jws(
    enc_ptr: *const std::os::raw::c_char,
    machine_id_hash_ptr: *const std::os::raw::c_char,
) -> *const std::os::raw::c_char {
    if enc_ptr.is_null() || machine_id_hash_ptr.is_null() {
        return store_string("".to_string());
    }
    let enc = unsafe { std::ffi::CStr::from_ptr(enc_ptr) }
        .to_string_lossy()
        .to_string();
    let machine_id_hash = unsafe { std::ffi::CStr::from_ptr(machine_id_hash_ptr) }
        .to_string_lossy()
        .to_string();
    match aes_decrypt(&enc, &machine_id_hash) {
        Ok(plain) => match String::from_utf8(plain) {
            Ok(s) => store_string(s),
            Err(_) => store_string("".to_string()),
        },
        Err(_) => store_string("".to_string()),
    }
}

#[no_mangle]
pub extern "C" fn broski_license_verify_jws(
    jws_ptr: *const std::os::raw::c_char,
    machine_id_hash_ptr: *const std::os::raw::c_char,
) -> i32 {
    if jws_ptr.is_null() || machine_id_hash_ptr.is_null() {
        return 0;
    }
    let jws = unsafe { std::ffi::CStr::from_ptr(jws_ptr) }
        .to_string_lossy()
        .to_string();
    let machine_id_hash = unsafe { std::ffi::CStr::from_ptr(machine_id_hash_ptr) }
        .to_string_lossy()
        .to_string();

    match verify_jws_and_extract_claims(&jws, &machine_id_hash) {
        Ok(_) => 1,
        Err(_) => 0,
    }
}

#[no_mangle]
pub extern "C" fn broski_license_claims_json(
    jws_ptr: *const std::os::raw::c_char,
    machine_id_hash_ptr: *const std::os::raw::c_char,
) -> *const std::os::raw::c_char {
    if jws_ptr.is_null() || machine_id_hash_ptr.is_null() {
        return store_string("".to_string());
    }
    let jws = unsafe { std::ffi::CStr::from_ptr(jws_ptr) }
        .to_string_lossy()
        .to_string();
    let machine_id_hash = unsafe { std::ffi::CStr::from_ptr(machine_id_hash_ptr) }
        .to_string_lossy()
        .to_string();
    match verify_jws_and_extract_claims(&jws, &machine_id_hash) {
        Ok(claims) => {
            store_string(serde_json::to_string(&claims).unwrap_or_else(|_| "".to_string()))
        }
        Err(_) => store_string("".to_string()),
    }
}

#[no_mangle]
pub extern "C" fn broski_verify_codesign(exe_path_ptr: *const std::os::raw::c_char) -> i32 {
    if exe_path_ptr.is_null() {
        return 0;
    }
    let exe_path = unsafe { std::ffi::CStr::from_ptr(exe_path_ptr) }
        .to_string_lossy()
        .to_string();

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("/usr/bin/codesign");
        cmd.args(["--verify", "--deep", "--strict", "--verbose=0", &exe_path]);
        let ok = cmd.status().map(|s| s.success()).unwrap_or(false);
        return if ok { 1 } else { 0 };
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = exe_path;
        return 1;
    }
}
