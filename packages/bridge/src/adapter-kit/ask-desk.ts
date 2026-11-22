/**
 * An adapter's pending asks and the promises waiting on them: it mints each ask's id, emits `interaction_requested`,
 * checks every answer with `answerProblem`, lets the first answer win, and emits exactly one `interaction_resolved`
 * per ask. Nothing here answers on anyone's behalf and no timer comes with it: an ask ends only when a human answers,
 * its signal withdraws it, its run ends, or the adapter expires every ask (its backend went away).
 */

import {
	type ActionResult,
	answerProblem,
	clip,
	type Interaction,
	type InteractionAnswer,
	type InteractionId,
	type InteractionOrigin,
	type InteractionReply,
	type InteractionRequest,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type ResolutionReason,
	type RunId,
	type SinkRecord,
	type Timestamp,
} from "../contract";

/** Resolved asks remembered so a late answer is told `stale`, not `not_found`. */
const RESOLVED_MEMORY = 10_000;

export type AskOutcome =
	| { readonly kind: "answered"; readonly reply: InteractionReply }
	| { readonly kind: "ended"; readonly reason: "withdrawn" | "expired" };

export interface AskSpec {
	/** The run the ask belongs to; absent for an ask outside a run. */
	readonly runId?: RunId;
	readonly title: string;
	readonly body?: string;
	/** Whether the run waits for the answer; by default, whenever the ask belongs to a run. */
	readonly blocksRun?: boolean;
	/** The backend's own deadline, shown, never acted on. */
	readonly expiresAt?: Timestamp;
	readonly origin?: InteractionOrigin;
	readonly request: InteractionRequest;
	/** Aborted when the backend gives the ask up: it ends `withdrawn`. */
	readonly signal?: AbortSignal;
}

export interface AskDeskOptions {
	/** The session's sink; it never throws. */
	readonly emit: (record: SinkRecord) => void;
	/** Called when an answer ends the run (`cancel{stopRun}`, or a permission option that `stopsRun`). */
	readonly stopRun: () => void;
	readonly now?: () => number;
	readonly newId?: () => InteractionId;
}

export interface AskDesk {
	ask(spec: AskSpec): Promise<AskOutcome>;
	/** For `SessionControl.answer` and `OpenSession.answer`. */
	answer(answer: InteractionAnswer): ActionResult;
	/** The asks still waiting, oldest first, for the session's snapshot. */
	pending(): Interaction[];
	/** The run ended: its blocking asks are withdrawn, which must happen before its `run_finished`. */
	withdrawRun(runId: RunId): void;
	/** Nothing can answer any more (the backend went away, the session closed): every ask expires. */
	expireAll(): void;
}

const WITHDRAWN: AskOutcome = { kind: "ended", reason: "withdrawn" };

interface Waiting {
	readonly interaction: Interaction;
	readonly settle: (outcome: AskOutcome) => void;
}

export function createAskDesk(options: AskDeskOptions): AskDesk {
	return new Desk(options);
}

class Desk implements AskDesk {
	private readonly now: () => number;
	private readonly newId: () => InteractionId;
	private readonly waiting = new Map<InteractionId, Waiting>();
	private readonly resolved = new Set<InteractionId>();

	constructor(private readonly options: AskDeskOptions) {
		this.now = options.now ?? Date.now;
		this.newId = options.newId ?? (() => crypto.randomUUID());
	}

	ask(spec: AskSpec): Promise<AskOutcome> {
		if (spec.signal?.aborted) return Promise.resolve(WITHDRAWN);
		const interaction = interactionOf(this.newId(), this.now(), spec);
		const { promise, resolve } = Promise.withResolvers<AskOutcome>();
		const withdraw = () => this.end(interaction.id, "withdrawn", WITHDRAWN);
		spec.signal?.addEventListener("abort", withdraw, { once: true });
		this.waiting.set(interaction.id, {
			interaction,
			settle: (outcome) => {
				spec.signal?.removeEventListener("abort", withdraw);
				resolve(outcome);
			},
		});
		this.options.emit({ at: interaction.createdAt, event: { type: "interaction_requested", interaction } });
		return promise;
	}

	answer(answer: InteractionAnswer): ActionResult {
		const ask = this.waiting.get(answer.interactionId);
		if (!ask) {
			return this.resolved.has(answer.interactionId)
				? rejected("stale", "this interaction is already resolved")
				: rejected("not_found", `no interaction ${answer.interactionId} is pending`);
		}
		const problem = answerProblem(ask.interaction, answer);
		if (problem !== undefined) return rejected("invalid_input", problem);
		this.end(ask.interaction.id, "answered", { kind: "answered", reply: answer.reply });
		if (replyStopsRun(ask.interaction.request, answer.reply)) this.options.stopRun();
		return { status: "accepted" };
	}

	pending(): Interaction[] {
		return [...this.waiting.values()].map((ask) => ask.interaction);
	}

	withdrawRun(runId: RunId): void {
		for (const { interaction } of [...this.waiting.values()]) {
			if (interaction.blocksRun && interaction.runId === runId) this.end(interaction.id, "withdrawn", WITHDRAWN);
		}
	}

	expireAll(): void {
		for (const id of [...this.waiting.keys()]) this.end(id, "expired", { kind: "ended", reason: "expired" });
	}

	private end(id: InteractionId, reason: ResolutionReason, outcome: AskOutcome): void {
		const ask = this.waiting.get(id);
		if (!ask) return;
		this.waiting.delete(id);
		this.resolved.add(id);
		for (const oldest of this.resolved) {
			if (this.resolved.size <= RESOLVED_MEMORY) break;
			this.resolved.delete(oldest);
		}
		this.options.emit({ at: this.now(), event: { type: "interaction_resolved", interactionId: id, reason } });
		ask.settle(outcome);
	}
}

function interactionOf(id: InteractionId, createdAt: number, spec: AskSpec): Interaction {
	return {
		id,
		...(spec.runId !== undefined && { runId: spec.runId }),
		createdAt,
		...(spec.expiresAt !== undefined && { expiresAt: spec.expiresAt }),
		title: clip(spec.title, MAX_NAME_CHARS),
		...(spec.body !== undefined && { body: clip(spec.body, MAX_TEXT_CHARS) }),
		blocksRun: spec.runId !== undefined && spec.blocksRun !== false,
		...(spec.origin !== undefined && { origin: spec.origin }),
		request: spec.request,
	};
}

/** Whether the reply ends the run the ask belongs to. */
export function replyStopsRun(request: InteractionRequest, reply: InteractionReply): boolean {
	if (reply.kind === "cancel") return reply.stopRun;
	if (reply.kind !== "tool_permission" || request.kind !== "tool_permission") return false;
	return request.options.some((option) => option.id === reply.optionId && option.stopsRun);
}

function rejected(code: "stale" | "not_found" | "invalid_input", message: string): ActionResult {
	return { status: "rejected", rejection: { code, message } };
}
