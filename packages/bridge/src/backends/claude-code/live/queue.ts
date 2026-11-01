/**
 * The input accepted and not yet delivered to the model (D8). `pending` is the adapter's own queue: shown in
 * `queue_changed`, cancellable one by one, pushed to the CLI when the run settles. `steered` is input already pushed
 * with `priority: "next"`, which the CLI folds into the running turn at its next tool boundary; it leaves the queue when
 * the CLI reports it `started`, and a Stop that cancels it hands its text back.
 */

import {
	type ActionResult,
	type ClientRequestId,
	MAX_LIST_ITEMS,
	MAX_TEXT_CHARS,
	type QueuedDelivery,
	type QueueItem,
	type QueueItemId,
} from "../../../contract";
import { clip } from "../bounds";
import { mintQueueItemId } from "../ids";
import type { SessionEmitter } from "../ports/live";
import { ACCEPTED, rejected } from "../rejections";
import type { PreparedSend } from "./input";

export interface HeldInput {
	readonly item: QueueItem;
	readonly send: PreparedSend;
}

export class InputQueue {
	private pending: HeldInput[] = [];
	private steered: HeldInput[] = [];

	constructor(private readonly live: SessionEmitter) {}

	get size(): number {
		return this.pending.length + this.steered.length;
	}

	get isFull(): boolean {
		return this.size >= MAX_LIST_ITEMS;
	}

	/** Holds `send` for when the run settles; emits `queue_changed`. */
	enqueue(send: PreparedSend, clientRequestId: ClientRequestId): QueueItem {
		const held = this.hold("queue", send, clientRequestId);
		this.pending.push(held);
		this.emit();
		return held.item;
	}

	/** `send` was pushed to the CLI as steering; it is queued until the CLI delivers it. */
	steer(send: PreparedSend, clientRequestId: ClientRequestId): QueueItem {
		const held = this.hold("steer", send, clientRequestId);
		this.steered.push(held);
		this.emit();
		return held.item;
	}

	cancel(id: QueueItemId): ActionResult {
		const index = this.pending.findIndex((held) => held.item.id === id);
		if (index >= 0) {
			this.pending.splice(index, 1);
			this.emit();
			return ACCEPTED;
		}
		if (this.steered.some((held) => held.item.id === id)) {
			return rejected("stale", "this message was already sent to Claude Code, which folds it into the run");
		}
		return rejected("not_found", "no such queued input");
	}

	/** The oldest queued input leaves the queue to be sent now. */
	takeNext(): PreparedSend | undefined {
		const held = this.pending.shift();
		if (held) this.emit();
		return held?.send;
	}

	/** The CLI delivered (`started`) or dropped (`cancelled`) a steered send; the send, when it was steered here. */
	settleSteered(uuid: string): PreparedSend | undefined {
		const index = this.steered.findIndex((held) => held.send.uuid === uuid);
		if (index < 0) return undefined;
		const [held] = this.steered.splice(index, 1);
		this.emit();
		return held?.send;
	}

	/** Steered sends the CLI never reported delivered; the run is over, so they will not be. */
	takeSteered(): PreparedSend[] {
		const sends = this.steered.map((held) => held.send);
		this.steered = [];
		if (sends.length > 0) this.emit();
		return sends;
	}

	/** Everything not delivered, steering first, for `input_returned`; the queue is empty afterwards. */
	takeAll(): PreparedSend[] {
		const all = [...this.steered, ...this.pending].map((held) => held.send);
		this.steered = [];
		this.pending = [];
		if (all.length > 0) this.emit();
		return all;
	}

	private hold(delivery: QueuedDelivery, send: PreparedSend, clientRequestId: ClientRequestId): HeldInput {
		const item: QueueItem = {
			id: mintQueueItemId(),
			delivery,
			preview: clip(send.typedText === "" ? send.sentText : send.typedText, MAX_TEXT_CHARS),
			clientRequestId,
		};
		return { item, send };
	}

	private emit(): void {
		this.live.emit({
			type: "queue_changed",
			items: [...this.steered, ...this.pending].map((held) => held.item),
		});
	}
}
