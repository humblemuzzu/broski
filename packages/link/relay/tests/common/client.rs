use std::net::SocketAddr;
use std::time::Duration;

use broski_relay::auth::b64url_encode;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::common::{token_hash, WAIT};

#[derive(Debug)]
pub enum Frame {
    Text(Value),
    Binary(Bytes),
    Close(u16, String),
}

pub struct Client {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    req: u64,
}

impl Client {
    pub async fn connect(
        addr: SocketAddr,
        path: &str,
        headers: &[(&str, &str)],
    ) -> Result<Client, u16> {
        let mut request = format!("ws://{addr}{path}")
            .into_client_request()
            .expect("client request");
        for (name, value) in headers {
            request.headers_mut().insert(
                HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                HeaderValue::from_str(value).expect("header value"),
            );
        }
        match connect_async(request).await {
            Ok((ws, _)) => Ok(Client { ws, req: 0 }),
            Err(WsError::Http(response)) => Err(response.status().as_u16()),
            Err(_) => Err(0),
        }
    }

    pub async fn send_json(&mut self, value: &Value) {
        self.send_text(&value.to_string()).await;
    }

    pub async fn send_text(&mut self, text: &str) {
        self.ws
            .send(Message::Text(text.to_owned().into()))
            .await
            .expect("send text");
    }

    pub async fn send_bin(&mut self, payload: Bytes) {
        self.ws
            .send(Message::Binary(payload))
            .await
            .expect("send binary");
    }

    pub async fn try_send_bin(&mut self, payload: Bytes) -> bool {
        self.ws.send(Message::Binary(payload)).await.is_ok()
    }

    pub async fn drain_close(&mut self) -> u16 {
        for _ in 0..4096 {
            match self.next(WAIT).await {
                Some(Frame::Close(code, _)) => return code,
                Some(_) => continue,
                None => panic!("no close frame after draining buffered frames"),
            }
        }
        panic!("close frame never arrived");
    }

    pub async fn send_channel(&mut self, channel: u32, payload: &[u8]) {
        let mut frame = Vec::with_capacity(4 + payload.len());
        frame.extend_from_slice(&channel.to_be_bytes());
        frame.extend_from_slice(payload);
        self.send_bin(Bytes::from(frame)).await;
    }

    pub async fn next(&mut self, within: Duration) -> Option<Frame> {
        loop {
            match tokio::time::timeout(within, self.ws.next()).await {
                Err(_) => return None,
                Ok(None) => return Some(Frame::Close(1006, "eof".to_owned())),
                Ok(Some(Err(error))) => return Some(Frame::Close(1006, error.to_string())),
                Ok(Some(Ok(Message::Binary(payload)))) => return Some(Frame::Binary(payload)),
                Ok(Some(Ok(Message::Text(text)))) => {
                    let value = serde_json::from_str(text.as_str()).expect("json control message");
                    return Some(Frame::Text(value));
                }
                Ok(Some(Ok(Message::Close(frame)))) => {
                    return Some(match frame {
                        Some(frame) => {
                            Frame::Close(u16::from(frame.code), frame.reason.to_string())
                        }
                        None => Frame::Close(1005, String::new()),
                    })
                }
                Ok(Some(Ok(_))) => continue,
            }
        }
    }

    pub async fn text(&mut self) -> Value {
        match self.next(WAIT).await {
            Some(Frame::Text(value)) => value,
            other => panic!("expected text message, got {other:?}"),
        }
    }

    pub async fn binary(&mut self) -> Bytes {
        match self.next(WAIT).await {
            Some(Frame::Binary(payload)) => payload,
            other => panic!("expected binary message, got {other:?}"),
        }
    }

    pub async fn close(&mut self) -> (u16, String) {
        match self.next(WAIT).await {
            Some(Frame::Close(code, reason)) => (code, reason),
            other => panic!("expected close frame, got {other:?}"),
        }
    }

    pub fn next_req(&mut self) -> u64 {
        self.req += 1;
        self.req
    }

    pub async fn request(&mut self, mut value: Value) -> Value {
        let req = self.next_req();
        value["req"] = json!(req);
        self.send_json(&value).await;
        self.text().await
    }

    pub async fn publish(&mut self, bundle: &[u8]) -> Value {
        self.request(json!({"t": "identity", "pub": b64url_encode(bundle)}))
            .await
    }

    pub async fn allow(&mut self, device: &str, token: &str) -> Value {
        self.request(json!({
            "t": "allow",
            "device": device,
            "token_hash": token_hash(token),
        }))
        .await
    }

    pub async fn revoke(&mut self, device: &str) -> Value {
        self.request(json!({"t": "revoke", "device": device})).await
    }

    pub async fn watch(&mut self, on: bool) -> Value {
        self.request(json!({"t": "watch", "on": on})).await
    }

    pub async fn alert_targets(&mut self, targets: &[(&str, &str, &str)]) -> Value {
        let targets: Vec<Value> = targets
            .iter()
            .map(|(device, platform, token)| {
                json!({"device": device, "platform": platform, "token": token})
            })
            .collect();
        self.request(json!({"t": "alert_targets", "targets": targets}))
            .await
    }

    pub async fn ack_letter(&mut self, id: u64) -> Value {
        self.request(json!({"t": "letter_ack", "id": id})).await
    }

    pub async fn send_letter_ack(&mut self, id: u64) {
        self.send_json(&json!({"t": "letter_ack", "id": id})).await;
    }

    pub async fn letter(&mut self) -> Value {
        for _ in 0..64 {
            let value = self.text().await;
            if value["t"] == "letter" {
                return value;
            }
        }
        panic!("no letter frame arrived");
    }

    pub async fn open_channel(&mut self) -> (u32, String) {
        let value = self.text().await;
        assert_eq!(value["t"], "open", "unexpected message: {value}");
        (
            value["ch"].as_u64().expect("channel") as u32,
            value["device"].as_str().expect("device").to_owned(),
        )
    }

    pub async fn state(&mut self) -> (String, Option<i64>) {
        let value = self.text().await;
        assert_eq!(value["t"], "status", "unexpected message: {value}");
        (
            value["machine"].as_str().expect("machine state").to_owned(),
            value["last_seen"].as_i64(),
        )
    }

    pub async fn wait_state(&mut self, expected: &str) -> Option<i64> {
        for _ in 0..20 {
            let (state, last_seen) = self.state().await;
            if state == expected {
                return last_seen;
            }
        }
        panic!("device never reported {expected}");
    }
}
