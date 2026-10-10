use std::net::SocketAddr;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub async fn http_get(addr: SocketAddr, path: &str, headers: &[(&str, &str)]) -> (u16, String) {
    try_http_get(addr, path, headers)
        .await
        .expect("http get failed")
}

pub async fn http_post(
    addr: SocketAddr,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> (u16, String) {
    request(addr, "POST", path, headers, body)
        .await
        .expect("http post failed")
}

pub async fn try_http_get(
    addr: SocketAddr,
    path: &str,
    headers: &[(&str, &str)],
) -> Option<(u16, String)> {
    request(addr, "GET", path, headers, &[]).await
}

pub async fn request(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Option<(u16, String)> {
    let mut stream = TcpStream::connect(addr).await.ok()?;
    let mut request = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
    request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    for (name, value) in headers {
        request.push_str(name);
        request.push_str(": ");
        request.push_str(value);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await.ok()?;
    stream.write_all(body).await.ok()?;
    let mut response = Vec::new();
    // the relay answers short requests and may reset a connection whose body it never read,
    // so bytes already read are the answer even when the read then fails
    if stream.read_to_end(&mut response).await.is_err() && response.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(&response).into_owned();
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_owned())
        .unwrap_or_default();
    Some((status, body))
}
