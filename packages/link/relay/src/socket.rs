use std::error::Error as _;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use bytes::Bytes;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;
use tokio::time::{interval_at, timeout, Instant, Interval};

use crate::limits::{
    LIVENESS_CHECK, LIVENESS_TIMEOUT, PING_INTERVAL, SOCKET_QUEUE_MESSAGES, WRITER_EXIT_TIMEOUT,
};

pub const CLOSE_LIVENESS: u16 = 1001;
pub const CLOSE_POLICY: u16 = 1008;
pub const CLOSE_TOO_LARGE: u16 = 1009;
pub const CLOSE_RESTART: u16 = 1012;
pub const CLOSE_CHANNEL: u16 = 4000;
pub const CLOSE_REPLACED: u16 = 4001;
pub const CLOSE_REVOKED: u16 = 4003;
pub const CLOSE_SLOW: u16 = 4008;

pub enum Event {
    Text(String),
    Binary(Bytes),
    Replaced,
    Closed,
}

enum Out {
    Binary(Bytes),
    Text(String),
    Ping,
    Close(u16, &'static str),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SendFail {
    Slow,
    Closed,
}

#[derive(Clone)]
pub struct SocketHandle {
    tx: mpsc::Sender<Out>,
    pending: Arc<AtomicUsize>,
    wake: Arc<Notify>,
    cap: usize,
}

impl SocketHandle {
    pub fn binary(&self, payload: Bytes) -> Result<(), SendFail> {
        let len = payload.len();
        self.enqueue(Out::Binary(payload), len)
    }

    pub fn text(&self, text: String) -> Result<(), SendFail> {
        let len = text.len();
        self.enqueue(Out::Text(text), len)
    }

    pub fn ping(&self) -> Result<(), SendFail> {
        self.tx.try_send(Out::Ping).map_err(|_| SendFail::Closed)
    }

    pub fn close(&self, code: u16, reason: &'static str) {
        let _ = self.tx.try_send(Out::Close(code, reason));
        self.wake.notify_one();
    }

    fn enqueue(&self, out: Out, len: usize) -> Result<(), SendFail> {
        if self.pending.load(Ordering::Relaxed) + len > self.cap {
            return Err(SendFail::Slow);
        }
        self.tx.try_send(out).map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => SendFail::Slow,
            mpsc::error::TrySendError::Closed(_) => SendFail::Closed,
        })?;
        self.pending.fetch_add(len, Ordering::Relaxed);
        Ok(())
    }
}

pub struct Session {
    pub handle: SocketHandle,
    stream: SplitStream<WebSocket>,
    writer: JoinHandle<()>,
    pings: Interval,
    liveness: Interval,
    last_frame: Instant,
}

impl Session {
    pub fn new(socket: WebSocket, cap: usize) -> Session {
        let (sink, stream) = socket.split();
        let (tx, rx) = mpsc::channel(SOCKET_QUEUE_MESSAGES);
        let pending = Arc::new(AtomicUsize::new(0));
        let wake = Arc::new(Notify::new());
        let writer = tokio::spawn(write_loop(sink, rx, pending.clone()));
        Session {
            handle: SocketHandle {
                tx,
                pending,
                wake,
                cap,
            },
            stream,
            writer,
            pings: interval_at(Instant::now() + PING_INTERVAL, PING_INTERVAL),
            liveness: interval_at(Instant::now() + LIVENESS_CHECK, LIVENESS_CHECK),
            last_frame: Instant::now(),
        }
    }

    pub async fn next(&mut self) -> Event {
        loop {
            tokio::select! {
                biased;
                () = self.handle.wake.notified() => return Event::Replaced,
                _ = self.liveness.tick() => {
                    if self.last_frame.elapsed() >= LIVENESS_TIMEOUT {
                        self.handle.close(CLOSE_LIVENESS, "no activity");
                        return Event::Closed;
                    }
                }
                _ = self.pings.tick() => {
                    if self.handle.ping().is_err() {
                        return Event::Closed;
                    }
                }
                message = self.stream.next() => match message {
                    Some(Ok(Message::Binary(payload))) => {
                        self.last_frame = Instant::now();
                        return Event::Binary(payload);
                    }
                    Some(Ok(Message::Text(text))) => {
                        self.last_frame = Instant::now();
                        return Event::Text(text.as_str().to_owned());
                    }
                    Some(Ok(Message::Close(_))) | None => return Event::Closed,
                    Some(Ok(_)) => self.last_frame = Instant::now(),
                    Some(Err(error)) => {
                        if is_oversize(&error) {
                            self.handle.close(CLOSE_TOO_LARGE, "message too large");
                        }
                        return Event::Closed;
                    },
                },
            }
        }
    }

    pub async fn finish(self) {
        let Session {
            mut writer,
            stream,
            handle,
            ..
        } = self;
        drop(stream);
        drop(handle);
        if timeout(WRITER_EXIT_TIMEOUT, &mut writer).await.is_err() {
            writer.abort();
        }
    }
}

// oversize frames arrive as a bare read error without a close code, so they are classified here
fn is_oversize(error: &axum::Error) -> bool {
    error
        .source()
        .and_then(|source| source.downcast_ref::<tungstenite::Error>())
        .is_some_and(|error| matches!(error, tungstenite::Error::Capacity(_)))
}

async fn write_loop(
    mut sink: SplitSink<WebSocket, Message>,
    mut rx: mpsc::Receiver<Out>,
    pending: Arc<AtomicUsize>,
) {
    while let Some(out) = rx.recv().await {
        match out {
            Out::Binary(payload) => {
                let len = payload.len();
                if sink.send(Message::Binary(payload)).await.is_err() {
                    return;
                }
                pending.fetch_sub(len, Ordering::Relaxed);
            }
            Out::Text(text) => {
                let len = text.len();
                if sink.send(Message::Text(text.into())).await.is_err() {
                    return;
                }
                pending.fetch_sub(len, Ordering::Relaxed);
            }
            Out::Ping => {
                if sink.send(Message::Ping(Bytes::new())).await.is_err() {
                    return;
                }
            }
            Out::Close(code, reason) => {
                let frame = CloseFrame {
                    code,
                    reason: reason.into(),
                };
                let _ = sink.send(Message::Close(Some(frame))).await;
                let _ = sink.close().await;
                return;
            }
        }
    }
}
