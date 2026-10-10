mod common;

use bytes::Bytes;
use common::{bundle_of, machine_id, Client, Frame, Relay};
use serde_json::json;

const DEVICE_ID: &str = "0123456789abcdef0123456789abcdef";
const TOKEN: &str = "device-token";

async fn online_pair(relay: &Relay, seed: u8) -> (Client, Client, u32) {
    let bundle = bundle_of(seed);
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
    let (channel, _) = machine.open_channel().await;
    (machine, dev, channel)
}

#[tokio::test]
async fn machine_reconnect_replaces_the_old_socket() {
    let relay = Relay::start().await;
    let bundle = bundle_of(11);
    let id = machine_id(&bundle);
    let mut first = relay.machine(&id, "secret").await.expect("first machine");
    let mut second = relay.machine(&id, "secret").await.expect("second machine");
    assert_eq!(first.close().await.0, 4001);
    assert_eq!(second.publish(&bundle).await["t"], "ok");
}

#[tokio::test]
async fn device_reconnect_replaces_the_old_socket() {
    let relay = Relay::start().await;
    let bundle = bundle_of(12);
    let id = machine_id(&bundle);
    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");

    let mut first = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("first device");
    assert_eq!(first.state().await.0, "online");
    let (first_channel, _) = machine.open_channel().await;

    let mut second = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("second device");
    assert_eq!(second.state().await.0, "online");

    let closed = machine.text().await;
    assert_eq!(closed["t"], "close");
    assert_eq!(closed["ch"], first_channel);
    let (second_channel, _) = machine.open_channel().await;
    assert_ne!(first_channel, second_channel);

    assert_eq!(first.close().await.0, 4001);
    machine.send_channel(second_channel, b"hello").await;
    assert_eq!(&second.binary().await[..], b"hello");
}

#[tokio::test]
async fn machine_closed_channel_closes_the_device() {
    let relay = Relay::start().await;
    let (mut machine, mut dev, channel) = online_pair(&relay, 13).await;
    machine
        .send_json(&json!({"t": "close", "ch": channel}))
        .await;
    assert_eq!(dev.close().await.0, 4000);
}

#[tokio::test]
async fn waiting_device_gets_offline_then_online_with_a_working_channel() {
    let relay = Relay::start().await;
    let bundle = bundle_of(14);
    let id = machine_id(&bundle);
    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");
    drop(machine);

    let mut dev = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("device connects while the machine is away");
    dev.wait_state("offline").await;

    dev.send_bin(Bytes::from_static(b"dropped")).await;
    assert!(dev
        .next(std::time::Duration::from_millis(50))
        .await
        .is_none());

    let mut machine = relay.machine(&id, "secret").await.expect("machine returns");
    dev.wait_state("online").await;
    let (channel, opened_for) = machine.open_channel().await;
    assert_eq!(opened_for, DEVICE_ID);

    dev.send_bin(Bytes::from_static(b"ping")).await;
    let frame = machine.binary().await;
    assert_eq!(&frame[..4], &channel.to_be_bytes());
    assert_eq!(&frame[4..], b"ping");

    machine.send_channel(channel, b"pong").await;
    let frame = dev.next(std::time::Duration::from_secs(5)).await;
    assert!(matches!(frame, Some(Frame::Binary(payload)) if &payload[..] == b"pong"));
}

#[tokio::test]
async fn sleep_marks_devices_asleep_until_the_machine_sends_again() {
    let relay = Relay::start().await;
    let (mut machine, mut dev, channel) = online_pair(&relay, 15).await;

    machine.send_json(&json!({"t": "sleep"})).await;
    dev.wait_state("asleep").await;

    machine.send_channel(channel, b"wake").await;
    dev.wait_state("online").await;
    assert_eq!(&dev.binary().await[..], b"wake");

    machine.send_json(&json!({"t": "sleep"})).await;
    dev.wait_state("asleep").await;
}

#[tokio::test]
async fn shutdown_closes_every_socket_with_service_restart() {
    let mut relay = Relay::start().await;
    let (mut machine, mut dev, _) = online_pair(&relay, 16).await;

    relay.stop().await;

    assert_eq!(machine.close().await.0, 1012);
    assert_eq!(dev.close().await.0, 1012);
}

#[tokio::test]
#[ignore = "takes ~50 s; exercises the 45 s liveness timeout"]
async fn idle_socket_is_closed_after_the_liveness_timeout() {
    let relay = Relay::start().await;
    let bundle = bundle_of(17);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");

    tokio::time::sleep(std::time::Duration::from_secs(50)).await;
    assert_eq!(machine.drain_close().await, 1001);
}
