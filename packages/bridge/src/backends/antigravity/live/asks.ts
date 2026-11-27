/**
 * A live session's asks: agy's permission requests and questions, raised through the kit's ask desk and answered only
 * by the person. An ask ends without an answer only when agy ends it: its tool call ends, its turn ends, it takes the
 * request back (`$/cancel_request`), or its process goes (all `withdrawn`); the bridge shutting down expires it. When
 * the person stops the turn, every open request is answered as ACP's cancellation requires: a permission `cancelled`,
 * a question `cancel`.
 */

import { type AskDesk, createAskDesk } from "../../../adapter-kit/ask-desk";
import type {
	ActionResult,
	Interaction,
	InteractionAnswer,
	InteractionOrigin,
	InteractionRequest,
	SinkRecord,
} from "../../../contract";
import type { AgentCall } from "../acp/rpc";
import { type ToolState, toolLook } from "../mapping/tools";
import { permissionAsk, permissionResult } from "./permissions";
import { elicitationResult, questionForm } from "./questions";

export const UNSHOWN_QUESTION = "Antigravity asked something Broski can't show yet.";
const UNSHOWN_PERMISSION = "Antigravity asked for a permission Broski can't show; stop the turn to refuse it.";

type Call<M extends AgentCall["method"]> = Extract<AgentCall, { method: M }>;

/** Where an ask stands in its session. */
export interface AskPlace {
	/** The run it blocks; absent outside a run (a compaction's turn). */
	readonly runId?: string;
	/** agy's id of the tool call it belongs to, and the contract's. */
	readonly agyToolCallId?: string;
	readonly toolCallId?: string;
}

interface AskShape {
	readonly title: string;
	readonly request: InteractionRequest;
	readonly origin: InteractionOrigin | undefined;
}

interface OpenAsk {
	readonly place: AskPlace;
	readonly withdraw: AbortController;
	/** Answers agy's request the way a stopped turn does. */
	readonly cancel: () => void;
}

export interface AsksDeps {
	readonly emit: (record: SinkRecord) => void;
	readonly stopRun: () => void;
	readonly notice: (text: string) => void;
	readonly now: () => number;
}

export class AgyAsks {
	private readonly desk: AskDesk;
	private readonly open = new Set<OpenAsk>();

	constructor(private readonly deps: AsksDeps) {
		this.desk = createAskDesk({ emit: deps.emit, stopRun: deps.stopRun, now: deps.now });
	}

	/** `tool`: the call the permission is for, as agy reported it so far. */
	permission(call: Call<"session/request_permission">, place: AskPlace, tool: ToolState): void {
		const ask = permissionAsk(call.params, tool);
		const open = this.track(call, place, () => call.answer.result({ outcome: { outcome: "cancelled" } }));
		if (ask === undefined) {
			this.deps.notice(UNSHOWN_PERMISSION);
			return;
		}
		const origin = originOf(place, toolLook(tool).name);
		void this.raise({ title: ask.title, request: ask.request, origin }, place, open).then((reply) => {
			if (reply !== undefined) call.answer.result(permissionResult(reply));
		});
	}

	question(call: Call<"elicitation/create">, place: AskPlace): void {
		const form = questionForm(call.params);
		if (form === undefined) {
			call.answer.result({ action: "cancel" });
			this.deps.notice(UNSHOWN_QUESTION);
			return;
		}
		const open = this.track(call, place, () => call.answer.result({ action: "cancel" }));
		const request = { kind: "questions" as const, questions: form.questions };
		void this.raise({ title: form.title, request, origin: originOf(place, "ask_question") }, place, open).then(
			(reply) => {
				if (reply !== undefined) call.answer.result(elicitationResult(form, reply));
			},
		);
	}

	/** The person stopped the turn: every open request is answered as cancelled, and its ask withdrawn. */
	cancelAll(): void {
		for (const open of [...this.open]) {
			open.cancel();
			this.end(open);
		}
	}

	/** agy ended the tool call `agyToolCallId`: what it asked for that call is moot. */
	toolEnded(agyToolCallId: string): void {
		for (const open of [...this.open]) if (open.place.agyToolCallId === agyToolCallId) this.end(open);
	}

	/** The turn ended (a run, or a compaction's turn when `runId` is absent): its asks go with it. */
	turnEnded(runId: string | undefined): void {
		for (const open of [...this.open]) if (open.place.runId === runId) this.end(open);
		if (runId !== undefined) this.desk.withdrawRun(runId);
	}

	/** agy's process is gone, and every request with it. */
	withdrawAll(): void {
		for (const open of [...this.open]) this.end(open);
	}

	answer(answer: InteractionAnswer): ActionResult {
		return this.desk.answer(answer);
	}

	pending(): Interaction[] {
		return this.desk.pending();
	}

	get any(): boolean {
		return this.open.size > 0;
	}

	/** Nothing will answer any more: the bridge is shutting down. */
	expireAll(): void {
		this.open.clear();
		this.desk.expireAll();
	}

	private track(call: AgentCall, place: AskPlace, cancel: () => void): OpenAsk {
		const open: OpenAsk = { place, withdraw: new AbortController(), cancel };
		this.open.add(open);
		const withdrawn = () => this.end(open);
		if (call.withdrawn.aborted) withdrawn();
		else call.withdrawn.addEventListener("abort", withdrawn, { once: true });
		return open;
	}

	private end(open: OpenAsk): void {
		this.open.delete(open);
		open.withdraw.abort();
	}

	/** The person's reply, or undefined when the ask ended without one. */
	private async raise(spec: AskShape, place: AskPlace, open: OpenAsk) {
		const outcome = await this.desk.ask({
			...(place.runId !== undefined && { runId: place.runId }),
			title: spec.title,
			request: spec.request,
			...(spec.origin !== undefined && { origin: spec.origin }),
			signal: open.withdraw.signal,
		});
		this.open.delete(open);
		return outcome.kind === "answered" ? outcome.reply : undefined;
	}
}

function originOf(place: AskPlace, toolName: string): InteractionOrigin | undefined {
	return place.toolCallId === undefined ? undefined : { toolCallId: place.toolCallId, toolName };
}
