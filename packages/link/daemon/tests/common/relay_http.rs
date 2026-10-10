use std::net::SocketAddr;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_core::crypto::PublicBundle;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub(super) fn device_headers(
    machine: &str,
    device: &str,
    token: &str,
) -> [(&'static str, String); 3] {
    [
        ("x-broski-machine", machine.to_owned()),
        ("x-broski-device", device.to_owned()),
        ("authorization", format!("Bearer {token}")),
    ]
}

/// One raw HTTP/1.1 request, as the relay serves it.
async fn request(
    relay: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, String)],
    body: &[u8],
) -> (u16, String) {
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {relay}\r\nConnection: close\r\n");
    if !body.is_empty() {
        head.push_str(&format!(
            "Content-Type: application/octet-stream\r\nContent-Length: {}\r\n",
            body.len()
        ));
    }
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let mut stream = TcpStream::connect(relay)
        .await
        .expect("connect to the relay");
    stream.write_all(head.as_bytes()).await.expect("write");
    if !body.is_empty() {
        stream.write_all(body).await.expect("write body");
    }
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read");
    let text = String::from_utf8(response).expect("http is utf8");
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or_default();
    let body = text.split("\r\n\r\n").nth(1).unwrap_or_default().to_owned();
    (status, body)
}

/// The relay answers 200 only for a device it currently authorises.
pub async fn device_authorised(
    relay: SocketAddr,
    machine: &str,
    device: &str,
    token: &str,
) -> bool {
    let headers = device_headers(machine, device, token);
    request(
        relay,
        "GET",
        &format!("/v1/status/{machine}"),
        &headers,
        &[],
    )
    .await
    .0 == 200
}

/// Stores one opaque letter for a machine: `202 {"id":N,"delivered":bool}`.
pub async fn post_letter(
    relay: SocketAddr,
    machine: &str,
    device: &str,
    token: &str,
    data: &[u8],
) -> (u16, Value) {
    let headers = device_headers(machine, device, token);
    let (status, body) = request(relay, "POST", "/v1/letters", &headers, data).await;
    let value = serde_json::from_str(body.trim()).unwrap_or(Value::Null);
    (status, value)
}

/// A phone that only has the QR fetches the machine bundle from the relay.
pub async fn machine_bundle(relay: SocketAddr, machine: &str) -> Option<PublicBundle> {
    let (status, body) = request(relay, "GET", &format!("/v1/identity/{machine}"), &[], &[]).await;
    if status != 200 {
        return None;
    }
    let value: Value = serde_json::from_str(body.trim()).ok()?;
    let public = URL_SAFE_NO_PAD.decode(value["pub"].as_str()?).ok()?;
    PublicBundle::from_bytes(&public).ok()
}
