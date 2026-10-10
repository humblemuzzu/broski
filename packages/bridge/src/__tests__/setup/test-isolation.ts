/**
 * Pins every `bun test` run to throwaway cache directories, so a test that lists sessions cannot write
 * the developer's real `~/.broski/cache` or `~/.codex`. A preload runs before any test file.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "broski-test-"));
process.env.BROSKI_CACHE_DIR = join(dir, "cache");
process.env.BROSKI_COLLAB_CACHE_PATH = join(dir, "collab-cache.json");

process.on("exit", () => {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// The temp directory is the OS's problem if it is still busy at exit.
	}
});
