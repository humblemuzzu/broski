/**
 * The processes of the `agy` the backend started, read from `ps`: a front's workers are its children (agy 1.5.18,
 * `--process-per-session`). A test kills only a process it has traced to an `agy` its own wire tap started, never one
 * found by name: the user may run their own `agy`, or a bridge of their own with its front.
 */

import type { TappedAgy } from "./wire-log";

export interface Process {
	readonly pid: number;
	readonly ppid: number;
	readonly command: string;
}

export function processTable(): Process[] {
	const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,command="], { stdout: "pipe" });
	return ps.stdout
		.toString()
		.split("\n")
		.flatMap((line): Process[] => {
			const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
			return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }] : [];
		});
}

export function childrenOf(pid: number): Process[] {
	return processTable().filter((entry) => entry.ppid === pid);
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Kills a worker of `front`, once it is sure the pid is one: a child of the `agy` the tap started. */
export function killWorker(front: TappedAgy, pid: number): void {
	if (!childrenOf(front.pid).some((child) => child.pid === pid)) {
		throw new Error(`${pid} is no worker of the tapped front ${front.pid}; nothing was killed`);
	}
	process.kill(pid, "SIGKILL");
}

/** Kills the tapped front itself, once it is sure the pid is the `agy` its tap started. */
export function killFront(front: TappedAgy): void {
	const agy = processTable().find((candidate) => candidate.pid === front.pid);
	if (agy?.ppid !== front.tapPid) throw new Error(`${front.pid} is not the agy the tap ${front.tapPid} started`);
	process.kill(front.pid, "SIGKILL");
}

export function describeProcesses(processes: readonly Process[]): string {
	return processes.map((entry) => `${entry.pid} ${entry.command.slice(0, 120)}`).join("; ") || "none";
}
