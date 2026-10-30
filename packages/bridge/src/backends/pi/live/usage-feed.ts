/**
 * A hosted session's `usage_updated` (D10). Pi emits no usage event, so its totals are pulled where they change: as
 * the session opens, after each assistant message, after a compaction and a model switch, and at a run's end
 * (contract README §7, "pull after `message_end`"). An unchanged figure is not sent again.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Usage } from "../../../contract";
import { usageOf } from "../mapping/usage";
import { faultEvent } from "./live-notes";
import type { LiveState } from "./live-state";

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
	constructor(
		private readonly session: () => AgentSession,
		private readonly live: LiveState,
	) {}

	refresh(): void {
		let usage: Usage;
		try {
			const stats = this.session().getSessionStats();
			usage = usageOf(stats, stats.contextUsage);
		} catch (error) {
			this.live.emit(faultEvent(error));
			return;
		}
		const known = this.live.snapshot().usage;
		if (known !== undefined && FIELDS.every((field) => known[field] === usage[field])) return;
		this.live.emit({ type: "usage_updated", usage });
	}
}
