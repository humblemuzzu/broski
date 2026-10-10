/**
 * Minimal compiled binary that reports whether the native PTY sidecar passed the build-time hash
 * check. Compiled with `--define BROSKI_PTY_LIB_HASH="…"` by the PTY integrity test.
 */

import { isNativePtyAvailable } from "../../pty/native-pty";

console.log(`PTY_AVAILABLE=${isNativePtyAvailable() ? 1 : 0}`);
