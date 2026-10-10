import { spawnSync } from "node:child_process";
import { RESULT_PREFIX } from "./report";
import type { ChildPayload, ScenarioMetrics, ScenarioResult } from "./types";

export type ChildRunOptions = {
	name: string;
	scriptPath: string;
	cwd: string;
	env: Record<string, string>;
	rssCapBytes: number;
	timeCapMs: number;
	sampleIntervalMs: number;
};

const STDOUT_CAP_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMetrics(source: Record<string, unknown>): ScenarioMetrics {
	const out: ScenarioMetrics = {};
	for (const [key, value] of Object.entries(source)) {
		if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
			out[key] = value;
		}
	}
	return out;
}

function toNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parsePayload(stdout: string): ChildPayload | null {
	const markerIndex = stdout.lastIndexOf(RESULT_PREFIX);
	if (markerIndex < 0) return null;
	const line = stdout.slice(markerIndex + RESULT_PREFIX.length).split("\n")[0] ?? "";
	try {
		const parsed: unknown = JSON.parse(line);
		if (!isRecord(parsed) || !isRecord(parsed.metrics)) return null;
		return {
			metrics: toMetrics(parsed.metrics),
			error: typeof parsed.error === "string" ? parsed.error : null,
			childWallMs: toNumber(parsed.childWallMs, 0),
			cpuUserMs: toNumber(parsed.cpuUserMs, 0),
			cpuSystemMs: toNumber(parsed.cpuSystemMs, 0),
			rssAtExitBytes: toNumber(parsed.rssAtExitBytes, 0),
		};
	} catch {
		return null;
	}
}

async function readBounded(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value || value.length === 0) continue;
		chunks.push(value);
		total += value.length;
		while (total > cap && chunks.length > 1) {
			const dropped = chunks.shift();
			total -= dropped ? dropped.length : 0;
		}
	}

	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder().decode(merged);
}

type ProcessRow = { pid: number; ppid: number };

function listProcesses(): ProcessRow[] {
	const result = spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf-8" });
	const rows: ProcessRow[] = [];
	for (const line of result.stdout.split("\n")) {
		const parts = line.trim().split(/\s+/);
		if (parts.length !== 2) continue;
		const pid = Number.parseInt(parts[0] ?? "", 10);
		const ppid = Number.parseInt(parts[1] ?? "", 10);
		if (Number.isFinite(pid) && Number.isFinite(ppid)) rows.push({ pid, ppid });
	}
	return rows;
}

export function killProcessTree(rootPid: number): number[] {
	const rows = listProcesses();
	const childrenByParent = new Map<number, number[]>();
	for (const row of rows) {
		const siblings = childrenByParent.get(row.ppid);
		if (siblings) siblings.push(row.pid);
		else childrenByParent.set(row.ppid, [row.pid]);
	}

	const order: number[] = [];
	const visit = (pid: number): void => {
		for (const child of childrenByParent.get(pid) ?? []) visit(child);
		order.push(pid);
	};
	visit(rootPid);
	order.pop();

	const killed: number[] = [];
	for (const pid of order.reverse()) {
		try {
			process.kill(pid, "SIGKILL");
			killed.push(pid);
		} catch {}
	}
	return killed;
}

let activePid: number | null = null;

process.on("exit", () => {
	if (activePid !== null) killProcessTree(activePid);
});

async function readRss(pid: number): Promise<number | null> {
	const proc = Bun.spawn({ cmd: ["ps", "-o", "rss=", "-p", String(pid)], stdout: "pipe", stderr: "ignore" });
	const text = await new Response(proc.stdout).text();
	await proc.exited;
	const kb = Number.parseInt(text.trim(), 10);
	return Number.isFinite(kb) ? kb * 1024 : null;
}

export async function runChild(options: ChildRunOptions): Promise<ScenarioResult> {
	const startedAtMs = Date.now();
	const proc = Bun.spawn({
		cmd: ["bun", options.scriptPath],
		cwd: options.cwd,
		env: options.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	activePid = proc.pid;

	const stdoutPromise = readBounded(proc.stdout, STDOUT_CAP_BYTES);
	const stderrPromise = readBounded(proc.stderr, STDOUT_CAP_BYTES);

	let exited = false;
	void proc.exited.then(() => {
		exited = true;
	});

	let startRssBytes = 0;
	let peakRssBytes = 0;
	let samples = 0;
	let killed: "rss" | "time" | null = null;

	while (!exited) {
		const rss = await readRss(proc.pid);
		if (rss !== null) {
			samples += 1;
			if (samples === 1) startRssBytes = rss;
			if (rss > peakRssBytes) peakRssBytes = rss;
			if (peakRssBytes > options.rssCapBytes) {
				killed = "rss";
				break;
			}
		}
		if (Date.now() - startedAtMs > options.timeCapMs) {
			killed = "time";
			break;
		}
		await Bun.sleep(options.sampleIntervalMs);
	}

	if (killed !== null) {
		killProcessTree(proc.pid);
		try {
			process.kill(proc.pid, "SIGKILL");
		} catch {}
	}

	await proc.exited;
	const stdout = await stdoutPromise;
	const stderr = await stderrPromise;
	killProcessTree(proc.pid);
	activePid = null;

	const payload = parsePayload(stdout);
	const wallMs = Date.now() - startedAtMs;
	const status: ScenarioResult["status"] = killed !== null ? "killed" : payload && !payload.error ? "ok" : "error";
	const diagnostics = `${stdout}\n${stderr}`.trim();

	if (payload && payload.rssAtExitBytes > peakRssBytes) peakRssBytes = payload.rssAtExitBytes;
	if (startRssBytes === 0) startRssBytes = peakRssBytes;

	return {
		name: options.name,
		status,
		killed,
		wallMs,
		startRssBytes,
		peakRssBytes,
		samples,
		cpuUserMs: payload ? payload.cpuUserMs : null,
		cpuSystemMs: payload ? payload.cpuSystemMs : null,
		metrics: payload ? payload.metrics : {},
		error: payload ? payload.error : diagnostics.slice(-400) || "no result payload",
		stdoutTail: diagnostics.slice(-2000),
	};
}
