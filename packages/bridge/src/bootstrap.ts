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
 * After first run these files exist next to the binary and won't be recreated
 * unless deleted.
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
	const libName = process.platform === "darwin" ? "libbroski_pty.dylib" : "libbroski_pty.so";
	const libPath = join(binDir, libName);
	if (!existsSync(libPath)) {
		try {
			const buf = Buffer.from(EMBEDDED_PTY_LIB_B64, "base64");
			writeFileSync(libPath, buf, { mode: 0o755 });
		} catch {
			// Non-fatal: PTY falls back to OpenCode-based terminal
		}
	}
}

// Now safe to load the real entry point
await import("./index");
