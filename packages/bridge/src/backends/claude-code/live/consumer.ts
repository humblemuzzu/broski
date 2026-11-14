/** The one loop that reads a `Query` (D1) and hands every frame to its host, in order. */

import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface FrameSink {
	frame(message: SDKMessage): void;
	/** A frame the sink could not handle: the loop goes on with the next. */
	fault(error: unknown): void;
	/** The query ended: `error` when it threw. */
	ended(error: unknown): void;
}

/** Never throws: what the sink throws is its own fault, and the loop ends all the same. */
export async function consume(query: Query, sink: FrameSink): Promise<void> {
	let failure: unknown;
	try {
		for await (const message of query) {
			try {
				sink.frame(message);
			} catch (error) {
				sink.fault(error);
			}
		}
	} catch (error) {
		failure = error;
	}
	try {
		sink.ended(failure);
	} catch {
		/* the host that owned this loop is already gone */
	}
}
