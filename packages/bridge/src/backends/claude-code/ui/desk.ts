/** The `AskDesk` each host creates and wires into its `query()` options (D15, D16): one interaction per CLI ask. */

import type {
	CanUseTool,
	ElicitationRequest,
	ElicitationResult,
	OnElicitation,
	PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { ACCEPTED, rejected } from "../../../adapter-kit/rejections";
import {
	type ActionResult,
	answerProblem,
	type InteractionAnswer,
	type InteractionReply,
	type InteractionRequest,
	type RunId,
} from "../../../contract";
import type { AskDesk, AskDeskFactory, AskHost } from "../ports/asks";
import { AskBook } from "./book";
import { ELICITATION_CANCELLED, elicitationAsk } from "./elicitation";
import { AskFloor } from "./floor";
import { type PermissionAsk, permissionOrigin } from "./permission";
import { reportAskProblem } from "./problems";
import { deciding, WITHDRAWN } from "./tool-ask";
import { chooseToolAsk } from "./tool-choice";

type CallbackOptions = Parameters<OnElicitation>[1];

class ClaudeAskDesk implements AskDesk {
	readonly canUseTool: CanUseTool = (toolName, input, options) => this.tool({ toolName, input, options });
	readonly onElicitation: OnElicitation = (request, options) => this.elicitation(request, options);
	private readonly floor: AskFloor;
	private readonly tools: AskBook<PermissionResult>;
	private readonly elicitations: AskBook<ElicitationResult>;

	constructor(host: AskHost) {
		this.floor = new AskFloor(host);
		this.tools = new AskBook(this.floor);
		this.elicitations = new AskBook(this.floor);
	}

	answer(answer: InteractionAnswer): ActionResult {
		try {
			return this.deliver(answer);
		} catch (error) {
			reportAskProblem("answer", error);
			return rejected("backend_error", "the answer could not be delivered");
		}
	}

	elicitationComplete(elicitationId: string): void {
		this.floor.withdrawAll(this.floor.ledger.ofElicitation(elicitationId), "withdrawn");
	}

	withdrawRun(runId: RunId): void {
		this.floor.withdrawAll(this.floor.ledger.ofRun(runId), "withdrawn");
	}

	expireAll(): void {
		this.floor.withdrawAll(this.floor.ledger.all(), "expired");
	}

	private deliver(answer: InteractionAnswer): ActionResult {
		const { ledger } = this.floor;
		const ask = ledger.peek(answer.interactionId);
		if (!ask) {
			return ledger.status(answer.interactionId) === "resolved"
				? rejected("stale", "this interaction was already resolved")
				: rejected("not_found", "no such interaction");
		}
		const problem = answerProblem(ask.interaction, answer);
		if (problem !== undefined) return rejected("invalid_input", problem);
		const give = ask.accept(answer.reply);
		if (!give) return rejected("invalid_input", "this answer cannot be given to Claude Code");
		this.floor.finish(ask.interaction.id, "answered");
		give();
		if (stopsRun(ask.interaction.request, answer.reply)) this.floor.stopRun();
		return ACCEPTED;
	}

	private async tool(ask: PermissionAsk): Promise<PermissionResult> {
		const { signal, requestId } = ask.options;
		try {
			const chosen = chooseToolAsk(ask, () => this.floor.host.planModeOptions());
			return await this.tools.ask({
				requestId,
				signal,
				title: chosen.title,
				...(chosen.body !== undefined && { body: chosen.body }),
				origin: permissionOrigin(ask),
				request: chosen.request,
				resultFor: (reply) => deciding(chosen, reply),
				ended: WITHDRAWN,
			});
		} catch (error) {
			reportAskProblem("canUseTool", error);
			return parked(signal, WITHDRAWN);
		}
	}

	private async elicitation(request: ElicitationRequest, options: CallbackOptions): Promise<ElicitationResult> {
		const { signal, requestId } = options;
		try {
			const asked = elicitationAsk(request);
			return await this.elicitations.ask({
				requestId,
				...(request.elicitationId !== undefined && { elicitationId: request.elicitationId }),
				signal,
				title: asked.title,
				...(asked.body !== undefined && { body: asked.body }),
				request: asked.request,
				resultFor: (reply) => (reply.kind === "cancel" ? ELICITATION_CANCELLED : asked.resultFor(reply)),
				ended: ELICITATION_CANCELLED,
			});
		} catch (error) {
			reportAskProblem("onElicitation", error);
			return parked(signal, ELICITATION_CANCELLED);
		}
	}
}

export const createAskDesk: AskDeskFactory = (host: AskHost): AskDesk => new ClaudeAskDesk(host);

/** The ask could not even be raised: it stays pending, never answered, until the CLI withdraws it. */
function parked<R>(signal: AbortSignal, withdrawn: R): Promise<R> {
	if (signal.aborted) return Promise.resolve(withdrawn);
	return new Promise((resolve) => signal.addEventListener("abort", () => resolve(withdrawn), { once: true }));
}

function stopsRun(request: InteractionRequest, reply: InteractionReply): boolean {
	if (reply.kind === "cancel") return reply.stopRun;
	if (request.kind !== "tool_permission" || reply.kind !== "tool_permission") return false;
	return request.options.find((option) => option.id === reply.optionId)?.stopsRun === true;
}
