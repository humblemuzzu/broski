/**
 * Refuses writes that would land inside the developer's real home directory while this process is
 * running under test or bench isolation.
 *
 * Bun resolves the home directory from the initial environment and caches it, so a process that
 * inherits the real `HOME` cannot be redirected by assigning `process.env.HOME` later. The real home
 * is captured into `BROSKI_REAL_HOME` before anything moves `HOME`; without that capture it falls
 * back to `os.userInfo().homedir`. The hook installers write into `~/.claude` and `~/.codex`, so a
 * scenario started without a temp home used to edit the developer's live settings.
 */

import { userInfo } from "node:os";
import { resolve, sep } from "node:path";

export const TEST_ISOLATION_ENV = "BROSKI_TEST_ISOLATION";
export const BENCH_ISOLATION_ENV = "BROSKI_BENCH_ISOLATION";
export const REAL_HOME_ENV = "BROSKI_REAL_HOME";

export class RealHomeWriteError extends Error {
	readonly target: string;
	readonly realHome: string;
	readonly context: string;

	constructor(target: string, realHome: string, context: string) {
		super(
			`refusing to write ${target} (${context}): it is inside the real home directory ${realHome} ` +
				`and this process runs under test/bench isolation. Point HOME at a temp directory first.`,
		);
		this.name = "RealHomeWriteError";
		this.target = target;
		this.realHome = realHome;
		this.context = context;
	}
}

let realHomeOverride: string | null = null;

/** Test-only seam so the guard itself can be exercised without ever resolving the real `~`. */
export function setRealHomeForTesting(path: string | null): void {
	realHomeOverride = path;
}

/** Records the current home as the real one before `HOME` is moved to a temp dir. */
export function captureRealHome(env: Record<string, string | undefined> = process.env): string {
	const existing = env[REAL_HOME_ENV]?.trim();
	if (existing) return resolve(existing);
	const home = resolve(userInfo().homedir);
	env[REAL_HOME_ENV] = home;
	return home;
}

export function realHomeDir(): string {
	if (realHomeOverride !== null) return resolve(realHomeOverride);
	const captured = process.env[REAL_HOME_ENV]?.trim();
	if (captured) return resolve(captured);
	return resolve(userInfo().homedir);
}

export function isIsolationActive(): boolean {
	return process.env[TEST_ISOLATION_ENV] === "1" || process.env[BENCH_ISOLATION_ENV] === "1";
}

export function isInsideRealHome(target: string): boolean {
	const real = realHomeDir();
	const resolved = resolve(target);
	return resolved === real || resolved.startsWith(`${real}${sep}`);
}

/** Throws when `target` is inside the real home and this process is under isolation; otherwise a no-op. */
export function assertNotRealHome(target: string, context: string): void {
	if (!isIsolationActive()) return;
	if (!isInsideRealHome(target)) return;
	throw new RealHomeWriteError(resolve(target), realHomeDir(), context);
}
