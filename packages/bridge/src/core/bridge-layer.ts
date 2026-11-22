import type { Interaction, QueueItem, SessionSnapshot, SinkRecord } from "../contract";
import type { CacheClock } from "./cache-clock";
import type { ExternalInteractions } from "./external-interactions";
import type { LiveSession, StateLayer } from "./live-session";
import type { SessionExtras } from "./session-extras";

/**
 * The bridge's own state on top of each adapter's: the asks it raised, the prompts it queued, and the cache window.
 * Every snapshot phones get passes through `onto`, the attach's reconcile included, so an adapter that knows nothing
 * of them is never resynced for leaving them out.
 */
export class BridgeLayer implements StateLayer {
	constructor(
		private readonly cache: CacheClock,
		private readonly externals: ExternalInteractions,
	) {}

	adopt(live: LiveSession, snapshot: SessionSnapshot): void {
		this.cache.adopt(live.key, snapshot);
		live.extras.adapterQueue = adapterItems(snapshot.queue, live.extras);
	}

	onto(live: LiveSession, snapshot: SessionSnapshot): SessionSnapshot {
		const own: SessionSnapshot = {
			...snapshot,
			interactions: withAsks(snapshot.interactions, live.extras, live.snapshot.interactions),
			queue: withQueued(snapshot.queue, live.extras),
		};
		return this.cache.onto(live.key, own, live.snapshot.usage?.cache);
	}

	enrich(live: LiveSession, record: SinkRecord): SinkRecord {
		const { event } = record;
		switch (event.type) {
			case "usage_updated":
				return { ...record, event: { ...event, usage: this.cache.usage(live.key, event.usage, live.snapshot.usage) } };
			case "queue_changed":
				live.extras.adapterQueue = adapterItems(event.items, live.extras);
				return { ...record, event: { ...event, items: withQueued(event.items, live.extras) } };
			case "resynced":
				this.adopt(live, event.snapshot);
				return { ...record, event: { ...event, snapshot: this.onto(live, event.snapshot) } };
			case "run_finished":
				this.externals.runEnding(live, event.runId);
				return record;
			default:
				return record;
		}
	}
}

/**
 * The adapter's asks and the bridge's together, in the order the stream raised them (`reference`, the live state's),
 * any the live state does not hold yet after them in the order given.
 */
function withAsks(
	adapter: readonly Interaction[],
	extras: SessionExtras,
	reference: readonly Interaction[],
): Interaction[] {
	if (extras.asks.size === 0) return [...adapter];
	const own = [...extras.asks.values()].map((ask) => ask.interaction);
	const all = [...adapter.filter((interaction) => !extras.asks.has(interaction.id)), ...own];
	const rank = new Map(reference.map((interaction, index) => [interaction.id, index]));
	return all
		.map((interaction, index) => ({ interaction, at: rank.get(interaction.id) ?? reference.length + index }))
		.sort((a, b) => a.at - b.at)
		.map(({ interaction }) => interaction);
}

/** The adapter's queue, then the bridge's. */
function withQueued(adapter: readonly QueueItem[], extras: SessionExtras): QueueItem[] {
	return [...adapterItems(adapter, extras), ...extras.queued.map(({ item }) => item)];
}

/** The items of `queue` the adapter holds, not the bridge. */
function adapterItems(queue: readonly QueueItem[], extras: SessionExtras): QueueItem[] {
	const own = new Set(extras.queued.map(({ item }) => item.id));
	return queue.filter((item) => !own.has(item.id));
}
