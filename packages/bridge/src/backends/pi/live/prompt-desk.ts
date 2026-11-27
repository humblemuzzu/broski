/**
 * Prompts into Pi: mode routing on the adapter's own run, the disposition Pi answers with, idempotency per
 * `clientRequestId`, and the record the transcript names a prompt's user message by. A prompt is sent as the terminal
 * sends what is typed: every mode is a `prompt` (an idle `steer` or `follow_up` would start nothing), and text that
 * begins with a command's name runs that command, as it does in Pi (`docs/rpc-commands.md:20-33`).
 */

import type { LiveState } from "../../../adapter-kit/live-state";
import { CLOSED, rejected } from "../../../adapter-kit/rejections";
import { type ClientRequestId, MAX_LIST_ITEMS, type PromptInput, type PromptResult } from "../../../contract";
import type { PromptRecord } from "../broski-entries";
import { commandText, type PiCommandRef } from "../command-ids";
import { offersCommand } from "../commands";
import { contentText, type UserContent } from "../messages";
import type { RunContext } from "../ports";
import type { PiModel } from "../rpc/replies";
import { noticeEvent } from "./live-notes";
import type { PiChild } from "./pi-child";
import { PiPrompt, type PiPromptHost } from "./pi-prompt";
import { commandOf, imageNames, inputProblem, piImages } from "./prompt-input";
import type { QueueMirror } from "./queue-mirror";
import type { RunTracker } from "./run-tracker";

/** Accepted prompts remembered per hosted session; the core's ledger covers older ones (core README §8). */
const REMEMBERED_PROMPTS = 1_000;

export interface PromptDeskDeps {
	readonly child: PiChild;
	readonly runs: RunTracker;
	readonly queue: QueueMirror;
	readonly live: LiveState;
	/** The session's model now. */
	readonly model: () => PiModel | undefined;
	/** Where the transcript stops while a run this desk starts is on. */
	readonly leafId: () => string | null;
	/** The host's abort path, for an abort that arrived before the run it was meant for existed. */
	readonly abort: () => void;
}

const HANDLED: PromptResult = { status: "accepted", disposition: "handled" };

export class PromptDesk {
	private readonly accepted = new Map<ClientRequestId, PromptResult>();
	private awaitingStart: PromptRecord | undefined;
	private deciding = false;
	private abortedWhileDeciding = false;
	private closed = false;
	private commandsRunning = 0;
	private readonly closing = Promise.withResolvers<PromptResult>();
	/** The prompt Pi has not decided yet. */
	private pending: PiPrompt | undefined;

	constructor(private readonly deps: PromptDeskDeps) {}

	get isDeciding(): boolean {
		return this.deciding;
	}

	/** An extension command the phone sent is still running. */
	get inCommand(): boolean {
		return this.commandsRunning > 0;
	}

	/** Called under the session lock; resolves once Pi has decided the disposition, never at the run's end. */
	async prompt(input: PromptInput): Promise<PromptResult> {
		const known = this.accepted.get(input.clientRequestId);
		if (known) return known;
		this.deciding = true;
		this.abortedWhileDeciding = false;
		try {
			const result = await Promise.race([this.decide(input), this.closing.promise]);
			if (result.status === "accepted") this.remember(input.clientRequestId, result);
			return result;
		} finally {
			this.deciding = false;
		}
	}

	/** An abort that finds no run while a prompt is being decided belongs to the run that prompt may start. */
	noteAbort(): void {
		if (this.deciding) this.abortedWhileDeciding = true;
	}

	/**
	 * Pi is still deciding a prompt sent while idle, but a human is being asked about it or a compaction has begun
	 * before it: the run starts now and the prompt is answered `started`, so neither waits on the request deadline.
	 * Undefined when no such prompt is pending, or an abort already asked to stop it.
	 */
	startEarly(): RunContext | undefined {
		if (this.abortedWhileDeciding || this.deps.runs.current()) return undefined;
		return this.pending?.startEarly();
	}

	/** The host is ending: a prompt still being decided answers `closed`. */
	close(): void {
		this.closed = true;
		this.closing.resolve(CLOSED);
	}

	/** The record of the user message Pi just ended, by the prompt that started the run or the queue it came out of. */
	claim(content: UserContent): PromptRecord | undefined {
		const stored = typeof content === "string" ? 0 : content.filter((block) => block.type === "image").length;
		const own = this.awaitingStart;
		if (own) {
			this.awaitingStart = undefined;
			return namesFor(own.clientRequestId, own.imageNames, stored);
		}
		const held = this.deps.queue.takeDelivered(contentText(content, ""));
		const clientRequestId = held?.item.clientRequestId;
		return held && clientRequestId ? namesFor(clientRequestId, held.imageNames, stored) : undefined;
	}

	/** The run ended: no user message of it is still to come. */
	endRun(): void {
		this.awaitingStart = undefined;
	}

	private async decide(input: PromptInput): Promise<PromptResult> {
		const problem = inputProblem(input, this.deps.model());
		if (problem) return problem;
		const ref = commandOf(input);
		if (ref !== undefined) {
			const commands = await this.deps.child.commands();
			if (!commands.ok) return rejected("backend_error", `Pi could not list its commands: ${commands.error}`);
			if (!offersCommand(commands.data, ref)) return rejected("not_found", `no command ${input.command}`);
			if (ref.source === "extension") return this.runExtensionCommand(ref, input);
		}
		return this.route(input, ref === undefined ? input.text : commandText(ref, input.text));
	}

	/**
	 * Pi runs an extension command at once, even mid-run, and answers `handled` only once it returns, which may wait for
	 * a human (`docs/rpc-commands.md:31`); the phone is answered at once, and a failure is a notice.
	 */
	private runExtensionCommand(ref: PiCommandRef, input: PromptInput): PromptResult {
		this.commandsRunning += 1;
		void this.deps.child.prompt(commandText(ref, input.text), []).then((answer) => {
			this.commandsRunning -= 1;
			if (!answer.ok) this.deps.live.emit(noticeEvent("error", `/${ref.name} failed: ${answer.error}`));
		});
		return HANDLED;
	}

	private route(input: PromptInput, text: string): Promise<PromptResult> | PromptResult {
		const { runs, queue } = this.deps;
		const run = runs.current();
		if (run && this.pending) return rejected("busy", "the prompt before this one is waiting to start");
		if (runs.compacting) return rejected("busy", "a compaction is under way");
		if (run && input.mode === "start") return rejected("busy", "a run is active");
		if (input.mode !== "start" && queue.size >= MAX_LIST_ITEMS) return rejected("busy", "the queue is full");
		const call = new PiPrompt(this.callHost(input), { input, text, images: piImages(input), idle: run === undefined });
		this.pending = call;
		void call.decided.then(() => {
			if (this.pending === call) this.pending = undefined;
		});
		call.send();
		return call.answer;
	}

	private callHost(input: PromptInput): PiPromptHost {
		const { child, runs, queue, live } = this.deps;
		return {
			child,
			runs,
			queue,
			live,
			closed: () => this.closed,
			begin: () => {
				const run = runs.start("prompt", this.deps.leafId());
				this.awaitingStart = { clientRequestId: input.clientRequestId, imageNames: imageNames(input) };
				return run;
			},
			abortIfAsked: () => {
				if (!this.abortedWhileDeciding && !runs.aborting) return;
				runs.noteAbort();
				this.deps.abort();
			},
			forgetStart: () => {
				this.awaitingStart = undefined;
			},
		};
	}

	private remember(id: ClientRequestId, result: PromptResult): void {
		this.accepted.set(id, result);
		if (this.accepted.size > REMEMBERED_PROMPTS) {
			const oldest = this.accepted.keys().next();
			if (!oldest.done) this.accepted.delete(oldest.value);
		}
	}
}

/** Pi drops an image it cannot process, so names that no longer line up with the stored images are all unknown. */
function namesFor(
	clientRequestId: ClientRequestId,
	imageNames: readonly (string | null)[],
	stored: number,
): PromptRecord {
	return {
		clientRequestId,
		imageNames: imageNames.length === stored ? imageNames : Array.from({ length: stored }, () => null),
	};
}
