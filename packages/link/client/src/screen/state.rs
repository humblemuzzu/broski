use std::collections::VecDeque;
use std::sync::Arc;

use broski_screen::{
    Client, ClientTunnelMsg, Error as ScreenError, Rect, ScreenCloseReason, ScreenCredentials,
    ScreenEvent, ServerTunnelMsg, MAX_TUNNEL_CHUNK,
};
use tokio::sync::Notify;

use super::ScreenUpdate;

const MAX_QUEUED_UPDATES: usize = 32;

pub(crate) enum TakeScreen {
    Update(ScreenUpdate),
    Wait(Arc<Notify>),
    Finished,
}

#[derive(Default)]
pub(crate) struct ScreenSlot {
    next_id: u32,
    active: Option<ScreenSession>,
}

struct ScreenSession {
    id: u32,
    client: Client,
    updates: VecDeque<ScreenUpdate>,
    notify: Arc<Notify>,
    closed: bool,
}

impl ScreenSlot {
    pub(crate) fn open(
        &mut self,
        credentials: Option<ScreenCredentials>,
    ) -> (u32, Vec<u8>, Option<Vec<u8>>) {
        let prev_close = self.close_active(ScreenCloseReason::Normal, "replaced".to_owned());
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let id = self.next_id;
        self.active = Some(ScreenSession {
            id,
            client: Client::new(credentials),
            updates: VecDeque::new(),
            notify: Arc::new(Notify::new()),
            closed: false,
        });
        let open_frame = ClientTunnelMsg::Open { session_id: id }.encode();
        (id, open_frame, prev_close)
    }

    pub(crate) fn on_tunnel_bytes(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        let Some(msg) = ServerTunnelMsg::decode(bytes) else {
            return Vec::new();
        };
        let Some(session) = self.active.as_mut() else {
            return Vec::new();
        };
        match msg {
            ServerTunnelMsg::Opened { session_id } if session_id == session.id => Vec::new(),
            ServerTunnelMsg::Data {
                session_id,
                payload,
            } if session_id == session.id => {
                if let Err(err) = session.client.feed(&payload) {
                    let reason = match err {
                        ScreenError::AuthRejected | ScreenError::AuthFailed(_) => {
                            ScreenCloseReason::AuthFailed
                        }
                        _ => ScreenCloseReason::ProtocolError,
                    };
                    session.finish(reason, err.to_string());
                    return vec![ClientTunnelMsg::Close { session_id }.encode()];
                }
                session.drain_events();
                session.take_outbound()
            }
            ServerTunnelMsg::Closed {
                session_id,
                reason,
                detail,
            } if session_id == session.id => {
                session.finish(reason, detail);
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    pub(crate) fn with_client<F>(&mut self, id: u32, f: F) -> Result<Vec<Vec<u8>>, ()>
    where
        F: FnOnce(&mut Client) -> Result<(), ScreenError>,
    {
        let Some(session) = self.active.as_mut() else {
            return Err(());
        };
        if session.id != id || session.closed {
            return Err(());
        }
        if let Err(err) = f(&mut session.client) {
            session.finish(ScreenCloseReason::ProtocolError, err.to_string());
            return Ok(vec![ClientTunnelMsg::Close { session_id: id }.encode()]);
        }
        session.drain_events();
        Ok(session.take_outbound())
    }

    pub(crate) fn close_id(&mut self, id: u32) -> Option<Vec<u8>> {
        if self.active.as_ref().is_some_and(|s| s.id == id) {
            return self.close_active(ScreenCloseReason::Normal, String::new());
        }
        None
    }

    pub(crate) fn fail_id(
        &mut self,
        id: u32,
        reason: ScreenCloseReason,
        detail: String,
    ) -> Option<Vec<u8>> {
        if self.active.as_ref().is_some_and(|s| s.id == id) {
            return self.close_active(reason, detail);
        }
        None
    }

    pub(crate) fn fail_all(&mut self, reason: ScreenCloseReason, detail: String) {
        if let Some(session) = self.active.as_mut() {
            session.finish(reason, detail);
        }
    }

    pub(crate) fn take(&mut self, id: u32) -> TakeScreen {
        let Some(session) = self.active.as_mut() else {
            return TakeScreen::Finished;
        };
        if session.id != id {
            return TakeScreen::Finished;
        }
        if let Some(update) = session.updates.pop_front() {
            return TakeScreen::Update(update);
        }
        if session.closed {
            return TakeScreen::Finished;
        }
        TakeScreen::Wait(Arc::clone(&session.notify))
    }

    fn close_active(&mut self, reason: ScreenCloseReason, detail: String) -> Option<Vec<u8>> {
        let mut session = self.active.take()?;
        let was_open = !session.closed;
        session.finish(reason, detail);
        was_open.then(|| {
            ClientTunnelMsg::Close {
                session_id: session.id,
            }
            .encode()
        })
    }
}

impl ScreenSession {
    fn drain_events(&mut self) {
        while let Some(ev) = self.client.poll_event() {
            let update = match ev {
                ScreenEvent::AuthRequired { schemes } => ScreenUpdate::AuthRequired { schemes },
                ScreenEvent::Ready {
                    width,
                    height,
                    desktop_name,
                    apple_server,
                } => ScreenUpdate::Ready {
                    width,
                    height,
                    desktop_name,
                    apple_server,
                },
                ScreenEvent::Frame {
                    width,
                    height,
                    rect,
                    rgba,
                } => {
                    self.push_frame(width, height, rect, rgba);
                    continue;
                }
                ScreenEvent::Resized { width, height } => ScreenUpdate::Resized { width, height },
                ScreenEvent::Cursor(shape) => ScreenUpdate::Cursor {
                    width: shape.width,
                    height: shape.height,
                    hotspot_x: shape.hotspot_x,
                    hotspot_y: shape.hotspot_y,
                    rgba: shape.rgba,
                },
                ScreenEvent::PointerPos { x, y } => ScreenUpdate::PointerPos { x, y },
                ScreenEvent::Clipboard(text) => ScreenUpdate::Clipboard { text },
            };
            self.push(update);
        }
    }

    /// Coalesces consecutive frame updates so a slow UI always gets the newest pixels without
    /// growing the queue unboundedly.
    fn push_frame(&mut self, width: u16, height: u16, rect: Rect, rgba: Vec<u8>) {
        if let Some(ScreenUpdate::Frame {
            width: prev_w,
            height: prev_h,
            ..
        }) = self.updates.back()
        {
            if *prev_w == width && *prev_h == height {
                if let Some((w, h, full)) = self.client.snapshot_rgba() {
                    self.updates.pop_back();
                    self.push(ScreenUpdate::Frame {
                        width: w,
                        height: h,
                        x: 0,
                        y: 0,
                        rect_width: w,
                        rect_height: h,
                        rgba: full.to_vec(),
                    });
                    return;
                }
            }
        }
        self.push(ScreenUpdate::Frame {
            width,
            height,
            x: rect.x,
            y: rect.y,
            rect_width: rect.width,
            rect_height: rect.height,
            rgba,
        });
    }

    fn push(&mut self, update: ScreenUpdate) {
        // Keep only the latest PointerPos or Cursor in the queue so fast pointer movement never
        // fills the queue or displaces frames.
        match &update {
            ScreenUpdate::PointerPos { .. } => {
                self.updates
                    .retain(|u| !matches!(u, ScreenUpdate::PointerPos { .. }));
            }
            ScreenUpdate::Cursor { .. } => {
                self.updates
                    .retain(|u| !matches!(u, ScreenUpdate::Cursor { .. }));
            }
            _ => {}
        }
        if self.updates.len() >= MAX_QUEUED_UPDATES {
            self.compact_for_incoming(update);
            self.notify.notify_one();
            return;
        }
        self.updates.push_back(update);
        self.notify.notify_one();
    }

    fn compact_for_incoming(&mut self, incoming: ScreenUpdate) {
        let had_frames = self
            .updates
            .iter()
            .any(|u| matches!(u, ScreenUpdate::Frame { .. }));
        self.updates
            .retain(|u| !matches!(u, ScreenUpdate::Frame { .. }));
        if had_frames || matches!(incoming, ScreenUpdate::Frame { .. }) {
            if let Some((w, h, full)) = self.client.snapshot_rgba() {
                self.updates.push_back(ScreenUpdate::Frame {
                    width: w,
                    height: h,
                    x: 0,
                    y: 0,
                    rect_width: w,
                    rect_height: h,
                    rgba: full.to_vec(),
                });
            }
            if matches!(incoming, ScreenUpdate::Frame { .. }) {
                return;
            }
        }
        while self.updates.len() >= MAX_QUEUED_UPDATES {
            self.updates.pop_front();
        }
        self.updates.push_back(incoming);
    }

    fn finish(&mut self, reason: ScreenCloseReason, detail: String) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.updates
            .push_back(ScreenUpdate::Closed { reason, detail });
        self.notify.notify_one();
    }

    fn take_outbound(&mut self) -> Vec<Vec<u8>> {
        let Some(bytes) = self.client.poll_write() else {
            return Vec::new();
        };
        bytes
            .chunks(MAX_TUNNEL_CHUNK)
            .map(|chunk| {
                ClientTunnelMsg::Data {
                    session_id: self.id,
                    payload: chunk.to_vec(),
                }
                .encode()
            })
            .collect()
    }
}
