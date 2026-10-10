import { detectCpuModel, detectOsVersion, detectTotalRamBytes } from "./host-info";
import type { MachineInfo } from "./types";

export function collectMachineInfo(): MachineInfo {
	return {
		bunVersion: Bun.version,
		platform: process.platform,
		arch: process.arch,
		osVersion: detectOsVersion(),
		cpu: detectCpuModel(),
		totalRamBytes: detectTotalRamBytes(),
	};
}
