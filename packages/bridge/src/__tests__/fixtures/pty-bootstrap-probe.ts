/**
 * Minimal compiled binary that runs the same sidecar extraction the bootstrap entry point runs,
 * then reports whether the native loader accepts the result. Compiled by `pty_lib_hash.test.ts`
 * with `--define BROSKI_PTY_LIB_B64="…"` (the embedded library) and
 * `--define BROSKI_PTY_LIB_HASH="…"` (the hash baked into native-pty.ts).
 */

import { dirname } from "node:path";
import { isNativePtyAvailable } from "../../workspace/pty/native-pty-library";
import { extractPtySidecar } from "../../workspace/pty/sidecar-embed";

declare const BROSKI_PTY_LIB_B64: string;

const outcome = extractPtySidecar({ binDir: dirname(process.execPath), embeddedBase64: BROSKI_PTY_LIB_B64 });
console.log(`EXTRACT=${outcome}`);
console.log(`PTY_AVAILABLE=${isNativePtyAvailable() ? 1 : 0}`);
