mod common;

use std::net::TcpListener;
use std::time::Duration;

use broski_client::{
    LinkState, ScreenCloseReason, ScreenCredentials, ScreenShortcut, ScreenUpdate,
};
use broski_link_testkit::await_identity;
use broski_link_testkit::daemon::{Home, TestDaemon};
use broski_link_testkit::relay::TestRelay;
use broski_screen::test_server::{RecordedInput, ServerAuth, TestServer};
use tokio::time::timeout;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_screen_works_end_to_end_over_relay_with_apple_ard() {
    let rfb = TestServer::start(
        192,
        128,
        "Sam's MacBook Pro",
        ServerAuth::AppleArd {
            username: "sam".to_owned(),
            password: "p@ssword#1".to_owned(),
        },
        true,
    );
    let relay = TestRelay::start().await;
    let home = Home::new();
    let daemon =
        TestDaemon::start_with_screen_port(&home, Some(&relay.url), false, rfb.port()).await;
    await_identity(&relay, &daemon).await;
    let offer = daemon.offer().await.to_uri();

    let phone = common::phone();
    let machine = phone.pair(offer).await.expect("pair over relay");
    common::status_until(&machine, "link connected over relay", |s| {
        matches!(s.link.state, LinkState::Connected { .. })
    })
    .await;

    let screen = std::sync::Arc::clone(&machine)
        .open_screen(Some(ScreenCredentials {
            username: "sam".to_owned(),
            password: "p@ssword#1".to_owned(),
        }))
        .expect("open screen");

    let mut saw_ready = false;
    let mut saw_frame = false;
    for _ in 0..8 {
        let update = timeout(Duration::from_secs(5), screen.next_update())
            .await
            .expect("screen update")
            .expect("screen still open");
        match update {
            ScreenUpdate::Ready {
                width,
                height,
                desktop_name,
                apple_server,
            } => {
                assert_eq!((width, height), (192, 128));
                assert_eq!(desktop_name, "Sam's MacBook Pro");
                assert!(apple_server);
                saw_ready = true;
            }
            ScreenUpdate::Frame {
                width,
                height,
                rgba,
                ..
            } => {
                assert_eq!((width, height), (192, 128));
                assert_eq!(&rgba[0..4], &[10, 120, 220, 255]);
                saw_frame = true;
                break;
            }
            other => panic!("unexpected screen update: {other:?}"),
        }
    }
    assert!(saw_ready && saw_frame);

    screen.pointer(80, 45, 1);
    screen.pointer(80, 45, 0);
    screen.type_text("Hi@9".to_owned());
    screen.shortcut(ScreenShortcut::SpaceLeft);
    screen.set_clipboard("copied from phone".to_owned());

    // Wait briefly for the inputs to traverse the Noise relay tunnel to the loopback RFB server.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let recorded = rfb.inputs();
        if recorded.contains(&RecordedInput::Clipboard("copied from phone".to_owned())) {
            assert!(recorded.contains(&RecordedInput::Pointer {
                x: 80,
                y: 45,
                buttons: 1
            }));
            assert!(recorded.contains(&RecordedInput::Key {
                keysym: u32::from(b'@'),
                down: true
            }));
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for RFB inputs, saw: {recorded:?}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    screen.close();
    machine.close();
    daemon.stop().await;
    relay.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn closed_screen_port_reports_screen_sharing_disabled() {
    // Grab an ephemeral unused port and release it so dialing 127.0.0.1:<port> refuses immediately.
    let closed_port = {
        let l = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
        l.local_addr().unwrap().port()
    };
    let home = Home::new();
    let daemon = TestDaemon::start_with_screen_port(&home, None, true, closed_port).await;
    let mut offer = daemon.offer().await;
    offer.lan = vec![daemon.lan().to_string()];
    let offer = offer.to_uri();

    let phone = common::phone();
    let machine = phone.pair(offer).await.expect("pair over lan");
    common::status_until(&machine, "link connected over lan", |s| {
        matches!(s.link.state, LinkState::Connected { .. })
    })
    .await;

    let screen = std::sync::Arc::clone(&machine)
        .open_screen(None)
        .expect("open screen");
    let update = timeout(Duration::from_secs(5), screen.next_update())
        .await
        .expect("close update")
        .expect("update present");
    match update {
        ScreenUpdate::Closed { reason, detail } => {
            assert_eq!(reason, ScreenCloseReason::ScreenSharingDisabled);
            assert!(detail.contains("Screen Sharing"), "detail was: {detail}");
        }
        other => panic!("expected ScreenSharingDisabled, got {other:?}"),
    }

    machine.close();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn wrong_password_reports_auth_failed_and_fresh_reconnect_succeeds() {
    let rfb = TestServer::start(
        64,
        64,
        "Mac",
        ServerAuth::AppleArd {
            username: "sam".to_owned(),
            password: "correct!".to_owned(),
        },
        false,
    );
    let home = Home::new();
    let daemon = TestDaemon::start_with_screen_port(&home, None, true, rfb.port()).await;
    let mut offer = daemon.offer().await;
    offer.lan = vec![daemon.lan().to_string()];

    let phone = common::phone();
    let machine = phone.pair(offer.to_uri()).await.expect("pair over lan");
    common::status_until(&machine, "link connected", |s| {
        matches!(s.link.state, LinkState::Connected { .. })
    })
    .await;

    let bad = std::sync::Arc::clone(&machine)
        .open_screen(Some(ScreenCredentials {
            username: "sam".to_owned(),
            password: "wrong".to_owned(),
        }))
        .expect("open with wrong password");
    let failed = timeout(Duration::from_secs(5), bad.next_update())
        .await
        .expect("auth failure update")
        .expect("update present");
    assert!(matches!(
        failed,
        ScreenUpdate::Closed {
            reason: ScreenCloseReason::AuthFailed,
            ..
        }
    ));
    // Reusing the closed view must return Closed rather than hanging silently.
    assert!(bad
        .provide_credentials(ScreenCredentials {
            username: "sam".to_owned(),
            password: "correct!".to_owned(),
        })
        .is_err());

    let good = std::sync::Arc::clone(&machine)
        .open_screen(Some(ScreenCredentials {
            username: "sam".to_owned(),
            password: "correct!".to_owned(),
        }))
        .expect("reconnect with right password");
    let ready = timeout(Duration::from_secs(5), good.next_update())
        .await
        .expect("ready update")
        .expect("update present");
    assert!(matches!(
        ready,
        ScreenUpdate::Ready {
            width: 64,
            height: 64,
            ..
        }
    ));

    good.close();
    machine.close();
    daemon.stop().await;
}
