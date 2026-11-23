pub mod keys;
pub mod live_activity;
pub mod policy;
pub mod seal;

use std::time::Duration;

use serde_json::Value;

const MAX_COLLAPSE: usize = 40;
/// How long a request that was pushed is remembered, so a feed that redials and replays what is
/// still pending does not push it again. A request lives until it is answered.
const REQUEST_MEMORY: Duration = Duration::from_secs(12 * 60 * 60);
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
    /// A tool permission a lock screen can answer: Allow and Deny.
    Approval,
    /// Anything else that needs the person, answered in the app.
    Attention,
    Done,
    /// A run that ended in an error or at a limit.
    Failed,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "approval" => Some(Kind::Approval),
            "attention" => Some(Kind::Attention),
            "done" => Some(Kind::Done),
            "failed" => Some(Kind::Failed),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Approval => "approval",
            Kind::Attention => "attention",
            Kind::Done => "done",
            Kind::Failed => "failed",
        }
    }

    /// The kind the relay knows the push by; it has no word for a failure, which it treats as a
    /// finish. The phone reads the real kind from the sealed payload.
    pub fn relay_kind(self) -> &'static str {
        match self {
            Kind::Failed => "done",
            other => other.as_str(),
        }
    }

    /// Every alert is something the person asked to hear about, so none waits for a quiet moment:
    /// a normal-priority message is held back while an Android phone dozes.
    pub fn priority(self) -> &'static str {
        "high"
    }

    fn is_request(self) -> bool {
        matches!(self, Kind::Approval | Kind::Attention)
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
    /// What may not alert twice, and for how long: a request by its id, for as long as it can still
    /// be replayed; a finished run by session and moment, for `finished`.
    pub fn debounce(&self, finished: Duration) -> ((String, String), Duration) {
        if self.kind.is_request() {
            let id = self.request.unwrap_or(self.session);
            (
                (self.kind.as_str().to_owned(), id.to_owned()),
                REQUEST_MEMORY,
            )
        } else {
            let id = format!("{}:{}", self.session, self.at);
            ((self.kind.as_str().to_owned(), id), finished)
        }
    }

    /// One slot on the lock screen per request, and one per session for what finished in it, so a
    /// newer alert replaces the older instead of piling up.
    pub fn collapse(&self) -> String {
        if self.kind.is_request() {
            collapse_key("a-", self.request.unwrap_or(self.session))
        } else {
            collapse_key("d-", self.session)
        }
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

fn collapse_key(prefix: &str, group: &str) -> String {
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

/// A request the person no longer has to answer: answered on the Mac or taken back.
pub struct Resolved<'a> {
    pub backend: &'a str,
    pub session: &'a str,
    pub request: &'a str,
    pub at: u64,
}

impl Resolved<'_> {
    /// The collapse key of the alert it resolves, so a message still waiting in the provider is
    /// replaced by this one.
    pub fn collapse(&self) -> String {
        collapse_key("a-", self.request)
    }

    pub fn notification<'a>(&'a self, machine: &'a str) -> seal::Notification<'a> {
        seal::Notification {
            v: 1,
            kind: "resolved",
            title: "Answered",
            body: "This no longer needs you.",
            machine,
            backend: self.backend,
            session: self.session,
            request: Some(self.request),
            at: self.at,
        }
    }
}

/// Reads one `{"type":"link_resolved",...}` body; a malformed one is dropped.
pub fn resolved(value: &Value) -> Option<Resolved<'_>> {
    let text = |key: &str| value.get(key).and_then(Value::as_str);
    Some(Resolved {
        backend: text("backend")?,
        session: text("session")?,
        request: text("request")?,
        at: value.get("at").and_then(Value::as_u64).unwrap_or_default(),
    })
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
