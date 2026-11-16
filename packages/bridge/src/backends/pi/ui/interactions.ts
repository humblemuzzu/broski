/**
 * One hosted session's pending asks: each becomes an `Interaction` in the live state, waits for a human, the end Pi
 * gives the dialog itself, the run's abort or the bridge's shutdown, and resolves exactly once. Nothing here answers
 * for the human: a dialog's `timeout` is Pi's own, which ends the dialog in Pi with its default
 * (pi-coding-agent 1.5.2 `docs/rpc-extension-ui.md:10`), and the ask is withdrawn when it does.
 */

import {
	type ActionResult,
	answerProblem,
	type Interaction,
	type InteractionAnswer,
	type InteractionId,
	type InteractionOrigin,
	type InteractionReply,
	type InteractionRequest,
	MAX_LIST_ITEMS,
	type ResolutionReason,
	type RunId,
} from "../../../contract";
import { mintInteractionId } from "../ids";
import type { AskHost, InteractionPort, RunContext } from "../ports";
import { ACCEPTED, rejected } from "../rejections";

export interface AskSpec {
	readonly title: string;
	readonly body?: string;
	readonly request: InteractionRequest;
	readonly origin?: InteractionOrigin;
	/** The run the ask is part of, when the asker knows it (a tool call's gate); else the host attributes it. */
	readonly run?: RunContext;
	/** What `answerProblem` cannot know about a reply to this ask; a reply it faults is refused `invalid_input`. */
	readonly replyProblem?: (reply: InteractionReply) => string | undefined;
}

/** `ended`: withdrawn, expired or timed out, so the asker answers Pi with its default. */
export type AskOutcome = { readonly kind: "answered"; readonly reply: InteractionReply } | { readonly kind: "ended" };

const ENDED: AskOutcome = { kind: "ended" };

/** `setTimeout` fires at once for a delay past a signed 32-bit integer. */
const MAX_TIMER_MS = 2 ** 31 - 1;

interface Pending {
	/** Replaced when the ask outlives the run it was raised in (`endRun`). */
	interaction: Interaction;
	readonly replyProblem: AskSpec["replyProblem"];
	readonly settle: (outcome: AskOutcome) => void;
	readonly release: () => void;
}

export class InteractionDesk implements InteractionPort {
	private readonly pending = new Map<InteractionId, Pending>();
	private readonly resolved = new Set<InteractionId>();
	private closed = false;

	constructor(private readonly host: AskHost) {}

	/**
	 * Inside a run the ask names it and blocks it; an extension command's ask does neither (`AskHost.inCommand`).
	 * Otherwise the host decides which run that is (`AskHost.activeRun`), and may start one for a prompt Pi is still
	 * deciding. It ends at once, asking nobody, after `expireAll`, when `MAX_LIST_ITEMS` asks are open and when the
	 * run it would join is being aborted: the abort has withdrawn the run's asks, and one raised after that is either
	 * dropped by Pi when the abort reaches its signal or holds the abort until it is answered (`AskHost.aborting`).
	 * `piTimeoutMs` is the dialog's own `timeout`, after which Pi has answered it. `withdrawn` ends the ask when it is
	 * answered somewhere else: a terminal's own dialog that its user answered first.
	 */
	ask(spec: AskSpec, piTimeoutMs?: number, withdrawn?: AbortSignal): Promise<AskOutcome> {
		if (this.closed || this.pending.size >= MAX_LIST_ITEMS || withdrawn?.aborted) return Promise.resolve(ENDED);
		const run = spec.run ?? (this.host.inCommand() ? undefined : this.host.activeRun());
		if (run !== undefined && this.host.aborting()) return Promise.resolve(ENDED);
		const createdAt = this.host.now();
		const timeoutMs = usableTimeout(piTimeoutMs);
		const interaction: Interaction = {
			id: mintInteractionId(),
			...(run !== undefined && { runId: run.runId }),
			createdAt,
			...(timeoutMs !== undefined && { expiresAt: createdAt + timeoutMs }),
			title: spec.title,
			...(spec.body !== undefined && { body: spec.body }),
			blocksRun: run !== undefined,
			...(spec.origin !== undefined && { origin: spec.origin }),
			request: spec.request,
		};
		return new Promise((settle) => {
			const timer = timeoutMs === undefined ? undefined : setTimeout(() => end(), timeoutMs);
			const entry: Pending = {
				interaction,
				replyProblem: spec.replyProblem,
				settle,
				release: () => {
					clearTimeout(timer);
					withdrawn?.removeEventListener("abort", end);
				},
			};
			const end = () => this.finish(entry.interaction.id, ENDED, "withdrawn");
			withdrawn?.addEventListener("abort", end, { once: true });
			this.pending.set(interaction.id, entry);
			this.host.live.emit({ type: "interaction_requested", interaction });
		});
	}

	answer(answer: InteractionAnswer): ActionResult {
		const entry = this.pending.get(answer.interactionId);
		if (entry === undefined) {
			return this.resolved.has(answer.interactionId)
				? rejected("stale", "this interaction is already resolved")
				: rejected("not_found", "no such interaction");
		}
		const reply = answer.reply;
		const problem =
			answerProblem(entry.interaction, answer) ?? (reply.kind === "cancel" ? undefined : entry.replyProblem?.(reply));
		if (problem !== undefined) return rejected("invalid_input", problem);
		this.finish(answer.interactionId, { kind: "answered", reply }, "answered");
		if (reply.kind === "cancel" && reply.stopRun) this.host.abortRun();
		return ACCEPTED;
	}

	withdrawRun(runId: RunId): void {
		for (const [id, entry] of [...this.pending]) {
			if (entry.interaction.runId === runId) this.finish(id, ENDED, "withdrawn");
		}
	}

	/**
	 * The run ended. A permission ask is withdrawn: it gates one of the run's tool calls and is bound to the run's
	 * signal, which Pi has aborted, dropping the dialog without a word (`rpc-mode.js:51-82`), so no answer could reach
	 * it. Any other ask came from outside the run (an extension command, a timer) and still waits for a human: it is
	 * withdrawn from the run and raised again on its own, its extension waiting on the same answer.
	 */
	endRun(runId: RunId): void {
		for (const [id, entry] of [...this.pending]) {
			if (entry.interaction.runId !== runId) continue;
			if (entry.interaction.request.kind === "tool_permission") {
				this.finish(id, ENDED, "withdrawn");
				continue;
			}
			const { runId: _run, ...rest } = entry.interaction;
			entry.interaction = { ...rest, id: mintInteractionId(), createdAt: this.host.now(), blocksRun: false };
			this.pending.delete(id);
			this.pending.set(entry.interaction.id, entry);
			this.remember(id);
			this.host.live.emit({ type: "interaction_resolved", interactionId: id, reason: "withdrawn" });
			this.host.live.emit({ type: "interaction_requested", interaction: entry.interaction });
		}
	}

	expireAll(): void {
		this.closed = true;
		for (const id of [...this.pending.keys()]) this.finish(id, ENDED, "expired");
	}

	private finish(id: InteractionId, outcome: AskOutcome, reason: ResolutionReason): void {
		const entry = this.pending.get(id);
		if (entry === undefined) return;
		this.pending.delete(id);
		entry.release();
		this.remember(id);
		this.host.live.emit({ type: "interaction_resolved", interactionId: id, reason });
		entry.settle(outcome);
	}

	private remember(id: InteractionId): void {
		this.resolved.add(id);
		if (this.resolved.size <= MAX_LIST_ITEMS) return;
		for (const oldest of this.resolved) {
			this.resolved.delete(oldest);
			break;
		}
	}
}

/**
 * Pi starts a timer only for a positive `timeout` (pi-coding-agent 1.5.2 `dist/modes/rpc/rpc-mode.js:68-73`);
 * the contract's `expiresAt` is a whole number.
 */
function usableTimeout(timeoutMs: number | undefined): number | undefined {
	if (timeoutMs === undefined || !(timeoutMs > 0)) return undefined;
	return Math.ceil(Math.min(timeoutMs, MAX_TIMER_MS));
}
