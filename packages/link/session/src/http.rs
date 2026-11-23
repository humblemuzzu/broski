use std::sync::Arc;

use http_body_util::{BodyExt, Empty, Limited};
use hyper::body::Bytes;
use hyper::header::HOST;
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use rustls::pki_types::ServerName;
use rustls::ClientConfig;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_rustls::TlsConnector;
use url::Url;

use crate::transport;

pub(crate) async fn get(
    url: &Url,
    zone: Option<&str>,
    lan: bool,
    tls: Arc<ClientConfig>,
    limit: usize,
) -> Option<Vec<u8>> {
    let port = url.port_or_known_default()?;
    let host = url.host_str()?.trim_matches(['[', ']']);
    let tcp = transport::connect_tcp(host, port, zone, lan).await.ok()?;
    match url.scheme() {
        "http" => request(tcp, url, limit).await,
        "https" => {
            let name = ServerName::try_from(host.to_owned()).ok()?;
            let stream = TlsConnector::from(tls).connect(name, tcp).await.ok()?;
            request(stream, url, limit).await
        }
        _ => None,
    }
}

async fn request<S>(stream: S, url: &Url, limit: usize) -> Option<Vec<u8>>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .ok()?;
    let driver = tokio::spawn(connection);
    let body = async {
        let authority = url.host_str()?.to_owned()
            + &url
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
        let request = Request::get(url.path())
            .header(HOST, authority)
            .body(Empty::<Bytes>::new())
            .ok()?;
        let response = sender.send_request(request).await.ok()?;
        if response.status() != StatusCode::OK {
            return None;
        }
        let collected = Limited::new(response.into_body(), limit)
            .collect()
            .await
            .ok()?;
        Some(collected.to_bytes().to_vec())
    }
    .await;
    driver.abort();
    body
}
