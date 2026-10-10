mod common;

use bytes::Bytes;
use common::{bundle_of, http_get, machine_id, Relay, DEVICE_HEADER, MACHINE_HEADER};
use serde_json::Value;

const DEVICE_ID: &str = "0123456789abcdef0123456789abcdef";
const TOKEN: &str = "device-token";

#[tokio::test]
async fn machine_secret_identity_and_devices_survive_a_restart() {
    let relay = Relay::start().await;
    let bundle = bundle_of(50);
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
    drop(dev);
    drop(machine);

    let relay = relay.restart().await;

    let (status, body) = http_get(relay.addr, &format!("/v1/identity/{id}"), &[]).await;
    assert_eq!(status, 200);
    let value: Value = serde_json::from_str(&body).expect("identity json");
    assert_eq!(value["pub"], broski_relay::auth::b64url_encode(&bundle));

    assert_eq!(relay.machine(&id, "wrong").await.err(), Some(401));

    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("stored secret still works");
    let mut dev = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("stored device still allowed");
    assert_eq!(dev.state().await.0, "online");
    let (channel, opened_for) = machine.open_channel().await;
    assert_eq!(opened_for, DEVICE_ID);

    dev.send_bin(Bytes::from_static(b"after-restart")).await;
    let frame = machine.binary().await;
    assert_eq!(&frame[..4], &channel.to_be_bytes());
    assert_eq!(&frame[4..], b"after-restart");
}

#[tokio::test]
async fn storage_keeps_only_hashes() {
    let relay = Relay::start().await;
    let bundle = bundle_of(52);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");

    let conn = rusqlite::Connection::open(&relay.db).expect("open database");
    let secret_hash: Vec<u8> = conn
        .query_row(
            "SELECT secret_hash FROM machines WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .expect("machine row");
    assert_eq!(secret_hash, broski_relay::auth::sha256(b"secret"));
    let token_hash: Vec<u8> = conn
        .query_row(
            "SELECT token_hash FROM devices WHERE device_id = ?1",
            [DEVICE_ID],
            |row| row.get(0),
        )
        .expect("device row");
    assert_eq!(token_hash, broski_relay::auth::sha256(TOKEN.as_bytes()));
    let stored_pub: Vec<u8> = conn
        .query_row("SELECT pub FROM machines WHERE id = ?1", [&id], |row| {
            row.get(0)
        })
        .expect("published identity");
    assert_eq!(stored_pub, bundle);
}

#[tokio::test]
async fn identity_is_served_from_storage_while_the_machine_is_offline() {
    let relay = Relay::start().await;
    let bundle = bundle_of(51);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    drop(machine);

    let relay = relay.restart().await;

    let (status, body) = http_get(relay.addr, &format!("/v1/identity/{id}"), &[]).await;
    assert_eq!(status, 200);
    let value: Value = serde_json::from_str(&body).expect("identity json");
    assert_eq!(value["pub"], broski_relay::auth::b64url_encode(&bundle));

    let refused = relay.device(&id, DEVICE_ID, TOKEN).await;
    assert_eq!(refused.err(), Some(401));

    let token = format!("Bearer {TOKEN}");
    let (status, _) = http_get(
        relay.addr,
        &format!("/v1/status/{id}"),
        &[
            (MACHINE_HEADER, &id),
            (DEVICE_HEADER, DEVICE_ID),
            ("authorization", &token),
        ],
    )
    .await;
    assert_eq!(status, 401);
}
