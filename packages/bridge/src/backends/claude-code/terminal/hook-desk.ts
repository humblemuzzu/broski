/**
 * The terminal asks one watch-only session shows (D26). Each is a hook request that stays open until a person answers
 * it, the terminal's own user answers it first (the tool's result reaches the tail, or the run ends), or the CLI drops
 * the request (its hook timeout, or the terminal gone): no timer here decides anything.
 */

import type { PermissionRequestHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { ActionResult, AgentEvent, InteractionAnswer, InteractionId, RunId, ToolCallId } from "../../../contract";
import { mintInteractionId } from "../ids";
import { ACCEPTED, rejected } from "../rejections";
import { decisionOf, type HookDecision, permissionInteraction } from "./hook-interaction";

/** What the desk needs of the session it sits on. */
export interface DeskSession {
	emit(event: AgentEvent): void;
	/** The run the ask blocks; starts an external one when the tail has seen none. */
	ensureRun(): RunId;
	toolMatching(name: string, input: unknown): ToolCallId | undefined;
	/** Resolves once what the terminal has written so far has been shown. */
	catchUp(): Promise<void>;
	now(): number;
}

interface Pending {
	readonly runId: RunId | undefined;
	readonly toolCallId: ToolCallId | undefined;
	readonly settle: (decision: HookDecision) => void;
}

export class HookDesk {
	private readonly pending = new Map<InteractionId, Pending>();
	private shut = false;

	constructor(private readonly session: DeskSession) {}

	get size(): number {
		return this.pending.size;
	}

	/** Resolves with the person's decision; undefined when the terminal is left to decide. */
	async raise(ask: PermissionRequestHookInput, signal: AbortSignal): Promise<HookDecision> {
		if (signal.aborted) return { decision: undefined };
		await this.session.catchUp();
		if (signal.aborted || this.shut) return { decision: undefined };
		const id = mintInteractionId();
		const runId = this.session.ensureRun();
		const toolCallId = this.session.toolMatching(ask.tool_name, ask.tool_input);
		return new Promise<HookDecision>((resolve) => {
			const settle = (decision: HookDecision) => {
				signal.removeEventListener("abort", onAbort);
				resolve(decision);
			};
			const onAbort = () => this.withdraw(id);
			this.pending.set(id, { runId, toolCallId, settle });
			signal.addEventListener("abort", onAbort, { once: true });
			const interaction = permissionInteraction(ask, {
				id,
				runId,
				createdAt: this.session.now(),
				toolCallId,
			});
			this.session.emit({ type: "interaction_requested", interaction });
		});
	}

	answer(answer: InteractionAnswer): ActionResult {
		const entry = this.pending.get(answer.interactionId);
		if (entry === undefined) return rejected("stale", "that ask is no longer open");
		const decision = decisionOf(answer.reply);
		if (decision === undefined) return rejected("invalid_input", "that reply does not answer a permission ask");
		this.pending.delete(answer.interactionId);
		this.session.emit({
			type: "interaction_resolved",
			interactionId: answer.interactionId,
			reason: "answered",
		});
		entry.settle(decision);
		return ACCEPTED;
	}

	/** The terminal's own user answered, or the CLI dropped the request. */
	withdraw(id: InteractionId): void {
		const entry = this.pending.get(id);
		if (entry === undefined) return;
		this.pending.delete(id);
		this.session.emit({
			type: "interaction_resolved",
			interactionId: id,
			reason: "withdrawn",
		});
		entry.settle({ decision: undefined });
	}

	withdrawForTool(toolCallId: ToolCallId): void {
		for (const [id, entry] of [...this.pending]) if (entry.toolCallId === toolCallId) this.withdraw(id);
	}

	withdrawForRun(runId: RunId): void {
		for (const [id, entry] of [...this.pending]) if (entry.runId === runId) this.withdraw(id);
	}

	/** The session is going: what is open is withdrawn and nothing new is raised. */
	withdrawAll(): void {
		this.shut = true;
		for (const id of [...this.pending.keys()]) this.withdraw(id);
	}
}
