import type { SessionSnapshot } from "../contract";

/** Whether two snapshots say the same thing as JSON: key order and absent-versus-undefined do not count. */
export function sameState(a: SessionSnapshot, b: SessionSnapshot): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(snapshot: SessionSnapshot): string {
	return JSON.stringify(snapshot, (_key, value) =>
		value !== null && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: value,
	);
}
