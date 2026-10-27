import { BoundedMap, registerSweepable } from "../state/bounded-map";

const MAX_PENDING = 128;
const TTL_MS = 10 * 60 * 1000;

/** An elicitation prompt the phone may still have to answer, as the SDK asked it. */
export type PendingElicitation = {
	sessionId: string;
	requestId: string;
	mcpServerName?: string;
	message?: string;
	mode?: string;
	url?: string;
	elicitationId?: string;
	requestedSchema?: unknown;
	at: number;
};

/**
 * Claude Code's elicitation prompts are held by the SDK, so the payload only exists in the stream
 * message the bridge emitted. Keeping it is what makes a restored prompt show the real server, URL
 * and message instead of a generic line.
 */
class PendingElicitations {
	private readonly entries = new BoundedMap<string, PendingElicitation>({
		maxEntries: MAX_PENDING,
		ttlMs: TTL_MS,
		touchOnGet: false,
	});

	constructor() {
		registerSweepable({
			name: "pending-elicitations",
			sweep: (now) => this.entries.sweep(now),
			size: () => this.entries.size,
			limit: () => MAX_PENDING,
		});
	}

	remember(prompt: PendingElicitation): void {
		this.entries.set(keyOf(prompt.sessionId, prompt.requestId), prompt);
	}

	forget(sessionId: string, requestId: string): void {
		this.entries.delete(keyOf(sessionId, requestId));
	}

	pending(): PendingElicitation[] {
		const found: PendingElicitation[] = [];
		for (const key of this.entries.keys()) {
			const entry = this.entries.get(key);
			if (entry) found.push(entry);
		}
		return found;
	}

	reset(): void {
		this.entries.clear();
	}
}

function keyOf(sessionId: string, requestId: string): string {
	return `${sessionId}:${requestId}`;
}

export const pendingElicitations = new PendingElicitations();
