import type { BackendTraits } from "../backend";
import type { AgentEvent } from "../events";
import type { MessageId, ModelId, RunId, SessionRef, ToolCallId } from "../ids";
import type { InteractionReply } from "../interaction-replies";
import type { Interaction, InteractionRequest, PermissionOption } from "../interactions";
import type { RunOutcome } from "../runs";
import type { FakeSignalStep, FakeStep, FakeToolStep } from "./fake-script";

/** What a run needs from the session it runs in. */
export interface RunHost {
	readonly traits: BackendTraits;
	now(): number;
	newId(): string;
	emit(event: AgentEvent): void;
	/** Emits the request and resolves with the reply that answers it. */
	ask(interaction: Interaction): Promise<InteractionReply>;
	deliverSteers(): void;
	createChild(parentToolCallId: ToolCallId): SessionRef;
	replaceSession(): void;
	/** The model the session has selected now. */
	selectedModel(): ModelId | undefined;
}

const ABORTED = Symbol("aborted");

const PERMISSION_OPTIONS: readonly PermissionOption[] = [
	{ id: "allow_once", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
	{
		id: "allow_session",
		label: "Allow for this session",
		effect: "allow",
		scope: "session",
		stopsRun: false,
		message: "none",
	},
	{
		id: "allow_always",
		label: "Always allow",
		effect: "allow",
		scope: "always",
		stopsRun: false,
		message: "none",
		rule: "fake(*)",
	},
	{ id: "deny", label: "Deny", effect: "deny", scope: "once", stopsRun: false, message: "optional" },
	{ id: "deny_stop", label: "Deny and stop", effect: "deny", scope: "once", stopsRun: true, message: "none" },
];

/** Plays one run's steps against its host, ending when the steps do, a step ends it, or it is aborted. */
export class FakeRun {
	private messageId: MessageId;
	private abortedWith: RunOutcome | undefined;
	private readonly interruption = Promise.withResolvers<typeof ABORTED>();
	private readonly holdRelease = Promise.withResolvers<void>();

	constructor(
		private readonly host: RunHost,
		readonly runId: RunId,
		private readonly steps: readonly FakeStep[],
	) {
		this.messageId = host.newId();
	}

	/** Stops the run at its next step boundary or wait, ending it with `outcome`. */
	abort(outcome: RunOutcome): void {
		this.abortedWith ??= outcome;
		this.interruption.resolve(ABORTED);
	}

	/** Ends a `hold` step, now or when the run reaches one. */
	release(): void {
		this.holdRelease.resolve();
	}

	async play(): Promise<RunOutcome> {
		try {
			for (const step of this.steps) {
				if (this.abortedWith) throw ABORTED;
				this.host.deliverSteers();
				const outcome = await this.playStep(step);
				if (outcome) return outcome;
			}
			this.host.deliverSteers();
			return { kind: "completed" };
		} catch (error) {
			if (error !== ABORTED) throw error;
			return this.abortedWith ?? { kind: "aborted" };
		}
	}

	private async playStep(step: FakeStep): Promise<RunOutcome | undefined> {
		switch (step.kind) {
			case "text":
				await this.block("text", step.text, this.host.traits.streamText);
				return undefined;
			case "thinking":
				await this.block("thinking", step.text, this.host.traits.streamThinking);
				return undefined;
			case "plan_proposal":
				await this.block("plan", step.text, this.host.traits.streamText);
				return undefined;
			case "echo_model":
				await this.block("text", this.host.selectedModel() ?? "", this.host.traits.streamText);
				return undefined;
			case "new_message":
				this.messageId = this.host.newId();
				return undefined;
			case "retract":
				this.host.emit({ type: "messages_retracted", messageIds: [this.messageId] });
				this.messageId = this.host.newId();
				return undefined;
			case "tool":
				await this.tool(step, undefined);
				return undefined;
			case "ask":
				await this.askHuman(step.title, step.request, step.blocksRun ?? true, undefined);
				return undefined;
			case "hold":
				await this.waitFor(this.holdRelease.promise);
				return undefined;
			default:
				return this.playSignal(step);
		}
	}

	private async playSignal(step: FakeSignalStep): Promise<RunOutcome | undefined> {
		switch (step.kind) {
			case "compaction":
				this.host.emit({ type: "compaction_started", trigger: "auto" });
				await this.tick();
				this.host.emit({
					type: "compaction_finished",
					outcome: { kind: "completed", tokensBefore: 1000, tokensAfter: 200 },
				});
				return undefined;
			case "retry":
				for (let attempt = 1; attempt <= step.attempts; attempt++) {
					const retryAt = this.host.now() + 1000;
					this.host.emit({
						type: "retry_scheduled",
						attempt,
						maxAttempts: step.attempts,
						retryAt,
						message: "overloaded",
					});
					await this.tick();
				}
				this.host.emit({ type: "retry_finished", succeeded: true });
				return undefined;
			case "return_input":
				this.host.emit({ type: "input_returned", texts: step.texts });
				return undefined;
			case "usage":
				this.host.emit({ type: "usage_updated", usage: step.usage });
				return undefined;
			case "notice":
				this.host.emit({ type: "notice", level: step.level, text: step.text });
				return undefined;
			case "extension":
				this.host.emit({ type: "extension", extension: step.extension });
				return undefined;
			case "backend_error":
				this.host.emit({ type: "error", error: step.error, retryable: step.retryable });
				return undefined;
			case "replace_session":
				this.host.replaceSession();
				return undefined;
			case "fail":
				return { kind: "error", error: step.error };
			case "limit":
				return { kind: "limit", limit: step.limit };
			case "suspend":
				return { kind: "suspended" };
			case "defer":
				return { kind: "deferred" };
		}
	}

	private async block(kind: "text" | "thinking" | "plan", text: string, streams: boolean): Promise<void> {
		const blockId = this.host.newId();
		this.host.emit({ type: "block_started", blockId, messageId: this.messageId, kind });
		if (streams) {
			for (const chunk of chunks(text)) {
				await this.tick();
				this.host.emit({ type: "block_delta", blockId, text: chunk });
			}
		}
		await this.tick();
		this.host.emit({ type: "block_finished", blockId, text });
	}

	private async tool(step: FakeToolStep, parentToolCallId: ToolCallId | undefined): Promise<void> {
		const toolCallId = this.host.newId();
		this.host.emit({
			type: "tool_started",
			toolCallId,
			name: step.name,
			...(step.streamInput ? {} : { input: step.input }),
			messageId: this.messageId,
			...(parentToolCallId !== undefined && { parentToolCallId }),
		});
		if (step.streamInput) {
			await this.tick();
			this.host.emit({ type: "tool_updated", toolCallId, update: { kind: "input", input: step.input } });
		}
		if (step.permission && !(await this.permitted(step, toolCallId, parentToolCallId))) {
			this.host.emit({
				type: "tool_finished",
				toolCallId,
				outcome: "denied",
				result: { content: [{ kind: "text", text: "Denied by the user." }], fileChanges: [] },
			});
			return;
		}
		await this.runTool(step, toolCallId);
	}

	private async runTool(step: FakeToolStep, toolCallId: ToolCallId): Promise<void> {
		if (step.child) {
			this.host.emit({
				type: "tool_updated",
				toolCallId,
				update: { kind: "child_session", session: this.host.createChild(toolCallId) },
			});
		}
		for (const nested of step.nested ?? []) await this.tool(nested, toolCallId);
		this.host.emit({ type: "tool_updated", toolCallId, update: { kind: "progress", message: "running" } });
		for (const chunk of chunks(step.output)) {
			await this.tick();
			this.host.emit({ type: "tool_updated", toolCallId, update: { kind: "output_appended", text: chunk } });
		}
		if (step.fileChanges) {
			this.host.emit({ type: "tool_updated", toolCallId, update: { kind: "file_changes", changes: step.fileChanges } });
		}
		this.host.emit({
			type: "tool_finished",
			toolCallId,
			outcome: step.fails ? "failed" : "completed",
			result: {
				content: [{ kind: "text", text: step.output }],
				fileChanges: step.fileChanges ?? [],
				...(step.fails && { error: "the tool failed" }),
			},
		});
	}

	private async permitted(step: FakeToolStep, toolCallId: ToolCallId, parentToolCallId: ToolCallId | undefined) {
		const request: InteractionRequest = {
			kind: "tool_permission",
			input: step.input,
			inputEditable: true,
			previews: [{ kind: "command", command: step.name }],
			options: [...PERMISSION_OPTIONS],
			grants: [],
			defaultOptionId: "allow_once",
			deliberate: false,
		};
		const origin = { toolCallId, toolName: step.name, ...(parentToolCallId !== undefined && { parentToolCallId }) };
		const reply = await this.askHuman(`Run ${step.name}?`, request, true, origin);
		if (reply.kind !== "tool_permission") return false;
		const option = PERMISSION_OPTIONS.find((candidate) => candidate.id === reply.optionId);
		if (!option) throw new Error(`answers reach the run checked, yet ${reply.optionId} is no option`);
		if (option.stopsRun) throw ABORTED;
		if (reply.editedInput !== undefined) {
			this.host.emit({ type: "tool_updated", toolCallId, update: { kind: "input", input: reply.editedInput } });
		}
		return option.effect === "allow";
	}

	private async askHuman(
		title: string,
		request: InteractionRequest,
		blocksRun: boolean,
		origin: Interaction["origin"],
	): Promise<InteractionReply> {
		const interaction: Interaction = {
			id: this.host.newId(),
			runId: this.runId,
			createdAt: this.host.now(),
			title,
			blocksRun,
			...(origin && { origin }),
			request,
		};
		const reply = await this.waitFor(this.host.ask(interaction));
		if (reply.kind === "cancel" && reply.stopRun) throw ABORTED;
		return reply;
	}

	private async waitFor<T>(promise: Promise<T>): Promise<T> {
		const result = await Promise.race([promise, this.interruption.promise]);
		if (result === ABORTED) throw ABORTED;
		return result;
	}

	private async tick(): Promise<void> {
		await Promise.resolve();
		if (this.abortedWith) throw ABORTED;
	}
}

function chunks(text: string): string[] {
	const size = Math.max(1, Math.ceil(text.length / 3));
	const parts: string[] = [];
	for (let start = 0; start < text.length; start += size) parts.push(text.slice(start, start + size));
	return parts;
}
