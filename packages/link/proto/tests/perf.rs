use std::time::Instant;

use broski_link_proto::{Config, Session};

const BULK_FRAMES: usize = 2_000;
const SMALL_MESSAGES: usize = 100_000;

#[test]
#[ignore = "perf; run with --release --ignored --nocapture"]
fn throughput_and_per_message_overhead() {
    let bulk = incompressible(64 * 1024);
    let (mb_per_second, micros) = measure(&bulk, BULK_FRAMES, Config::default());
    println!(
        "{BULK_FRAMES} x 64 KiB messages, deflate attempted: {mb_per_second:.0} MB/s, {micros:.2} us/send"
    );

    let no_deflate = Config {
        compress_threshold: usize::MAX,
        ..Config::default()
    };
    let (mb_per_second, micros) = measure(&bulk, BULK_FRAMES, no_deflate);
    println!(
        "{BULK_FRAMES} x 64 KiB messages, deflate skipped: {mb_per_second:.0} MB/s, {micros:.2} us/send"
    );

    let small = incompressible(200);
    let (_, micros) = measure(&small, SMALL_MESSAGES, Config::default());
    println!(
        "{SMALL_MESSAGES} x 200 B messages: {:.0} ns/send",
        micros * 1_000.0
    );
}

fn measure(message: &[u8], iterations: usize, config: Config) -> (f64, f64) {
    let mut sender = Session::new([1; 16], config);
    let mut receiver = Session::new([2; 16], config);
    sender.attach(0, 0).expect("attach");
    receiver.attach(0, 0).expect("attach");

    let start = Instant::now();
    for _ in 0..iterations {
        sender.send(1, message, 0).expect("send");
        while let Some(frame) = sender.poll_transmit() {
            receiver.handle_frame(&frame, 0).expect("receive");
        }
        while let Some(frame) = receiver.poll_transmit() {
            sender.handle_frame(&frame, 0).expect("ack");
        }
    }
    let seconds = start.elapsed().as_secs_f64();
    let megabytes = (iterations * message.len()) as f64 / (1024.0 * 1024.0);
    (megabytes / seconds, seconds * 1e6 / iterations as f64)
}

fn incompressible(len: usize) -> Vec<u8> {
    let mut state = 0x1234_5678_9ABC_DEF0u64;
    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) as u8
        })
        .collect()
}
