//! The update protocol against the contract's own reducer trace: whatever the batching, a UI that
//! applies the updates holds exactly the snapshot the view holds.

use std::path::PathBuf;

use broski_contract::{
    session_status, AgentEvent, BackendId, BlockDeltaEvent, BlockKind, BlockStartedEvent,
    RunStartedEvent, RunTrigger, SessionCapabilities, SessionRef, SessionSnapshot, Timestamp,
    MAX_LIST_ITEMS,
};
use serde_json::Value;
use tokio::time::Instant;

use super::changes::{self, SessionChange};
use super::queue::{Live, Take, UpdateQueue, BATCH_INTERVAL};
use super::SessionUpdate;

#[path = "../../tests/common/replica.rs"]
mod replica;

use replica::Replica;

struct Case {
    name: String,
    initial: SessionSnapshot,
    steps: Vec<(Timestamp, AgentEvent)>,
}

/// The bridge's reducer trace, read where the generator wrote it.
fn reducer_cases() -> Vec<Case> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../bridge/contract-fixtures/reducer_trace.json");
    let text = std::fs::read_to_string(&path).expect("the reducer trace");
    let trace = expand(serde_json::from_str(&text).expect("json"));
    let cases = trace["cases"].as_array().expect("cases");
    cases
        .iter()
        .map(|case| Case {
            name: case["name"].as_str().expect("name").to_owned(),
            initial: serde_json::from_value(case["initial"].clone()).expect("initial"),
            steps: case["steps"]
                .as_array()
                .expect("steps")
                .iter()
                .map(|step| {
                    let record = &step["record"];
                    let at = record["at"].as_i64().expect("at");
                    let event = serde_json::from_value(record["event"].clone()).expect("event");
                    (at, event)
                })
                .collect(),
        })
        .collect()
}

/// The trace writes a long string as `{"$runs": [[codePoint, count], …]}`.
fn expand(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(expand).collect()),
        Value::Object(object) => match object.get("$runs") {
            Some(Value::Array(runs)) => Value::String(
                runs.iter()
                    .map(|run| {
                        let text = run[0].as_str().expect("a code point");
                        text.repeat(run[1].as_u64().expect("a count") as usize)
                    })
                    .collect(),
            ),
            _ => Value::Object(
                object
                    .into_iter()
                    .map(|(key, value)| (key, expand(value)))
                    .collect(),
            ),
        },
        other => other,
    }
}

fn session() -> SessionRef {
    SessionRef {
        backend: BackendId::Pi,
        session_id: "s".to_owned(),
    }
}

fn capabilities() -> SessionCapabilities {
    SessionCapabilities {
        controllable: true,
        compact: true,
        cancel_queued: true,
        answer: true,
    }
}

/// A view's state and one subscriber, on a clock the test moves.
struct Harness {
    snapshot: SessionSnapshot,
    queue: UpdateQueue,
    replica: Replica,
    now: Instant,
}

impl Harness {
    fn new(initial: SessionSnapshot) -> Harness {
        let mut harness = Harness {
            snapshot: initial,
            queue: UpdateQueue::new(),
            replica: Replica::default(),
            now: Instant::now(),
        };
        harness.drain();
        harness
    }

    fn apply(&mut self, at: Timestamp, event: AgentEvent) {
        for delta in changes::apply(&mut self.snapshot, at, event) {
            self.queue.push(delta);
        }
    }

    fn take(&mut self) -> Take {
        let session = session();
        let capabilities = capabilities();
        let live = Live {
            session: &session,
            capabilities: &capabilities,
            snapshot: &self.snapshot,
        };
        self.queue.take(self.now, Some(live))
    }

    /// Everything the subscriber has, as a UI's loop would take it once the pace allows.
    fn drain(&mut self) {
        self.now += BATCH_INTERVAL;
        loop {
            match self.take() {
                Take::Update(update) => self.replica.apply(update),
                Take::Wait(_) => return,
                Take::Finished => panic!("the queue never ended"),
            }
        }
    }

    fn assert_equal(&self, place: &str) {
        assert!(
            self.replica.snapshot == self.snapshot,
            "{place}: the UI's state differs"
        );
        assert_eq!(
            self.replica.status,
            Some(session_status(&self.snapshot)),
            "{place}"
        );
    }
}

/// A deterministic pseudo-random sequence, so a failure replays.
struct Dice(u64);

impl Dice {
    fn roll(&mut self, sides: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % sides
    }
}

fn play(case: &Case, mut batch_after: impl FnMut(usize) -> bool) -> Replica {
    let mut harness = Harness::new(case.initial.clone());
    for (index, (at, event)) in case.steps.iter().enumerate() {
        harness.apply(*at, event.clone());
        if batch_after(index) {
            harness.drain();
            harness.assert_equal(&format!("{}, after step {index}", case.name));
        }
    }
    harness.drain();
    harness.assert_equal(&format!("{}, at the end", case.name));
    harness.replica
}

#[test]
fn every_reducer_trace_case_reaches_the_ui_whatever_the_batching() {
    let cases = reducer_cases();
    assert_eq!(cases.len(), 11, "the trace's cases");
    for case in &cases {
        let each = play(case, |_| true);
        let resyncs = case
            .steps
            .iter()
            .filter(|(_, event)| matches!(event, AgentEvent::Resynced(_)))
            .count();
        assert_eq!(
            each.resets,
            1 + resyncs,
            "{}: records, not snapshots",
            case.name
        );
        play(case, |_| false);
        for seed in 1..=8_u64 {
            let mut dice = Dice(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15));
            play(case, |_| dice.roll(7) == 0);
        }
    }
}

fn open_block(harness: &mut Harness) {
    let run = AgentEvent::RunStarted(RunStartedEvent {
        run_id: "r".to_owned(),
        trigger: RunTrigger::Prompt,
    });
    harness.apply(1, run);
    let block = AgentEvent::BlockStarted(BlockStartedEvent {
        block_id: "b".to_owned(),
        message_id: "m".to_owned(),
        kind: BlockKind::Text,
        parent_tool_call_id: None,
    });
    harness.apply(2, block);
}

fn delta(text: &str) -> AgentEvent {
    AgentEvent::BlockDelta(BlockDeltaEvent {
        block_id: "b".to_owned(),
        text: text.to_owned(),
    })
}

#[test]
fn a_burst_of_deltas_reaches_the_ui_as_one_assignment_of_the_newest_text() {
    let mut harness = Harness::new(broski_contract::empty_snapshot());
    open_block(&mut harness);
    harness.drain();
    for index in 0..300 {
        harness.apply(3, delta(&format!("{index} ")));
    }
    harness.now += BATCH_INTERVAL;
    let Take::Update(SessionUpdate::Changes { changes, .. }) = harness.take() else {
        panic!("a batch is due");
    };
    let text: String = (0..300).map(|index| format!("{index} ")).collect();
    assert_eq!(
        changes,
        [SessionChange::BlockTextChanged {
            block_id: "b".to_owned(),
            text,
        }]
    );
}

#[test]
fn batches_come_at_most_thirty_times_a_second() {
    let mut harness = Harness::new(broski_contract::empty_snapshot());
    open_block(&mut harness);
    harness.drain();
    harness.apply(3, delta("one"));
    harness.now += BATCH_INTERVAL;
    let Take::Update(update) = harness.take() else {
        panic!("the first change after a pause goes at once");
    };
    harness.replica.apply(update);
    harness.apply(4, delta(" two"));
    let batched_at = harness.now;
    match harness.take() {
        Take::Wait(Some(next)) => assert_eq!(next, batched_at + BATCH_INTERVAL),
        _ => panic!("the next batch waits for the pace"),
    }
    harness.drain();
    harness.assert_equal("after the pause");
}

#[test]
fn a_subscriber_that_falls_behind_gets_the_whole_snapshot_instead() {
    let mut harness = Harness::new(broski_contract::empty_snapshot());
    open_block(&mut harness);
    for index in 0..=MAX_LIST_ITEMS {
        let run = AgentEvent::RunStarted(RunStartedEvent {
            run_id: format!("r{index}"),
            trigger: RunTrigger::Prompt,
        });
        harness.apply(3, run);
    }
    let Take::Update(update @ SessionUpdate::Reset { .. }) = harness.take() else {
        panic!("past the bound the update is the snapshot");
    };
    harness.replica.apply(update);
    harness.assert_equal("after the reset");
}
