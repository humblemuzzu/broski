mod common;

use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;
use futures_util::StreamExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio_tungstenite::tungstenite::Error as WsError;

const WAIT: Duration = Duration::from_secs(10);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_millis(200);
/// The per-address cap `lan::MAX_CONNECTIONS_PER_IP`.
const PER_IP: usize = 8;
const MAX_REQUEST_BYTES: usize = 8192;

/// Silent sockets from one address cannot take every slot the daemon has: the ninth is refused
/// before it can be held, and the ones that never complete a handshake give their slot back on
/// their own.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn one_address_cannot_hold_every_lan_slot_with_silent_sockets() {
    let daemon = TestDaemon::start(Options {
        durations: broski_link_daemon::durations::Durations {
            handshake_timeout: HANDSHAKE_TIMEOUT,
            ..Default::default()
        },
        ..Options::default()
    })
    .await;
    let url = format!("ws://{}/v1/link", daemon.lan());

    let mut silent = Vec::new();
    for _ in 0..PER_IP {
        let (socket, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("the daemon upgrades a socket that says nothing");
        silent.push(socket);
    }

    let refused = tokio_tungstenite::connect_async(&url).await;
    match refused {
        Err(WsError::Http(response)) => assert_eq!(response.status(), 429),
        Err(other) => panic!("the extra socket was refused with {other}"),
        Ok(_) => panic!("a ninth silent socket from one address was admitted"),
    }

    // The handshake window closes them, so the address gets its slots back without a word from it.
    let closed = tokio::time::timeout(WAIT, async {
        for socket in &mut silent {
            while let Some(Ok(_)) = socket.next().await {}
        }
    })
    .await;
    assert!(
        closed.is_ok(),
        "a silent socket outlived its handshake window"
    );

    let mut phone = pair_lan_phone(&daemon).await;
    phone.await_control("routes", WAIT).await;
    let status = daemon.ask(serde_json::json!({"cmd": "status"})).await;
    assert_eq!(
        status["sessions"][0]["connected"], true,
        "the owner still gets a session after the silent sockets: {status}"
    );
    daemon.stop().await;
}

/// A request line that never ends is refused as soon as it passes the limit, not when it finally
/// times out: the daemon must not hold an unbounded line in memory.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_control_request_longer_than_the_limit_is_cut_off() {
    let daemon = TestDaemon::start(Options::default()).await;
    let path = daemon.control_path();
    let mut stream = UnixStream::connect(&path).await.expect("control socket");
    let flood = vec![b'x'; MAX_REQUEST_BYTES * 2];
    stream.write_all(&flood).await.expect("write");

    let mut reply = Vec::new();
    let closed = tokio::time::timeout(WAIT, stream.read_to_end(&mut reply)).await;
    assert!(
        closed.is_ok(),
        "the daemon kept a request line past its limit open"
    );
    assert!(reply.is_empty(), "an over-long request is never answered");

    let status = daemon.ask(serde_json::json!({"cmd": "status"})).await;
    assert_eq!(status["machine"]["id"].as_str().map(str::len), Some(32));
    daemon.stop().await;
}
