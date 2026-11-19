import { type BackendId, CatalogEvent } from "../contract";
import type { CoreClient } from "./client";
import type { Observation } from "./observer";
import type { CoreLog } from "./ports";
import type { RunClock } from "./run-clock";
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
		private readonly runClock: RunClock,
		private readonly observation: Observation,
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
		const enriched = this.enrich(checked.data);
		const frame = fitMessage({ type: "catalog", backend, event: enriched }, this.maxFrameBytes, this.log);
		if (frame) {
			for (const client of this.clients) if (client.negotiated) client.send(frame);
		} else {
			this.log.error(`[core] dropped a ${backend} ${enriched.type} catalog event too large for the link`);
		}
		if (enriched.type === "session_removed") {
			this.runClock.remove(enriched.session);
			this.hub.remove(enriched.session);
		}
		this.observation.publishCatalog(enriched);
	}

	private enrich(event: CatalogEvent): CatalogEvent {
		if (event.type !== "session_updated") return event;
		return { ...event, summary: this.runClock.enrich(event.summary) };
	}
}
