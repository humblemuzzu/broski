/**
 * After a run's `run_finished`, the context figure the result frames rarely carry (`result.usage.iterations` is empty
 * on most API paths): one `getContextUsage({detail: "summary"})` on the still-live host, sent as a `usage_updated`
 * over the snapshot's usage, its totals and cache window as they were: a measure is no model request, and the core's
 * cache clock reads unchanged totals as none. Nothing is sent when the figure is the one the snapshot has. Never before
 * the run ends and never waited for. A failure is logged and nothing is sent, unless the process that was asked has
 * ended or been told to close meanwhile: the SDK rejects every pending control request when its query closes, which is
 * how a session that ends right after a run answers, not a fault.
 */

import type { Query, SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { Usage } from "../../../contract";
import type { SessionEmitter } from "../ports/live";
import { errorText } from "./error-text";

export interface ContextReportDeps {
	readonly live: SessionEmitter;
	/** The running process's query; undefined once it ended or is closing. */
	readonly query: () => Query | undefined;
	readonly closed: () => boolean;
}

export function reportContextAfterRun(deps: ContextReportDeps): void {
	const query = deps.query();
	if (query === undefined || deps.closed()) return;
	query.getContextUsage({ detail: "summary" }).then(
		(usage) => {
			const measured = contextOf(usage);
			if (measured === undefined || deps.closed()) return;
			const current = deps.live.snapshot().usage;
			if (sameContext(current, measured)) return;
			deps.live.emit({ type: "usage_updated", usage: { ...current, ...measured } });
		},
		(error: unknown) => {
			if (deps.query() === query)
				process.stderr.write(`[claude-code] context usage after a run: ${errorText(error)}\n`);
		},
	);
}

/** The window the CLI's own `/context` divides by (`maxTokens`), and what fills it. */
function contextOf(
	usage: SDKControlGetContextUsageResponse,
): Pick<Usage, "contextTokens" | "contextWindow"> | undefined {
	const tokens = whole(usage.totalTokens);
	if (tokens === undefined) return undefined;
	const window = whole(usage.maxTokens);
	return { contextTokens: tokens, ...(window !== undefined && window > 0 && { contextWindow: window }) };
}

function sameContext(current: Usage | undefined, measured: Pick<Usage, "contextTokens" | "contextWindow">): boolean {
	return (
		current !== undefined &&
		current.contextTokens === measured.contextTokens &&
		(measured.contextWindow === undefined || current.contextWindow === measured.contextWindow)
	);
}

function whole(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
		? Math.round(value)
		: undefined;
}
