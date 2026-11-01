import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** The open prompt a long-lived `query()` reads: it never ends until `end()`, so the CLI's stdin stays open. */
export type Inbox = {
	iterable: AsyncIterable<SDKUserMessage>;
	push: (message: SDKUserMessage) => void;
	end: () => void;
};

export function createInbox(): Inbox {
	const queued: SDKUserMessage[] = [];
	let wake: (() => void) | null = null;
	let ended = false;
	const notify = () => {
		const resume = wake;
		wake = null;
		resume?.();
	};
	async function* read(): AsyncGenerator<SDKUserMessage> {
		for (;;) {
			const next = queued.shift();
			if (next) {
				yield next;
				continue;
			}
			if (ended) return;
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
		}
	}
	return {
		iterable: read(),
		push: (message) => {
			queued.push(message);
			notify();
		},
		end: () => {
			ended = true;
			notify();
		},
	};
}
