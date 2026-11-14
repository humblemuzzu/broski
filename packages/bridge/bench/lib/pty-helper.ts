/**
 * Bench scenarios run from source, where `dist/` may not exist yet — a bare CI runner has no built
 * sidecar. Compile the native PTY helper into `dist/` when it is missing so a scenario that measures
 * the native path measures it on the runner too, instead of passing on metrics it never took.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isNativePtyAvailable } from "../../src/workspace/pty/native-pty";
import { ptySidecarName } from "../../src/workspace/pty/sidecar-embed";

const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");
const PTY_SOURCE = resolve(BRIDGE_ROOT, "native", "pty", "pty_helper.c");

export function ensureNativePtyLibrary(): string {
	if (isNativePtyAvailable()) return "prebuilt";

	const name = ptySidecarName();
	if (!name) throw new Error(`no native PTY helper for ${process.platform}`);

	const outPath = resolve(BRIDGE_ROOT, "dist", name);
	mkdirSync(dirname(outPath), { recursive: true });
	const args =
		process.platform === "darwin"
			? ["-dynamiclib", "-o", outPath, PTY_SOURCE]
			: ["-shared", "-fPIC", "-o", outPath, PTY_SOURCE, "-lutil"];

	let build: ReturnType<typeof Bun.spawnSync>;
	try {
		build = Bun.spawnSync({ cmd: ["cc", ...args], stdout: "pipe", stderr: "pipe" });
	} catch (error) {
		throw new Error(
			`could not run cc to build the native PTY helper: ${error instanceof Error ? error.message : error}`,
		);
	}
	if (build.exitCode !== 0) {
		const stderr = new TextDecoder().decode(build.stderr).trim();
		throw new Error(`could not build the native PTY helper (cc ${args.join(" ")}): ${stderr}`);
	}
	if (!isNativePtyAvailable()) throw new Error(`built ${outPath} but the PTY helper still does not load`);

	return "built";
}
