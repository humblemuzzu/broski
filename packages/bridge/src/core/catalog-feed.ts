import { type BackendId, CatalogEvent } from "../contract";
import type { CoreClient } from "./client";
import type { CoreLog } from "./ports";
import type { SessionHub } from "./session-hub";
import { fitMessage } from "./wire-fit";

/**
 * Backend-wide news, from an adapter's catalog sink to every client that said `hello`, viewing a
 * session or not. A deleted session's stream ends here too. Like a session sink, it never throws
 * into the adapter.
 */
export class CatalogFeed {
	constructor(
		private readonly clients: ReadonlySet<CoreClient>,
		private readonly hub: SessionHub,
		private readonly maxFrameBytes: number,
		private readonly log: CoreLog,
	) {}

	publish(backend: BackendId, event: CatalogEvent): void {
		try {
			this.fanOut(backend, event);
		} catch (error) {
			this.log.error(`[core] a ${backend} catalog event failed in the core: ${String(error)}`);
		}
	}

	private fanOut(backend: BackendId, event: CatalogEvent): void {
		const checked = CatalogEvent.safeParse(event);
		if (!checked.success) {
			this.log.error(`[core] dropped a ${backend} catalog event that breaks the contract: ${checked.error.message}`);
			return;
		}
		const frame = fitMessage({ type: "catalog", backend, event }, this.maxFrameBytes, this.log);
		if (frame) {
			for (const client of this.clients) if (client.negotiated) client.send(frame);
		} else {
			this.log.error(`[core] dropped a ${backend} ${event.type} catalog event too large for the link`);
		}
		if (event.type === "session_removed") this.hub.remove(event.session);
	}
}
