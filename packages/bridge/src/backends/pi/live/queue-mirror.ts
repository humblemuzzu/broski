/**
 * The adapter's own queue: the steer and queue input it handed Pi, with ids it minted, kept in step with Pi's
 * `queue_update`, which carries text only (pi-coding-agent 1.5.2 `docs/json.md:117-121`).
 */

import type { LiveState } from "../../../adapter-kit/live-state";
import {
	type ClientRequestId,
	MAX_LIST_ITEMS,
	MAX_TEXT_CHARS,
	type QueuedDelivery,
	type QueueItem,
} from "../../../contract";
import { clipStart } from "../bounds";
import { mintQueueItemId } from "../ids";

/** What Pi holds of the queue now: its two lists of queued texts. */
export interface PiQueue {
	readonly steering: readonly string[];
	readonly followUp: readonly string[];
}

/** One queued input and what the transcript will record when Pi delivers it. */
export interface HeldInput {
	readonly item: QueueItem;
	/** The text Pi queued (a command's expansion), which Pi matches deliveries by. */
	readonly text: string;
	readonly imageNames: readonly (string | null)[];
}

export class QueueMirror {
	private steering: HeldInput[] = [];
	private followUp: HeldInput[] = [];
	private delivering: HeldInput[] = [];
	/** Pi's two queues as its latest `queue_update` said. */
	pi: PiQueue = { steering: [], followUp: [] };

	constructor(private readonly live: LiveState) {}

	get size(): number {
		return this.steering.length + this.followUp.length;
	}

	/** Emits `queue_changed`. `text` is what Pi queued; `preview` is what the human typed. */
	enqueue(
		delivery: QueuedDelivery,
		input: { readonly text: string; readonly preview: string; readonly imageNames: readonly (string | null)[] },
		clientRequestId: ClientRequestId,
	): QueueItem {
		const item: QueueItem = {
			id: mintQueueItemId(),
			delivery,
			preview: clipStart(input.preview, MAX_TEXT_CHARS),
			clientRequestId,
		};
		const held: HeldInput = { item, text: input.text, imageNames: input.imageNames };
		if (delivery === "steer") this.steering.push(held);
		else this.followUp.push(held);
		this.emit();
		return item;
	}

	/**
	 * Drops the items Pi no longer holds into the delivery list. Pi removes the first text-equal entry
	 * (pi-coding-agent 1.5.2 `dist/core/agent-session.js:786-802`), so of equal texts the newest survive.
	 */
	reconcile(pi: PiQueue): void {
		this.pi = pi;
		const steering = this.keepHeld(this.steering, pi.steering);
		const followUp = this.keepHeld(this.followUp, pi.followUp);
		if (steering.length === this.steering.length && followUp.length === this.followUp.length) return;
		this.steering = steering;
		this.followUp = followUp;
		this.emit();
	}

	/** The input a delivered user message came from, taken when Pi removed it from its queue. */
	takeDelivered(text: string): HeldInput | undefined {
		const index = this.delivering.findIndex((held) => held.text === text);
		if (index < 0) return undefined;
		return this.delivering.splice(index, 1)[0];
	}

	/** A run ended: whatever was taken out of Pi's queue and never delivered will not be. */
	forgetDelivering(): void {
		this.delivering = [];
	}

	private keepHeld(held: HeldInput[], piTexts: readonly string[]): HeldInput[] {
		const remaining = new Map<string, number>();
		for (const text of piTexts) remaining.set(text, (remaining.get(text) ?? 0) + 1);
		const kept: HeldInput[] = [];
		const dropped: HeldInput[] = [];
		for (let index = held.length - 1; index >= 0; index--) {
			const input = held[index];
			if (input === undefined) continue;
			const left = remaining.get(input.text) ?? 0;
			if (left > 0) {
				remaining.set(input.text, left - 1);
				kept.unshift(input);
			} else {
				dropped.unshift(input);
			}
		}
		this.delivering.push(...dropped);
		if (this.delivering.length > MAX_LIST_ITEMS) this.delivering.splice(0, this.delivering.length - MAX_LIST_ITEMS);
		return kept;
	}

	private emit(): void {
		this.live.emit({ type: "queue_changed", items: [...this.steering, ...this.followUp].map((held) => held.item) });
	}
}
