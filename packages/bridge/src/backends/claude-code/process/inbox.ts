import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * The prompt of a long-lived `query()`: an `AsyncIterable` that stays open until `end()`, so stdin stays open between
 * runs (PLAN fact 1). One consumer only: the SDK's. A probe or a transient host passes one and never pushes.
 */
export interface Inbox {
	readonly iterable: AsyncIterable<SDKUserMessage>;
	/** Ignored after `end()`. */
	push(message: SDKUserMessage): void;
	/** Ends the iterable once what was pushed is read: the CLI sees stdin close. Idempotent. */
	end(): void;
	readonly ended: boolean;
}

export function createInbox(): Inbox {
	const queued: SDKUserMessage[] = [];
	let wake: (() => void) | undefined;
	let ended = false;
	const notify = () => {
		const resume = wake;
		wake = undefined;
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
			if (ended) return;
			queued.push(message);
			notify();
		},
		end: () => {
			ended = true;
			notify();
		},
		get ended() {
			return ended;
		},
	};
}
