use std::sync::Arc;

use axum::extract::ws::WebSocket;
use bytes::Bytes;
use tracing::info;

use crate::alerts::{self, AlertTarget, Arming};
use crate::auth::{self, public_identity, truncated};
use crate::db::PutDevice;
use crate::hub::Hub;
use crate::letters;
use crate::limits::{MACHINE_QUEUE_BYTES, MAX_ALERT_TARGETS, MAX_ALLOWED_DEVICES};
use crate::protocol::{encode, now_ms, FromMachine, ToMachine};
use crate::push::{self, PushError};
use crate::room::Room;
use crate::socket::{Event, Session, CLOSE_POLICY};

pub async fn run(hub: Arc<Hub>, machine_id: String, last_seen: Option<i64>, socket: WebSocket) {
    let mut session = Session::new(socket, MACHINE_QUEUE_BYTES);
    let room = hub.lease(&machine_id, last_seen);
    let generation = room.attach_machine(session.handle.clone(), last_seen);
    info!(machine = truncated(&machine_id), "machine attached");
    deliver_letters(&hub, &room, &machine_id).await;
    loop {
        match session.next().await {
            Event::Binary(frame) => {
                touch(&hub, &room, &machine_id).await;
                forward(&room, &frame);
            }
            Event::Text(text) => {
                touch(&hub, &room, &machine_id).await;
                if control(&hub, &room, &session, &machine_id, &text)
                    .await
                    .is_err()
                {
                    session
                        .handle
                        .close(CLOSE_POLICY, "malformed control message");
                    break;
                }
            }
            Event::Replaced | Event::Closed => break,
        }
    }
    if let Some(ts) = room.detach_machine(generation) {
        let _ = hub.db().touch_last_seen(&machine_id, ts).await;
        alerts::arm(&hub, &machine_id, Arming::Gone);
    }
    info!(machine = truncated(&machine_id), "machine detached");
    session.finish().await;
}

async fn deliver_letters(hub: &Hub, room: &Room, machine_id: &str) {
    let cutoff = letters::cutoff(hub, now_ms());
    if let Ok(letters) = hub.db().pending_letters(machine_id, cutoff).await {
        letters::deliver_pending(room, &letters);
    }
}

fn forward(room: &Room, frame: &Bytes) {
    if frame.len() < 4 {
        return;
    }
    let channel = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]);
    room.forward_from_machine(channel, frame.slice(4..));
}

async fn touch(hub: &Hub, room: &Room, machine_id: &str) {
    let outcome = room.touch(now_ms());
    if outcome.woke {
        room.notify_status();
    }
    if let Some(ts) = outcome.flush {
        let _ = hub.db().touch_last_seen(machine_id, ts).await;
    }
}

// Err marks a control message that cannot be honoured; the caller closes the socket with 1008
struct Malformed;

type Control = Result<(), Malformed>;

async fn control(
    hub: &Arc<Hub>,
    room: &Arc<Room>,
    session: &Session,
    machine_id: &str,
    text: &str,
) -> Control {
    let message: FromMachine = serde_json::from_str(text).map_err(|_| Malformed)?;
    match message.t.as_str() {
        "identity" => identity(hub, session, machine_id, &message).await,
        "allow" => allow(hub, session, machine_id, &message).await,
        "revoke" => revoke(hub, room, session, machine_id, &message).await,
        "keep" => keep(hub, room, session, machine_id, &message).await,
        "close" => {
            room.close_channel(message.ch.ok_or(Malformed)?);
            Ok(())
        }
        "sleep" => {
            room.sleep();
            alerts::arm(hub, machine_id, Arming::Asleep);
            Ok(())
        }
        "push" => request_push(hub, session, machine_id, &message),
        "alert_targets" => targets(hub, session, machine_id, &message).await,
        "watch" => watch(hub, room, session, machine_id, &message),
        "letter_ack" => letter_ack(hub, session, machine_id, &message).await,
        _ => Ok(()),
    }
}

fn request_push(
    hub: &Arc<Hub>,
    session: &Session,
    machine_id: &str,
    message: &FromMachine,
) -> Control {
    let req = message.req.ok_or(Malformed)?;
    let request = match push::from_machine(message, machine_id) {
        Ok(request) => request,
        Err(error) => return err(session, req, error.code()),
    };
    if !hub.push().allow_machine(machine_id) {
        return err(session, req, PushError::RateLimited.code());
    }
    let hub = hub.clone();
    let session = session.handle.clone();
    tokio::spawn(async move {
        let reply = match hub.push().send(&request).await {
            Ok(()) => ToMachine::Ok { req },
            Err(error) => ToMachine::Err {
                req,
                code: error.code(),
            },
        };
        let _ = session.text(encode(&reply));
    });
    Ok(())
}

async fn targets(hub: &Hub, session: &Session, machine_id: &str, message: &FromMachine) -> Control {
    let req = message.req.ok_or(Malformed)?;
    let Some(list) = message.targets.as_deref() else {
        return err(session, req, "bad_target");
    };
    if list.len() > MAX_ALERT_TARGETS {
        return err(session, req, "too_many_targets");
    }
    let mut targets = Vec::with_capacity(list.len());
    for target in list {
        if !auth::valid_id(&target.device) || !push::valid_token(&target.token) {
            return err(session, req, "bad_target");
        }
        let Some(platform) = push::Platform::parse(&target.platform) else {
            return err(session, req, "bad_target");
        };
        targets.push(AlertTarget {
            device: target.device.clone(),
            platform,
            token: target.token.clone(),
        });
    }
    match hub.db().put_alert_targets(machine_id, targets).await {
        Ok(true) => ok(session, req),
        Ok(false) => err(session, req, "db_error"),
        Err(_) => err(session, req, "db_error"),
    }
}

fn watch(
    hub: &Arc<Hub>,
    room: &Room,
    session: &Session,
    machine_id: &str,
    message: &FromMachine,
) -> Control {
    room.set_watch(message.on.ok_or(Malformed)?);
    if !hub.push().configured() && hub.note_alert_gap() {
        info!(
            machine = truncated(machine_id),
            "offline alerts unavailable: push is not configured"
        );
    }
    match message.req {
        Some(req) => ok(session, req),
        None => Ok(()),
    }
}

async fn letter_ack(
    hub: &Hub,
    session: &Session,
    machine_id: &str,
    message: &FromMachine,
) -> Control {
    let id = message.id.ok_or(Malformed)?;
    let failed = hub.db().delete_letter(machine_id, id).await.is_err();
    let Some(req) = message.req else {
        return Ok(());
    };
    if failed {
        err(session, req, "db_error")
    } else {
        ok(session, req)
    }
}

async fn identity(
    hub: &Hub,
    session: &Session,
    machine_id: &str,
    message: &FromMachine,
) -> Control {
    let req = message.req.ok_or(Malformed)?;
    let public = message.public.as_deref().ok_or(Malformed)?;
    let Some(bundle) = public_identity(machine_id, public) else {
        return err(session, req, "bad_identity");
    };
    if hub.db().set_pub(machine_id, bundle).await.is_err() {
        return err(session, req, "db_error");
    }
    info!(machine = truncated(machine_id), "identity published");
    ok(session, req)
}

async fn allow(hub: &Hub, session: &Session, machine_id: &str, message: &FromMachine) -> Control {
    let req = message.req.ok_or(Malformed)?;
    let device = message.device.as_deref().ok_or(Malformed)?;
    let Some(token_hash) = message.token_hash.as_deref() else {
        return err(session, req, "bad_device");
    };
    if !auth::valid_id(device) {
        return err(session, req, "bad_device");
    }
    let Some(hash) = auth::hex32(token_hash) else {
        return err(session, req, "bad_device");
    };
    match hub
        .db()
        .put_device(machine_id, device, &hash, now_ms())
        .await
    {
        Ok(PutDevice::Added) => {
            info!(
                machine = truncated(machine_id),
                device = truncated(device),
                "device allowed"
            );
            ok(session, req)
        }
        Ok(PutDevice::TooMany) => err(session, req, "too_many_devices"),
        Err(_) => err(session, req, "db_error"),
    }
}

async fn revoke(
    hub: &Hub,
    room: &Room,
    session: &Session,
    machine_id: &str,
    message: &FromMachine,
) -> Control {
    let req = message.req.ok_or(Malformed)?;
    let device = message.device.as_deref().ok_or(Malformed)?;
    if !auth::valid_id(device) {
        return err(session, req, "bad_device");
    }
    if hub.db().delete_device(machine_id, device).await.is_err() {
        return err(session, req, "db_error");
    }
    room.revoke_device(device);
    info!(
        machine = truncated(machine_id),
        device = truncated(device),
        "device revoked"
    );
    ok(session, req)
}

/// The machine names every device it authorises; the relay forgets the rest. A device revoked
/// while the machine was away from the relay loses its token here, at the machine's next connect.
async fn keep(
    hub: &Hub,
    room: &Room,
    session: &Session,
    machine_id: &str,
    message: &FromMachine,
) -> Control {
    let devices = message.devices.as_deref().ok_or(Malformed)?;
    // The machine's paired devices, plus an open offer's pairing device.
    let bound = MAX_ALLOWED_DEVICES as usize + 1;
    if devices.len() > bound || !devices.iter().all(|id| auth::valid_id(id)) {
        return match message.req {
            Some(req) => err(session, req, "bad_device"),
            None => Ok(()),
        };
    }
    let Ok(gone) = hub.db().keep_devices(machine_id, devices.to_vec()).await else {
        return match message.req {
            Some(req) => err(session, req, "db_error"),
            None => Ok(()),
        };
    };
    for device in &gone {
        room.revoke_device(device);
        info!(
            machine = truncated(machine_id),
            device = truncated(device),
            "device revoked (no longer kept)"
        );
    }
    match message.req {
        Some(req) => ok(session, req),
        None => Ok(()),
    }
}

fn ok(session: &Session, req: u64) -> Control {
    let _ = session.handle.text(encode(&ToMachine::Ok { req }));
    Ok(())
}

fn err(session: &Session, req: u64, code: &str) -> Control {
    let _ = session.handle.text(encode(&ToMachine::Err { req, code }));
    Ok(())
}
