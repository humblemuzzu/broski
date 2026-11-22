//! UniFFI exports an object only when it is `Send + Sync`, and an async method only when its future
//! is `Send`: this module does not compile when one of them is not.

use broski_contract::{ClientMessage, SessionRef, WorkspaceInfoRequest};

use crate::{Inbox, Machine, Phone, SessionList, SessionView, TerminalView};

fn shared<T: Send + Sync>() {}

fn sent<T: Send>(_: T) {}

#[test]
fn every_object_can_cross_threads() {
    shared::<Phone>();
    shared::<Machine>();
    shared::<SessionView>();
    shared::<TerminalView>();
    shared::<SessionList>();
    shared::<Inbox>();
}

#[allow(dead_code, reason = "type-checked, never run")]
fn every_future_is_send(
    phone: &Phone,
    machine: &Machine,
    views: (&SessionView, &TerminalView, &SessionList, &Inbox),
) {
    let (view, terminal, list, inbox) = views;
    let session = session_ref();
    let info = ClientMessage::WorkspaceInfo(WorkspaceInfoRequest {
        request_id: String::new(),
    });
    sent(phone.pair(String::new()));
    sent(machine.next_event());
    sent(machine.request(info));
    sent(machine.backends());
    sent(machine.backend_status("pi".to_owned()));
    sent(machine.models("pi".to_owned(), None, false));
    sent(machine.commands("pi".to_owned(), None, Some(session)));
    sent(machine.modes("pi".to_owned(), None));
    sent(view.next_update());
    sent(terminal.next_update());
    sent(terminal.input(Vec::new()));
    sent(terminal.resize(80, 24, None, None));
    sent(list.load_more());
    sent(list.refresh());
    sent(list.next_change());
    sent(inbox.next_change());
    let (interaction, option) = (String::new(), String::new());
    sent(inbox.answer(String::new(), session_ref(), interaction, option));
}

fn session_ref() -> SessionRef {
    SessionRef {
        backend: "pi".to_owned(),
        session_id: String::new(),
    }
}
