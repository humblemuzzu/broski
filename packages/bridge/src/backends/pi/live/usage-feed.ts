/**
 * A hosted session's `usage_updated`. Pi emits no usage event, so its totals are asked for (`get_session_stats`) where
 * they change: as the session opens, after each assistant message, after a compaction and a model switch, and at a
 * run's end (contract README §7, "pull after `message_end`"). The cache window is the latest assistant message's own,
 * kept until a later request touches the cache. An unchanged figure is not sent again; asks made while one is out
 * share its answer's turn.
 */

import type { CacheWindow, Usage } from "../../../contract";
import { cacheWindowOf, usageOf } from "../mapping/usage";
import type { AssistantMessage } from "../messages";
import { faultEvent } from "./live-notes";
import type { LiveState } from "./live-state";
import type { PiChild } from "./pi-child";

const FIELDS: readonly (keyof Usage)[] = [
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"reasoningTokens",
	"costUsd",
	"contextTokens",
	"contextWindow",
];

const CACHE_FIELDS: readonly (keyof CacheWindow)[] = [
	"lastTouchAt",
	"ttlMs",
	"confidence",
	"cachedTokens",
	"promptTokens",
];

function sameCache(known: CacheWindow | undefined, next: CacheWindow | undefined): boolean {
	if (known === undefined || next === undefined) return known === next;
	return CACHE_FIELDS.every((field) => known[field] === next[field]);
}

export class UsageFeed {
	private asking = false;
	private again = false;
	private cache: CacheWindow | undefined;

	constructor(
		private readonly child: PiChild,
		private readonly live: LiveState,
	) {}

	/** Asked for and shown before the caller goes on: the totals a session opens with, or those a run ends with. */
	async pull(): Promise<void> {
		const answer = await this.child.stats();
		if (answer.ok) this.show(usageOf(answer.data, this.cache));
	}

	/** `latest`: the assistant message that just ended. */
	refresh(latest?: AssistantMessage): void {
		if (latest !== undefined) this.cache = cacheWindowOf(latest, this.cache) ?? this.cache;
		if (this.asking) {
			this.again = true;
			return;
		}
		this.asking = true;
		void this.child.stats().then((answer) => {
			this.asking = false;
			if (answer.ok) this.show(usageOf(answer.data, this.cache));
			else if (this.child.running) this.live.emit(faultEvent(answer.error));
			if (this.again) {
				this.again = false;
				this.refresh();
			}
		});
	}

	private show(usage: Usage): void {
		const known = this.live.snapshot().usage;
		const unchanged = known !== undefined && FIELDS.every((field) => known[field] === usage[field]);
		if (unchanged && sameCache(known.cache, usage.cache)) return;
		this.live.emit({ type: "usage_updated", usage });
	}
}
