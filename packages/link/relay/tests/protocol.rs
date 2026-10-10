mod common;

use bytes::Bytes;
use common::{bundle_of, machine_id, Client, Relay};

const DEVICE_ID: &str = "0123456789abcdef0123456789abcdef";
const TOKEN: &str = "device-token";

#[tokio::test]
async fn machine_publishes_identity_allows_device_and_forwards_bytes() {
    let relay = Relay::start().await;
    let bundle = bundle_of(7);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "machine-secret")
        .await
        .expect("machine registers");

    let wrong = bundle_of(8);
    let reply = machine.publish(&wrong).await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "bad_identity");

    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");

    let mut dev = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("device connects");
    let (state, _) = dev.state().await;
    assert_eq!(state, "online");

    let (channel, opened_for) = machine.open_channel().await;
    assert_eq!(opened_for, DEVICE_ID);
    assert_ne!(channel, 0);

    forwards_bytes_both_ways(&mut machine, &mut dev, channel).await;
}

async fn forwards_bytes_both_ways(machine: &mut Client, dev: &mut Client, channel: u32) {
    let payload = Bytes::from(vec![0xab; 200 * 1024]);
    dev.send_bin(payload.clone()).await;
    let frame = machine.binary().await;
    assert_eq!(&frame[..4], &channel.to_be_bytes());
    assert_eq!(&frame[4..], &payload[..]);

    dev.send_bin(Bytes::from_static(b"ping")).await;
    let frame = machine.binary().await;
    assert_eq!(&frame[..4], &channel.to_be_bytes());
    assert_eq!(&frame[4..], b"ping");

    machine.send_channel(channel, b"pong").await;
    assert_eq!(&dev.binary().await[..], b"pong");

    machine.send_channel(channel, &vec![0x5a; 200 * 1024]).await;
    assert_eq!(dev.binary().await.len(), 200 * 1024);

    dev.send_text("device text frames are ignored").await;
    assert!(
        machine
            .next(std::time::Duration::from_millis(100))
            .await
            .is_none(),
        "device text frame was forwarded to the machine"
    );
    dev.send_bin(Bytes::from_static(b"still here")).await;
    let frame = machine.binary().await;
    assert_eq!(&frame[4..], b"still here");
}

#[tokio::test]
async fn wrong_machine_secret_is_rejected_before_upgrade() {
    let relay = Relay::start().await;
    let bundle = bundle_of(3);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "right")
        .await
        .expect("unknown machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");

    let refused = relay.machine(&id, "wrong").await;
    assert_eq!(refused.err(), Some(401));

    let other = machine_id(&bundle_of(4));
    relay
        .machine(&other, "first-come")
        .await
        .expect("a second unknown machine registers");
    assert_eq!(relay.machine(&other, "second").await.err(), Some(401));

    assert_eq!(relay.machine("not-hex", "secret").await.err(), Some(400));
}

#[tokio::test]
async fn wrong_or_unknown_device_is_rejected_before_upgrade() {
    let relay = Relay::start().await;
    let bundle = bundle_of(5);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");

    assert_eq!(
        relay.device(&id, DEVICE_ID, "other-token").await.err(),
        Some(401)
    );
    assert_eq!(
        relay
            .device(&id, "ffffffffffffffffffffffffffffffff", TOKEN)
            .await
            .err(),
        Some(401)
    );
    assert_eq!(
        relay
            .device("ffffffffffffffffffffffffffffffff", DEVICE_ID, TOKEN)
            .await
            .err(),
        Some(401)
    );
    assert_eq!(relay.device(&id, "not-hex", TOKEN).await.err(), Some(401));

    let mut dev = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("allowed device connects");
    assert_eq!(dev.state().await.0, "online");
}

#[tokio::test]
async fn revoke_closes_live_device_and_blocks_reconnect() {
    let relay = Relay::start().await;
    let bundle = bundle_of(9);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");

    let mut dev = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("device connects");
    assert_eq!(dev.state().await.0, "online");
    let _ = machine.open_channel().await;

    assert_eq!(machine.revoke(DEVICE_ID).await["t"], "ok");
    assert_eq!(dev.close().await.0, 4003);

    assert_eq!(relay.device(&id, DEVICE_ID, TOKEN).await.err(), Some(401));
}
