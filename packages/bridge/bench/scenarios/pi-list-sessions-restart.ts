/**
 * The restart path: one process builds the index against the real session directory, then a second
 * process starts with that index already on disk and lists. That second number is what a bridge
 * restart costs, bun boot included, with the data unchanged between the two runs.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runChild } from "../lib/child-runner";
import { runScenario } from "../lib/report";

const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");
const CHILD_RSS_CAP_BYTES = 2560 * 1024 ** 2;
const CHILD_TIME_CAP_MS = 120_000;

function childEnv(extra: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") env[key] = value;
	}
	return { ...env, ...extra };
}

await runScenario(async () => {
	const cacheRoot = await mkdtemp(join(tmpdir(), "broski-pi-restart-"));
	const env = childEnv({ BROSKI_CACHE_DIR: cacheRoot });

	try {
		const warm = await runChild({
			name: "pi-index-warm",
			scriptPath: resolve(import.meta.dir, "children", "pi-index-warm.ts"),
			cwd: BRIDGE_ROOT,
			env,
			rssCapBytes: CHILD_RSS_CAP_BYTES,
			timeCapMs: CHILD_TIME_CAP_MS,
			sampleIntervalMs: 100,
		});

		const restarted = await runChild({
			name: "pi-index-restart",
			scriptPath: resolve(import.meta.dir, "children", "pi-index-restart.ts"),
			cwd: BRIDGE_ROOT,
			env,
			rssCapBytes: CHILD_RSS_CAP_BYTES,
			timeCapMs: CHILD_TIME_CAP_MS,
			sampleIntervalMs: 100,
		});

		return {
			buildMs: warm.metrics.callMs ?? -1,
			buildCount: warm.metrics.count ?? -1,
			buildPeakMb: Math.round(warm.peakRssBytes / 1024 ** 2),
			restartCallMs: restarted.metrics.callMs ?? -1,
			restartCount: restarted.metrics.count ?? -1,
			restartWallMs: restarted.wallMs,
			restartPeakMb: Math.round(restarted.peakRssBytes / 1024 ** 2),
			indexBytes: restarted.metrics.indexBytes ?? -1,
			indexEntries: restarted.metrics.indexEntries ?? -1,
			warmErrors: `${warm.status}/${restarted.status}`,
		};
	} finally {
		await rm(cacheRoot, { recursive: true, force: true });
	}
});
