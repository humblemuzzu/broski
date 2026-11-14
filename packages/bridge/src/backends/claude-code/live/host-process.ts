/** One `query()` and what keeps it alive: its open inbox (D1) and the single consumer loop over its frames. */

import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSdk } from "../ports/sdk";
import { createInbox, type Inbox } from "../process/inbox";
import { consume, type FrameSink } from "./consumer";
import { PROCESS_END_DEADLINE_MS, within } from "./shutdown";

export class HostProcess {
	readonly query: Query;
	private readonly inbox: Inbox;
	private readonly consumer: Promise<void>;
	private closing = false;

	constructor(sdk: ClaudeSdk, options: Options, sink: FrameSink) {
		this.inbox = createInbox();
		this.query = sdk.query({ prompt: this.inbox.iterable, options });
		this.consumer = consume(this.query, sink);
	}

	/** True once `close` was called: the end of the loop is then expected. */
	get isClosing(): boolean {
		return this.closing;
	}

	push(message: SDKUserMessage): void {
		this.inbox.push(message);
	}

	/** Stdin EOF, then the SDK's SIGTERM and SIGKILL; never throws. */
	close(): void {
		if (this.closing) return;
		this.closing = true;
		this.inbox.end();
		try {
			this.query.close();
		} catch {
			/* the process is gone already */
		}
	}

	/** Resolves once the consumer saw the process end, or after the deadline. */
	async closed(): Promise<void> {
		await within(this.consumer, PROCESS_END_DEADLINE_MS, undefined);
	}
}
