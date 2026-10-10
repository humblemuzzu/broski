mod common;

use std::time::{Duration, Instant};

use broski_relay::auth::b64url_encode;
use broski_relay::limits::{Limits, RateLimit};
use common::{
    bundle_of, http_post, machine_id, Client, Relay, DEVICE_A, DEVICE_B, DEVICE_HEADER,
    MACHINE_HEADER, TOKEN_A, TOKEN_B,
};

const LETTER_MAX: usize = 64 * 1024;

async fn pair(relay: &Relay, seed: u8) -> (String, Client) {
    let bundle = bundle_of(seed);
    let id = machine_id(&bundle);
    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_B, TOKEN_B).await["t"], "ok");
    (id, machine)
}

async fn post(
    relay: &Relay,
    machine: &str,
    device: &str,
    token: &str,
    body: &[u8],
) -> (u16, String) {
    let authorization = format!("Bearer {token}");
    http_post(
        relay.addr,
        "/v1/letters",
        &[
            (MACHINE_HEADER, machine),
            (DEVICE_HEADER, device),
            ("authorization", &authorization),
            ("content-type", "application/octet-stream"),
        ],
        body,
    )
    .await
}

fn posted(body: &str) -> (u64, bool) {
    let value: serde_json::Value = serde_json::from_str(body).expect("letter json");
    (
        value["id"].as_u64().expect("letter id"),
        value["delivered"].as_bool().expect("delivered"),
    )
}

async fn letter_count(db: &std::path::Path) -> i64 {
    let conn = rusqlite::Connection::open(db).expect("open database");
    conn.query_row("SELECT COUNT(*) FROM letters", [], |row| row.get(0))
        .expect("count letters")
}

#[tokio::test]
async fn letters_posted_while_offline_arrive_in_order_and_are_removed_by_the_ack() {
    let relay = Relay::start().await;
    let (id, machine) = pair(&relay, 70).await;
    drop(machine);

    let mut ids = Vec::new();
    for index in 0..3u8 {
        let body = [b"letter-".as_slice(), &[b'0' + index]].concat();
        let (status, response) = post(&relay, &id, DEVICE_A, TOKEN_A, &body).await;
        assert_eq!(status, 202, "{response}");
        let (letter_id, delivered) = posted(&response);
        assert!(!delivered, "no machine is listening");
        ids.push(letter_id);
    }
    assert_eq!(ids, vec![1, 2, 3]);
    assert_eq!(letter_count(&relay.db).await, 3);

    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    let mut frames = Vec::new();
    for _ in 0..ids.len() {
        frames.push(machine.letter().await);
    }
    for (index, frame) in frames.iter().enumerate() {
        assert_eq!(frame["id"].as_u64(), Some(ids[index]));
        assert_eq!(frame["device"], DEVICE_A);
        let body = [b"letter-".as_slice(), &[b'0' + index as u8]].concat();
        assert_eq!(frame["data"], b64url_encode(&body));
        assert!(frame["created_at"].as_i64().expect("created_at") > 0);
    }
    for letter_id in &ids {
        assert_eq!(machine.ack_letter(*letter_id).await["t"], "ok");
    }
    assert_eq!(letter_count(&relay.db).await, 0);

    drop(machine);
    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert!(
        machine.next(Duration::from_millis(200)).await.is_none(),
        "an acked letter was redelivered"
    );
}

#[tokio::test]
async fn unacked_letters_are_redelivered_until_the_machine_acks_them() {
    let relay = Relay::start().await;
    let (id, machine) = pair(&relay, 71).await;
    drop(machine);

    let (status, response) = post(&relay, &id, DEVICE_A, TOKEN_A, b"queue me").await;
    assert_eq!(status, 202);
    let (letter_id, _) = posted(&response);

    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert_eq!(machine.letter().await["id"].as_u64(), Some(letter_id));
    drop(machine);

    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    let frame = machine.letter().await;
    assert_eq!(frame["id"].as_u64(), Some(letter_id));
    assert_eq!(frame["data"], b64url_encode(b"queue me"));
    assert_eq!(machine.ack_letter(letter_id + 1000).await["t"], "ok");
    assert_eq!(
        letter_count(&relay.db).await,
        1,
        "an ack for another id must not retire a letter"
    );
    assert_eq!(machine.ack_letter(letter_id).await["t"], "ok");
    assert_eq!(letter_count(&relay.db).await, 0);

    drop(machine);
    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert!(machine.next(Duration::from_millis(200)).await.is_none());
}

#[tokio::test]
async fn letter_size_is_capped_at_64_kib() {
    let relay = Relay::start().await;
    let (id, _machine) = pair(&relay, 72).await;

    let (status, _) = post(&relay, &id, DEVICE_A, TOKEN_A, &vec![7u8; LETTER_MAX]).await;
    assert_eq!(status, 202);
    let (status, body) = post(&relay, &id, DEVICE_A, TOKEN_A, &vec![7u8; LETTER_MAX + 1]).await;
    assert_eq!(status, 413, "{body}");
    assert_eq!(letter_count(&relay.db).await, 1);
}

#[tokio::test]
async fn mailbox_is_capped_by_letter_count() {
    let relay = Relay::start().await;
    let (id, machine) = pair(&relay, 73).await;
    drop(machine);

    for index in 0..100u32 {
        let device = if index % 2 == 0 { DEVICE_A } else { DEVICE_B };
        let token = if index % 2 == 0 { TOKEN_A } else { TOKEN_B };
        let (status, body) = post(&relay, &id, device, token, b"x").await;
        assert_eq!(status, 202, "letter {index}: {body}");
    }
    let (status, body) = post(&relay, &id, DEVICE_A, TOKEN_A, b"x").await;
    assert_eq!(status, 507, "{body}");
    assert!(body.contains("mailbox_full"), "{body}");
    assert_eq!(letter_count(&relay.db).await, 100);
}

#[tokio::test]
async fn mailbox_is_capped_by_total_bytes() {
    let relay = Relay::start().await;
    let (id, machine) = pair(&relay, 74).await;
    drop(machine);

    for index in 0..16u32 {
        let device = if index % 2 == 0 { DEVICE_A } else { DEVICE_B };
        let token = if index % 2 == 0 { TOKEN_A } else { TOKEN_B };
        let (status, body) = post(&relay, &id, device, token, &vec![3u8; LETTER_MAX]).await;
        assert_eq!(status, 202, "letter {index}: {body}");
    }
    let (status, body) = post(&relay, &id, DEVICE_A, TOKEN_A, &vec![3u8; 1024]).await;
    assert_eq!(status, 507, "{body}");
    assert!(body.contains("mailbox_full"), "{body}");
}

#[tokio::test]
async fn expired_letters_are_never_delivered_and_the_sweep_deletes_them() {
    let relay = Relay::start_configured(
        RateLimit::default(),
        Limits {
            letter_ttl: Duration::from_millis(200),
            sweep_interval: Duration::from_millis(50),
            ..Limits::default()
        },
        Default::default(),
    )
    .await;
    let (id, machine) = pair(&relay, 75).await;
    drop(machine);

    let (status, _) = post(&relay, &id, DEVICE_A, TOKEN_A, b"too late").await;
    assert_eq!(status, 202);

    let deadline = Instant::now() + Duration::from_secs(5);
    while letter_count(&relay.db).await > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(letter_count(&relay.db).await, 0, "the sweep never ran");

    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert!(
        machine.next(Duration::from_millis(200)).await.is_none(),
        "an expired letter was delivered"
    );
}

#[tokio::test]
async fn expired_letters_are_withheld_even_before_the_sweep() {
    let relay = Relay::start_configured(
        RateLimit::default(),
        Limits {
            letter_ttl: Duration::from_millis(100),
            sweep_interval: Duration::from_secs(600),
            ..Limits::default()
        },
        Default::default(),
    )
    .await;
    let (id, machine) = pair(&relay, 76).await;
    drop(machine);

    let (status, _) = post(&relay, &id, DEVICE_A, TOKEN_A, b"too late").await;
    assert_eq!(status, 202);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(
        letter_count(&relay.db).await,
        1,
        "the sweep should not have run"
    );

    let mut machine = relay.machine(&id, "secret").await.expect("machine");
    assert!(machine.next(Duration::from_millis(200)).await.is_none());
}

#[tokio::test]
async fn letters_are_rate_limited_per_device() {
    let relay = Relay::start().await;
    let (id, machine) = pair(&relay, 77).await;
    drop(machine);

    for index in 0..60u32 {
        let (status, body) = post(&relay, &id, DEVICE_A, TOKEN_A, b"x").await;
        assert_eq!(status, 202, "letter {index}: {body}");
    }
    let (status, body) = post(&relay, &id, DEVICE_A, TOKEN_A, b"x").await;
    assert_eq!(status, 429, "{body}");

    let (status, body) = post(&relay, &id, DEVICE_B, TOKEN_B, b"x").await;
    assert_eq!(status, 202, "the other device has its own bucket: {body}");
}

#[tokio::test]
async fn letters_require_device_credentials() {
    let relay = Relay::start().await;
    let (id, _machine) = pair(&relay, 78).await;
    let unknown = "f".repeat(32);

    let attempts: Vec<Vec<(&str, &str)>> = vec![
        vec![],
        vec![(MACHINE_HEADER, id.as_str())],
        vec![(MACHINE_HEADER, "not-hex")],
        vec![(MACHINE_HEADER, &unknown), (DEVICE_HEADER, DEVICE_A)],
        vec![(MACHINE_HEADER, &id), (DEVICE_HEADER, DEVICE_A)],
        vec![
            (MACHINE_HEADER, &id),
            (DEVICE_HEADER, DEVICE_A),
            ("authorization", "Bearer wrong"),
        ],
        vec![
            (MACHINE_HEADER, &id),
            (DEVICE_HEADER, "ffffffffffffffffffffffffffffffff"),
            ("authorization", "Bearer device-token-a"),
        ],
    ];
    for headers in attempts {
        let (status, _) = http_post(relay.addr, "/v1/letters", &headers, b"x").await;
        assert_eq!(status, 401, "headers {headers:?}");
    }
    assert_eq!(letter_count(&relay.db).await, 0);
}

#[tokio::test]
async fn a_letter_posted_to_an_online_machine_is_handed_over_immediately() {
    let relay = Relay::start().await;
    let (id, mut machine) = pair(&relay, 79).await;

    let (status, response) = post(&relay, &id, DEVICE_B, TOKEN_B, b"now").await;
    assert_eq!(status, 202);
    let (letter_id, delivered) = posted(&response);
    assert!(delivered);

    let frame = machine.letter().await;
    assert_eq!(frame["id"].as_u64(), Some(letter_id));
    assert_eq!(frame["device"], DEVICE_B);
    assert_eq!(machine.ack_letter(letter_id).await["t"], "ok");
    assert_eq!(letter_count(&relay.db).await, 0);
}
