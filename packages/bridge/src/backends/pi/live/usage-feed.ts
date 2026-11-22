/**
 * A hosted session's `usage_updated`. Pi emits no usage event, so its totals are asked for (`get_session_stats`) where
 * they change: as the session opens, after each assistant message and each request Pi sends itself, after a compaction
 * and a model switch, and at a run's end (contract README §7, "pull after `message_end`"). The cache window is the
 * latest assistant message's own, kept until a later request touches the cache. An unchanged figure is not sent again;
 * asks made while one is out share its answer's turn.
 */

import type { CacheWindow, Usage } from "../../../contract";
import { type CacheRequest, cacheWindowOf, usageOf } from "../mapping/usage";
import type { AssistantMessage } from "../messages";
import type { PiModel, PromptCache } from "../rpc/replies";
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
		/** The session's model now, whose `promptCache` says how long an entry it wrote lives. */
		private readonly model: () => PiModel | undefined,
	) {}

	/** Asked for and shown before the caller goes on: the totals a session opens with, or those a run ends with. */
	async pull(): Promise<void> {
		const answer = await this.child.stats();
		if (answer.ok) this.show(usageOf(answer.data, this.cache));
	}

	/** `latest`: the assistant message that just ended. */
	refresh(latest?: AssistantMessage): void {
		if (latest !== undefined) this.cache = cacheWindowOf(latest, this.cache, this.promptCacheOf(latest)) ?? this.cache;
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

	/**
	 * A request Pi sent itself, as its idle cache warming does (pi-coding-agent 1.5.2 `dist/core/cache-warmer.js:188`):
	 * one that touched the cache keeps the window alive from its time, with the lifetime it had, and its cost is in
	 * the totals.
	 */
	requested(request: CacheRequest): void {
		const touched = cacheWindowOf(request, this.cache, this.promptCacheOf(request));
		if (touched !== undefined) {
			this.cache = this.cache === undefined ? touched : { ...this.cache, lastTouchAt: touched.lastTouchAt };
		}
		this.refresh();
	}

	private promptCacheOf(request: CacheRequest): PromptCache | undefined {
		const model = this.model();
		return model !== undefined && model.provider === request.provider ? model.promptCache : undefined;
	}

	private show(usage: Usage): void {
		const known = this.live.snapshot().usage;
		const unchanged = known !== undefined && FIELDS.every((field) => known[field] === usage[field]);
		if (unchanged && sameCache(known.cache, usage.cache)) return;
		this.live.emit({ type: "usage_updated", usage });
	}
}
