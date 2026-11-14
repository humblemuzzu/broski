/**
 * Bootstrap entry point for compiled Broski binaries.
 *
 * Creates required sidecar files BEFORE importing anything that needs them.
 * Dynamic import() at the bottom is critical — static imports would be hoisted
 * and evaluated before our bootstrap code runs.
 *
 * What this extracts on first run:
 * 1. package.json — Pi SDK reads this at import time via readFileSync()
 * 2. libbroski_pty.dylib/.so — Native PTY library for terminal sessions
 *
 * The package.json sidecar is created once; the PTY library is rewritten whenever the bytes on
 * disk differ from the embedded ones, because an in-place upgrade leaves the previous release's
 * library behind and the compiled loader refuses a sidecar whose sha256 does not match.
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractPtySidecar } from "./workspace/pty/sidecar-embed";

const binDir = dirname(process.execPath);

// 1. Create package.json for Pi SDK
const pkgJsonPath = join(binDir, "package.json");
if (!existsSync(pkgJsonPath)) {
	try {
		writeFileSync(pkgJsonPath, '{"name":"broski-bridge","version":"0.1.0"}', { mode: 0o644 });
	} catch {
		// Non-fatal: Pi agent won't work but everything else will
	}
}

// 2. Extract embedded PTY library
// The build script replaces EMBEDDED_PTY_LIB_B64 with the actual base64 content.
// If the placeholder is still present (dev mode), skip extraction.
const EMBEDDED_PTY_LIB_B64 = "%%EMBEDDED_PTY_LIB_BASE64_PLACEHOLDER%%";

if (!EMBEDDED_PTY_LIB_B64.includes("PLACEHOLDER")) {
	extractPtySidecar({ binDir, embeddedBase64: EMBEDDED_PTY_LIB_B64 });
}

// Now safe to load the real entry point
await import("./index");
