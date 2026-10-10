/** The process table on any host: `/proc` when it exists, `ps` otherwise (macOS has no procfs). */

import { spawnSync } from "node:child_process";
import { procTable } from "./procfs";

export type ProcessRow = { pid: number; ppid: number; comm: string };

function psTable(): ProcessRow[] | null {
	const result = spawnSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf-8" });
	if (result.error) return null;

	const rows: ProcessRow[] = [];
	for (const line of (result.stdout ?? "").split("\n")) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 3) continue;
		const pid = Number.parseInt(parts[0] ?? "", 10);
		const ppid = Number.parseInt(parts[1] ?? "", 10);
		if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
		rows.push({ pid, ppid, comm: parts.slice(2).join(" ") });
	}
	return rows;
}

export function listProcesses(): ProcessRow[] {
	return procTable() ?? psTable() ?? [];
}

export function childProcessesOf(parentPid: number): ProcessRow[] {
	return listProcesses().filter((row) => row.ppid === parentPid && !/(^|\/)ps$/.test(row.comm));
}

/** SIGKILLs every descendant of `rootPid` (deepest first) and returns the pids it killed. */
export function killProcessTree(rootPid: number): number[] {
	const childrenByParent = new Map<number, number[]>();
	for (const row of listProcesses()) {
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
		} catch {
			// Already gone.
		}
	}
	return killed;
}
