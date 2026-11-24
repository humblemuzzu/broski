use std::net::SocketAddr;

use rustls::RootCertStore;
use tokio::time::Instant;

use super::*;
use crate::tls;

/// The real relay behind its own rustls listener with a throwaway certificate for 127.0.0.1.
async fn tls_relay(dir: &std::path::Path) -> (SocketAddr, RootCertStore) {
    // axum-server asks rustls for the process default provider, which is ambiguous in a test
    // binary that links the daemon's and the relay's providers as well.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let certified = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_owned()]).expect("cert");
    std::fs::write(dir.join("cert.pem"), certified.cert.pem()).expect("cert.pem");
    std::fs::write(dir.join("key.pem"), certified.signing_key.serialize_pem()).expect("key.pem");
    let hub = broski_relay::open(broski_relay::Options {
        db_path: dir.join("relay.db"),
        rate: broski_relay::limits::RateLimit::default(),
        limits: broski_relay::limits::Limits::default(),
        push: broski_relay::push::PushConfig::default(),
        register_token: None,
    })
    .await
    .expect("relay");
    let addr = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("port")
        .local_addr()
        .expect("addr");
    let (cert, key) = (dir.join("cert.pem"), dir.join("key.pem"));
    tokio::spawn(broski_relay::serve_tls(
        addr,
        cert,
        key,
        hub,
        std::future::pending(),
    ));
    let mut roots = RootCertStore::empty();
    roots.add(certified.cert.der().clone()).expect("root");
    (addr, roots)
}

fn machine_socket(addr: SocketAddr) -> Target {
    Target {
        route: Route::Relay,
        url: format!("wss://{addr}/v1/machine"),
        headers: vec![
            (
                "x-broski-machine",
                "00112233445566778899aabbccddeeff".to_owned(),
            ),
            ("authorization", "Bearer test-token-only".to_owned()),
        ],
        detail: addr.ip().to_string(),
        zone: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_wss_relay_is_dialled_over_ring_tls_and_an_untrusted_certificate_is_refused() {
    let dir = tempfile::tempdir().expect("dir");
    let (addr, roots) = tls_relay(dir.path()).await;
    let target = machine_socket(addr);
    let trusted = tls::with_roots(roots);
    let deadline = Instant::now() + Duration::from_secs(10);
    let stream = loop {
        match dial(&target, trusted.clone(), Duration::from_secs(5)).await {
            Ok(stream) => break stream,
            Err(error) => assert!(
                Instant::now() < deadline,
                "the wss dial never succeeded: {error}"
            ),
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert!(matches!(stream.get_ref(), MaybeTlsStream::Rustls(_)));

    let refused = dial(&target, tls::client_config(), Duration::from_secs(5)).await;
    let error = refused.expect_err("Mozilla's roots do not vouch for a self-signed certificate");
    assert!(
        error.to_string().to_lowercase().contains("certificate"),
        "{error}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_relay_refusing_a_device_token_is_a_401_not_a_string() {
    let dir = tempfile::tempdir().expect("dir");
    let (addr, roots) = tls_relay(dir.path()).await;
    let device = Target {
        route: Route::Relay,
        url: format!("wss://{addr}/v1/device"),
        headers: vec![
            (
                "x-broski-machine",
                "00112233445566778899aabbccddeeff".to_owned(),
            ),
            (
                "x-broski-device",
                "ffeeddccbbaa99887766554433221100".to_owned(),
            ),
            ("authorization", "Bearer unknown".to_owned()),
        ],
        detail: addr.ip().to_string(),
        zone: None,
    };
    let trusted = tls::with_roots(roots);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match dial(&device, trusted.clone(), Duration::from_secs(5)).await {
            Err(DialError::Refused(status)) => {
                assert_eq!(status, StatusCode::UNAUTHORIZED);
                return;
            }
            other => assert!(
                Instant::now() < deadline,
                "the relay never refused the device: {other:?}"
            ),
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn a_dialled_socket_sends_segments_no_larger_than_the_cap() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let url = format!("ws://{addr}/");
    let target = Target {
        route: Route::Lan,
        url: url.clone(),
        headers: Vec::new(),
        detail: addr.to_string(),
        zone: None,
    };
    let request = url.as_str().into_client_request().expect("request");
    let (socket, accepted) = tokio::join!(open_tcp(&target, &request), listener.accept());
    let (socket, _) = (socket.expect("connected"), accepted.expect("accepted"));
    assert!(socket.nodelay().expect("nodelay"));
    assert!(segments::max_segment(&socket) <= segments::MAX_SEGMENT);
}

#[test]
fn the_relay_status_frame_is_read_and_anything_else_is_not() {
    assert_eq!(
        presence(r#"{"t":"status","machine":"asleep","last_seen":17}"#),
        Some(Presence {
            machine: MachinePresence::Asleep,
            last_seen_ms: Some(17)
        })
    );
    assert_eq!(
        presence(r#"{"t":"status","machine":"online","last_seen":null}"#)
            .map(|presence| presence.last_seen_ms),
        Some(None)
    );
    for text in [
        r#"{"t":"status","machine":"gone"}"#,
        r#"{"t":"open"}"#,
        "[]",
        "x",
    ] {
        assert_eq!(presence(text), None, "{text}");
    }
}
