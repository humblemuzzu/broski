mod common;

use broski_relay::auth::b64url_encode;
use common::{bundle_of, http_get, machine_id, Relay, DEVICE_HEADER, MACHINE_HEADER};
use serde_json::Value;

const DEVICE_ID: &str = "0123456789abcdef0123456789abcdef";
const TOKEN: &str = "device-token";

fn device_headers<'a>(id: &'a str, token: &'a str) -> [(&'a str, &'a str); 3] {
    [
        (MACHINE_HEADER, id),
        (DEVICE_HEADER, DEVICE_ID),
        ("authorization", token),
    ]
}

#[tokio::test]
async fn healthz_answers_ok() {
    let relay = Relay::start().await;
    let (status, body) = http_get(relay.addr, "/healthz", &[]).await;
    assert_eq!(status, 200);
    assert_eq!(body, "ok");
}

#[tokio::test]
async fn identity_is_published_and_looked_up() {
    let relay = Relay::start().await;
    let bundle = bundle_of(40);
    let id = machine_id(&bundle);

    assert_eq!(
        http_get(relay.addr, &format!("/v1/identity/{id}"), &[])
            .await
            .0,
        404
    );

    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");

    let (status, body) = http_get(relay.addr, &format!("/v1/identity/{id}"), &[]).await;
    assert_eq!(status, 200);
    let value: Value = serde_json::from_str(&body).expect("identity json");
    assert_eq!(value["pub"], b64url_encode(&bundle));

    let unknown = machine_id(&bundle_of(41));
    assert_eq!(
        http_get(relay.addr, &format!("/v1/identity/{unknown}"), &[])
            .await
            .0,
        404
    );
    assert_eq!(
        http_get(relay.addr, "/v1/identity/not-an-id", &[]).await.0,
        404
    );
}

#[tokio::test]
async fn status_requires_device_credentials_and_tracks_the_machine() {
    let relay = Relay::start().await;
    let bundle = bundle_of(42);
    let id = machine_id(&bundle);
    let mut machine = relay
        .machine(&id, "secret")
        .await
        .expect("machine registers");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_ID, TOKEN).await["t"], "ok");

    let path = format!("/v1/status/{id}");
    unauthorized_status(&relay, &id, &path).await;

    let token = format!("Bearer {TOKEN}");
    let online = status_body(&relay, &path, &device_headers(&id, &token)).await;
    assert_eq!(online["machine"], "online");
    assert!(online["last_seen"].as_i64().is_some());

    let mut dev = relay
        .device(&id, DEVICE_ID, TOKEN)
        .await
        .expect("device connects");
    assert_eq!(dev.state().await.0, "online");
    drop(machine);
    dev.wait_state("offline").await;

    let offline = status_body(&relay, &path, &device_headers(&id, &token)).await;
    assert_eq!(offline["machine"], "offline");
    assert!(offline["last_seen"].as_i64().is_some());
}

async fn unauthorized_status(relay: &Relay, id: &str, path: &str) {
    let unknown = "f".repeat(32);
    let attempts = [
        Vec::new(),
        vec![(MACHINE_HEADER, id)],
        device_headers(id, "Bearer wrong").to_vec(),
        vec![
            (MACHINE_HEADER, &unknown),
            (DEVICE_HEADER, "00000000000000000000000000000000"),
            ("authorization", "Bearer wrong"),
        ],
    ];
    for headers in attempts {
        assert_eq!(http_get(relay.addr, path, &headers).await.0, 401);
    }
}

async fn status_body(relay: &Relay, path: &str, headers: &[(&str, &str)]) -> Value {
    let (status, body) = http_get(relay.addr, path, headers).await;
    assert_eq!(status, 200);
    let value: Value = serde_json::from_str(&body).expect("status json");
    assert_eq!(value["t"], "status");
    value
}
