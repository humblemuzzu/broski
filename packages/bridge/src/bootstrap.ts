/**
 * Bootstrap entry point for compiled Broski binaries.
 *
 * Creates required sidecar files BEFORE importing anything that needs them.
 * Dynamic import() at the bottom is critical — static imports would be hoisted
 * and evaluated before our bootstrap code runs.
 *
 * What this extracts: libbroski_pty.dylib/.so, the native PTY library for terminal sessions. It is rewritten
 * whenever the bytes on disk differ from the embedded ones, because an in-place upgrade leaves the previous
 * release's library behind and the compiled loader refuses a sidecar whose sha256 does not match.
 */

import { dirname } from "node:path";
import { HOLDER_SUBCOMMAND } from "./backends/pi/holder/protocol";
import { extractPtySidecar } from "./workspace/pty/sidecar-embed";

const binDir = dirname(process.execPath);

// Extract the embedded PTY library
// The build script replaces EMBEDDED_PTY_LIB_B64 with the actual base64 content.
// If the placeholder is still present (dev mode), skip extraction.
const EMBEDDED_PTY_LIB_B64 = "%%EMBEDDED_PTY_LIB_BASE64_PLACEHOLDER%%";

// A holder (`backends/pi/holder/`) opens no terminal, and may run long after an upgrade replaced the library.
if (!EMBEDDED_PTY_LIB_B64.includes("PLACEHOLDER") && process.argv[2] !== HOLDER_SUBCOMMAND) {
	extractPtySidecar({ binDir, embeddedBase64: EMBEDDED_PTY_LIB_B64 });
}

// Now safe to load the real entry point
await import("./index");
