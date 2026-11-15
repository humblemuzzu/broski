//! A machine whose link never comes up: requests wait for a bridge, within their deadline and the
//! bound, and leave nothing behind.

use std::sync::Arc;
use std::time::Duration;

use broski_contract::{
    BackendsListRequest, ClientInfo, ClientMessage, HelloRequest, ProtocolVersion,
};
use broski_link_session::{
    DeviceIdentity, LinkRuntime, MachineRecord, Platform, Session, SessionOptions,
};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::Machine;
use crate::error::ClientError;
use crate::requests::MAX_PENDING_REQUESTS;

/// A machine whose one LAN route is a closed port.
fn unreachable() -> Arc<Machine> {
    let runtime = LinkRuntime::new().expect("runtime");
    let identity = DeviceIdentity::generate().expect("identity");
    let machine = DeviceIdentity::generate().expect("a machine identity");
    let closed = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .expect("a free port");
    let record = MachineRecord {
        id: machine.id(),
        name: "nobody".into(),
        os: None,
        public_bundle: machine.public_bundle(),
        device_id: identity.id(),
        relay: None,
        relay_token: None,
        lan: vec![closed.to_string()],
        push_key: vec![7; 32],
        paired_at_ms: 0,
    };
    let options = SessionOptions::new("test phone", Platform::Ios);
    let session = Session::start(&runtime, &identity, record.clone(), options).expect("a session");
    let client = ClientInfo {
        name: "tests".into(),
        version: "0".into(),
    };
    Machine::spawn(&runtime, session, record, client, Arc::new(Notify::new()))
}

fn backends() -> ClientMessage {
    ClientMessage::BackendsList(BackendsListRequest {
        request_id: String::new(),
    })
}

#[tokio::test]
async fn a_request_unanswered_by_its_deadline_times_out_and_leaves_nothing_behind() {
    let machine = unreachable();
    let deadline = Instant::now() + Duration::from_millis(50);
    let call = machine
        .shared()
        .call_until(backends(), deadline)
        .expect("held");
    assert_eq!(machine.shared().lock().requests.callers(), 1);
    assert_eq!(call.answer().await, Err(ClientError::Timeout));
    assert_eq!(machine.shared().lock().requests.callers(), 0);
}

#[tokio::test]
async fn requests_waiting_for_a_bridge_are_bounded() {
    let machine = unreachable();
    let held: Vec<_> = (0..MAX_PENDING_REQUESTS)
        .map(|_| machine.shared().call(backends()).expect("held"))
        .collect();
    assert_eq!(
        machine.shared().call(backends()).err(),
        Some(ClientError::Overloaded)
    );
    drop(held);
    assert!(
        machine.shared().call(backends()).is_ok(),
        "dropped calls free their places"
    );
}

#[tokio::test]
async fn the_clients_own_requests_are_refused_and_a_closed_machine_refuses_all() {
    let machine = unreachable();
    let hello = ClientMessage::Hello(HelloRequest {
        request_id: String::new(),
        protocol: ProtocolVersion { major: 1, minor: 0 },
        client: ClientInfo {
            name: "x".into(),
            version: "0".into(),
        },
    });
    assert!(matches!(
        machine.request(hello).await,
        Err(ClientError::InvalidRequest { .. })
    ));
    let waiting = machine.shared().call(backends()).expect("held");
    machine.retire();
    assert_eq!(waiting.answer().await, Err(ClientError::Closed));
    assert_eq!(machine.request(backends()).await, Err(ClientError::Closed));
}
