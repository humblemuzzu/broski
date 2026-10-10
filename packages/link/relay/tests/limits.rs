mod common;

use std::time::Duration;

use bytes::Bytes;
use common::{bundle_of, machine_id, Client, Frame, Relay};
use serde_json::json;

const DEVICE_A: &str = "0123456789abcdef0123456789abcdef";
const DEVICE_B: &str = "fedcba9876543210fedcba9876543210";
const TOKEN_A: &str = "token-a";
const TOKEN_B: &str = "token-b";

async fn registered(relay: &Relay, seed: u8) -> (Client, String) {
    let bundle = bundle_of(seed);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    (machine, id)
}

#[tokio::test]
async fn oversized_message_closes_the_socket_with_1009() {
    let relay = Relay::start().await;
    let (mut machine, _) = registered(&relay, 20).await;

    let _ = machine
        .try_send_bin(Bytes::from(vec![0u8; 300 * 1024]))
        .await;
    assert_eq!(machine.close().await.0, 1009);
}

#[tokio::test]
async fn malformed_json_closes_the_socket_with_1008() {
    let relay = Relay::start().await;
    let (mut machine, _) = registered(&relay, 21).await;

    machine.send_text("{not json").await;
    assert_eq!(machine.close().await.0, 1008);
}

#[tokio::test]
async fn malformed_known_control_message_closes_the_socket_with_1008() {
    let relay = Relay::start().await;
    let (mut machine, _) = registered(&relay, 22).await;

    machine.send_json(&json!({"t": "close"})).await;
    assert_eq!(machine.close().await.0, 1008);
}

#[tokio::test]
async fn unknown_control_message_is_ignored() {
    let relay = Relay::start().await;
    let (mut machine, _) = registered(&relay, 23).await;

    machine
        .send_json(&json!({"t": "from-the-future", "req": 1, "extra": {"deep": true}}))
        .await;
    assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
}

#[tokio::test]
async fn upgrades_are_rate_limited_per_ip() {
    let relay = Relay::start().await;
    let (mut machine, id) = registered(&relay, 24).await;
    assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");

    for _ in 0..9 {
        relay
            .device(&id, DEVICE_A, TOKEN_A)
            .await
            .expect("inside the burst");
    }
    assert_eq!(relay.device(&id, DEVICE_A, TOKEN_A).await.err(), Some(429));
    assert_eq!(relay.machine(&id, "secret").await.err(), Some(429));
}

#[tokio::test]
async fn allowed_devices_are_capped() {
    let relay = Relay::start().await;
    let (mut machine, _) = registered(&relay, 25).await;

    for index in 0..32u32 {
        let id = format!("{index:032x}");
        assert_eq!(machine.allow(&id, TOKEN_A).await["t"], "ok");
    }
    let reply = machine.allow(&"f".repeat(32), TOKEN_A).await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "too_many_devices");

    assert_eq!(
        machine.allow(&format!("{:032x}", 0), TOKEN_B).await["t"],
        "ok"
    );
}

#[tokio::test]
async fn device_flooding_a_stalled_machine_is_closed() {
    let relay = Relay::start().await;
    let (mut machine, mut dev, channel) = {
        let (mut machine, id) = registered(&relay, 27).await;
        assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
        let mut dev = relay.device(&id, DEVICE_A, TOKEN_A).await.expect("device");
        assert_eq!(dev.state().await.0, "online");
        let (channel, _) = machine.open_channel().await;
        (machine, dev, channel)
    };
    assert_ne!(channel, 0);

    let payload = vec![0u8; 64 * 1024];
    let mut sent = 0usize;
    let mut closed = None;
    while sent < 64 * 1024 * 1024 {
        if !dev.try_send_bin(Bytes::from(payload.clone())).await {
            break;
        }
        sent += payload.len();
        if let Some(Frame::Close(code, _)) = dev.next(Duration::from_millis(1)).await {
            closed = Some(code);
            break;
        }
    }
    let code = match closed {
        Some(code) => code,
        None => dev.drain_close().await,
    };
    assert_eq!(code, 4008, "after {sent} bytes with a stalled machine");

    let mut notice = None;
    for _ in 0..4096 {
        match machine.next(Duration::from_secs(2)).await {
            Some(Frame::Text(value)) if value["t"] == "close" => {
                notice = Some(value);
                break;
            }
            Some(_) => continue,
            None => break,
        }
    }
    let notice = notice.expect("the machine was never told the channel closed");
    assert_eq!(notice["ch"], channel);
}

#[tokio::test]
async fn slow_device_is_closed_while_another_device_keeps_flowing() {
    let relay = Relay::start().await;
    let (mut machine, id) = registered(&relay, 26).await;
    assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_B, TOKEN_B).await["t"], "ok");

    let mut slow = relay
        .device(&id, DEVICE_A, TOKEN_A)
        .await
        .expect("slow device");
    assert_eq!(slow.state().await.0, "online");
    let (slow_channel, _) = machine.open_channel().await;

    let mut fast = relay
        .device(&id, DEVICE_B, TOKEN_B)
        .await
        .expect("healthy device");
    assert_eq!(fast.state().await.0, "online");
    let (fast_channel, _) = machine.open_channel().await;

    pump_until_channel_closes(&mut machine, slow_channel).await;
    assert_eq!(slow.drain_close().await, 4008);

    machine.send_channel(fast_channel, b"alive").await;
    assert_eq!(&fast.binary().await[..], b"alive");
    fast.send_bin(Bytes::from_static(b"pong")).await;
    let frame = machine.binary().await;
    assert_eq!(&frame[..4], &fast_channel.to_be_bytes());
    assert_eq!(&frame[4..], b"pong");
}

async fn pump_until_channel_closes(machine: &mut Client, channel: u32) {
    let payload = vec![0u8; 64 * 1024];
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&channel.to_be_bytes());
    frame.extend_from_slice(&payload);
    let frame = Bytes::from(frame);

    let mut sent = 0usize;
    while sent < 64 * 1024 * 1024 {
        machine.send_bin(frame.clone()).await;
        sent += payload.len();
        while let Some(message) = machine.next(Duration::from_millis(1)).await {
            if let Frame::Text(value) = message {
                if value["t"] == "close" && value["ch"] == channel {
                    return;
                }
            }
        }
    }
    panic!("relay never closed the slow channel after {sent} bytes");
}
