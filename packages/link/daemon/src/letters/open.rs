use serde_json::Value;

use crate::push::{keys, seal};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Decision {
    Allow,
    Deny,
}

impl Decision {
    pub fn as_str(self) -> &'static str {
        match self {
            Decision::Allow => "allow",
            Decision::Deny => "deny",
        }
    }
}

pub enum Body {
    Decision {
        backend: String,
        session: String,
        request: Option<Value>,
        decision: Decision,
    },
    Bridge {
        message: String,
    },
}

pub struct Opened {
    pub id: String,
    pub at: u64,
    pub body: Body,
}

/// Decrypts one letter with the key of the device that wrote it and checks its shape. Time and
/// replay are the caller's business.
pub fn open(secret: &[u8; 32], machine_id: &str, device_id: &str, data: &[u8]) -> Option<Opened> {
    let aad = format!("{machine_id}:{device_id}");
    let key = keys::letter(secret);
    let plaintext = seal::open(&key, aad.as_bytes(), data)?;
    let value: Value = serde_json::from_slice(&plaintext).ok()?;
    if value.get("v").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    let id = value.get("id").and_then(Value::as_str)?;
    if !is_hex32(id) {
        return None;
    }
    let at = value.get("at").and_then(Value::as_u64)?;
    let body = body(&value)?;
    Some(Opened {
        id: id.to_owned(),
        at,
        body,
    })
}

fn body(value: &Value) -> Option<Body> {
    match value.get("kind").and_then(Value::as_str)? {
        "decision" => {
            let decision = match value.get("decision").and_then(Value::as_str)? {
                "allow" => Decision::Allow,
                "deny" => Decision::Deny,
                _ => return None,
            };
            Some(Body::Decision {
                backend: string(value, "backend"),
                session: string(value, "session"),
                request: value.get("request").filter(|item| !item.is_null()).cloned(),
                decision,
            })
        }
        "bridge" => Some(Body::Bridge {
            message: value.get("message").and_then(Value::as_str)?.to_owned(),
        }),
        _ => None,
    }
}

fn string(value: &Value, name: &str) -> String {
    value
        .get(name)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn is_hex32(text: &str) -> bool {
    text.len() == 32
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
