/**
 * After a run's `run_finished`, the context figure the result frames rarely carry (`result.usage.iterations` is empty
 * on most API paths): one `getContextUsage({detail: "summary"})` on the still-live host, sent as a `usage_updated`
 * over the snapshot's usage. Never before the run ends and never waited for; a failure is logged and nothing is sent.
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
	readonly log?: (line: string) => void;
}

export function reportContextAfterRun(deps: ContextReportDeps): void {
	const query = deps.query();
	if (query === undefined || deps.closed()) return;
	const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
	query.getContextUsage({ detail: "summary" }).then(
		(usage) => {
			const measured = contextOf(usage);
			if (measured === undefined || deps.closed()) return;
			deps.live.emit({ type: "usage_updated", usage: { ...deps.live.snapshot().usage, ...measured } });
		},
		(error: unknown) => log(`[claude-code] context usage after a run: ${errorText(error)}`),
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

function whole(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
		? Math.round(value)
		: undefined;
}
