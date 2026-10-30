/**
 * A command the person typed with `!` or `!!`, run as the terminal runs it: `user_bash` extension handlers first
 * (they may supply the whole result or the operations to run it with), then `AgentSession.executeBash`, which
 * records the result in the session as a `bashExecution` message (pi-coding-agent `src/core/agent-session.ts:3906-3965`;
 * the terminal's `handleBashCommand`, `src/modes/interactive/interactive-mode.ts:7068-7190`).
 *
 * It is a run of the contract with no agent loop: `run_started`, one `bash` tool call whose output streams, then
 * `run_finished`. The terminal also runs a command while the agent streams and records it when the agent ends;
 * the contract has one run at a time, so a command waits for the run to end (`busy`). Stop ends the command alone.
 */

import type { AgentSession, UserBashEventResult } from "@earendil-works/pi-coding-agent";
import type { BackendCallResult, Rejected, RunOutcome, RunShellOp, ToolCallId } from "../../../contract";
import { clipStart } from "../bounds";
import { errorText } from "../error-text";
import { mintToolCallId } from "../ids";
import { BASH_TOOL_NAME, bashInput, bashOutcome, bashResult } from "../mapping/bash-items";
import { phoneText } from "../phone-text";
import { rejected } from "../rejections";
import type { LiveState } from "./live-state";
import type { RunTracker } from "./run-tracker";

type BashResult = Awaited<ReturnType<AgentSession["executeBash"]>>;

export interface ShellDeps {
	readonly session: () => AgentSession;
	readonly live: LiveState;
	readonly runs: RunTracker;
	/** Nothing else runs in the session: no run, no ask, no compaction, no queued input. */
	readonly idle: () => boolean;
}

const STARTED: BackendCallResult = { status: "accepted", result: { kind: "run_shell" } };
const REMEMBERED_REQUESTS = 1_000;
/** Output reaches the phone in pieces no more often than this, whatever the command prints. */
const FLUSH_MS = 50;
const FLUSH_CHARS = 64 * 1024;

export class ShellRun {
	private readonly answered = new Set<string>();
	private running = false;

	constructor(private readonly deps: ShellDeps) {}

	/** Ends the command that runs, if any; the session's agent is untouched. Whether one was running. */
	stop(): boolean {
		if (!this.running) return false;
		this.deps.session().abortBash();
		return true;
	}

	async start(op: RunShellOp): Promise<BackendCallResult> {
		if (this.answered.has(op.clientRequestId)) return STARTED;
		const session = this.deps.session();
		if (this.running || session.isBashRunning) return rejected("busy", "a bash command is already running");
		if (!this.deps.idle()) return rejected("busy", "the session has work under way");
		const command = op.command.trim();
		if (command === "") return rejected("invalid_input", "there is no command to run");
		const hooked = await this.hooked(session, command, op.excludeFromContext);
		if (hooked !== undefined && "status" in hooked) return hooked;
		if (!this.deps.idle()) return rejected("busy", "the session has work under way");
		this.remember(op.clientRequestId);
		this.running = true;
		const toolCallId = this.begin(session, command, op.excludeFromContext);
		void this.execute(session, { command, excludeFromContext: op.excludeFromContext, toolCallId, hooked });
		return STARTED;
	}

	private async hooked(
		session: AgentSession,
		command: string,
		excludeFromContext: boolean,
	): Promise<UserBashEventResult | undefined | Rejected> {
		try {
			return await session.extensionRunner.emitUserBash({
				type: "user_bash",
				command,
				excludeFromContext,
				cwd: session.sessionManager.getCwd(),
			});
		} catch (error) {
			return rejected("backend_error", `an extension's user_bash handler failed: ${errorText(error)}`);
		}
	}

	private remember(clientRequestId: string): void {
		this.answered.add(clientRequestId);
		if (this.answered.size > REMEMBERED_REQUESTS) {
			const oldest = this.answered.values().next().value;
			if (oldest !== undefined) this.answered.delete(oldest);
		}
	}

	private begin(session: AgentSession, command: string, excludeFromContext: boolean): ToolCallId {
		const { live, runs } = this.deps;
		runs.start("prompt", session.sessionManager.getLeafId(), "shell");
		const toolCallId = mintToolCallId();
		live.emit({
			type: "tool_started",
			toolCallId,
			name: BASH_TOOL_NAME,
			input: bashInput(command, excludeFromContext),
		});
		return toolCallId;
	}

	private async execute(session: AgentSession, job: Job): Promise<void> {
		const output = new OutputPieces((text) =>
			this.deps.live.emit({
				type: "tool_updated",
				toolCallId: job.toolCallId,
				update: { kind: "output_appended", text },
			}),
		);
		try {
			const given = job.hooked?.result;
			if (given !== undefined)
				session.recordBashResult(job.command, given, { excludeFromContext: job.excludeFromContext });
			const result =
				given ??
				(await session.executeBash(job.command, (chunk) => output.add(chunk), {
					excludeFromContext: job.excludeFromContext,
					...(job.hooked?.operations !== undefined && { operations: job.hooked.operations }),
				}));
			output.flush();
			this.finish(job, result);
		} catch (error) {
			output.flush();
			this.fail(job, error);
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

	private fail(job: Job, error: unknown): void {
		this.deps.live.emit({
			type: "tool_finished",
			toolCallId: job.toolCallId,
			outcome: "failed",
			result: { content: [], fileChanges: [], error: clipStart(phoneText(errorText(error)), 4096) },
		});
		this.end({ kind: "error", error: { code: "tool", message: clipStart(errorText(error), 1024) } });
	}

	private end(outcome: RunOutcome): void {
		this.running = false;
		this.deps.runs.end(outcome);
	}
}

interface Job {
	readonly command: string;
	readonly excludeFromContext: boolean;
	readonly toolCallId: ToolCallId;
	readonly hooked: UserBashEventResult | undefined;
}

/** Coalesces a command's output into pieces, so a chatty command costs the link a few events a second. */
class OutputPieces {
	private pending = "";
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly send: (text: string) => void) {}

	add(chunk: string): void {
		this.pending += chunk;
		if (this.pending.length >= FLUSH_CHARS) this.flush();
		else this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
	}

	flush(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
		const text = phoneText(this.pending);
		this.pending = "";
		if (text !== "") this.send(text);
	}
}
