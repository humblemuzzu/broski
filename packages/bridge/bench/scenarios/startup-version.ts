import { resolve } from "node:path";
import { runScenario } from "../lib/report";
import { readProcessRssBytes } from "../lib/rss-sample";
import { runTimedCommand } from "../lib/time-report";
import type { ScenarioMetrics } from "../lib/types";

const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");
const GUARD_MS = 20_000;

async function timedDirectSpawn(): Promise<{ wallMs: number; exitCode: number; peakRssBytes: number }> {
	const startedAt = Date.now();
	const proc = Bun.spawn({
		cmd: ["bun", "src/index.ts", "version"],
		cwd: BRIDGE_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	void new Response(proc.stdout).text();
	void new Response(proc.stderr).text();

	let exited = false;
	void proc.exited.then(() => {
		exited = true;
	});
	let peakRssBytes = 0;
	while (!exited) {
		const rss = readProcessRssBytes(proc.pid);
		if (rss !== null && rss > peakRssBytes) peakRssBytes = rss;
		if (Date.now() - startedAt > GUARD_MS) {
			try {
				process.kill(proc.pid, "SIGKILL");
			} catch {}
			break;
		}
		await Bun.sleep(25);
	}

	return { wallMs: Date.now() - startedAt, exitCode: await proc.exited, peakRssBytes };
}

await runScenario(async () => {
	const direct = await timedDirectSpawn();
	const metrics: ScenarioMetrics = {
		directWallMs: direct.wallMs,
		directExitCode: direct.exitCode,
		directPeakRssBytes: direct.peakRssBytes,
	};

	const timed = runTimedCommand(["bun", "src/index.ts", "version"], BRIDGE_ROOT, GUARD_MS);
	metrics.timeTool = timed.tool;
	if (timed.report) {
		metrics.timeRealMs = timed.report.realMs;
		metrics.timeUserMs = timed.report.userMs;
		metrics.timeSysMs = timed.report.sysMs;
		metrics.timeMaxRssBytes = timed.report.maxRssBytes;
	} else {
		metrics.timeReportParsed = false;
	}
	metrics.stdout = timed.stdout.trim().split("\n").join(" | ");
	return metrics;
});
