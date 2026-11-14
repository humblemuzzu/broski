---
description: Run all tests and report results
allowed-tools: Bash, Read
---

# Run Tests

Execute all tests and provide a summary of results.

## Steps

1. Run `cd packages/bridge && bun test` for the bridge (about five minutes)
2. Run `cd packages/link && cargo test --workspace` for the Rust link stack
3. Summarize:
   - Total tests run
   - Passed/Failed counts
   - Any failing test details

$ARGUMENTS
