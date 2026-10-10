/**
 * The compiled bridge only loads a PTY sidecar whose sha256 matches the one baked in at build time.
 *
 * Builds the real helper from `native/pty/pty_helper.c`, compiles the probe against its hash, and
 * runs the probe next to the library it was built for and next to a tampered copy of it.
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BRIDGE_ROOT = resolve(__dirname, "..", "..");
const PROBE_SOURCE = resolve(__dirname, "fixtures", "pty-hash-probe.ts");
const PTY_SOURCE = resolve(BRIDGE_ROOT, "native", "pty", "pty_helper.c");

const HOST_TARGET =
	process.platform === "darwin"
		? `bun-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`
		: `bun-linux-${process.arch === "arm64" ? "arm64" : "x64"}`;

const LIB_NAME = process.platform === "darwin" ? "libbroski_pty.dylib" : "libbroski_pty.so";
const SUPPORTED = process.platform === "darwin" || process.platform === "linux";

function buildDylib(outPath: string): { ok: boolean; detail: string } {
	const args =
		process.platform === "darwin"
			? ["-dynamiclib", "-o", outPath, PTY_SOURCE]
			: ["-shared", "-fPIC", "-o", outPath, PTY_SOURCE, "-lutil"];
	const result = Bun.spawnSync({ cmd: ["cc", ...args], stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) return { ok: false, detail: new TextDecoder().decode(result.stderr) };
	return { ok: true, detail: "" };
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function compileProbe(outPath: string, bakedHash: string): { ok: boolean; detail: string } {
	const result = Bun.spawnSync({
		cmd: [
			"bun",
			"build",
			"--compile",
			"--bytecode",
			"--format=esm",
			`--target=${HOST_TARGET}`,
			"--define",
			`BROSKI_PTY_LIB_HASH="${bakedHash}"`,
			"--outfile",
			outPath,
			PROBE_SOURCE,
		],
		cwd: BRIDGE_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) return { ok: false, detail: new TextDecoder().decode(result.stderr) };
	return { ok: true, detail: "" };
}

function runProbe(binary: string, cwd: string): { output: string; exitCode: number } {
	const result = Bun.spawnSync({ cmd: [binary], cwd, stdout: "pipe", stderr: "pipe" });
	const stdout = new TextDecoder().decode(result.stdout);
	const stderr = new TextDecoder().decode(result.stderr);
	return { output: `${stdout}\n${stderr}`, exitCode: result.exitCode };
}

describe.skipIf(!SUPPORTED)("compiled binary PTY library integrity", () => {
	it("loads the library it was built for and refuses a modified copy", async () => {
		const root = await mkdtemp(join(tmpdir(), "broski-pty-hash-"));
		try {
			const pristine = join(root, LIB_NAME);
			const built = buildDylib(pristine);
			if (!built.ok) {
				console.warn(`[pty-hash] cc could not build the PTY helper, skipped: ${built.detail}`);
				return;
			}
			const pristineHash = sha256(pristine);

			const tampered = join(root, `${LIB_NAME}.tampered`);
			copyFileSync(pristine, tampered);
			writeFileSync(tampered, Buffer.from("\n/* tampered */\n"), { flag: "a" });

			const matching = join(root, "probe-matching");
			const compiled = compileProbe(matching, pristineHash);
			expect(compiled.ok, compiled.detail).toBe(true);
			chmodSync(matching, 0o755);

			const okDir = join(root, "ok");
			const tamperedDir = join(root, "tampered");
			mkdirSync(okDir, { recursive: true });
			mkdirSync(tamperedDir, { recursive: true });
			copyFileSync(matching, join(okDir, "probe"));
			copyFileSync(matching, join(tamperedDir, "probe"));
			copyFileSync(pristine, join(okDir, LIB_NAME));
			copyFileSync(tampered, join(tamperedDir, LIB_NAME));

			const accepted = runProbe(join(okDir, "probe"), okDir);
			expect(accepted.output).toContain("PTY_AVAILABLE=1");
			expect(accepted.exitCode).toBe(0);

			const refused = runProbe(join(tamperedDir, "probe"), tamperedDir);
			expect(refused.output).toContain("PTY_AVAILABLE=0");
			expect(refused.output).toContain("Refusing to load");
			expect(refused.output).toContain("does not match the hash baked at build time");
			expect(refused.exitCode).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);
});
