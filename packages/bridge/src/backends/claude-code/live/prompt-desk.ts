/** Prompts: `start`, `steer` (`priority: "next"`), `queue` (D9), human-stamped with uuid = clientRequestId (D10). */

import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	ActionResult,
	ClientRequestId,
	PromptInput,
	PromptResult,
	Rejected,
	RunTrigger,
	SessionId,
} from "../../../contract";
import { imageAttachmentId, sendUuid } from "../ids";
import { base64ImageOf } from "../mapping/images";
import type { SessionEmitter } from "../ports/live";
import type { Ownership } from "../ports/store";
import { ACCEPTED, CLOSED, isRejected, rejected } from "../rejections";
import { errorText } from "./error-text";
import type { LiveImageCache } from "./image-cache";
import { type PreparedSend, userMessageOf, withPriority } from "./input";
import type { InputQueue } from "./queue";
import type { RunTracker } from "./run-tracker";

/** Accepted prompts remembered per host; the core's ledger covers older ones (core README §8). */
const REMEMBERED_PROMPTS = 1_000;

export interface PromptDeskDeps {
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly ownership: Ownership;
	readonly sessionId: () => SessionId;
	/** Tells the frame mapper this send's uuid is the host's own, so it emits no user message for it. */
	readonly noteSend: (uuid: string) => void;
	/** Starts the CLI process when none runs (it ended, or never started). */
	readonly ensureProcess: () => Promise<Rejected | undefined>;
	readonly push: (message: SDKUserMessage) => void;
	/** The CLI process runs, so a send reaches it. */
	readonly alive: () => boolean;
	readonly closed: () => boolean;
	readonly locked: <T>(work: () => Promise<T>) => Promise<T>;
	/** A run began: the catalogue row flips to running. */
	readonly runBegan: () => void;
	readonly images?: LiveImageCache;
}

export interface SendOptions {
	/** False for an action such as a compaction, which is a run but not something the person said. */
	readonly shown: boolean;
	/** The run is a compaction and nothing else. */
	readonly compaction?: boolean;
}

export class PromptDesk {
	private readonly accepted = new Map<ClientRequestId, Promise<PromptResult>>();

	constructor(private readonly deps: PromptDeskDeps) {}

	/** Idempotent per `clientRequestId`: a repeat of an accepted prompt gets its first result; a rejection is forgotten. */
	prompt(input: PromptInput): Promise<PromptResult> {
		const known = this.accepted.get(input.clientRequestId);
		if (known) return known;
		const attempt = this.deps
			.locked(() => this.decide(input))
			.catch((error: unknown): Rejected => rejected("backend_error", `the prompt failed: ${errorText(error)}`));
		this.accepted.set(input.clientRequestId, attempt);
		return attempt.then((result) => this.settled(input.clientRequestId, attempt, result));
	}

	/** A compaction is a run the person asked for but did not say; `busy` while a run is active. */
	compaction(text: string): Promise<ActionResult> {
		return this.deps
			.locked(async () => {
				if (this.deps.closed()) return CLOSED;
				if (this.deps.runs.current) return rejected("busy", "a run is active");
				const failure = await this.deps.ensureProcess();
				if (failure) return failure;
				if (this.deps.closed()) return CLOSED;
				if (this.deps.runs.current) return rejected("busy", "a run is active");
				const uuid = randomUUID();
				const send = userMessageOf({ clientRequestId: uuid, mode: "start", text, attachments: [] }, uuid);
				if (isRejected(send)) return send;
				this.begin(send, "prompt", { shown: false, compaction: true });
				return ACCEPTED;
			})
			.catch((error: unknown): Rejected => rejected("backend_error", `the compaction failed: ${errorText(error)}`));
	}

	/** Sends `send` now as a new run's first input, or into the running one. Synchronous: the CLI process runs. */
	begin(send: PreparedSend, trigger: RunTrigger, options: SendOptions): void {
		const { runs, live } = this.deps;
		this.record(send);
		if (!runs.current) {
			runs.start(trigger, options.compaction === true);
			this.deps.runBegan();
		}
		if (options.shown) live.emit(send.event);
		this.deps.push(send.message);
	}

	/** The run settled: the oldest queued input starts the next run. */
	dispatchNext(): boolean {
		if (!this.deps.alive()) return false;
		const send = this.deps.queue.takeNext();
		if (!send) return false;
		this.begin(send, "queue", { shown: true });
		return true;
	}

	private async decide(input: PromptInput): Promise<PromptResult> {
		const { runs, queue } = this.deps;
		if (this.deps.closed()) return CLOSED;
		const uuid = sendUuid(input.clientRequestId);
		if (uuid === undefined) return rejected("invalid_input", "the clientRequestId is not a UUID");
		const prepared = userMessageOf(input, uuid);
		if (isRejected(prepared)) return prepared;
		if (runs.current && input.mode === "start") return rejected("busy", "a run is active");
		const failure = await this.deps.ensureProcess();
		if (failure) return failure;
		if (this.deps.closed()) return CLOSED;
		const running = runs.current !== undefined;
		if (!running) {
			this.begin(prepared, "prompt", { shown: true });
			return { status: "accepted", disposition: "started" };
		}
		if (input.mode === "start") return rejected("busy", "a run is active");
		if (queue.isFull) return rejected("busy", "the queue is full");
		if (input.mode === "steer") return this.steer(withPriority(prepared, "next"), input.clientRequestId);
		const item = queue.enqueue(prepared, input.clientRequestId);
		return { status: "accepted", disposition: "queued", queueItemId: item.id };
	}

	private steer(send: PreparedSend, clientRequestId: ClientRequestId): PromptResult {
		const item = this.deps.queue.steer(send, clientRequestId);
		this.record(send);
		this.deps.push(send.message);
		return { status: "accepted", disposition: "steered", queueItemId: item.id };
	}

	private record(send: PreparedSend): void {
		this.cacheImages(send);
		this.deps.noteSend(send.uuid);
		try {
			this.deps.ownership
				.notePrompt(this.deps.sessionId(), send.uuid, {
					imageNames: send.imageNames,
				})
				.catch(() => undefined);
		} catch {
			/* the journal is a convenience: the prompt goes on without its record */
		}
	}

	private cacheImages(send: PreparedSend): void {
		const cache = this.deps.images;
		const content = send.message.message.content;
		if (cache === undefined || !Array.isArray(content)) return;
		const sessionId = this.deps.sessionId();
		let imagePosition = 0;
		content.forEach((block, blockIndex) => {
			const image = base64ImageOf(block);
			if (image === undefined) return;
			const name = send.imageNames[imagePosition];
			imagePosition += 1;
			cache.put(sessionId, imageAttachmentId(send.uuid, blockIndex), {
				mimeType: image.mimeType,
				data: image.data,
				...(name !== undefined && name !== "" && { name }),
			});
		});
	}

	private settled(id: ClientRequestId, attempt: Promise<PromptResult>, result: PromptResult): PromptResult {
		if (result.status === "rejected") {
			this.forget(id, attempt);
			return result;
		}
		if (this.accepted.size > REMEMBERED_PROMPTS) {
			const oldest = this.accepted.keys().next();
			if (!oldest.done) this.accepted.delete(oldest.value);
		}
		return result;
	}

	private forget(id: ClientRequestId, attempt: Promise<PromptResult>): void {
		if (this.accepted.get(id) === attempt) this.accepted.delete(id);
	}
}
