mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use broski_relay::limits::RateLimit;
use bytes::Bytes;
use common::{bundle_of, machine_id, Client, Frame, Relay};
use tokio::task::JoinHandle;

const DEVICES: usize = 4;
const BULK: usize = 64 * 1024;
const WINDOW: Duration = Duration::from_secs(3);
const IN_FLIGHT: usize = 8;
const SAMPLES: usize = 2000;
const PROBE: usize = 200;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "perf measurement; run with --release --ignored --nocapture"]
async fn throughput_and_latency() {
    let relay = Relay::start_with(RateLimit {
        burst: 100.0,
        per_second: 100.0,
    })
    .await;
    let bundle = bundle_of(99);
    let id = machine_id(&bundle);
    let (machine, devices) = connected(&relay, &id, &bundle).await;

    let done = Arc::new(AtomicBool::new(false));
    let reader = spawn_reader(machine, done.clone());
    let started = Instant::now();
    let senders = spawn_senders(devices, WINDOW);

    let mut offered = 0usize;
    let mut stopped = 0usize;
    for sender in senders {
        let (payload_bytes, refused) = sender.await.expect("sender task");
        offered += payload_bytes;
        stopped += usize::from(refused);
    }
    let elapsed = started.elapsed();
    done.store(true, Ordering::Relaxed);
    let (delivered, closes) = reader.await.expect("reader task");

    println!(
        "bulk: {DEVICES} devices x {BULK} B frames, {IN_FLIGHT} frames in flight each, acked by the machine | window {:.2}s | offered {:.1} MiB | delivered {:.1} MiB | {:.1} MiB/s | {:.0} frames/s | broken senders {stopped} | machine closes {closes}",
        elapsed.as_secs_f64(),
        offered as f64 / 1_048_576.0,
        delivered as f64 / 1_048_576.0,
        delivered as f64 / elapsed.as_secs_f64() / 1_048_576.0,
        (delivered / BULK) as f64 / elapsed.as_secs_f64(),
    );

    latency(&relay, &id).await;
}

async fn connected(relay: &Relay, id: &str, bundle: &[u8]) -> (Client, Vec<Client>) {
    let mut machine = relay.machine(id, "secret").await.expect("machine");
    assert_eq!(machine.publish(bundle).await["t"], "ok");
    let mut devices = Vec::new();
    for index in 0..DEVICES {
        let device_id = format!("{index:032x}");
        assert_eq!(machine.allow(&device_id, "token").await["t"], "ok");
        devices.push(relay.device(id, &device_id, "token").await.expect("device"));
        let (_, opened_for) = machine.open_channel().await;
        assert_eq!(opened_for, device_id);
    }
    for dev in devices.iter_mut() {
        assert_eq!(dev.state().await.0, "online");
    }
    (machine, devices)
}

fn spawn_reader(mut machine: Client, done: Arc<AtomicBool>) -> JoinHandle<(usize, usize)> {
    tokio::spawn(async move {
        let mut delivered = 0usize;
        let mut closes = 0usize;
        loop {
            match machine.next(Duration::from_millis(50)).await {
                Some(Frame::Binary(frame)) => {
                    delivered += frame.len() - 4;
                    if !machine
                        .try_send_bin(Bytes::copy_from_slice(&frame[..4]))
                        .await
                    {
                        break;
                    }
                }
                Some(Frame::Close(..)) => {
                    closes += 1;
                    break;
                }
                Some(_) => {}
                None => {
                    if done.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }
        (delivered, closes)
    })
}

fn spawn_senders(devices: Vec<Client>, window: Duration) -> Vec<JoinHandle<(usize, bool)>> {
    let start = Instant::now();
    devices
        .into_iter()
        .map(|mut dev| {
            tokio::spawn(async move {
                let frame = Bytes::from(vec![0u8; BULK]);
                let mut offered = 0usize;
                let mut in_flight = 0usize;
                let mut stopped = false;
                while start.elapsed() < window {
                    while in_flight < IN_FLIGHT {
                        if !dev.try_send_bin(frame.clone()).await {
                            stopped = true;
                            break;
                        }
                        in_flight += 1;
                        offered += frame.len();
                    }
                    if stopped {
                        break;
                    }
                    match dev.next(Duration::from_secs(5)).await {
                        Some(Frame::Binary(_)) => in_flight -= 1,
                        _ => {
                            stopped = true;
                            break;
                        }
                    }
                }
                (offered, stopped)
            })
        })
        .collect()
}

async fn latency(relay: &Relay, id: &str) {
    let mut machine = relay.machine(id, "secret").await.expect("machine");
    let mut dev = relay
        .device(id, &format!("{:032x}", 0), "token")
        .await
        .expect("device");
    assert_eq!(dev.state().await.0, "online");

    let echo = tokio::spawn(async move {
        let mut echoed = 0usize;
        while echoed < SAMPLES {
            match machine.next(Duration::from_secs(30)).await {
                Some(Frame::Binary(frame)) => {
                    machine.send_bin(frame).await;
                    echoed += 1;
                }
                Some(_) => {}
                None => break,
            }
        }
    });

    let probe = Bytes::from(vec![0u8; PROBE]);
    let mut samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let started = Instant::now();
        dev.send_bin(probe.clone()).await;
        match dev.next(Duration::from_secs(5)).await {
            Some(Frame::Binary(_)) => samples.push(started.elapsed()),
            other => panic!("expected echo, got {other:?}"),
        }
    }
    let _ = echo.await;
    samples.sort_unstable();
    let p50 = samples[samples.len() / 2].as_secs_f64() * 1e6 / 2.0;
    let p99 = samples[samples.len() * 99 / 100].as_secs_f64() * 1e6 / 2.0;
    println!(
        "latency: {PROBE} B probe frames | {SAMPLES} round trips | one-way derived from round trip | p50 {p50:.1} us | p99 {p99:.1} us"
    );
}
