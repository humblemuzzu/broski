/**
 * A bench scenario that starts a bridge server must run with a temp HOME: the server installs the
 * Claude Code permission hook into `~/.claude` and opens its log, auth-token
 * and TLS stores under `~/.broski`. Bun caches the home directory from the environment at process
 * start, so a process that inherited the real home is re-executed once with HOME pointed at a fresh
 * temp directory rather than editing the developer's files.
 *
 * Import this before any `../../src/...` module.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BENCH_ISOLATION_ENV, REAL_HOME_ENV } from "../../src/safety/real-home-guard";

const REENTRY_ENV = "BROSKI_BENCH_REENTRY";

export type BenchHome = { home: string; realHome: string; reentered: boolean };

function normalize(path: string): string {
	return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

export function isTempHome(path: string): boolean {
	const home = normalize(path);
	const root = normalize(tmpdir());
	return home === root || home.startsWith(`${root}/`);
}

function loadBenchHome(): BenchHome {
	const home = homedir();
	const reentered = process.env[REENTRY_ENV] === "1";
	const realHome = process.env[REAL_HOME_ENV]?.trim() || (reentered ? "" : home);

	process.env[REAL_HOME_ENV] = realHome || home;
	process.env[BENCH_ISOLATION_ENV] = "1";

	if (!isTempHome(home)) {
		console.error(
			`[bench] HOME is the real home (${home}); re-running this scenario under a temp HOME so the bridge cannot write it`,
		);
		reenterWithTempHome(realHome || home);
	}

	return { home, realHome: process.env[REAL_HOME_ENV] ?? home, reentered };
}

function reenterWithTempHome(realHome: string): never {
	const entry = process.argv[1];
	if (!entry) throw new Error("[bench] cannot re-run: no entry point in argv");
	const tempHome = mkdtempSync(join(tmpdir(), "broski-bench-home-"));
	try {
		const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
			cwd: process.cwd(),
			env: {
				...process.env,
				HOME: tempHome,
				USERPROFILE: tempHome,
				[REAL_HOME_ENV]: realHome,
				[REENTRY_ENV]: "1",
			},
			stdio: "inherit",
		});
		process.exit(result.status ?? 1);
	} finally {
		rmSync(tempHome, { recursive: true, force: true });
	}
}

export const BENCH_HOME: BenchHome = loadBenchHome();

/** Throws unless this process really is running under a temp home; used before starting a server. */
export function requireIsolatedBenchHome(): BenchHome {
	if (!isTempHome(BENCH_HOME.home)) {
		throw new Error(`[bench] refusing to start a bridge server with HOME=${BENCH_HOME.home} (not a temp dir)`);
	}
	return BENCH_HOME;
}
