/**
 * A live session's asks: agy's permission requests and questions, raised through the kit's ask desk and answered only
 * by the person, one the phone cannot show included (as an ask the person can only refuse). An ask ends without an
 * answer only when agy ends it: its tool call ends, its turn ends, it takes the request back (`$/cancel_request`), or
 * its process goes (all `withdrawn`); the bridge shutting down expires it. When the person stops the turn, every open
 * request is answered as ACP's cancellation requires: a permission `cancelled`, a question `cancel`; so is a request
 * agy sends in that turn after the stop, which the person has already answered by stopping.
 */

import { type AskDesk, createAskDesk } from "../../../adapter-kit/ask-desk";
import type {
	ActionResult,
	InteractionAnswer,
	InteractionOrigin,
	InteractionReply,
	InteractionRequest,
	SinkRecord,
} from "../../../contract";
import type { AgentCall } from "../acp/rpc";
import { type ToolState, toolLook } from "../mapping/tools";
import { PERMISSION_CANCELLED, permissionAsk } from "./permissions";
import { ELICITATION_CANCELLED, questionAsk } from "./questions";

type Call<M extends AgentCall["method"]> = Extract<AgentCall, { method: M }>;

/** Where an ask stands in its session. */
export interface AskPlace {
	/** The run it blocks; absent outside a run (a compaction's turn). */
	readonly runId?: string;
	/** agy's id of the tool call it belongs to, and the contract's. */
	readonly agyToolCallId?: string;
	readonly toolCallId?: string;
}

/** An ask as `permissions.ts` and `questions.ts` make it: what the person sees, and how their reply goes back. */
interface Ask {
	readonly title: string;
	readonly body?: string;
	readonly request: InteractionRequest;
	readonly result: (reply: InteractionReply) => unknown;
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
	readonly now: () => number;
}

export class AgyAsks {
	private readonly desk: AskDesk;
	private readonly open = new Set<OpenAsk>();

	constructor(deps: AsksDeps) {
		this.desk = createAskDesk({ emit: deps.emit, stopRun: deps.stopRun, now: deps.now });
	}

	/** `tool`: the call the permission is for, as agy reported it so far. */
	permission(call: Call<"session/request_permission">, place: AskPlace, tool: ToolState): void {
		const origin = originOf(place, toolLook(tool).name);
		this.raise(call, place, permissionAsk(call.params, tool), origin, PERMISSION_CANCELLED);
	}

	question(call: Call<"elicitation/create">, place: AskPlace): void {
		this.raise(call, place, questionAsk(call.params), originOf(place, "ask_question"), ELICITATION_CANCELLED);
	}

	/** The person stopped the turn: every open request is answered as cancelled, and its ask withdrawn. */
	cancelAll(): void {
		for (const open of [...this.open]) {
			open.cancel();
			this.end(open);
		}
	}

	/** A request agy sent in a turn the person had already stopped: answered as the stop answered the others. */
	answerStopped(call: AgentCall): void {
		call.answer.result(call.method === "elicitation/create" ? ELICITATION_CANCELLED : PERMISSION_CANCELLED);
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

	get any(): boolean {
		return this.open.size > 0;
	}

	/** Nothing will answer any more: the bridge is shutting down. */
	expireAll(): void {
		this.open.clear();
		this.desk.expireAll();
	}

	/** The ask stays open until the person answers it or agy ends it; `stopped` answers it when the turn is stopped. */
	private raise(call: AgentCall, place: AskPlace, ask: Ask, origin: InteractionOrigin | undefined, stopped: unknown) {
		const open: OpenAsk = { place, withdraw: new AbortController(), cancel: () => call.answer.result(stopped) };
		this.open.add(open);
		const withdrawn = () => this.end(open);
		if (call.withdrawn.aborted) withdrawn();
		else call.withdrawn.addEventListener("abort", withdrawn, { once: true });
		const asked = this.desk.ask({
			...(place.runId !== undefined && { runId: place.runId }),
			title: ask.title,
			...(ask.body !== undefined && { body: ask.body }),
			request: ask.request,
			...(origin !== undefined && { origin }),
			signal: open.withdraw.signal,
		});
		void asked.then((outcome) => {
			this.open.delete(open);
			if (outcome.kind === "answered") call.answer.result(ask.result(outcome.reply));
		});
	}

	private end(open: OpenAsk): void {
		this.open.delete(open);
		open.withdraw.abort();
	}
}

function originOf(place: AskPlace, toolName: string): InteractionOrigin | undefined {
	return place.toolCallId === undefined ? undefined : { toolCallId: place.toolCallId, toolName };
}
