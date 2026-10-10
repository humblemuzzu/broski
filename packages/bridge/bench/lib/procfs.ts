/** Linux host facts read straight from `/proc`, used when the procps tools are absent. */

import { readdirSync, readFileSync } from "node:fs";

export type ProcRow = { pid: number; ppid: number; comm: string };

export function readProcText(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

/** Resident set size from `/proc/<pid>/status`; null when the pid is gone. */
export function procRssBytes(pid: number): number | null {
	const status = readProcText(`/proc/${pid}/status`);
	const match = status ? /^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(status) : null;
	const kb = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isFinite(kb) ? kb * 1024 : null;
}

/**
 * Every process as `{ pid, ppid, comm }`, or null when `/proc` is unavailable (macOS).
 * `/proc/<pid>/stat` puts the command in parentheses, and a command can contain spaces and
 * parentheses, so the fields after the last `)` are the only safe ones to split.
 */
export function procTable(): ProcRow[] | null {
	let names: string[];
	try {
		names = readdirSync("/proc");
	} catch {
		return null;
	}

	const rows: ProcRow[] = [];
	for (const name of names) {
		if (!/^\d+$/.test(name)) continue;
		const stat = readProcText(`/proc/${name}/stat`);
		if (stat === null) continue;
		const openParen = stat.indexOf("(");
		const closeParen = stat.lastIndexOf(")");
		if (openParen < 0 || closeParen < openParen) continue;
		const fields = stat.slice(closeParen + 2).split(" ");
		const pid = Number.parseInt(name, 10);
		const ppid = Number.parseInt(fields[1] ?? "", 10);
		if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
		rows.push({ pid, ppid, comm: stat.slice(openParen + 1, closeParen) });
	}
	return rows;
}

export function procMemTotalBytes(): number | null {
	const meminfo = readProcText("/proc/meminfo");
	const match = meminfo ? /^MemTotal:\s+(\d+)\s+kB\s*$/m.exec(meminfo) : null;
	const kb = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isFinite(kb) ? kb * 1024 : null;
}

export function procCpuModel(): string | null {
	const cpuinfo = readProcText("/proc/cpuinfo");
	if (cpuinfo === null) return null;
	for (const line of cpuinfo.split("\n")) {
		const separator = line.indexOf(":");
		if (separator < 0) continue;
		const key = line.slice(0, separator).trim();
		if (key !== "model name" && key !== "Model" && key !== "Hardware" && key !== "Processor") continue;
		const value = line.slice(separator + 1).trim();
		if (value) return value;
	}
	return null;
}

export function linuxOsVersion(): string | null {
	const osRelease = readProcText("/etc/os-release");
	if (osRelease === null) return null;
	const match = /^PRETTY_NAME="?([^"\n]+)"?\s*$/m.exec(osRelease);
	return match?.[1]?.trim() ?? null;
}
