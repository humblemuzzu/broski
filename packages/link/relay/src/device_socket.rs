use std::sync::Arc;

use axum::extract::ws::WebSocket;
use tracing::info;

use crate::auth::truncated;
use crate::hub::Hub;
use crate::limits::DEVICE_QUEUE_BYTES;
use crate::socket::{Event, Session};

pub async fn run(
    hub: Arc<Hub>,
    machine_id: String,
    device_id: String,
    last_seen: Option<i64>,
    socket: WebSocket,
) {
    let mut session = Session::new(socket, DEVICE_QUEUE_BYTES);
    let room = hub.lease(&machine_id, last_seen);
    let generation = room.attach_device(&device_id, session.handle.clone());
    info!(
        machine = truncated(&machine_id),
        device = truncated(&device_id),
        "device attached"
    );
    loop {
        match session.next().await {
            Event::Binary(frame) => room.forward_from_device(&device_id, &frame),
            Event::Text(_) => {}
            Event::Replaced | Event::Closed => break,
        }
    }
    room.detach_device(&device_id, generation);
    info!(
        machine = truncated(&machine_id),
        device = truncated(&device_id),
        "device detached"
    );
    session.finish().await;
}
