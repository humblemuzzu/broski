//! A machine whose link never comes up: requests wait for a bridge, within their deadline and the
//! bound, and leave nothing behind; a bridge status and its answers fed in by hand drive the hello.

use std::sync::Arc;
use std::time::Duration;

use broski_contract::{
    BackendsListRequest, ClientInfo, ClientMessage, ErrorResponse, HelloRequest, HelloResponse,
    ProtocolError, ProtocolErrorCode, ServerMessage, PROTOCOL_VERSION,
};
use broski_link_session::{
    BridgeState, BridgeStatus, DeviceIdentity, LinkRuntime, MachineRecord, Platform, Session,
    SessionOptions,
};
use tokio::sync::Notify;
use tokio::time::{timeout, Instant};

use super::{ContractState, Machine};
use crate::error::ClientError;
use crate::requests::MAX_PENDING_REQUESTS;

/// A machine whose one LAN route is a closed port.
pub(super) fn unreachable() -> Arc<Machine> {
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
        protocol: PROTOCOL_VERSION,
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

/// Hands the machine a message from the bridge, as its pump does.
fn answer(machine: &Machine, answer: ServerMessage) {
    machine
        .shared()
        .on_message(&mut machine.shared().lock(), answer);
}

fn refusal(id: &str, message: &str) -> ServerMessage {
    ServerMessage::Error(ErrorResponse {
        request_id: Some(id.to_owned()),
        error: ProtocolError {
            code: ProtocolErrorCode::Internal,
            message: message.to_owned(),
        },
    })
}

/// Pulls the machine's events until its contract state is `wanted`; how long that took.
async fn contract_becomes(machine: &Machine, wanted: ContractState) -> Duration {
    let started = std::time::Instant::now();
    while machine.status().contract != wanted {
        timeout(Duration::from_secs(10), machine.next_event())
            .await
            .unwrap_or_else(|_| panic!("waiting for {wanted:?}: {:?}", machine.status()))
            .expect("the machine goes on");
    }
    started.elapsed()
}

#[tokio::test]
async fn a_hello_the_bridge_refuses_is_said_again_after_a_pause_that_grows() {
    let machine = unreachable();
    let up = BridgeStatus {
        state: BridgeState::Up,
        conn: 1,
        detail: None,
    };
    machine.shared().on_bridge(&mut machine.shared().lock(), up);

    // The client numbers its requests from 1, and the hello is its first.
    answer(&machine, refusal("1", "starting up"));
    let refused = ContractState::Refused {
        message: "starting up".to_owned(),
    };
    assert_eq!(machine.status().contract, refused);
    let first = contract_becomes(&machine, ContractState::Waiting).await;

    answer(&machine, refusal("2", "still starting"));
    let second = contract_becomes(&machine, ContractState::Waiting).await;
    assert!(
        first >= Duration::from_secs(1) && second >= Duration::from_secs(2),
        "the hello went again after {first:?}, then {second:?}"
    );

    let accepted = ServerMessage::HelloResult(HelloResponse {
        request_id: "3".to_owned(),
        protocol: PROTOCOL_VERSION,
        bridge_version: "9.9.9".to_owned(),
    });
    answer(&machine, accepted);
    let ready = ContractState::Ready {
        bridge_version: "9.9.9".to_owned(),
    };
    assert_eq!(machine.status().contract, ready);
}
