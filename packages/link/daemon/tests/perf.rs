mod common;

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};
use common::relay::TestRelay;

const WAIT: Duration = Duration::from_secs(30);
const RTT_COUNT: usize = 2000;
const BULK_COUNT: usize = 200;
const BULK_SIZE: usize = 64 * 1024;
const WINDOW: usize = 8;

struct Report {
    rtt: Duration,
    msgs_per_second: f64,
    p50: Duration,
    p99: Duration,
    bulk: Duration,
    mb_per_second: f64,
}

async fn measure(phone: &mut Phone) -> Report {
    let small = "x".repeat(200);
    let mut samples = Vec::with_capacity(RTT_COUNT);
    let started = Instant::now();
    for _ in 0..RTT_COUNT {
        let at = Instant::now();
        let (_, echoed) = phone.echo(&small, WAIT).await;
        assert_eq!(echoed.len(), 205);
        samples.push(at.elapsed());
    }
    let rtt = started.elapsed();
    samples.sort_unstable();

    let big = "y".repeat(BULK_SIZE);
    let mut window = VecDeque::new();
    let started = Instant::now();
    for index in 0..BULK_COUNT {
        phone.send(1, big.as_bytes()).await;
        window.push_back(index);
        if window.len() >= WINDOW {
            window.pop_front();
            let (_, echoed) = phone.next_message(WAIT).await;
            assert_eq!(echoed.len(), BULK_SIZE + 5);
        }
    }
    while !window.is_empty() {
        window.pop_front();
        let (_, echoed) = phone.next_message(WAIT).await;
        assert_eq!(echoed.len(), BULK_SIZE + 5);
    }
    let bulk = started.elapsed();

    Report {
        rtt,
        msgs_per_second: RTT_COUNT as f64 / rtt.as_secs_f64(),
        p50: samples[RTT_COUNT / 2],
        p99: samples[RTT_COUNT * 99 / 100],
        bulk,
        mb_per_second: (BULK_COUNT * BULK_SIZE) as f64 / 1_000_000.0 / bulk.as_secs_f64(),
    }
}

async fn lan_phone(daemon: &TestDaemon) -> (Phone, String, String) {
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));
    let (device, token) = phone.paired_credentials(WAIT).await;
    assert_eq!(phone.echo("warmup", WAIT).await.1, b"echo:warmup");
    (phone, device, token)
}

fn report(route: &str, report: &Report) {
    println!(
        "{route}: 200 B round trip {:?} total, {:.0} msgs/s, p50 {:?}, p99 {:?}",
        report.rtt, report.msgs_per_second, report.p50, report.p99
    );
    println!(
        "{route}: 64 KiB x {BULK_COUNT} in {:?} = {:.1} MB/s",
        report.bulk, report.mb_per_second
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "perf: cargo test --release -p broski-link-daemon -- --ignored --nocapture"]
async fn lan_loopback_throughput() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let (mut phone, _, _) = lan_phone(&daemon).await;
    let measured = measure(&mut phone).await;
    report("lan", &measured);
    assert!(measured.msgs_per_second > 100.0);
    daemon.stop().await;
    bridge.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "perf: cargo test --release -p broski-link-daemon -- --ignored --nocapture"]
async fn relay_loopback_throughput() {
    let relay = TestRelay::start().await;
    let daemon = TestDaemon::start(Options {
        relay: Some(relay.url.clone()),
        ..Options::default()
    })
    .await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let (mut phone, device, token) = lan_phone(&daemon).await;
    let machine = phone.server.id();
    let addr = daemon.lan();
    phone.disconnect().await;
    assert!(
        phone
            .reconnect_relay(relay.addr, &machine, &device, &token, WAIT)
            .await,
        "the relay channel resumes the lan session"
    );
    assert_eq!(phone.echo("warmup", WAIT).await.1, b"echo:warmup");

    let measured = measure(&mut phone).await;
    report("relay", &measured);
    assert_eq!(phone.connect_lan(addr, WAIT).await, Some(true));
    daemon.stop().await;
    bridge.stop().await;
    relay.stop().await;
}
