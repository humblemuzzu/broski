---
description: Run all tests and report results
allowed-tools: Bash, Read
---

# Run Tests

Execute all tests and provide a summary of results.

## Steps

1. Run `flutter test` for Flutter tests
2. Run `cd packages/bridge && bun test` for bridge tests
3. Summarize:
   - Total tests run
   - Passed/Failed counts
   - Any failing test details

$ARGUMENTS
