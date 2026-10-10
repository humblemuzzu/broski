use std::net::SocketAddr;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_core::crypto::{HandshakeMode, PairingOffer, PublicBundle, StaticIdentity};
use broski_link_core::{Link, LinkEvent, CONFIG};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{sleep_until, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderValue, Request};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use super::relay_http::device_headers;
use super::{instant, now_ms};

const STEP_CAP: Duration = Duration::from_millis(200);
const WAIT: Duration = Duration::from_secs(10);
pub const POLL: Duration = Duration::from_millis(50);

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// The reference phone: `core::Link` over a real websocket, the same code the app runs.
pub struct Phone {
    pub identity: StaticIdentity,
    pub server: PublicBundle,
    pub link: Link,
    pub resumed: Vec<bool>,
    pub closed: Vec<u16>,
    pub control: Vec<Value>,
    pub messages: Vec<(u32, Vec<u8>)>,
    socket: Option<Socket>,
}

impl Phone {
    pub fn new(server: PublicBundle) -> Phone {
        Phone {
            identity: StaticIdentity::generate().expect("identity"),
            server,
            link: Link::client(CONFIG),
            resumed: Vec::new(),
            closed: Vec::new(),
            control: Vec::new(),
            messages: Vec::new(),
            socket: None,
        }
    }

    pub fn session_id(&self) -> Option<[u8; 16]> {
        self.link.session_id()
    }

    pub fn is_online(&self) -> bool {
        self.socket.is_some()
    }

    pub async fn pair_lan(&mut self, addr: SocketAddr, offer: &PairingOffer) -> Option<bool> {
        let url = format!("ws://{addr}/v1/link");
        let mode = HandshakeMode::Pair {
            secret: offer.secret,
        };
        self.handshake(&url, &[], mode, Some(WAIT)).await
    }

    /// Pairs over a relay channel as the offer's derived pairing device, before any relay token.
    pub async fn pair_relay(
        &mut self,
        relay: SocketAddr,
        machine: &str,
        device: &str,
        token: &str,
        secret: [u8; 32],
        wait: Duration,
    ) -> Option<bool> {
        let url = format!("ws://{relay}/v1/device");
        let headers = device_headers(machine, device, token);
        self.handshake(&url, &headers, HandshakeMode::Pair { secret }, Some(wait))
            .await
    }

    pub async fn connect_lan(&mut self, addr: SocketAddr, wait: Duration) -> Option<bool> {
        let url = format!("ws://{addr}/v1/link");
        self.handshake(&url, &[], HandshakeMode::Connect, Some(wait))
            .await
    }

    pub async fn connect_relay(
        &mut self,
        relay: SocketAddr,
        machine: &str,
        device: &str,
        token: &str,
        wait: Duration,
    ) -> Option<bool> {
        let url = format!("ws://{relay}/v1/device");
        let headers = device_headers(machine, device, token);
        self.handshake(&url, &headers, HandshakeMode::Connect, Some(wait))
            .await
    }

    /// Reconnects over the relay until it authorises the device, then reports whether the session
    /// resumed. Panics once `budget` runs out: every caller expects the relay to come round.
    pub async fn reconnect_relay(
        &mut self,
        relay: SocketAddr,
        machine: &str,
        device: &str,
        token: &str,
        budget: Duration,
    ) -> bool {
        let deadline = Instant::now() + budget;
        loop {
            if let Some(resumed) = self
                .connect_relay(relay, machine, device, token, budget)
                .await
            {
                return resumed;
            }
            assert!(
                Instant::now() < deadline,
                "the relay never authorised the device"
            );
            tokio::time::sleep(POLL).await;
        }
    }

    /// The device id and relay token the machine sent in its paired control message.
    pub async fn paired_credentials(&mut self, wait: Duration) -> (String, String) {
        let paired = self.await_control("paired", wait).await;
        let device = paired["device_id"].as_str().expect("device id").to_owned();
        let token = paired["relay_token"]
            .as_str()
            .expect("relay token")
            .to_owned();
        (device, token)
    }

    async fn handshake(
        &mut self,
        url: &str,
        headers: &[(&str, String)],
        mode: HandshakeMode,
        wait: Option<Duration>,
    ) -> Option<bool> {
        let mut request: Request<()> = url.into_client_request().expect("request");
        for (name, value) in headers {
            request.headers_mut().insert(
                tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.as_bytes())
                    .expect("header"),
                HeaderValue::from_str(value).expect("header value"),
            );
        }
        let Ok((socket, _)) = connect_async(request).await else {
            return None;
        };
        self.socket = Some(socket);

        let seen = self.resumed.len();
        let msg1 = self
            .link
            .connect(&self.identity, &self.server, mode, now_ms())
            .expect("msg1");
        self.send_raw(msg1).await;
        let wait = wait?;
        let deadline = Instant::now() + wait;
        loop {
            if self.resumed.len() > seen {
                return Some(self.resumed[seen]);
            }
            if Instant::now() >= deadline {
                return None;
            }
            self.step().await;
        }
    }

    pub async fn disconnect(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None).await;
        }
        self.link.disconnect();
    }

    pub async fn send(&mut self, stream: u32, bytes: &[u8]) {
        self.link.send(stream, bytes, now_ms()).expect("send");
        self.flush().await;
    }

    pub async fn send_control(&mut self, message: Value) {
        self.send(0, message.to_string().as_bytes()).await;
    }

    pub async fn echo(&mut self, text: &str, wait: Duration) -> (u32, Vec<u8>) {
        self.send(1, text.as_bytes()).await;
        self.next_message(wait).await
    }

    pub async fn next_message(&mut self, wait: Duration) -> (u32, Vec<u8>) {
        let deadline = Instant::now() + wait;
        loop {
            if !self.messages.is_empty() {
                return self.messages.remove(0);
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for a link message"
            );
            self.step().await;
        }
    }

    pub async fn await_control(&mut self, tag: &str, wait: Duration) -> Value {
        let deadline = Instant::now() + wait;
        loop {
            if let Some(index) = self.control.iter().position(|message| message["t"] == tag) {
                return self.control.remove(index);
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for the {tag} control message; saw {:?}",
                self.control
            );
            self.step().await;
        }
    }

    pub async fn next_control(&mut self, wait: Duration) -> Value {
        let deadline = Instant::now() + wait;
        loop {
            if !self.control.is_empty() {
                return self.control.remove(0);
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for a control message"
            );
            self.step().await;
        }
    }

    pub async fn step(&mut self) {
        let Some(socket) = self.socket.as_mut() else {
            tokio::time::sleep(Duration::from_millis(10)).await;
            return;
        };
        let deadline = self
            .link
            .poll_timeout()
            .map_or_else(|| Instant::now() + WAIT, instant)
            .min(Instant::now() + STEP_CAP);
        tokio::select! {
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Binary(bytes))) => {
                    let _ = self.link.handle_wire(&bytes, now_ms());
                }
                // text frames are relay control messages, never link wire units
                Some(Ok(Message::Text(_))) => {}
                Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => self.socket = None,
            },
            _ = sleep_until(deadline) => self.link.handle_timeout(now_ms()),
        }
        self.collect();
        self.flush().await;
    }

    pub async fn flush(&mut self) {
        loop {
            let frame = match self.link.poll_transmit() {
                Ok(Some(frame)) => frame,
                Ok(None) => return,
                Err(_) => return,
            };
            self.send_raw(frame).await;
        }
    }

    async fn send_raw(&mut self, frame: Vec<u8>) {
        let Some(socket) = self.socket.as_mut() else {
            return;
        };
        if socket.send(Message::Binary(frame.into())).await.is_err() {
            self.socket = None;
        }
    }

    fn collect(&mut self) {
        while let Some(event) = self.link.poll_event() {
            match event {
                LinkEvent::Connected { resumed } => self.resumed.push(resumed),
                LinkEvent::Message { stream, bytes } => {
                    if stream == 0 {
                        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                            self.control.push(value);
                        }
                    } else {
                        self.messages.push((stream, bytes));
                    }
                }
                LinkEvent::PeerClosed(code) => self.closed.push(code),
                LinkEvent::Dead => self.socket = None,
            }
        }
    }
}

/// Sends a hand-built msg1 over a fresh socket and returns the raw reply, or `None`
/// when the machine stays silent because it does not know the peer.
pub async fn raw_handshake(addr: SocketAddr, msg1: Vec<u8>, wait: Duration) -> Option<Vec<u8>> {
    let (mut socket, _) = connect_async(format!("ws://{addr}/v1/link"))
        .await
        .expect("websocket upgrade");
    socket
        .send(Message::Binary(msg1.into()))
        .await
        .expect("msg1");
    match tokio::time::timeout(wait, socket.next()).await {
        Ok(Some(Ok(Message::Binary(bytes)))) => Some(bytes.to_vec()),
        _ => None,
    }
}

/// The bundle a pairing uri only fingerprints comes from the machine's own http endpoint.
pub async fn fetch_bundle(addr: SocketAddr) -> PublicBundle {
    let mut stream = TcpStream::connect(addr)
        .await
        .expect("connect to /v1/identity");
    let request = format!("GET /v1/identity HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.expect("write");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read");
    let text = String::from_utf8(response).expect("http is utf8");
    let body = text.split("\r\n\r\n").nth(1).expect("body");
    let value: Value = serde_json::from_str(body.trim()).expect("identity json");
    let public = URL_SAFE_NO_PAD
        .decode(value["pub"].as_str().expect("pub"))
        .expect("b64url");
    PublicBundle::from_bytes(&public).expect("public bundle")
}
