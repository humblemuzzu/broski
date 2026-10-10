mod common;

use std::time::Instant;

use broski_link_core::STREAM_BRIDGE;
use common::rand::random_bytes;
use common::Harness;

const BULK_ITERATIONS: usize = 2_000;
const LATENCY_ITERATIONS: usize = 100_000;
const BULK: usize = 64 * 1024;

#[test]
#[ignore = "perf; run with --release --ignored --nocapture"]
fn end_to_end_throughput_and_latency() {
    let mut h = Harness::new(1);
    h.pair().expect("pair");

    for (label, payload) in [
        ("json-like", json_like(BULK)),
        ("random", random_bytes(5, BULK)),
    ] {
        let (megabytes, sealed) = throughput(&mut h, &payload, BULK_ITERATIONS);
        println!(
            "64 KiB {label}, {BULK_ITERATIONS} messages: {megabytes:.0} MB/s, {sealed:.0} B sealed per message"
        );
    }

    let small = random_bytes(9, 200);
    let nanos = latency(&mut h, &small, LATENCY_ITERATIONS);
    println!("200 B message end to end, {LATENCY_ITERATIONS} messages: {nanos:.0} ns");
}

fn throughput(h: &mut Harness, payload: &[u8], iterations: usize) -> (f64, f64) {
    let mut delivered = 0;
    let mut sealed = 0;
    let start = Instant::now();
    for _ in 0..iterations {
        let (count, bytes) = round_trip(h, payload);
        delivered += count;
        sealed += bytes;
    }
    let seconds = start.elapsed().as_secs_f64();
    assert_eq!(delivered, iterations, "every message arrived exactly once");
    let megabytes = (iterations * payload.len()) as f64 / (1024.0 * 1024.0) / seconds;
    (megabytes, sealed as f64 / iterations as f64)
}

fn latency(h: &mut Harness, payload: &[u8], iterations: usize) -> f64 {
    let mut total = 0.0;
    let mut delivered = 0;
    for _ in 0..iterations {
        let start = Instant::now();
        delivered += round_trip(h, payload).0;
        total += start.elapsed().as_secs_f64();
    }
    assert_eq!(delivered, iterations, "every message arrived exactly once");
    total * 1e9 / iterations as f64
}

fn round_trip(h: &mut Harness, payload: &[u8]) -> (usize, usize) {
    h.phone
        .link
        .send(STREAM_BRIDGE, payload, h.now)
        .expect("send");
    let mut sealed = 0;
    while let Some(wire) = h.phone.link.poll_transmit().expect("seal") {
        sealed += wire.len();
        h.machine.deliver(&wire, h.now).expect("deliver");
    }
    while let Some(wire) = h.machine.poll_transmit().expect("seal") {
        h.phone.link.handle_wire(&wire, h.now).expect("open");
    }
    let delivered = h.machine.inbox.len();
    h.machine.inbox.clear();
    (delivered, sealed)
}

fn json_like(len: usize) -> Vec<u8> {
    const UNIT: &[u8] = br#"{"type":"assistant_text_delta","sessionId":"01H8ZR","text":"the quick brown fox jumps over the lazy dog"}"#;
    UNIT.iter().copied().cycle().take(len).collect()
}
