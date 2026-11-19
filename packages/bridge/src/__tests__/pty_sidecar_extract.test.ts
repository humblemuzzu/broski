/**
 * The bootstrap sidecar extraction must be hash-aware: an in-place binary upgrade leaves the
 * previous release's PTY library next to the new binary, and the compiled loader refuses it.
 * Presence alone would keep the stale copy; only a byte comparison forces the rewrite.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPtySidecar, ptySidecarName, sha256Hex } from "../workspace/pty/sidecar-embed";

const HOST = "darwin";
const LIB_NAME = ptySidecarName(HOST) as string;

const EMBEDDED = Buffer.from("libbroski_pty v2 — the library this build embeds", "utf8");
const EMBEDDED_B64 = EMBEDDED.toString("base64");

async function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "broski-pty-extract-"));
}

describe("PTY sidecar extraction", () => {
	it("writes the embedded library when the sidecar is absent", async () => {
		const dir = await tempDir();
		try {
			expect(extractPtySidecar({ binDir: dir, embeddedBase64: EMBEDDED_B64, platform: HOST })).toBe("written");

			const written = await readFile(join(dir, LIB_NAME));
			expect(sha256Hex(written)).toBe(sha256Hex(EMBEDDED));
			expect((await stat(join(dir, LIB_NAME))).mode & 0o777).toBe(0o755);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("leaves a sidecar whose hash already matches untouched", async () => {
		const dir = await tempDir();
		try {
			await writeFile(join(dir, LIB_NAME), EMBEDDED, { mode: 0o755 });
			const before = await stat(join(dir, LIB_NAME));

			expect(extractPtySidecar({ binDir: dir, embeddedBase64: EMBEDDED_B64, platform: HOST })).toBe("unchanged");

			const after = await stat(join(dir, LIB_NAME));
			expect(after.mtimeMs).toBe(before.mtimeMs);
			expect(after.ino).toBe(before.ino);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rewrites a stale sidecar left by a previous release", async () => {
		const dir = await tempDir();
		try {
			const stale = Buffer.from("libbroski_pty v1 — the previous release's library", "utf8");
			await writeFile(join(dir, LIB_NAME), stale, { mode: 0o755 });

			expect(extractPtySidecar({ binDir: dir, embeddedBase64: EMBEDDED_B64, platform: HOST })).toBe("written");

			const replaced = await readFile(join(dir, LIB_NAME));
			expect(sha256Hex(replaced)).toBe(sha256Hex(EMBEDDED));
			expect(sha256Hex(replaced)).not.toBe(sha256Hex(stale));
			expect((await stat(join(dir, LIB_NAME))).mode & 0o777).toBe(0o755);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("skips platforms without a native helper", () => {
		expect(extractPtySidecar({ binDir: tmpdir(), embeddedBase64: EMBEDDED_B64, platform: "freebsd" })).toBe("skipped");
	});
});
