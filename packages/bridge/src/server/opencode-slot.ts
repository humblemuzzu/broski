import type { OpenCodeConnector } from "../connectors/opencode";

/** How long a request that needs OpenCode waits for a managed start already under way. */
export const OPENCODE_READY_TIMEOUT_MS = 30_000;

const STILL_STARTING = "it is still starting";
const NOT_INSTALLED = "it is not installed";

/** A request that needs OpenCode and cannot have it, with the reason the machine gave. */
export class OpenCodeUnavailableError extends Error {
	readonly reason: string;

	constructor(reason: string) {
		super(`OpenCode unavailable: ${reason}`);
		this.name = "OpenCodeUnavailableError";
		this.reason = reason;
	}
}

export type OpenCodeSlot = {
	/** What is there right now; null until the managed start lands, or when it never does. */
	current(): OpenCodeConnector | null;
	/** Resolves once the backend has arrived or been given up on, bounded by [timeoutMs]. */
	ready(timeoutMs?: number): Promise<OpenCodeConnector | null>;
	/** Whether a start is still in flight, which is what makes waiting worth it. */
	pending(): boolean;
	settle(connector: OpenCodeConnector | null, reason?: string): void;
	reason(): string | null;
};

export type OpenCodeSlotOptions = {
	/** Already available, the case when a connector was handed to the server directly. */
	initial?: OpenCodeConnector | null;
	/** A start is under way and will fill the slot: a request that needs it may wait. */
	pending?: boolean;
	/** Why it is unavailable, when it is and nothing is starting it. */
	reason?: string;
};

/**
 * The OpenCode backend, which may arrive after the listeners are up.
 *
 * A managed start takes about ten seconds, and it used to be ten seconds in which the bridge would
 * not listen at all. Everything that needs OpenCode reads this slot at call time instead, so a
 * request arriving during the start waits for it — up to a bound — and one arriving after a failed
 * start is told why.
 */
export function createOpenCodeSlot(options: OpenCodeSlotOptions = {}): OpenCodeSlot {
	let connector = options.initial ?? null;
	let unavailableReason: string | null = connector
		? null
		: (options.reason ?? (options.pending ? STILL_STARTING : NOT_INSTALLED));
	let settled = connector !== null || !options.pending;
	const waiters: Array<() => void> = [];

	return {
		current: () => connector,
		pending: () => !settled,
		reason: () => (connector ? null : unavailableReason),
		settle: (next, reason) => {
			connector = next;
			unavailableReason = next ? null : (reason ?? NOT_INSTALLED);
			settled = true;
			for (const wake of waiters.splice(0)) wake();
		},
		ready: (timeoutMs = OPENCODE_READY_TIMEOUT_MS) => {
			if (settled) return Promise.resolve(connector);
			return new Promise<OpenCodeConnector | null>((resolve) => {
				const timer = setTimeout(() => resolve(connector), timeoutMs);
				waiters.push(() => {
					clearTimeout(timer);
					resolve(connector);
				});
			});
		},
	};
}
