use serde::Serialize;
use tokio::sync::oneshot;

/// One opaque push the relay hands to APNs or FCM.
pub struct PushRequest {
    pub platform: String,
    pub token: String,
    pub kind: &'static str,
    pub data: String,
    pub collapse: Option<String>,
    pub priority: &'static str,
}

impl PushRequest {
    pub(super) fn message(&self) -> Push<'_> {
        Push {
            t: "push",
            platform: &self.platform,
            token: &self.token,
            kind: self.kind,
            data: &self.data,
            collapse: self.collapse.as_deref(),
            priority: self.priority,
        }
    }
}

#[derive(Serialize)]
pub(super) struct Push<'a> {
    t: &'static str,
    platform: &'a str,
    token: &'a str,
    kind: &'a str,
    data: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    collapse: Option<&'a str>,
    priority: &'a str,
}

/// Work another task asks the relay socket to carry.
pub enum RelayCommand {
    Push(PushRequest),
    LetterAck(u64),
    Sleep { done: oneshot::Sender<()> },
}
