/** The one loop that reads a `Query` (fact 1) and hands every frame to its host, in order. */

import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface FrameSink {
	frame(message: SDKMessage): void;
	/** A frame the sink could not handle: the loop goes on with the next. */
	fault(error: unknown): void;
	/** The query ended: `error` when it threw. */
	ended(error: unknown): void;
}

export async function consume(query: Query, sink: FrameSink): Promise<void> {
	try {
		for await (const message of query) {
			try {
				sink.frame(message);
			} catch (error) {
				sink.fault(error);
			}
		}
	} catch (error) {
		sink.ended(error);
		return;
	}
	sink.ended(undefined);
}
