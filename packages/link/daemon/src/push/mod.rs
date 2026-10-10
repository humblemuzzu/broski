pub mod keys;
pub mod policy;
pub mod seal;

use serde_json::Value;

const MAX_COLLAPSE: usize = 40;
const MAX_TOKEN: usize = 512;

/// The platforms a phone may register for; anything else is ignored.
pub fn platform(text: &str) -> Option<&'static str> {
    match text {
        "apns" => Some("apns"),
        "fcm" => Some("fcm"),
        _ => None,
    }
}

/// The relay's own push-token rule: printable ASCII, bounded.
pub fn valid_token(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_TOKEN && text.bytes().all(|byte| byte.is_ascii_graphic())
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Approval,
    Attention,
    Done,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "approval" => Some(Kind::Approval),
            "attention" => Some(Kind::Attention),
            "done" => Some(Kind::Done),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Approval => "approval",
            Kind::Attention => "attention",
            Kind::Done => "done",
        }
    }

    pub fn priority(self) -> &'static str {
        match self {
            Kind::Approval | Kind::Attention => "high",
            Kind::Done => "normal",
        }
    }

    /// `request` groups an approval or attention alert; a finish has only its session.
    fn debounce_key(self, request: Option<&str>, session: &str) -> String {
        match self {
            Kind::Done => session.to_owned(),
            _ => request.unwrap_or(session).to_owned(),
        }
    }
}

/// One `link_event` from the bridge feed, as the push policy reads it.
pub struct Event<'a> {
    pub kind: Kind,
    pub backend: &'a str,
    pub session: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub at: u64,
    pub request: Option<&'a str>,
}

impl Event<'_> {
    /// The `(kind, request|session)` pair the debounce window keys on.
    pub fn debounce(&self) -> (String, String) {
        (
            self.kind.as_str().to_owned(),
            self.kind.debounce_key(self.request, self.session),
        )
    }

    pub fn collapse(&self) -> String {
        let group = self.kind.debounce_key(self.request, self.session);
        let prefix = if self.kind == Kind::Done { "d-" } else { "a-" };
        let mut out = String::with_capacity(prefix.len() + MAX_COLLAPSE);
        out.push_str(prefix);
        out.extend(
            group
                .bytes()
                .filter(u8::is_ascii_graphic)
                .take(MAX_COLLAPSE)
                .map(char::from),
        );
        out
    }

    pub fn notification<'a>(&'a self, machine: &'a str) -> seal::Notification<'a> {
        seal::Notification {
            v: 1,
            kind: self.kind.as_str(),
            title: self.title,
            body: self.body,
            machine,
            backend: self.backend,
            session: self.session,
            request: self.request,
            at: self.at,
        }
    }
}

/// Reads one `{"type":"link_event",...}` body; a malformed one is dropped.
pub fn event(value: &Value) -> Option<Event<'_>> {
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .and_then(Kind::parse)?;
    Some(Event {
        kind,
        backend: value
            .get("backend")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        session: value
            .get("session")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        body: value
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        at: value.get("at").and_then(Value::as_u64).unwrap_or_default(),
        request: value.get("request").and_then(Value::as_str),
    })
}
