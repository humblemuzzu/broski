import { spawnSync } from "node:child_process";
import type { MachineInfo } from "./types";

function sysctl(key: string): string {
	const result = spawnSync("sysctl", ["-n", key], { encoding: "utf-8" });
	return result.stdout.trim();
}

export function collectMachineInfo(): MachineInfo {
	const swVers = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf-8" });
	const memBytes = Number.parseInt(sysctl("hw.memsize"), 10);
	return {
		bunVersion: Bun.version,
		platform: process.platform,
		arch: process.arch,
		osVersion: swVers.stdout.trim() || sysctl("kern.osproductversion") || "unknown",
		cpu: sysctl("machdep.cpu.brand_string") || "unknown",
		totalRamBytes: Number.isFinite(memBytes) ? memBytes : 0,
	};
}
