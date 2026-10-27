use std::path::Path;
use std::time::Duration;

use tokio::net::UnixStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::WebSocketStream;
use tracing::debug;

const REQUEST: &str = "ws://localhost/v1/link";

/// The unix connect plus the websocket upgrade, giving up after `timeout`: `None` with the reason
/// logged, which every caller treats as a failed dial.
pub(crate) async fn upgrade(
    socket: &Path,
    headers: &[(&'static str, String)],
    config: WebSocketConfig,
    timeout: Duration,
) -> Option<WebSocketStream<UnixStream>> {
    match tokio::time::timeout(timeout, connect(socket, headers, config)).await {
        Ok(socket) => socket,
        Err(_) => {
            debug!(
                socket = %socket.display(),
                ?timeout,
                "the bridge did not answer the dial in time"
            );
            None
        }
    }
}

async fn connect(
    socket: &Path,
    headers: &[(&'static str, String)],
    config: WebSocketConfig,
) -> Option<WebSocketStream<UnixStream>> {
    let mut request = REQUEST.into_client_request().ok()?;
    for (name, value) in headers {
        let Ok(value) = HeaderValue::from_str(value) else {
            continue;
        };
        request.headers_mut().insert(*name, value);
    }
    let Ok(stream) = UnixStream::connect(socket).await else {
        debug!(socket = %socket.display(), "nothing is listening on the bridge socket");
        return None;
    };
    match tokio_tungstenite::client_async_with_config(request, stream, Some(config)).await {
        Ok((socket, _)) => Some(socket),
        Err(error) => {
            debug!(socket = %socket.display(), error = %error, "the bridge refused the upgrade");
            None
        }
    }
}
