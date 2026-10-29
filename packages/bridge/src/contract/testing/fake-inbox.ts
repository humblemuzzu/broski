import type { Attachment, AttachmentRef, ImageContent } from "../content";
import type { UserMessageEvent } from "../events";
import type { AttachmentId, ClientRequestId, QueueItemId } from "../ids";
import type { ActionResult, PromptInput, PromptResult } from "../input";
import type { QueueItem } from "../queue";
import type { DeliveredInput } from "./conformance-types";
import { rejected } from "./fake-validation";

interface PendingInput {
	readonly item: QueueItem;
	readonly input: PromptInput;
}

/** One fake session's input side: accepted prompts, the pending queue, stored images and what reached the model. */
export class FakeInbox {
	private readonly accepted = new Map<ClientRequestId, PromptResult>();
	private pending: PendingInput[] = [];
	private readonly sent = new Set<QueueItemId>();
	private readonly images = new Map<AttachmentId, ImageContent>();
	private lastDelivered: DeliveredInput | undefined;

	constructor(private readonly newId: () => string) {}

	/** The result an earlier accepted prompt with this id got. */
	acceptedResult(id: ClientRequestId): PromptResult | undefined {
		return this.accepted.get(id);
	}

	remember(id: ClientRequestId, result: PromptResult): void {
		if (result.status === "accepted") this.accepted.set(id, result);
	}

	image(id: AttachmentId): ImageContent | undefined {
		return this.images.get(id);
	}

	enqueue(input: PromptInput, delivery: QueueItem["delivery"]): QueueItem {
		const item: QueueItem = {
			id: this.newId(),
			delivery,
			preview: input.text,
			clientRequestId: input.clientRequestId,
		};
		this.pending.push({ item, input });
		return item;
	}

	queue(): QueueItem[] {
		return this.pending.map((pending) => pending.item);
	}

	takeSteers(): PromptInput[] {
		return this.take((pending) => pending.item.delivery === "steer");
	}

	takeNext(): PromptInput | undefined {
		const [next] = this.take((pending) => pending === this.pending[0]);
		return next;
	}

	/** Drops pending steers, as an ended run leaves them behind; true when there were any. */
	dropSteers(): boolean {
		const before = this.pending.length;
		this.pending = this.pending.filter((pending) => pending.item.delivery !== "steer");
		return this.pending.length !== before;
	}

	cancel(id: QueueItemId): ActionResult {
		const index = this.pending.findIndex((pending) => pending.item.id === id);
		if (index >= 0) {
			this.pending.splice(index, 1);
			return { status: "accepted" };
		}
		return this.sent.has(id) ? rejected("stale", "already delivered") : rejected("not_found", "no such queue item");
	}

	/** The input as it reaches the model, which the session emits as its user message, its images stored and named by reference. */
	deliver(messageId: string, input: PromptInput): UserMessageEvent {
		this.lastDelivered = {
			text: input.text,
			attachments: input.attachments,
			mentions: input.mentions,
			...(input.command !== undefined && { command: input.command }),
		};
		return {
			type: "user_message",
			messageId,
			text: input.text,
			attachments: input.attachments.map((attachment) => this.reference(attachment)),
			clientRequestId: input.clientRequestId,
		};
	}

	delivered(): DeliveredInput | undefined {
		return this.lastDelivered;
	}

	private reference(attachment: Attachment): AttachmentRef {
		if (attachment.kind === "file") return attachment;
		const id = this.newId();
		this.images.set(id, attachment);
		const { kind: _kind, data: _data, ...rest } = attachment;
		return { kind: "image_ref", id, ...rest };
	}

	private take(chosen: (pending: PendingInput) => boolean): PromptInput[] {
		const taken = this.pending.filter(chosen);
		this.pending = this.pending.filter((pending) => !chosen(pending));
		for (const pending of taken) this.sent.add(pending.item.id);
		return taken.map((pending) => pending.input);
	}
}
