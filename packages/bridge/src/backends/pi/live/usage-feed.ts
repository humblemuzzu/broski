/**
 * A hosted session's `usage_updated`. Pi emits no usage event, so its totals are asked for (`get_session_stats`) where
 * they change: as the session opens, after each assistant message, after a compaction and a model switch, and at a
 * run's end (contract README §7, "pull after `message_end`"). An unchanged figure is not sent again; asks made while
 * one is out share its answer's turn.
 */

import type { Usage } from "../../../contract";
import { usageOf } from "../mapping/usage";
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

export class UsageFeed {
	private asking = false;
	private again = false;

	constructor(
		private readonly child: PiChild,
		private readonly live: LiveState,
	) {}

	/** Asked for and shown before the caller goes on: the totals a session opens with, or those a run ends with. */
	async pull(): Promise<void> {
		const answer = await this.child.stats();
		if (answer.ok) this.show(usageOf(answer.data));
	}

	refresh(): void {
		if (this.asking) {
			this.again = true;
			return;
		}
		this.asking = true;
		void this.child.stats().then((answer) => {
			this.asking = false;
			if (answer.ok) this.show(usageOf(answer.data));
			else if (this.child.running) this.live.emit(faultEvent(answer.error));
			if (this.again) {
				this.again = false;
				this.refresh();
			}
		});
	}

	private show(usage: Usage): void {
		const known = this.live.snapshot().usage;
		if (known !== undefined && FIELDS.every((field) => known[field] === usage[field])) return;
		this.live.emit({ type: "usage_updated", usage });
	}
}
