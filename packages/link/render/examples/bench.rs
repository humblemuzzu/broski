//! What each render call costs, for the numbers in docs/architecture/rendering.md:
//! `cargo run --release -p broski-render --example bench`.

use std::hint::black_box;
use std::time::{Duration, Instant};

use broski_render::{highlight, markdown_blocks, parse_unified_diff};

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

fn agent_message(chars: usize) -> String {
    let section = "## Changes\n\nI updated **three files** to fix the `token refresh` race:\n\n\
        - `src/auth.ts` \u{2014} retries the refresh twice\n  - waits 200 ms between tries\n\
        - `src/client.ts` \u{2014} shares one refresh\n\n| File | + | - |\n|---|---:|---:|\n\
        | auth.ts | 12 | 3 |\n| client.ts | 4 | 1 |\n\n```ts\nexport async function refresh() {\n  \
        return await once(fetchToken);\n}\n```\n\nRun `bun test` to check; see <https://example.com>.\n\n";
    section
        .repeat(chars / section.len() + 1)
        .chars()
        .take(chars)
        .collect()
}

fn main() {
    let message = agent_message(20_000);
    let blocks = markdown_blocks(&message).len();
    let whole = median(51, || {
        black_box(markdown_blocks(black_box(&message)));
    });
    println!("markdown: 20,000 chars, {blocks} blocks: {whole:?} a parse");

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
