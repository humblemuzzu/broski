#![allow(dead_code)]

mod client;
mod http;
pub mod keys;
mod mock;
pub mod push;
mod relay;

use std::net::SocketAddr;
use std::time::Duration;

use broski_relay::auth::{hex_lower, sha256};

#[allow(unused_imports)]
pub use client::{Client, Frame};
#[allow(unused_imports)]
pub use http::{http_get, http_post, request, try_http_get};
#[allow(unused_imports)]
pub use mock::{
    apns_push_config, fcm_push_config, providers, upstream_push_config, ApnsMock, Captured,
    FcmMock, Providers, Recorder,
};
#[allow(unused_imports)]
pub use relay::Relay;

pub const MACHINE_HEADER: &str = "x-broski-machine";
pub const DEVICE_HEADER: &str = "x-broski-device";
pub const WAIT: Duration = Duration::from_secs(5);

pub const DEVICE_A: &str = "0123456789abcdef0123456789abcdef";
pub const DEVICE_B: &str = "fedcba9876543210fedcba9876543210";
pub const TOKEN_A: &str = "device-token-a";
pub const TOKEN_B: &str = "device-token-b";

pub const APNS_KEY_ID: &str = "TESTKEYID1";
pub const APNS_TEAM_ID: &str = "TESTTEAM99";
pub const APNS_TOPIC: &str = "dev.broski.link.test";
pub const FCM_PROJECT: &str = "broski-relay-test";
pub const FCM_CLIENT_EMAIL: &str = "relay@broski-relay-test.iam.gserviceaccount.com";

pub fn machine_id(bundle: &[u8]) -> String {
    hex_lower(&sha256(bundle)[..16])
}

pub fn token_hash(token: &str) -> String {
    hex_lower(&sha256(token.as_bytes()))
}

pub fn bundle_of(seed: u8) -> Vec<u8> {
    vec![seed; 48]
}

pub async fn connect_machine(addr: SocketAddr, id: &str, secret: &str) -> Result<Client, u16> {
    Client::connect(
        addr,
        "/v1/machine",
        &[
            (MACHINE_HEADER, id),
            ("authorization", &format!("Bearer {secret}")),
        ],
    )
    .await
}
