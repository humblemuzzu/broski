import * as limits from "../../src/contract/limits";
import { MAX_PAGE_LIMIT } from "../../src/contract/paging";
import { REQUEST_DEADLINE_MS } from "../../src/core/protocol-server";
import { byCodeUnits } from "./order";

/**
 * The numbers a client must agree with the bridge on, keyed by their TypeScript name: every bound in
 * `limits.ts`, the page bound, and how long the bridge core may take to answer a request (after
 * which it answers `internal` itself), so the client's wait follows the core's.
 */
export function contractConstants(): [string, number][] {
	const named: Record<string, number> = { ...limits, MAX_PAGE_LIMIT, REQUEST_DEADLINE_MS };
	for (const [name, value] of Object.entries(named)) {
		if (!Number.isSafeInteger(value)) throw new Error(`${name} is not an integer`);
	}
	return Object.entries(named).sort(([a], [b]) => byCodeUnits(a, b));
}
