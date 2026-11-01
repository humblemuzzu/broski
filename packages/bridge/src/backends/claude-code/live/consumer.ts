/** Lane D · the one loop that reads a `Query` (fact 1) and hands every frame to its host, in order. */

import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface FrameSink {
	frame(message: SDKMessage): void;
	/** The query ended: `error` when it threw. */
	ended(error: unknown): void;
}

export async function consume(_query: Query, _sink: FrameSink): Promise<void> {}
