import { BoundedMap, registerSweepable } from "../../state/bounded-map";
import type { LinkFeedAlertKind, LinkFeedEventMessage } from "./format";

const MAX_TRACKED_REQUESTS = 512;
const REQUEST_TTL_MS = 10 * 60 * 1000;

/** What a decision needs to know about an alert the daemon was told about. */
export type LinkFeedRequest = {
	kind: LinkFeedAlertKind;
	/** The backend's own label for the request. */
	requestKind?: string;
};

export type LinkFeedRequestRecord = LinkFeedRequest & {
	answered: boolean;
	/** The alert exactly as the daemon first received it, for a replay after a reconnect. */
	message: LinkFeedEventMessage;
};

/**
 * The approval and input requests announced to the daemon: one alert per request id, and at most
 * one decision per alert, so a lock-screen tap can only ever answer what the machine reported.
 */
export class LinkFeedRequests {
	private readonly entries = new BoundedMap<string, LinkFeedRequestRecord>({
		maxEntries: MAX_TRACKED_REQUESTS,
		ttlMs: REQUEST_TTL_MS,
		touchOnGet: false,
	});

	constructor() {
		registerSweepable({
			name: "link-feed-requests",
			sweep: (now) => this.entries.sweep(now),
			size: () => this.entries.size,
			limit: () => MAX_TRACKED_REQUESTS,
		});
	}

	/** False when this request id was already announced, so its alert is not repeated. */
	announce(
		backend: string,
		session: string,
		request: string,
		at: LinkFeedRequest,
		message: LinkFeedEventMessage,
	): boolean {
		const key = requestKey(backend, session, request);
		if (this.entries.has(key)) return false;
		this.entries.set(key, { ...at, answered: false, message });
		return true;
	}

	/** Every alert still outstanding, oldest first, for a feed that has just attached. */
	pending(): LinkFeedEventMessage[] {
		const messages: LinkFeedEventMessage[] = [];
		for (const key of this.entries.keys()) {
			const record = this.entries.get(key);
			if (record && !record.answered) messages.push(record.message);
		}
		return messages;
	}

	/** The record a decision refers to, or undefined when the daemon was never told about it. */
	find(backend: string, session: string, request: string): LinkFeedRequestRecord | undefined {
		return this.entries.get(requestKey(backend, session, request));
	}

	/** Closes a request to further decisions; a repeat is refused rather than applied twice. */
	markAnswered(backend: string, session: string, request: string): void {
		const key = requestKey(backend, session, request);
		const record = this.entries.get(key);
		if (record) this.entries.set(key, { ...record, answered: true });
	}

	reset(): void {
		this.entries.clear();
	}
}

function requestKey(backend: string, session: string, request: string): string {
	return `${backend}::${session}::${request}`;
}
