/**
 * The terminal asks one watch-only session shows (D29). Each is a hook request that stays open until a person answers
 * it, the terminal's own user answers it first (the tool's result reaches the tail, or the run ends), or the CLI drops
 * the request (its hook timeout, or the terminal gone): no timer here decides anything.
 */

import type { PermissionRequestHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
	type ActionResult,
	type AgentEvent,
	answerProblem,
	type Interaction,
	type InteractionAnswer,
	type InteractionId,
	type RunId,
	type ToolCallId,
} from "../../../contract";
import { mintInteractionId } from "../ids";
import { ACCEPTED, rejected } from "../rejections";
import { canonicalInput } from "./canonical";
import { type HookAsk, type HookDecision, permissionAsk } from "./hook-interaction";

/** What the desk needs of the session it sits on. */
export interface DeskSession {
	emit(event: AgentEvent): void;
	/** The run the ask blocks; starts an external one when the tail has seen none. */
	ensureRun(): RunId;
	toolMatching(name: string, input: unknown): ToolCallId | undefined;
	/** How many calls of this tool are waiting for a result. */
	openToolsNamed(name: string): number;
	/** Resolves once what the terminal has written so far has been shown. */
	catchUp(): Promise<void>;
	now(): number;
}

interface Pending {
	readonly interaction: Interaction;
	readonly decide: HookAsk["decide"];
	readonly runId: RunId | undefined;
	/** The terminal writes a tool call to its file a moment after it asks, so this may be found later. */
	toolCallId: ToolCallId | undefined;
	readonly toolName: string;
	readonly inputKey: string;
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
		const runId = this.session.ensureRun();
		const toolCallId = this.session.toolMatching(ask.tool_name, ask.tool_input);
		const shown = this.askFor(ask, runId, toolCallId);
		if (shown === undefined) return { decision: undefined };
		const { interaction, decide } = shown;
		return new Promise<HookDecision>((resolve) => {
			const settle = (decision: HookDecision) => {
				signal.removeEventListener("abort", onAbort);
				resolve(decision);
			};
			const onAbort = () => this.withdraw(interaction.id);
			this.pending.set(interaction.id, {
				interaction,
				decide,
				runId,
				toolCallId,
				toolName: ask.tool_name,
				inputKey: canonicalInput(ask.tool_input),
				settle,
			});
			signal.addEventListener("abort", onAbort, { once: true });
			this.session.emit({ type: "interaction_requested", interaction });
		});
	}

	/** The ask as the contract shows it; undefined if it cannot be built, which leaves the terminal to ask. */
	private askFor(
		ask: PermissionRequestHookInput,
		runId: RunId,
		toolCallId: ToolCallId | undefined,
	): HookAsk | undefined {
		try {
			return permissionAsk(ask, {
				id: mintInteractionId(),
				runId,
				createdAt: this.session.now(),
				toolCallId,
			});
		} catch {
			return undefined;
		}
	}

	answer(answer: InteractionAnswer): ActionResult {
		const entry = this.pending.get(answer.interactionId);
		if (entry === undefined) return rejected("stale", "that ask is no longer open");
		const problem = answerProblem(entry.interaction, answer);
		if (problem !== undefined) return rejected("invalid_input", problem);
		const decision = entry.decide(answer.reply);
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

	/** A tool call the terminal wrote after its ask: the ask belongs to it when it is the same call. */
	toolStarted(toolCallId: ToolCallId, name: string, input: unknown): void {
		const waiting = [...this.pending.values()].filter(
			(entry) => entry.toolCallId === undefined && entry.toolName === name,
		);
		const key = canonicalInput(input);
		const same = waiting.find((entry) => entry.inputKey === key);
		const only = waiting.length === 1 && this.session.openToolsNamed(name) === 1 ? waiting[0] : undefined;
		const entry = same ?? only;
		if (entry !== undefined) entry.toolCallId = toolCallId;
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
