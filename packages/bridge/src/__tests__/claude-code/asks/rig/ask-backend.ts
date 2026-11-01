/**
 * The smallest `AgentBackend` that holds an ask desk: a prompt starts a run, the CLI behind it (`AskCli`) raises the
 * arranged ask, an answer reaches the desk, a run ends when its CLI's turn does. Enough for conformance rule 23;
 * every other member refuses. The real adapter's host is lane D's.
 */

import { mintRunId } from "../../../../backends/claude-code/ids";
import { LiveState } from "../../../../backends/claude-code/live/live-state";
import { PERMISSION_MODES } from "../../../../backends/claude-code/permission-modes";
import type { AskDesk } from "../../../../backends/claude-code/ports/asks";
import { ACCEPTED, rejected } from "../../../../backends/claude-code/rejections";
import { CLAUDE_CODE_TRAITS } from "../../../../backends/claude-code/traits";
import { createAskDesk } from "../../../../backends/claude-code/ui/desk";
import {
	type AgentBackend,
	emptySnapshot,
	type InteractionAnswer,
	type InteractionKind,
	type OpenResult,
	type OpenSession,
	type OpenTarget,
	type PromptInput,
	type PromptResult,
	type RunId,
	type SessionControl,
	type SessionRef,
	type SessionSink,
} from "../../../../contract";
import type { AskCli, AskCliFactory } from "./cli";

const UNSUPPORTED = rejected("unsupported", "the ask rig serves asks only");

class AskRigSession {
	readonly ref: SessionRef = { backend: "claude-code", sessionId: crypto.randomUUID() };
	readonly state: LiveState;
	readonly desk: AskDesk;
	private runId: RunId | undefined;
	private closed = false;

	constructor(
		sink: SessionSink,
		private readonly cli: AskCli,
		private readonly kindFor: () => InteractionKind | undefined,
	) {
		this.state = new LiveState(emptySnapshot(), () => Date.now());
		this.state.attach({ emit: (record) => (this.closed ? undefined : sink.emit(record)) });
		this.desk = createAskDesk({
			live: this.state,
			activeRunId: () => this.runId,
			abortRun: () => this.cli.interrupt(),
			planModeOptions: () => ({
				axis: "permissions",
				options: PERMISSION_MODES.map((value) => ({ value, label: value })),
				defaultValue: "default",
			}),
			now: () => Date.now(),
		});
	}

	control(): SessionControl {
		return {
			prompt: (input) => this.prompt(input),
			abort: async () => {
				if (this.runId !== undefined) await this.cli.interrupt();
				return ACCEPTED;
			},
			answer: async (answer: InteractionAnswer) =>
				this.closed ? rejected("closed", "closed") : this.desk.answer(answer),
			setModel: async () => UNSUPPORTED,
			setThinking: async () => UNSUPPORTED,
			setMode: async () => UNSUPPORTED,
		};
	}

	open(): OpenSession {
		return {
			session: this.ref,
			snapshot: () => this.state.snapshot(),
			control: this.control(),
			close: async () => {
				this.closed = true;
			},
		};
	}

	async end(): Promise<void> {
		this.closed = true;
		this.desk.expireAll();
		await this.cli.close();
	}

	private async prompt(_input: PromptInput): Promise<PromptResult> {
		const kind = this.kindFor();
		if (this.runId !== undefined) return rejected("busy", "a run is active");
		if (kind === undefined) return rejected("invalid_input", "nothing arranged");
		const runId = mintRunId();
		this.runId = runId;
		this.state.emit({ type: "run_started", runId, trigger: "prompt" });
		const turn = await this.cli.start(kind, this.desk);
		void turn.done.then((end) => this.finish(runId, end));
		return { status: "accepted", disposition: "started" };
	}

	private finish(runId: RunId, end: "completed" | "aborted"): void {
		this.desk.withdrawRun(runId);
		this.runId = undefined;
		this.state.emit({ type: "run_finished", runId, outcome: { kind: end } });
		void this.cli.close();
	}
}

export class AskRigBackend implements AgentBackend {
	readonly id = "claude-code";
	readonly traits = CLAUDE_CODE_TRAITS;
	readonly arranged = new Map<string, InteractionKind>();
	private readonly sessions: AskRigSession[] = [];

	constructor(private readonly makeCli: AskCliFactory) {}

	async open(_target: OpenTarget, sink: SessionSink): Promise<OpenResult> {
		const session = new AskRigSession(sink, this.makeCli(), () => this.arranged.get(session.ref.sessionId));
		this.sessions.push(session);
		return { status: "accepted", session: session.open(), snapshot: session.state.snapshot() };
	}

	async dispose(): Promise<void> {
		await Promise.all(this.sessions.map((session) => session.end()));
	}

	async status() {
		return { installed: true, auth: "unknown" as const, usable: true, issues: [] };
	}
	async listSessions() {
		return UNSUPPORTED;
	}
	async getSession() {
		return UNSUPPORTED;
	}
	async readTranscript() {
		return UNSUPPORTED;
	}
	async readAttachment() {
		return UNSUPPORTED;
	}
	async listModels() {
		return UNSUPPORTED;
	}
	async listCommands() {
		return UNSUPPORTED;
	}
	async listModes() {
		return UNSUPPORTED;
	}
}
