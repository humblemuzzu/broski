import type { BenchRun, ScenarioMetrics, ScenarioResult } from "./types";

const MAX_METRIC_CHARS = 150;

function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${bytes} B`;
}

function formatMetricValue(value: number | string | boolean | null): string {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return String(value);
		if (Number.isInteger(value)) return String(value);
		if (Math.abs(value) >= 1000) return value.toFixed(0);
		return value.toFixed(1);
	}
	return String(value);
}

export function summariseMetrics(metrics: ScenarioMetrics): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(metrics)) {
		parts.push(`${key}=${formatMetricValue(value)}`);
	}
	const joined = parts.join(", ");
	return joined.length > MAX_METRIC_CHARS ? `${joined.slice(0, MAX_METRIC_CHARS - 1)}…` : joined;
}

function statusLabel(result: ScenarioResult): string {
	if (result.killed === "rss") return "KILLED (rss)";
	if (result.killed === "time") return "KILLED (time)";
	if (result.status === "error") return "ERROR";
	return "ok";
}

function scenarioRows(run: BenchRun): string[] {
	return run.results.map((result) => {
		const cpu = result.cpuUserMs === null ? "-" : `${(result.cpuUserMs + (result.cpuSystemMs ?? 0)).toFixed(0)}`;
		return `| ${result.name} | ${statusLabel(result)} | ${result.wallMs} | ${formatBytes(result.peakRssBytes)} | ${cpu} | ${summariseMetrics(result.metrics)} |`;
	});
}

export function renderMarkdown(run: BenchRun): string {
	const lines: string[] = [];
	lines.push(`# Bridge bench — ${run.generatedAt}`);
	lines.push("");
	lines.push(
		`Machine: bun ${run.machine.bunVersion} · ${run.machine.platform} ${run.machine.osVersion} · ${run.machine.cpu} · ${formatBytes(run.machine.totalRamBytes)} RAM · ${run.machine.arch}`,
	);
	lines.push(
		`Caps: rss ${(run.config.rssCapBytes / 1024 ** 2).toFixed(0)} MB · time ${run.config.timeCapMs} ms · sample ${run.config.sampleIntervalMs} ms`,
	);
	lines.push("");
	lines.push("## Data sets");
	lines.push("");
	lines.push("| data set | files | bytes | largest |");
	lines.push("| --- | --- | --- | --- |");
	for (const dataset of run.datasets) {
		lines.push(
			`| ${dataset.id} | ${dataset.exists ? dataset.files : 0} | ${formatBytes(dataset.bytes)} | ${formatBytes(dataset.largestBytes)} |`,
		);
	}
	lines.push("");
	lines.push("## Scenarios");
	lines.push("");
	lines.push("| scenario | status | wall ms | peak RSS | cpu ms | metrics |");
	lines.push("| --- | --- | --- | --- | --- | --- |");
	lines.push(...scenarioRows(run));
	lines.push("");
	return lines.join("\n");
}

export { formatBytes };
