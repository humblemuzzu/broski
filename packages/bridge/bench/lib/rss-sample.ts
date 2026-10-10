/** Resident set size of another process, from `/proc` where it exists and `ps` otherwise. */

import { spawnSync } from "node:child_process";
import { procRssBytes } from "./procfs";

export function readProcessRssBytes(pid: number): number | null {
	const fromProc = procRssBytes(pid);
	if (fromProc !== null) return fromProc;

	const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf-8" });
	if (result.error) return null;
	const kb = Number.parseInt((result.stdout ?? "").trim(), 10);
	return Number.isFinite(kb) ? kb * 1024 : null;
}
