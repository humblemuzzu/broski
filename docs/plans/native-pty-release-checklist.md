# Native PTY Release Checklist

Use this checklist for every bridge release that includes terminal support.

## 1) Build

From `packages/bridge/`:

```bash
sh scripts/build.sh --target darwin-arm64
sh scripts/build.sh --target darwin-x64
sh scripts/build.sh --target linux-x64
sh scripts/build.sh --target linux-arm64
```

## 2) Required Artifacts Per Platform

### macOS
Ship both in the same directory:
- `broski-darwin-arm64` (or `broski-darwin-x64`)
- `libbroski_pty.dylib`

### Linux
Ship both in the same directory:
- `broski-linux-x64` (or `broski-linux-arm64`)
- `libbroski_pty.so`

### Windows
- Not supported (ConPTY future work).

## 3) Artifact Integrity Checks

For each platform output in `dist/`:
- Confirm sidecar exists next to binary.
- Confirm build log shows:
  - `Building native PTY helper...`
  - `✓ PTY library embedded (… bytes), sha256 …` (the binary carries the library and writes it out at first run)
- If signing in CI, confirm `.sig` files were generated for binaries.

## 4) Fast Validation Commands

Run from `packages/bridge/`:

```bash
bun test src/__tests__/native_pty.test.ts src/__tests__/workspace_terminal.test.ts
bun test
```

Expected: the PTY and terminal tests pass (they build the helper from `native/pty/` when `dist/` has none), and so
does the full bridge suite.

## 5) Runtime Smoke (on clean machine)

- Create terminal from app
- Send input
- Resize terminal, run `stty size` before and after
- Confirm output is smooth and responsive

## 6) Update Flow Check

- Confirm updater downloads/replaces binary.
- Confirm PTY sidecar remains present next to binary after update.
- If release CDN hosts sidecar files, confirm updater can fetch sidecar best-effort.

## 7) Release Gate (must all be true)

- [ ] Binary + sidecar pair present for macOS targets
- [ ] Binary + sidecar pair present for Linux targets
- [ ] PTY tests green
- [ ] Full bridge tests green
- [ ] Manual smoke test passed

## 8) Rollback Plan

If any regression is detected:
1. Revert to previous release artifact pair (binary + matching PTY sidecar).
2. Do not mix old binary with new sidecar or vice versa.
3. Re-run PTY tests before re-publishing.
