/** Host facts for the bench report, without macOS-only tooling (`sw_vers`, `sysctl`). */

import { spawnSync } from "node:child_process";
import { cpus, release, totalmem } from "node:os";
import { linuxOsVersion, procCpuModel, procMemTotalBytes } from "./procfs";

function sysctlValue(key: string): string | null {
	if (process.platform !== "darwin") return null;
	const result = spawnSync("sysctl", ["-n", key], { encoding: "utf-8" });
	if (result.error || result.status !== 0) return null;
	const value = (result.stdout ?? "").trim();
	return value.length > 0 ? value : null;
}

export function detectOsVersion(): string {
	if (process.platform === "darwin") {
		// `sw_vers` is macOS-only and absent from slim Linux images, so it is probed, not assumed.
		const result = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf-8" });
		if (!result.error && result.status === 0) {
			const value = (result.stdout ?? "").trim();
			if (value.length > 0) return value;
		}
		return sysctlValue("kern.osproductversion") ?? release();
	}
	return linuxOsVersion() ?? release();
}

export function detectCpuModel(): string {
	const model = cpus()[0]?.model?.trim();
	if (model) return model;
	return procCpuModel() ?? sysctlValue("machdep.cpu.brand_string") ?? "unknown";
}

export function detectTotalRamBytes(): number {
	const total = totalmem();
	if (Number.isFinite(total) && total > 0) return total;
	return procMemTotalBytes() ?? 0;
}
