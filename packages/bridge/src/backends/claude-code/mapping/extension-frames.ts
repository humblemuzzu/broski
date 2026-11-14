/** Lane B · the backend extension Claude Code declares: `rate_limit` (D24). */

import type { SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import { MAX_NAME_CHARS, RateLimitStatus, type RateLimitUpdate } from "../../../contract";
import { clip } from "../bounds";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

const UNNAMED_WINDOW = "account";

function nonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * `resetsAt` is epoch seconds and `utilization` a fraction (2.1.316 `claude` strings: `Math.floor(Date.now()/1000)+…`,
 * `Math.round(e.utilization*100)`); the contract wants milliseconds and a percentage.
 */
function rateLimitOf(info: SDKRateLimitEvent["rate_limit_info"]): RateLimitUpdate {
	const resetsAt = nonNegative(info.resetsAt);
	const utilization = nonNegative(info.utilization);
	const status = RateLimitStatus.safeParse(info.status);
	const named: unknown = info.rateLimitType;
	const window = typeof named === "string" && named !== "" ? named : UNNAMED_WINDOW;
	return {
		kind: "rate_limit",
		window: clip(window, MAX_NAME_CHARS),
		...(status.success && { status: status.data }),
		...(utilization !== undefined && {
			usedPercent: Math.round(utilization * 1000) / 10,
		}),
		...(resetsAt !== undefined && { resetsAt: Math.round(resetsAt * 1000) }),
	};
}

/** The CLI repeats an exceeded window about every 30 s; a window that says what it said last says nothing new. */
export function rateLimitEvents(state: MapperState, frame: SDKRateLimitEvent): MappedEvent[] {
	const update = rateLimitOf(frame.rate_limit_info);
	const signature = JSON.stringify(update);
	if (state.rateLimits.get(update.window) === signature) return [];
	state.rateLimits.set(update.window, signature);
	return [{ event: { type: "extension", extension: update } }];
}
