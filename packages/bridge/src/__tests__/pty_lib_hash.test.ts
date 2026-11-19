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
const BOOTSTRAP_PROBE_SOURCE = resolve(__dirname, "fixtures", "pty-bootstrap-probe.ts");
const PTY_SOURCE = resolve(BRIDGE_ROOT, "native", "pty", "pty_helper.c");

const HOST_TARGET = `bun-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`;

const LIB_NAME = "libbroski_pty.dylib";
const SUPPORTED = process.platform === "darwin";

function buildDylib(outPath: string): { ok: boolean; detail: string } {
	const args = ["-dynamiclib", "-o", outPath, PTY_SOURCE];
	const result = Bun.spawnSync({ cmd: ["cc", ...args], stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) return { ok: false, detail: new TextDecoder().decode(result.stderr) };
	return { ok: true, detail: "" };
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function compileProbe(
	outPath: string,
	source: string,
	defines: Record<string, string>,
): { ok: boolean; detail: string } {
	const cmd = ["bun", "build", "--compile", "--bytecode", "--format=esm", `--target=${HOST_TARGET}`];
	for (const [name, value] of Object.entries(defines)) cmd.push("--define", `${name}=${JSON.stringify(value)}`);
	cmd.push("--outfile", outPath, source);
	const result = Bun.spawnSync({ cmd, cwd: BRIDGE_ROOT, stdout: "pipe", stderr: "pipe" });
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
			const compiled = compileProbe(matching, PROBE_SOURCE, { BROSKI_PTY_LIB_HASH: pristineHash });
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

/**
 * The bootstrap must replace a sidecar left by a previous release, not just fill in a missing one:
 * an in-place upgrade keeps the old file, and the compiled loader rejects it by hash.
 */
describe.skipIf(!SUPPORTED)("compiled binary PTY sidecar bootstrap", () => {
	it("writes an absent sidecar, replaces a stale one, and leaves a matching one", async () => {
		const root = await mkdtemp(join(tmpdir(), "broski-pty-boot-"));
		try {
			const pristine = join(root, LIB_NAME);
			const built = buildDylib(pristine);
			if (!built.ok) {
				console.warn(`[pty-boot] cc could not build the PTY helper, skipped: ${built.detail}`);
				return;
			}
			const pristineHash = sha256(pristine);
			const embeddedB64 = readFileSync(pristine).toString("base64");

			const compiled = join(root, "bootstrap-probe");
			const probe = compileProbe(compiled, BOOTSTRAP_PROBE_SOURCE, {
				BROSKI_PTY_LIB_B64: embeddedB64,
				BROSKI_PTY_LIB_HASH: pristineHash,
			});
			expect(probe.ok, probe.detail).toBe(true);
			chmodSync(compiled, 0o755);

			const absentDir = join(root, "absent");
			const staleDir = join(root, "stale");
			const matchDir = join(root, "match");
			mkdirSync(absentDir, { recursive: true });
			mkdirSync(staleDir, { recursive: true });
			mkdirSync(matchDir, { recursive: true });
			copyFileSync(compiled, join(absentDir, "probe"));
			copyFileSync(compiled, join(staleDir, "probe"));
			copyFileSync(compiled, join(matchDir, "probe"));

			const staleBytes = Buffer.concat([readFileSync(pristine), Buffer.from("\n/* previous release */\n")]);
			writeFileSync(join(staleDir, LIB_NAME), staleBytes);
			copyFileSync(pristine, join(matchDir, LIB_NAME));

			const absent = runProbe(join(absentDir, "probe"), absentDir);
			expect(absent.output).toContain("EXTRACT=written");
			expect(absent.output).toContain("PTY_AVAILABLE=1");

			const stale = runProbe(join(staleDir, "probe"), staleDir);
			expect(stale.output).toContain("EXTRACT=written");
			expect(stale.output).toContain("PTY_AVAILABLE=1");
			expect(sha256(join(staleDir, LIB_NAME))).toBe(pristineHash);

			const matching = runProbe(join(matchDir, "probe"), matchDir);
			expect(matching.output).toContain("EXTRACT=unchanged");
			expect(matching.output).toContain("PTY_AVAILABLE=1");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);
});
