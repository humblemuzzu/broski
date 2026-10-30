/**
 * One prompt handed to Pi's `prompt()`, from the call until Pi decides what it did with it, and the answer
 * the phone gets. Pi decides through `preflightResult` (pi-coding-agent `src/core/agent-session.ts:2093-2172`),
 * after the extensions' `input` handlers and, for a run, after a pre-prompt compaction and the
 * `before_agent_start` handlers (`:1873-1883`, `_prepareRun` `:1926-1932`): any of them can take as long as a
 * human or a model request does. A prompt sent while idle is therefore answered `started` early when one of
 * them asks a human or a compaction begins, and the run it started ends on its own if Pi then does not run it.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PromptInput, PromptResult, RunOutcome } from "../../../contract";
import type { RunContext } from "../ports";
import { rejected } from "../rejections";
import { faultEvent } from "./live-notes";
import type { LiveState } from "./live-state";
import { promptRejection } from "./prompt-errors";
import { imageNames, piImages } from "./prompt-input";
import type { QueueMirror } from "./queue-mirror";
import type { RunTracker } from "./run-tracker";

export interface PiPromptHost {
	readonly session: AgentSession;
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
	/** No run was active when Pi was called, so `started` starts a new one. */
	readonly idle: boolean;
}

type Disposition = "started" | "queued" | "handled";

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

	/**
	 * Hands the prompt to Pi. Not called by the constructor: Pi runs the first `input` handler inside this call
	 * (`agent-session.ts:2117`, `extensions/runner.ts:1535-1545`), and a handler that asks a human at once reaches
	 * `startEarly`, which finds this call only once whoever made it has stored it.
	 */
	send(): void {
		const { session } = this.host;
		const { input, text } = this.call;
		const images = piImages(input);
		const streamingBehavior = input.mode === "steer" ? "steer" : input.mode === "queue" ? "followUp" : undefined;
		session
			.prompt(text, {
				expandPromptTemplates: input.command !== undefined,
				source: "rpc",
				...(images.length > 0 && { images }),
				...(streamingBehavior && { streamingBehavior }),
				preflightResult: (disposition) => this.onDisposition(disposition),
			})
			.then(
				() => this.onReturned(),
				(error: unknown) => this.onFailed(error),
			);
	}

	private onDisposition(disposition: Disposition): void {
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
				return;
		}
	}

	/**
	 * A prompt made while Pi settles resolves at once and runs later with this same callback (pi `:2093-2096`);
	 * when Pi is idle again and the callback never came, the deferred prompt failed.
	 */
	private onReturned(): void {
		if (this.piDecided) return;
		void this.host.session.waitForIdle().then(() => {
			if (!this.markDecided()) return;
			const failure = rejected("backend_error", "Pi did not run the prompt");
			if (this.early)
				this.endEarlyRun({ kind: "error", error: { code: "unknown", message: failure.rejection.message } });
			else this.answerWith(failure);
		});
	}

	private onFailed(error: unknown): void {
		if (!this.markDecided()) {
			this.host.live.emit(faultEvent(error));
			return;
		}
		const refusal = promptRejection(error);
		if (!this.early) {
			this.answerWith(refusal);
			return;
		}
		const code =
			refusal.rejection.code === "auth"
				? "auth"
				: refusal.rejection.code === "no_model"
					? "model_unavailable"
					: "unknown";
		this.endEarlyRun({ kind: "error", error: { code, message: refusal.rejection.message } });
	}

	private queued(): PromptResult {
		const { session, queue } = this.host;
		const { input, text } = this.call;
		const steering = input.mode === "steer";
		const pending = steering ? session.getSteeringMessages() : session.getFollowUpMessages();
		const item = queue.enqueue(
			steering ? "steer" : "queue",
			{ text: pending.at(-1) ?? text, preview: text, imageNames: imageNames(input) },
			input.clientRequestId,
		);
		queue.reconcile({ steering: session.getSteeringMessages(), followUp: session.getFollowUpMessages() });
		return { status: "accepted", disposition: steering ? "steered" : "queued", queueItemId: item.id };
	}

	/** The run started early ends without Pi having run it: Pi handled the prompt otherwise, or refused it. */
	private endEarlyRun(outcome: RunOutcome): void {
		this.host.forgetStart();
		this.host.runs.end(outcome);
	}

	/** True the first time; Pi decides once, and a decision after a failure is not Pi's. */
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
