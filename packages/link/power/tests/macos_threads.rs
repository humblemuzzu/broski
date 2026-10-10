#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::process;
use std::thread;
use std::time::{Duration, Instant};

use broski_link_power::PowerMonitor;

const PROC_PIDLISTTHREADS: i32 = 6;

unsafe extern "C" {
    fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut c_void, size: i32) -> i32;
}

fn thread_count(pid: u32) -> usize {
    let mut buffer = [0u64; 512];
    // SAFETY: the flavour asks for thread ids and `buffer` is a live array of the size passed.
    let written = unsafe {
        proc_pidinfo(
            pid as i32,
            PROC_PIDLISTTHREADS,
            0,
            buffer.as_mut_ptr().cast::<c_void>(),
            std::mem::size_of_val(&buffer) as i32,
        )
    };
    assert!(written > 0, "proc_pidinfo reported {written}");
    written as usize / std::mem::size_of::<u64>()
}

fn start() -> PowerMonitor {
    PowerMonitor::start(Duration::from_millis(50), |_| {}).expect("start")
}

#[test]
fn monitors_own_exactly_two_threads_and_leak_none_over_fifty_cycles() {
    let pid = process::id();

    // CoreFoundation starts one process-wide thread the first time a run loop is used.
    drop(start());
    thread::sleep(Duration::from_millis(500));
    let baseline = thread_count(pid);

    let monitor = start();
    thread::sleep(Duration::from_millis(300));
    assert_eq!(
        thread_count(pid),
        baseline + 2,
        "a live monitor owns a run loop thread and an event thread"
    );
    drop(monitor);

    for round in 0..50 {
        let monitor = PowerMonitor::start(Duration::from_millis(50), |_| {})
            .unwrap_or_else(|err| panic!("round {round}: {err}"));
        drop(monitor);
    }

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut count = thread_count(pid);
    while count > baseline && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
        count = thread_count(pid);
    }
    assert!(
        count <= baseline,
        "{count} threads after 50 start/stop cycles, {baseline} before"
    );
}
