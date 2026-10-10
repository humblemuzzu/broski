#![cfg(target_os = "macos")]

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use broski_link_power::PowerMonitor;

const CYCLES: usize = 500;
const WATCHDOG: Duration = Duration::from_secs(60);

#[test]
fn five_hundred_rapid_start_drop_cycles_finish() {
    let (finished, done) = mpsc::channel();
    let worker = thread::spawn(move || {
        let mut rng = Rng::new(0x5EED_5EED_0BAD_F00D);
        for _ in 0..CYCLES {
            let monitor = PowerMonitor::start(Duration::from_millis(50), |_| {}).expect("start");
            thread::sleep(Duration::from_micros(rng.below(2_000)));
            drop(monitor);
        }
        let _ = finished.send(());
    });

    match done.recv_timeout(WATCHDOG) {
        Ok(()) => worker.join().expect("the cycle thread panicked"),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            panic!("{CYCLES} start/drop cycles did not finish within {WATCHDOG:?}")
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            panic!("the cycle thread stopped before it finished")
        }
    }
}

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}
