import { stat } from "node:fs/promises";
import type { CheckResult, CheckStatus } from "./types";

export async function fileExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}

export async function dirExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
}

export function summarizeChecks(results: CheckResult[]) {
	const counts: Record<CheckStatus, number> = {
		ok: 0,
		warning: 0,
		error: 0,
		info: 0,
	};
	for (const result of results) {
		counts[result.status] += 1;
	}
	return {
		ok: counts.ok,
		warning: counts.warning,
		error: counts.error,
		info: counts.info,
		total: results.length,
	};
}
