/**
 * One prompt sent to Pi, from the command until Pi decides what it did with it, and the answer the phone gets. Pi
 * answers a `prompt` once it has decided (`started`, `queued` or `handled`, pi-coding-agent 1.5.2
 * `docs/rpc-commands.md:7-42`): after the extensions' `input` handlers and, for a run, after a pre-prompt compaction
 * and the `before_agent_start` handlers (`dist/core/agent-session.js:1695-1778, 1544-1550`). Any of them can take as
 * long as a human or a model request does. A prompt sent while idle is therefore answered `started` early when one of
 * them asks a human or a compaction begins, and the run it started ends on its own if Pi then does not run it.
 */

import type { LiveState } from "../../../adapter-kit/live-state";
import type { PromptInput, PromptResult, RunOutcome } from "../../../contract";
import type { ImageContent } from "../messages";
import type { RunContext } from "../ports";
import type { PromptDisposition } from "../rpc/replies";
import type { PiChild } from "./pi-child";
import { promptRejection } from "./prompt-errors";
import { imageNames } from "./prompt-input";
import type { QueueMirror } from "./queue-mirror";
import type { RunTracker } from "./run-tracker";

export interface PiPromptHost {
	readonly child: PiChild;
	readonly runs: RunTracker;
	readonly queue: QueueMirror;
	readonly live: LiveState;
	/** The host is ending: what Pi decides from now on is not answered. */
	closed(): boolean;
	/** Starts the adapter's run for this prompt, whose user message is the next one Pi ends. */
	begin(): RunContext;
	/** Pi started the run: abort it now when the human asked to stop it before it existed. */
	abortIfAsked(): void;
	/** The prompt the adapter started a run for went into Pi's queue instead. */
	forgetStart(): void;
}

export interface PiPromptCall {
	readonly input: PromptInput;
	/** As Pi is given it: a command's `/name args`, otherwise the human's text. */
	readonly text: string;
	readonly images: readonly ImageContent[];
	/** No run was active when Pi was sent the prompt, so `started` starts a new one. */
	readonly idle: boolean;
}

const STARTED: PromptResult = { status: "accepted", disposition: "started" };
const HANDLED: PromptResult = { status: "accepted", disposition: "handled" };

export class PiPrompt {
	/** What the phone is told: Pi's disposition, or `started` once the run started early. */
	readonly answer: Promise<PromptResult>;
	/** Settles once Pi has decided, or failed to. */
	readonly decided: Promise<void>;
	private readonly answering = Promise.withResolvers<PromptResult>();
	private readonly deciding = Promise.withResolvers<void>();
	private answered = false;
	private early = false;
	private piDecided = false;

	constructor(
		private readonly host: PiPromptHost,
		private readonly call: PiPromptCall,
	) {
		this.answer = this.answering.promise;
		this.decided = this.deciding.promise;
	}

	/** The run starts before Pi has decided (module comment); undefined when the answer has gone out already. */
	startEarly(): RunContext | undefined {
		if (this.answered || this.piDecided || !this.call.idle) return undefined;
		const run = this.host.begin();
		this.early = true;
		this.answerWith(STARTED);
		return run;
	}

	/** Sends the prompt; Pi's answer is read in its place among the session's events (`rpc/client.ts`). */
	send(): void {
		const { input, text, images } = this.call;
		const streamingBehavior = input.mode === "steer" ? "steer" : input.mode === "queue" ? "followUp" : undefined;
		void this.host.child.prompt(text, images, streamingBehavior).then((answer) => {
			if (answer.ok) this.onDisposition(answer.data);
			else this.onFailed(answer.error);
		});
	}

	private onDisposition(disposition: PromptDisposition): void {
		if (!this.markDecided() || this.host.closed()) return;
		switch (disposition) {
			case "handled":
				if (this.early) this.endEarlyRun(this.host.runs.aborting ? { kind: "aborted" } : { kind: "completed" });
				else this.answerWith(HANDLED);
				return;
			case "queued":
				if (this.early) this.host.forgetStart();
				this.answerWith(this.queued());
				return;
			case "started":
				if (!this.early) this.host.begin();
				this.host.abortIfAsked();
				this.answerWith(STARTED);
		}
	}

	private onFailed(error: string): void {
		if (!this.markDecided() || this.host.closed()) return;
		const refusal = promptRejection(error);
		if (!this.early) {
			this.answerWith(refusal);
			return;
		}
		const { code } = refusal.rejection;
		this.endEarlyRun({
			kind: "error",
			error: {
				code: code === "auth" ? "auth" : code === "no_model" ? "model_unavailable" : "unknown",
				message: refusal.rejection.message,
			},
		});
	}

	/** Pi announced the queue as it took the input (`queue_update` comes before the answer), with the text it queued. */
	private queued(): PromptResult {
		const { queue } = this.host;
		const { input, text } = this.call;
		const steering = input.mode === "steer";
		const pending = steering ? queue.pi.steering : queue.pi.followUp;
		const item = queue.enqueue(
			steering ? "steer" : "queue",
			{ text: pending.at(-1) ?? text, preview: text, imageNames: imageNames(input) },
			input.clientRequestId,
		);
		queue.reconcile(queue.pi);
		return { status: "accepted", disposition: steering ? "steered" : "queued", queueItemId: item.id };
	}

	/** The run started early ends without Pi having run it: Pi handled the prompt otherwise, or refused it. */
	private endEarlyRun(outcome: RunOutcome): void {
		this.host.forgetStart();
		this.host.runs.end(outcome);
	}

	/** True the first time; Pi decides once. */
	private markDecided(): boolean {
		if (this.piDecided) return false;
		this.piDecided = true;
		this.deciding.resolve();
		return true;
	}

	private answerWith(result: PromptResult): void {
		if (this.answered) return;
		this.answered = true;
		this.answering.resolve(result);
	}
}
