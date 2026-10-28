/**
 * Pins every `bun test` run to throwaway directories and arms the real-home guard, whose instrumented
 * write sites throw `RealHomeWriteError` rather than edit the developer's live `~/.claude`, `~/.codex`,
 * `~/.pi` or `~/.broski`.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { captureRealHome, TEST_ISOLATION_ENV } from "../../safety/real-home-guard";

const dir = mkdtempSync(join(tmpdir(), "broski-test-"));
captureRealHome();
process.env[TEST_ISOLATION_ENV] = "1";
process.env.BROSKI_CACHE_DIR = join(dir, "cache");
// macOS resolves the temp dir through /private, which the default allowlist's /tmp does not match.
process.env.BROSKI_ALLOWED_BASE_PATHS = [homedir(), realpathSync(tmpdir())].join(",");

process.on("exit", () => {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// The temp directory is the OS's problem if it is still busy at exit.
	}
});
