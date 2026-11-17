I ran the parser benchmark on every phone we support. Times are the median of 101 runs, in
milliseconds, for a 20,000-character answer:

| Device | Chip | OS | Cold start | Parse | Repair | Keys | Highlight | Layout | Draw | Total | Pass |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| iPhone 18 Pro | A20 Pro | iOS 26.2 | 41 | 0.31 | 0.02 | 0.01 | 2.4 | 3.1 | 1.2 | 7.0 | ✅ |
| iPhone 17e | A19 | iOS 26.2 | 48 | 0.39 | 0.02 | 0.01 | 3.0 | 3.9 | 1.5 | 8.8 | ✅ |
| iPhone SE (3rd generation) | A15 Bionic | iOS 26.0 | 77 | 0.62 | 0.04 | 0.02 | 5.1 | 6.8 | 2.9 | 15.5 | ⚠️ |
| Pixel 10 Pro | Tensor G5 | Android 16 | 63 | 0.44 | 0.03 | 0.01 | 3.6 | 4.4 | 2.0 | 10.5 | ✅ |
| Galaxy A16 | Exynos 1330 | Android 15 | 121 | 1.10 | 0.07 | 0.03 | 9.8 | 11.2 | 4.6 | 26.8 | ❌ |

Every Rust module and its size after the rewrite:

| Module | Lines | Tests |
|---|---:|---:|
| `format/block/mod.rs` | 385 | — |
| `format/block/starts.rs` | 340 | — |
| `format/block/cursor.rs` | 148 | — |
| `format/block/list_item.rs` | 92 | — |
| `format/block/leaf.rs` | 143 | — |
| `format/block/table.rs` | 95 | — |
| `format/block/html.rs` | 135 | — |
| `format/inline/mod.rs` | 210 | — |
| `format/inline/scan.rs` | 246 | — |
| `format/inline/brackets.rs` | 159 | — |
| `format/inline/emphasis.rs` | 157 | — |
| `format/inline/autolink.rs` | 270 | — |
| `format/inline/spans.rs` | 190 | — |
| `format/flatten.rs` | 195 | — |
| `format/tests/spec.rs` | 120 | 1 |
| `format/tests/streaming.rs` | 110 | 4 |
| `format/tests/fuzz.rs` | 130 | 2 |

Status by area, as a nested list item would hold it:

- **Parser**
  | Area | State |
  |---|---|
  | Blocks | Done |
  | Inlines | Done |
  | Repair | Done |
- **Apps**: in progress

Emoji and units:

| 🧪 | Size | Took |
|:-:|---:|---:|
| ✅ | 1.2 GB | 4 s |
| ❌ | 340 MB | 0.8 s |
| ⏳ | 12 KB | ~5 ms |

A quoted table:

> | Flag | Meaning |
> |---|---|
> | `-p` | the package |
> | `--release` | optimised |
