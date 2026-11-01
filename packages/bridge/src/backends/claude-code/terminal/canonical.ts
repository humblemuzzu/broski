/** A tool input as text that does not depend on the order of its keys, so two copies of one input compare equal. */

import { boundedJson, isRecord } from "../json";

export function canonicalInput(value: unknown): string {
	return JSON.stringify(boundedJson(value), (_key, item: unknown) =>
		isRecord(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item,
	);
}
