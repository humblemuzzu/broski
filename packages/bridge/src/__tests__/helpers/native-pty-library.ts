/**
 * Tests and bench scenarios run from source, where `dist/` may not exist yet: a bare CI runner has no built
 * sidecar. Compile the native PTY helper into `dist/` when it is missing or older than its source, so what
 * measures or proves the native path runs it, built from the source beside it, instead of passing on a skip.
 */

import { mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isNativePtyAvailable } from "../../workspace/pty/native-pty-library";
import { ptySidecarName } from "../../workspace/pty/sidecar-embed";

const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..", "..");
const PTY_SOURCE = resolve(BRIDGE_ROOT, "native", "pty", "pty_helper.c");

function modifiedAt(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

export function ensureNativePtyLibrary(): "prebuilt" | "built" {
	const name = ptySidecarName();
	if (!name) throw new Error(`no native PTY helper for ${process.platform}`);
	const outPath = resolve(BRIDGE_ROOT, "dist", name);
	const built = modifiedAt(outPath);
	if (built !== undefined && built >= (modifiedAt(PTY_SOURCE) ?? 0) && isNativePtyAvailable()) return "prebuilt";

	mkdirSync(dirname(outPath), { recursive: true });
	// Built aside and renamed, so a test file running at the same time never loads a half-written library.
	const partial = `${outPath}.${process.pid}.partial`;
	const args = ["-dynamiclib", "-o", partial, PTY_SOURCE];

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
	renameSync(partial, outPath);
	if (!isNativePtyAvailable()) throw new Error(`built ${outPath} but the PTY helper still does not load`);

	return "built";
}
