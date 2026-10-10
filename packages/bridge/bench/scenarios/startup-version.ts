import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runScenario } from "../lib/report";
import type { ScenarioMetrics } from "../lib/types";

const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");
const TIME_BIN = "/usr/bin/time";
const GUARD_MS = 20_000;

async function readRss(pid: number): Promise<number | null> {
	const proc = Bun.spawn({ cmd: ["ps", "-o", "rss=", "-p", String(pid)], stdout: "pipe", stderr: "ignore" });
	const text = await new Response(proc.stdout).text();
	await proc.exited;
	const kb = Number.parseInt(text.trim(), 10);
	return Number.isFinite(kb) ? kb * 1024 : null;
}

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
		const rss = await readRss(proc.pid);
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

type TimeReport = { realMs: number; userMs: number; sysMs: number; maxRssBytes: number };

function parseTimeReport(stderr: string): TimeReport | null {
	const cpu = stderr.match(/([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/);
	const rss = stderr.match(/(\d+)\s+maximum resident set size/);
	if (!cpu) return null;
	return {
		realMs: Math.round(Number.parseFloat(cpu[1] ?? "0") * 1000),
		userMs: Math.round(Number.parseFloat(cpu[2] ?? "0") * 1000),
		sysMs: Math.round(Number.parseFloat(cpu[3] ?? "0") * 1000),
		maxRssBytes: rss ? Number.parseInt(rss[1] ?? "0", 10) : 0,
	};
}

await runScenario(async () => {
	const direct = await timedDirectSpawn();
	const metrics: ScenarioMetrics = {
		directWallMs: direct.wallMs,
		directExitCode: direct.exitCode,
		directPeakRssBytes: direct.peakRssBytes,
	};

	const timed = spawnSync(TIME_BIN, ["-l", "bun", "src/index.ts", "version"], {
		cwd: BRIDGE_ROOT,
		encoding: "utf-8",
		timeout: GUARD_MS,
	});
	const report = parseTimeReport(timed.stderr ?? "");
	if (report) {
		metrics.timeRealMs = report.realMs;
		metrics.timeUserMs = report.userMs;
		metrics.timeSysMs = report.sysMs;
		metrics.timeMaxRssBytes = report.maxRssBytes;
	} else {
		metrics.timeReportParsed = false;
	}
	metrics.stdout = (timed.stdout ?? "").trim().split("\n").join(" | ");
	return metrics;
});
