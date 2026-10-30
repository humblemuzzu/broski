import { answerProblem } from "../answer-check";
import type { BackendTraits, SessionSink } from "../backend";
import type { CatalogEvent } from "../catalog-events";
import type { CompactionOutcome } from "../compaction";
import type { AgentEvent, UserMessageEvent } from "../events";
import type { AttachmentId, InteractionId, ModelId, QueueItemId, SessionRef, ToolCallId } from "../ids";
import type { ActionResult, PromptInput, PromptResult } from "../input";
import type { InteractionAnswer, InteractionReply, ResolutionReason } from "../interaction-replies";
import type { Interaction } from "../interactions";
import type { ModeAxis, ModeSetting } from "../modes";
import type { PageRequest } from "../paging";
import type { AttachmentReadResult, TranscriptReadResult } from "../read-results";
import type { RunOutcome, RunTrigger } from "../runs";
import { applyEvent, sessionStatus } from "../session-reducer";
import type { SessionSummary } from "../sessions";
import type { SessionSnapshot } from "../snapshot";
import { FakeHistory } from "./fake-history";
import { FakeInbox } from "./fake-inbox";
import { transcriptPage } from "./fake-paging";
import { FakeRun, type RunHost } from "./fake-run";
import { DEFAULT_REPLY, type FakeStep } from "./fake-script";
import { inputProblem, modelProblem, modeProblem, offeredModels, rejected, thinkingProblem } from "./fake-validation";

export interface FakeEnvironment {
	readonly traits: BackendTraits;
	readonly modes: readonly ModeAxis[];
	now(): number;
	newId(): string;
	catalog(event: CatalogEvent): void;
	createChild(parent: SessionRef, parentToolCallId: ToolCallId): SessionRef;
	/** Keeps the history under the old id and returns the id the live session goes on under. */
	splitOff(live: FakeSession): SessionRef;
}

const ACCEPTED: ActionResult = { status: "accepted" };

function compactionOutcome(end: "cancelled" | "released"): CompactionOutcome {
	return end === "cancelled" ? { kind: "aborted" } : { kind: "completed", tokensBefore: 1000, tokensAfter: 200 };
}

/** One session of the fake backend: its live state, transcript and runs. Open sessions are views onto it. */
export class FakeSession implements RunHost {
	readonly history: FakeHistory;
	readonly inbox: FakeInbox;
	snapshot: SessionSnapshot;
	private sink: SessionSink | undefined;
	private run: FakeRun | undefined;
	/** Where the active run's items start in the history, which the transcript stops short of. */
	private runStart: number | undefined;
	private settled: Promise<void> = Promise.resolve();
	private readonly scripts: FakeStep[][] = [];
	private readonly waiters = new Map<InteractionId, (reply: InteractionReply) => void>();
	private readonly resolved = new Set<InteractionId>();
	private slowCompaction = false;
	private compactionEnd: ((end: "cancelled" | "released") => void) | undefined;

	constructor(
		private env: FakeEnvironment,
		readonly cwd: string,
		public summary: SessionSummary,
		readonly external: boolean,
		initial: SessionSnapshot,
	) {
		this.history = new FakeHistory(() => env.newId());
		this.inbox = new FakeInbox(() => env.newId());
		this.snapshot = initial;
	}

	get traits(): BackendTraits {
		return this.env.traits;
	}

	/** The backend restarted: the session now belongs to the new one. */
	rebind(env: FakeEnvironment): void {
		this.env = env;
	}

	now(): number {
		return this.env.now();
	}

	newId(): string {
		return this.env.newId();
	}

	selectedModel(): ModelId | undefined {
		return this.snapshot.modelId;
	}

	attach(sink: SessionSink): void {
		this.sink = sink;
	}

	detach(sink: SessionSink): void {
		if (this.sink === sink) this.sink = undefined;
	}

	script(steps: FakeStep[]): void {
		this.scripts.push(steps);
	}

	transcript(page: PageRequest): TranscriptReadResult {
		const start = this.runStart;
		const finished = this.history.entries.filter((entry) => start === undefined || entry.seq < start);
		return transcriptPage(finished, page);
	}

	readAttachment(id: AttachmentId): AttachmentReadResult {
		const image = this.inbox.image(id);
		return image ? { status: "accepted", image } : rejected("not_found", `no attachment ${id}`);
	}

	emit(event: AgentEvent): void {
		const at = this.env.now();
		if (event.type === "run_started") this.runStart = this.history.position();
		if (event.type === "run_finished") this.runStart = undefined;
		if (event.type === "session_replaced" && this.run) this.runStart = this.history.position();
		this.history.record(this.snapshot, at, event);
		this.snapshot = applyEvent(this.snapshot, { at, event });
		this.sink?.emit({ at, event });
		this.refreshSummary(at, event);
	}

	ask(interaction: Interaction): Promise<InteractionReply> {
		const reply = Promise.withResolvers<InteractionReply>();
		this.waiters.set(interaction.id, reply.resolve);
		this.emit({ type: "interaction_requested", interaction });
		return reply.promise;
	}

	deliverSteers(): void {
		const steers = this.inbox.takeSteers();
		if (steers.length === 0) return;
		for (const steer of steers) this.emit(this.inbox.deliver(this.newId(), steer));
		this.emitQueue();
	}

	createChild(parentToolCallId: ToolCallId): SessionRef {
		return this.env.createChild(this.summary.session, parentToolCallId);
	}

	replaceSession(): void {
		const session = this.env.splitOff(this);
		const { title: _title, ...summary } = this.summary;
		const now = this.env.now();
		this.summary = { ...summary, session, createdAt: now, updatedAt: now };
		this.history.clear();
		this.emit({ type: "session_replaced", session });
		this.env.catalog({ type: "session_updated", summary: this.summary });
	}

	prompt(input: PromptInput): PromptResult {
		const known = this.inbox.acceptedResult(input.clientRequestId);
		if (known) return known;
		const result = this.admit(input);
		this.inbox.remember(input.clientRequestId, result);
		return result;
	}

	async abort(): Promise<ActionResult> {
		this.endCompaction("cancelled");
		this.run?.abort({ kind: "aborted" });
		await this.settled;
		return ACCEPTED;
	}

	answer(answer: InteractionAnswer): ActionResult {
		const interaction = this.snapshot.interactions.find((pending) => pending.id === answer.interactionId);
		if (!interaction) {
			return this.resolved.has(answer.interactionId)
				? rejected("stale", "this interaction is already resolved")
				: rejected("not_found", "no such interaction");
		}
		const problem = answerProblem(interaction, answer);
		if (problem !== undefined) return rejected("invalid_input", problem);
		const waiter = this.takeWaiter(interaction.id);
		this.resolveInteraction(interaction.id, "answered");
		waiter(answer.reply);
		return ACCEPTED;
	}

	/** A new model starts at its default thinking. */
	setModel(modelId: ModelId): ActionResult {
		const problem = modelProblem(this.traits, modelId);
		if (problem) return problem;
		const thinking = offeredModels(this.traits).find((model) => model.id === modelId)?.thinking.defaultValue;
		this.emit({ type: "model_changed", modelId, ...(thinking !== undefined && { thinking }) });
		return ACCEPTED;
	}

	setThinking(value: string): ActionResult {
		const modelId = this.snapshot.modelId;
		const problem = thinkingProblem(this.traits, modelId, value);
		if (problem) return problem;
		this.emit({ type: "model_changed", ...(modelId !== undefined && { modelId }), thinking: value });
		return ACCEPTED;
	}

	setMode(setting: ModeSetting): ActionResult {
		const problem = modeProblem(this.env.modes, setting);
		if (problem) return problem;
		this.emit({ type: "mode_changed", ...setting });
		return ACCEPTED;
	}

	compact(): ActionResult {
		if (this.run) return rejected("busy", "a run is active");
		this.emit({ type: "compaction_started", trigger: "manual" });
		if (this.slowCompaction) {
			this.slowCompaction = false;
			this.compactionEnd = (end) => this.emit({ type: "compaction_finished", outcome: compactionOutcome(end) });
			return ACCEPTED;
		}
		this.emit({ type: "compaction_finished", outcome: compactionOutcome("released") });
		return ACCEPTED;
	}

	/** The next compaction waits until it is cancelled, aborted or released. */
	armSlowCompaction(): void {
		this.slowCompaction = true;
	}

	cancelCompaction(): ActionResult {
		this.endCompaction("cancelled");
		return ACCEPTED;
	}

	cancelRetry(): ActionResult {
		if (this.snapshot.retry) this.run?.cancelRetry();
		return ACCEPTED;
	}

	cancelQueued(id: QueueItemId): ActionResult {
		const result = this.inbox.cancel(id);
		if (result.status === "accepted") this.emitQueue();
		return result;
	}

	release(): void {
		this.endCompaction("released");
		this.run?.release();
	}

	private endCompaction(end: "cancelled" | "released"): void {
		const finish = this.compactionEnd;
		this.compactionEnd = undefined;
		finish?.(end);
	}

	runExternally(text: string, steps: FakeStep[]): void {
		if (this.run) throw new Error("the session is already running");
		this.scripts.unshift(steps);
		this.startRun("external", { type: "user_message", messageId: this.newId(), text, attachments: [] });
	}

	resync(): void {
		this.emit({ type: "resynced", snapshot: this.snapshot });
	}

	/** The backend process went away: every pending ask expires and the run fails. */
	loseBackend(): Promise<void> {
		const error = { code: "backend_unavailable", message: "the backend went away" } as const;
		this.emit({ type: "error", error, retryable: true });
		return this.endEverything({ kind: "error", error });
	}

	/** The bridge went away with the run in it: every pending ask expires and the run ends aborted. */
	endWithTheBridge(): Promise<void> {
		return this.endEverything({ kind: "aborted" });
	}

	/** Another client of the backend answered; the run goes on without this bridge's answer. */
	answerElsewhere(id: InteractionId): void {
		const waiter = this.takeWaiter(id);
		this.resolveInteraction(id, "withdrawn");
		waiter({ kind: "cancel", stopRun: false });
	}

	private endEverything(outcome: RunOutcome): Promise<void> {
		for (const interaction of this.snapshot.interactions) this.resolveInteraction(interaction.id, "expired");
		this.run?.abort(outcome);
		return this.settled;
	}

	private takeWaiter(id: InteractionId): (reply: InteractionReply) => void {
		const waiter = this.waiters.get(id);
		if (!waiter) throw new Error(`no run is waiting on interaction ${id}`);
		return waiter;
	}

	private admit(input: PromptInput): PromptResult {
		const problem = inputProblem(this.traits, input);
		if (problem) return problem;
		if (input.command === "/noop") return { status: "accepted", disposition: "handled" };
		if (!this.run) {
			this.startRun("prompt", this.inbox.deliver(this.newId(), input));
			return { status: "accepted", disposition: "started" };
		}
		if (input.mode === "start") return rejected("busy", "a run is active");
		const item = this.inbox.enqueue(input, input.mode);
		this.emitQueue();
		return {
			status: "accepted",
			disposition: input.mode === "steer" ? "steered" : "queued",
			...(this.traits.queue && { queueItemId: item.id }),
		};
	}

	private startRun(trigger: RunTrigger, message: UserMessageEvent): void {
		const run = new FakeRun(this, this.newId(), this.scripts.shift() ?? DEFAULT_REPLY);
		this.run = run;
		this.emit({ type: "run_started", runId: run.runId, trigger });
		this.emit(message);
		this.settled = run.play().then((outcome) => this.finishRun(run, outcome));
	}

	private finishRun(run: FakeRun, outcome: RunOutcome): void {
		for (const tool of [...this.snapshot.tools].reverse()) {
			this.emit({
				type: "tool_finished",
				toolCallId: tool.toolCallId,
				outcome: "aborted",
				result: { content: [{ kind: "text", text: tool.output }], fileChanges: tool.fileChanges },
			});
		}
		for (const block of this.snapshot.blocks)
			this.emit({ type: "block_finished", blockId: block.blockId, text: block.text });
		for (const interaction of this.snapshot.interactions.filter((pending) => pending.runId === run.runId)) {
			this.resolveInteraction(interaction.id, "withdrawn");
		}
		if (this.snapshot.retry) this.emit({ type: "retry_finished", succeeded: false });
		if (this.snapshot.compaction) this.emit({ type: "compaction_finished", outcome: { kind: "aborted" } });
		if (outcome.kind !== "completed" && this.inbox.dropSteers()) this.emitQueue();
		this.emit({ type: "run_finished", runId: run.runId, outcome });
		this.run = undefined;
		if (outcome.kind === "completed") this.dispatchQueued();
	}

	private dispatchQueued(): void {
		const next = this.inbox.takeNext();
		if (!next) return;
		this.emitQueue();
		this.startRun("queue", this.inbox.deliver(this.newId(), next));
	}

	private emitQueue(): void {
		if (this.traits.queue) this.emit({ type: "queue_changed", items: this.inbox.queue() });
	}

	private resolveInteraction(id: InteractionId, reason: ResolutionReason): void {
		this.waiters.delete(id);
		this.resolved.add(id);
		this.emit({ type: "interaction_resolved", interactionId: id, reason });
	}

	private refreshSummary(at: number, event: AgentEvent): void {
		const status = sessionStatus(this.snapshot);
		const title =
			this.summary.title ??
			(event.type === "user_message" && event.text !== ""
				? { text: event.text.slice(0, 280), source: "first_prompt" as const }
				: undefined);
		const changed =
			status !== this.summary.status ||
			title !== this.summary.title ||
			event.type === "model_changed" ||
			event.type === "run_finished";
		if (!changed) return;
		const { modelId: _model, title: _title, ...rest } = this.summary;
		this.summary = {
			...rest,
			...(title && { title }),
			...(this.snapshot.modelId !== undefined && { modelId: this.snapshot.modelId }),
			status,
			updatedAt: at,
		};
		this.env.catalog({ type: "session_updated", summary: this.summary });
	}
}
