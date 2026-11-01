/**
 * A command the person typed with `!` or `!!`, run as the terminal runs it: `user_bash` extension handlers first
 * (they may supply the whole result or the operations to run it with), then `AgentSession.executeBash`, which
 * records the result in the session as a `bashExecution` message (pi-coding-agent `src/core/agent-session.ts:3906-3965`;
 * the terminal's `handleBashCommand`, `src/modes/interactive/interactive-mode.ts:7095-7186`).
 *
 * It is a run of the contract with no agent loop: `run_started`, one `bash` tool call, then `run_finished`. The run
 * starts before the handlers are asked, so a handler that asks the person asks inside it, and a Stop while one still
 * decides withdraws its asks and runs and records nothing. The contract has one run at a time, so a command waits for
 * a run to end (`busy`), where the terminal would record it after the agent ends. Stop ends the command alone.
 */

import type { AgentSession, UserBashEventResult } from "@earendil-works/pi-coding-agent";
import type { BackendCallResult, RunId, RunOutcome, RunShellOp, ToolCallId } from "../../../contract";
import { clipStart } from "../bounds";
import { errorText } from "../error-text";
import { mintToolCallId } from "../ids";
import { BASH_TOOL_NAME, bashInput, bashOutcome, bashResult } from "../mapping/bash-items";
import { phoneText } from "../phone-text";
import type { InteractionPort } from "../ports";
import { rejected } from "../rejections";
import type { LiveState } from "./live-state";
import type { RunTracker } from "./run-tracker";
import { ShellOutput } from "./shell-output";

type BashResult = Awaited<ReturnType<AgentSession["executeBash"]>>;

export interface ShellDeps {
	readonly session: () => AgentSession;
	readonly live: LiveState;
	readonly runs: RunTracker;
	readonly interactions: Pick<InteractionPort, "withdrawRun">;
	/** Nothing else runs in the session: no run, no ask, no compaction, no queued input. */
	readonly idle: () => boolean;
}

const STARTED: BackendCallResult = { status: "accepted", result: { kind: "run_shell" } };
const REMEMBERED_REQUESTS = 1_000;
const NOT_RUN: BashResult = { output: "", exitCode: undefined, cancelled: true, truncated: false };

interface Job {
	readonly runId: RunId;
	readonly command: string;
	readonly excludeFromContext: boolean;
	readonly toolCallId: ToolCallId;
	stopped: boolean;
}

export class ShellRun {
	private readonly answered = new Set<string>();
	private job: Job | undefined;

	constructor(private readonly deps: ShellDeps) {}

	/** Ends the command under way, whether it runs or its handlers still decide; the agent is untouched. Whether there was one. */
	stop(): boolean {
		const job = this.job;
		if (job === undefined) return false;
		job.stopped = true;
		this.deps.interactions.withdrawRun(job.runId);
		this.deps.session().abortBash();
		return true;
	}

	async start(op: RunShellOp): Promise<BackendCallResult> {
		if (this.answered.has(op.clientRequestId)) return STARTED;
		const session = this.deps.session();
		if (this.job !== undefined || session.isBashRunning) return rejected("busy", "a bash command is already running");
		if (!this.deps.idle()) return rejected("busy", "the session has work under way");
		const command = op.command.trim();
		if (command === "") return rejected("invalid_input", "there is no command to run");
		this.remember(op.clientRequestId);
		void this.execute(session, this.begin(session, command, op.excludeFromContext));
		return STARTED;
	}

	private remember(clientRequestId: string): void {
		this.answered.add(clientRequestId);
		if (this.answered.size > REMEMBERED_REQUESTS) {
			const oldest = this.answered.values().next().value;
			if (oldest !== undefined) this.answered.delete(oldest);
		}
	}

	private begin(session: AgentSession, command: string, excludeFromContext: boolean): Job {
		const { runId } = this.deps.runs.start("prompt", session.sessionManager.getLeafId(), "shell");
		const job: Job = { runId, command, excludeFromContext, toolCallId: mintToolCallId(), stopped: false };
		this.job = job;
		this.deps.live.emit({
			type: "tool_started",
			toolCallId: job.toolCallId,
			name: BASH_TOOL_NAME,
			input: bashInput(command, excludeFromContext),
		});
		return job;
	}

	private async execute(session: AgentSession, job: Job): Promise<void> {
		let hooked: UserBashEventResult | undefined;
		try {
			hooked = await session.extensionRunner.emitUserBash({
				type: "user_bash",
				command: job.command,
				excludeFromContext: job.excludeFromContext,
				cwd: session.sessionManager.getCwd(),
			});
		} catch (error) {
			this.fail(job, `an extension's user_bash handler failed: ${errorText(error)}`);
			return;
		}
		if (job.stopped) this.finish(job, NOT_RUN);
		else await this.run(session, job, hooked);
	}

	private async run(session: AgentSession, job: Job, hooked: UserBashEventResult | undefined): Promise<void> {
		const output = new ShellOutput((tail) =>
			this.deps.live.emit({
				type: "tool_updated",
				toolCallId: job.toolCallId,
				update: { kind: "output_replaced", text: tail },
			}),
		);
		try {
			const given = hooked?.result;
			if (given !== undefined)
				session.recordBashResult(job.command, given, { excludeFromContext: job.excludeFromContext });
			const result =
				given ??
				(await session.executeBash(job.command, (chunk) => output.add(chunk), {
					excludeFromContext: job.excludeFromContext,
					...(hooked?.operations !== undefined && { operations: hooked.operations }),
				}));
			output.flush();
			this.finish(job, result);
		} catch (error) {
			output.flush();
			this.fail(job, errorText(error));
		}
	}

	private finish(job: Job, result: BashResult): void {
		const record = { ...result, command: job.command, excludeFromContext: job.excludeFromContext };
		this.deps.live.emit({
			type: "tool_finished",
			toolCallId: job.toolCallId,
			outcome: bashOutcome(record),
			result: bashResult(record),
		});
		this.end(result.cancelled ? { kind: "aborted" } : { kind: "completed" });
	}

	private fail(job: Job, message: string): void {
		this.deps.live.emit({
			type: "tool_finished",
			toolCallId: job.toolCallId,
			outcome: "failed",
			result: { content: [], fileChanges: [], error: clipStart(phoneText(message), 4096) },
		});
		this.end({ kind: "error", error: { code: "tool", message: clipStart(message, 1024) } });
	}

	private end(outcome: RunOutcome): void {
		this.job = undefined;
		this.deps.runs.end(outcome);
	}
}
