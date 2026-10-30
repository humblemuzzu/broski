/**
 * Prompts into Pi (D4, D5, D11, D12): mode routing on the adapter's own run, the disposition from
 * `preflightResult`, idempotency per `clientRequestId`, and the `broski.prompt` record the transcript
 * names the prompt by.
 */

import { contentText, type ImageContent, type TextContent } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type ClientRequestId, MAX_LIST_ITEMS, type PromptInput, type PromptResult } from "../../../contract";
import type { PromptRecord } from "../broski-entries";
import { commandText, type PiCommandRef } from "../command-ids";
import { errorText } from "../error-text";
import type { RunContext } from "../ports";
import { CLOSED, rejected } from "../rejections";
import type { CommandScope } from "./command-scope";
import { noticeEvent } from "./live-notes";
import type { LiveState } from "./live-state";
import { PiPrompt, type PiPromptHost } from "./pi-prompt";
import { commandOf, imageNames, inputProblem } from "./prompt-input";
import type { QueueMirror } from "./queue-mirror";
import type { RunTracker } from "./run-tracker";

/** Accepted prompts remembered per hosted session; the core's ledger covers older ones (core README §8). */
const REMEMBERED_PROMPTS = 1_000;

export interface PromptDeskDeps {
	readonly session: () => AgentSession;
	readonly runs: RunTracker;
	readonly queue: QueueMirror;
	readonly live: LiveState;
	/** The host's abort path, for an abort that arrived before the run it was meant for existed. */
	readonly abort: () => void;
	readonly commands: CommandScope;
}

const HANDLED: PromptResult = { status: "accepted", disposition: "handled" };

export class PromptDesk {
	private readonly accepted = new Map<ClientRequestId, PromptResult>();
	private awaitingStart: PromptRecord | undefined;
	private deciding = false;
	private abortedWhileDeciding = false;
	private closed = false;
	private readonly closing = Promise.withResolvers<PromptResult>();
	/** The call Pi has not decided yet. */
	private pending: PiPrompt | undefined;

	constructor(private readonly deps: PromptDeskDeps) {}

	get isDeciding(): boolean {
		return this.deciding;
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

	/** The host is ending: a prompt still being decided answers `closed` and calls Pi no more. */
	close(): void {
		this.closed = true;
		this.closing.resolve(CLOSED);
	}

	/** The record of the user message Pi just ended, by the prompt that started the run or the queue it came out of. */
	claim(content: string | readonly (TextContent | ImageContent)[]): PromptRecord | undefined {
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
		const session = this.deps.session();
		const problem = inputProblem(input, session);
		if (problem) return problem;
		const ref = commandOf(input);
		if (ref?.source === "extension") return this.runExtensionCommand(session, ref, input);
		return this.route(session, input, ref ? commandText(ref, input.text) : input.text);
	}

	/** Extension commands run at once, even mid-run; Pi reports `handled` only after the handler ends, which may wait for a human (D12). */
	private runExtensionCommand(session: AgentSession, ref: PiCommandRef, input: PromptInput): PromptResult {
		const text = commandText(ref, input.text);
		this.deps.commands
			.run(() => session.prompt(text, { expandPromptTemplates: true, source: "rpc" }))
			.catch((error: unknown) => {
				this.deps.live.emit(noticeEvent("error", `/${ref.name} failed: ${errorText(error)}`));
			});
		return HANDLED;
	}

	private async route(session: AgentSession, input: PromptInput, text: string): Promise<PromptResult> {
		for (;;) {
			const run = this.deps.runs.current();
			if (run && this.pending) return rejected("busy", "the prompt before this one is waiting to start");
			if (this.deps.runs.compacting) return rejected("busy", "a compaction is under way");
			if (this.deps.runs.shelling) return rejected("busy", "a shell command is running");
			if (run && !session.isStreaming) {
				// Pi clears `isStreaming` before `agent_settled` reaches listeners, and defers a prompt made while
				// it settles (pi `src/core/agent-session.ts:1078-1100`, `:2093-2096`): wait, then route as idle.
				await this.deps.runs.afterSettle();
				if (this.closed) return CLOSED;
				continue;
			}
			if (run && input.mode === "start") return rejected("busy", "a run is active");
			if (input.mode !== "start" && this.deps.queue.size >= MAX_LIST_ITEMS)
				return rejected("busy", "the queue is full");
			return this.callPi(session, input, text, run === undefined);
		}
	}

	private callPi(session: AgentSession, input: PromptInput, text: string, idle: boolean): Promise<PromptResult> {
		const call = new PiPrompt(this.callHost(session, input), { input, text, idle });
		this.pending = call;
		void call.decided.then(() => {
			if (this.pending === call) this.pending = undefined;
		});
		call.send();
		return call.answer;
	}

	private callHost(session: AgentSession, input: PromptInput): PiPromptHost {
		const { runs, queue, live } = this.deps;
		return {
			session,
			runs,
			queue,
			live,
			closed: () => this.closed,
			begin: () => {
				const run = runs.start("prompt", session.sessionManager.getLeafId());
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

/** Pi drops an image it cannot process (pi `src/core/agent-session.ts:2061-2081`), so names that no longer line up with the stored images are all unknown. */
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
