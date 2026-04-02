import type { CheckResult, CheckStatus } from "./types";

export { dirExists, fileExists } from "../utils/fs-helpers";

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
