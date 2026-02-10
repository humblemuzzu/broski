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
- Native PTY fallback is not shipped yet (ConPTY future work).
- Terminal relies on OpenCode PTY path.

## 3) Artifact Integrity Checks

For each platform output in `dist/`:
- Confirm sidecar exists next to binary.
- Confirm build log shows:
  - `Building native PTY helper...`
  - `Baking PTY sidecar hashes...`
- If signing in CI, confirm `.sig` files were generated for binaries.

## 4) Fast Validation Commands

Run from `packages/bridge/`:

```bash
bun test src/__tests__/pty_manager.test.ts
bun test src/__tests__/pty_runtime.test.ts
bun test src/__tests__/native_pty.test.ts
bun test src/__tests__/
```

Expected:
- PTY tests pass (currently 7/7)
- Full bridge suite passes (currently 198/198)

## 5) Runtime Smoke (on clean machine)

### Scenario A: OpenCode installed/running
- Create terminal from app
- Send input
- Resize terminal
- Confirm output is smooth and responsive

### Scenario B: OpenCode missing
- Create terminal from app
- Confirm terminal still works (native PTY fallback)
- Run `stty size`, resize, run `stty size` again

## 6) Update Flow Check

- Confirm updater downloads/replaces binary.
- Confirm PTY sidecar remains present next to binary after update.
- If release CDN hosts sidecar files, confirm updater can fetch sidecar best-effort.

## 7) Release Gate (must all be true)

- [ ] Binary + sidecar pair present for macOS targets
- [ ] Binary + sidecar pair present for Linux targets
- [ ] PTY tests green
- [ ] Full bridge tests green
- [ ] Manual smoke test passed for OpenCode and native fallback paths

## 8) Rollback Plan

If any regression is detected:
1. Revert to previous release artifact pair (binary + matching PTY sidecar).
2. Do not mix old binary with new sidecar or vice versa.
3. Re-run PTY tests before re-publishing.
