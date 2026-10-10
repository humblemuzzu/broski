/**
 * GNU time takes `-v`, BSD (macOS) time takes `-l`, and slim Linux images ship neither, so the flag
 * is probed once and the absent case is reported instead of crashing the scenario.
 */

import { spawnSync } from "node:child_process";

export const TIME_BIN = "/usr/bin/time";

export type TimeTool = "gnu" | "bsd" | "none";

export type TimeReport = {
	realMs: number;
	userMs: number;
	sysMs: number;
	maxRssBytes: number;
};

export type TimedRun = {
	tool: TimeTool;
	status: number | null;
	stdout: string;
	stderr: string;
	report: TimeReport | null;
};

function secondsToMs(value: string | undefined): number {
	const parsed = Number.parseFloat(value ?? "");
	return Number.isFinite(parsed) ? Math.round(parsed * 1000) : 0;
}

function parseGnu(stderr: string): TimeReport | null {
	const user = /User time \(seconds\):\s*([\d.]+)/.exec(stderr);
	const sys = /System time \(seconds\):\s*([\d.]+)/.exec(stderr);
	const rss = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(stderr);
	if (!user || !rss) return null;

	const wall = /Elapsed \(wall clock\) time \(h:mm:ss or m:ss\):\s*([\d:.]+)/.exec(stderr);
	let realMs = 0;
	if (wall?.[1]) {
		const parts = wall[1].split(":").map((part) => Number.parseFloat(part));
		const [head, second, third] = [parts[0] ?? 0, parts[1] ?? 0, parts[2]];
		realMs = Math.round((third === undefined ? head * 60 + second : head * 3600 + second * 60 + third) * 1000);
	}

	return {
		realMs,
		userMs: secondsToMs(user[1]),
		sysMs: secondsToMs(sys?.[1]),
		maxRssBytes: Number.parseInt(rss[1] ?? "0", 10) * 1024,
	};
}

function parseBsd(stderr: string): TimeReport | null {
	const cpu = /([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/.exec(stderr);
	if (!cpu) return null;
	const rss = /(\d+)\s+maximum resident set size/.exec(stderr);
	return {
		realMs: secondsToMs(cpu[1]),
		userMs: secondsToMs(cpu[2]),
		sysMs: secondsToMs(cpu[3]),
		maxRssBytes: rss?.[1] ? Number.parseInt(rss[1], 10) : 0,
	};
}

let cachedTool: TimeTool | null = null;

export function detectTimeTool(): TimeTool {
	if (cachedTool !== null) return cachedTool;
	const gnuProbe = spawnSync(TIME_BIN, ["-v", "true"], { encoding: "utf-8" });
	if (!gnuProbe.error && gnuProbe.status === 0 && /Maximum resident set size/.test(gnuProbe.stderr ?? "")) {
		cachedTool = "gnu";
		return cachedTool;
	}
	const bsdProbe = spawnSync(TIME_BIN, ["-l", "true"], { encoding: "utf-8" });
	if (!bsdProbe.error && bsdProbe.status === 0 && /maximum resident set size/.test(bsdProbe.stderr ?? "")) {
		cachedTool = "bsd";
		return cachedTool;
	}
	cachedTool = "none";
	return cachedTool;
}

export function runTimedCommand(cmd: string[], cwd: string, timeoutMs: number): TimedRun {
	const tool = detectTimeTool();
	if (tool === "none") {
		return { tool, status: null, stdout: "", stderr: `${TIME_BIN} is not installed`, report: null };
	}

	const flag = tool === "gnu" ? "-v" : "-l";
	const result = spawnSync(TIME_BIN, [flag, ...cmd], { cwd, encoding: "utf-8", timeout: timeoutMs });
	const stderr = result.stderr ?? "";
	return {
		tool,
		status: result.status,
		stdout: result.stdout ?? "",
		stderr,
		report: tool === "gnu" ? parseGnu(stderr) : parseBsd(stderr),
	};
}
