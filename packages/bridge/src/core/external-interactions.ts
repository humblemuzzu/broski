import {
	type ActionResult,
	clip,
	Interaction,
	type InteractionAnswer,
	type InteractionId,
	type InteractionOrigin,
	type InteractionReply,
	type InteractionRequest,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type NoticeEvent,
	type NoticeLevel,
	type ResolutionReason,
	type RunId,
	type SessionAnswerer,
	type SessionRef,
} from "../contract";
import { settled } from "./deadline";
import type { LiveSession } from "./live-session";
import type { CoreLog } from "./ports";
import { rejected } from "./results";
import type { BridgeAsk, ExternalInteractionOutcome, SessionExtras } from "./session-extras";

export type { ExternalInteractionOutcome } from "./session-extras";

export interface ExternalInteractionSpec {
	readonly title: string;
	readonly body?: string;
	/** Whether the run waits for the answer; true by default, and only while the session has a run. */
	readonly blocksRun?: boolean;
	readonly origin?: InteractionOrigin;
	readonly request: InteractionRequest;
}

export interface ExternalNoticeSpec {
	readonly level: NoticeLevel;
	readonly text: string;
	/** Asks for a push beside the notice; the daemon's feed has no alert for a notice yet, so it is not acted on. */
	readonly urgent?: boolean;
}

export interface ExternalDeps {
	/** `BridgeCore.hold` and `release`: an ask keeps its session open with no viewer. */
	readonly hold: (ref: SessionRef) => Promise<ActionResult>;
	readonly release: (ref: SessionRef) => void;
	readonly find: (ref: SessionRef) => LiveSession | undefined;
	readonly now: () => number;
	readonly log: CoreLog;
}

const WITHDRAWN: ExternalInteractionOutcome = { kind: "ended", reason: "withdrawn" };
const EXPIRED: ExternalInteractionOutcome = { kind: "ended", reason: "expired" };

/**
 * Asks the bridge raises on a session itself, for a tool the agent calls (a bridge MCP tool such as `broski_ask`),
 * which no adapter knows of. Each is an `interaction_requested` on the session's stream, so every viewer, every attach's snapshot and
 * the observer (the lock-screen push) get it as they get an adapter's; its answers pass the interactions desk like any
 * other, and reach the waiting asker instead of an adapter. It ends once: `answered`; `withdrawn` when the asker's
 * signal aborts or the run it blocks ends; `expired` when the session's stream ends without a successor.
 */
export class ExternalInteractions {
	constructor(private readonly deps: ExternalDeps) {}

	async raise(
		ref: SessionRef,
		spec: ExternalInteractionSpec,
		signal: AbortSignal,
	): Promise<ExternalInteractionOutcome> {
		if (signal.aborted) return WITHDRAWN;
		const held = await this.deps.hold(ref);
		if (held.status === "rejected") return WITHDRAWN;
		const live = this.deps.find(ref);
		const interaction = live && this.interactionOf(live, spec);
		if (!live || !interaction || signal.aborted) {
			this.deps.release(ref);
			return WITHDRAWN;
		}
		const { promise, resolve } = Promise.withResolvers<ExternalInteractionOutcome>();
		const withdraw = () => this.end(live.extras, interaction.id, "withdrawn", WITHDRAWN);
		signal.addEventListener("abort", withdraw, { once: true });
		const ask: BridgeAsk = {
			interaction,
			held: ref,
			settle: (outcome) => {
				signal.removeEventListener("abort", withdraw);
				this.deps.release(ref);
				resolve(outcome);
			},
		};
		live.extras.asks.set(interaction.id, ask);
		if (!live.inject({ type: "interaction_requested", interaction })) {
			live.extras.asks.delete(interaction.id);
			ask.settle(WITHDRAWN);
		}
		return promise;
	}

	/** A notice on the session's stream, which only an open session has. */
	notify(ref: SessionRef, spec: ExternalNoticeSpec): ActionResult {
		const live = this.deps.find(ref);
		if (!live) return rejected("not_found", "the session is not open");
		const event: NoticeEvent = { type: "notice", level: spec.level, text: clip(spec.text, MAX_TEXT_CHARS) };
		return live.inject(event) ? { status: "accepted" } : rejected("invalid_input", "the notice breaks the contract");
	}

	/** What takes an answer to `id` when the bridge raised it; undefined for an adapter's ask. */
	answerer(live: LiveSession, id: InteractionId): SessionAnswerer | undefined {
		const ask = live.extras.asks.get(id);
		return ask && { answer: async (answer) => this.answered(live, ask, answer) };
	}

	/** The run ended: the asks it waited on are withdrawn, before its `run_finished` is published. */
	runEnding(live: LiveSession, runId: RunId): void {
		for (const { interaction } of [...live.extras.asks.values()]) {
			if (interaction.blocksRun && interaction.runId === runId) {
				this.end(live.extras, interaction.id, "withdrawn", WITHDRAWN);
			}
		}
	}

	/** The stream ends without a successor: nothing can answer its asks any more. */
	ending(live: LiveSession): void {
		for (const id of [...live.extras.asks.keys()]) this.end(live.extras, id, "expired", EXPIRED);
	}

	private answered(live: LiveSession, ask: BridgeAsk, answer: InteractionAnswer): ActionResult {
		this.end(live.extras, ask.interaction.id, "answered", { kind: "answered", reply: answer.reply });
		if (replyStopsRun(ask.interaction.request, answer.reply)) void this.stopRun(live);
		return { status: "accepted" };
	}

	private async stopRun(live: LiveSession): Promise<void> {
		const control = live.open.control;
		if (!control || !live.snapshot.run) return;
		const stopped = await settled(() => control.abort());
		if (!stopped.ok) this.deps.log.error(`[core] ${live.label}: abort threw: ${stopped.thrown}`);
	}

	private end(
		extras: SessionExtras,
		id: InteractionId,
		reason: ResolutionReason,
		outcome: ExternalInteractionOutcome,
	): void {
		const ask = extras.asks.get(id);
		if (!ask) return;
		extras.asks.delete(id);
		extras.stream?.inject({ type: "interaction_resolved", interactionId: id, reason });
		ask.settle(outcome);
	}

	private interactionOf(live: LiveSession, spec: ExternalInteractionSpec): Interaction | undefined {
		const runId = live.snapshot.run?.runId;
		const candidate: Interaction = {
			id: crypto.randomUUID(),
			...(runId !== undefined && { runId }),
			createdAt: this.deps.now(),
			title: clip(spec.title, MAX_NAME_CHARS),
			...(spec.body !== undefined && { body: clip(spec.body, MAX_TEXT_CHARS) }),
			blocksRun: runId !== undefined && spec.blocksRun !== false,
			...(spec.origin !== undefined && { origin: spec.origin }),
			request: spec.request,
		};
		const checked = Interaction.safeParse(candidate);
		if (checked.success) return checked.data;
		this.deps.log.error(`[core] ${live.label}: an external ask breaks the contract: ${checked.error.message}`);
		return undefined;
	}
}

/** Whether the reply ends the run the ask belongs to. */
function replyStopsRun(request: InteractionRequest, reply: InteractionReply): boolean {
	if (reply.kind === "cancel") return reply.stopRun;
	if (reply.kind !== "tool_permission" || request.kind !== "tool_permission") return false;
	return request.options.some((option) => option.id === reply.optionId && option.stopsRun);
}
