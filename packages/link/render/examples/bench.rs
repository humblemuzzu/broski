//! What each render call costs, for the numbers in docs/architecture/rendering.md:
//! `cargo run --release -p broski-render --example bench`.

use std::hint::black_box;
use std::time::{Duration, Instant};

use broski_render::{highlight, parse_unified_diff};

/// The median of `runs` timings of `work`.
fn median(runs: usize, mut work: impl FnMut()) -> Duration {
    let mut times: Vec<Duration> = (0..runs)
        .map(|_| {
            let start = Instant::now();
            work();
            start.elapsed()
        })
        .collect();
    times.sort();
    times[runs / 2]
}

fn main() {
    let cold = Instant::now();
    black_box(highlight("let x = 1;", Some("rs")));
    println!(
        "highlight: grammars loaded and Rust compiled on first use: {:?}",
        cold.elapsed()
    );
    let cold = Instant::now();
    black_box(highlight("const x = 1;", Some("ts")));
    println!(
        "highlight: TypeScript compiled on first use: {:?}",
        cold.elapsed()
    );
    let source = include_str!("../src/diff/parse.rs").repeat(8);
    let lines = source.lines().count();
    let hot = median(11, || {
        black_box(highlight(black_box(&source), Some("rs")));
    });
    println!("highlight: {lines} lines of Rust: {hot:?}");

    let diff = include_str!("../tests/fixtures/git-diff.diff").repeat(250);
    let diff_lines = diff.lines().count();
    let parsed = median(11, || {
        black_box(parse_unified_diff(black_box(&diff)));
    });
    println!("diff: {diff_lines} lines of git diff with word emphasis: {parsed:?}");
}
