import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { InterruptOptions, InterruptReceipt } from "../ports/sdk";

type InterruptWithOptions = (options?: InterruptOptions) => Promise<InterruptReceipt>;

/**
 * `Query.interrupt` with `{cancelQueued}`. The declared method takes no parameter, and a zero-parameter function is
 * assignable to one with an optional parameter, so the runtime argument passes without a cast.
 */
export function interruptQuery(query: Query, options?: InterruptOptions): Promise<InterruptReceipt> {
	const interrupt: InterruptWithOptions = query.interrupt.bind(query);
	return interrupt(options);
}
