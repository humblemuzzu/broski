/**
 * One session this bridge hosts in `agy`: a worker of the live front, its presence lock held for as long as it is
 * hosted, and its live state. Every event is applied to that state, whether or not a view is attached, so the snapshot
 * the next view gets is the state those events built. A host ends once: lost (its worker or the front went; its turn
 * ends failed), closed (`session/close` frees the worker), or shut down with the bridge.
 */

import type { z } from "zod";
import { LiveState } from "../../../adapter-kit/live-state";
import type { LockFile } from "../../../adapter-kit/ports";
import { ACCEPTED, rejected } from "../../../adapter-kit/rejections";
import {
	type ActionResult,
	type AgentEvent,
	type CatalogSink,
	type CommandSummary,
	type InteractionAnswer,
	MAX_NAME_CHARS,
	type PromptInput,
	type PromptResult,
	type SessionSink,
	type SessionSnapshot,
	type SessionSummary,
	type SinkRecord,
} from "../../../contract";
import {
	AnyResult,
	type AvailableCommand,
	type ConfigOption,
	isOffered,
	PromptResult as PromptAnswer,
	type SessionUpdate,
	SetConfigOptionResult,
	type TurnUsage,
} from "../acp/frames";
import { NO_DEADLINE, type RpcResult, type SessionRoute } from "../acp/rpc";
import type { AgyProcess } from "../agy-process";
import { commandSummaries } from "../catalog/commands";
import { MODE_AXIS_ID } from "../catalog/modes";
import { AgyAsks } from "./asks";
import type { Evictable } from "./cap";
import { HostRow, type RowFacts } from "./host-row";
import { isWorkerLoss } from "./outcomes";
import type { PhonePrompts } from "./phone-prompts";
import {
	type Choice,
	chosenAgain,
	modeChoice,
	modelChoice,
	offeredKey,
	settingEvents,
	settingsOf,
	snapshotOf,
	thinkingChoice,
} from "./settings";
import { Turns } from "./turns";
import { withContext, withTurnCache } from "./usage";

export interface HostFacts extends RowFacts {
	readonly options: readonly ConfigOption[];
}

export interface HostDeps {
	readonly agy: AgyProcess;
	readonly lock: LockFile;
	readonly prompts: PhonePrompts;
	readonly catalog: CatalogSink;
	/** agy offers other models or modes: the kept catalog of them is stale. */
	readonly catalogChanged: () => void;
	/** agy announced the session's commands, which a new session in its folder is offered too. */
	readonly commandsAnnounced: (cwd: string | undefined, commands: readonly CommandSummary[]) => void;
	readonly now: () => number;
	readonly log: (message: string) => void;
	/** A turn of this host's ended: the session's row and history changed. */
	readonly ran: (host: AgyHost) => void;
	/** The host has nothing in flight. */
	readonly idle: (host: AgyHost) => void;
	/** The host ended; it hosts nothing any more. */
	readonly ended: (host: AgyHost) => void;
}

export class AgyHost implements Evictable {
	readonly sessionId: string;
	readonly cwd: string | undefined;
	lastUsedAt: number;
	private readonly live: LiveState;
	private readonly row: HostRow;
	private readonly asks: AgyAsks;
	private readonly turns: Turns;
	private options: readonly ConfigOption[];
	private commands: readonly AvailableCommand[] | undefined;
	private calls = 0;
	private done = false;
	private readonly detachRoute: () => void;

	constructor(
		private readonly deps: HostDeps,
		facts: HostFacts,
	) {
		this.sessionId = facts.sessionId;
		this.cwd = facts.cwd;
		this.options = facts.options;
		this.lastUsedAt = deps.now();
		this.live = new LiveState(snapshotOf(settingsOf(facts.options)), deps.now);
		this.row = new HostRow(facts, () => this.live.snapshot(), deps.catalog, deps.now);
		this.asks = new AgyAsks({
			emit: (record) => this.record(record),
			stopRun: () => void this.abort(),
			now: deps.now,
		});
		this.turns = this.turnsOf();
		this.detachRoute = deps.agy.acp.rpc.attach(facts.sessionId, this.route());
	}

	get ended(): boolean {
		return this.done;
	}

	get viewed(): boolean {
		return this.live.attached;
	}

	/** The prompt of the run under way, as the transcript shows it. */
	get runningPrompt(): string | undefined {
		return this.turns.runningPrompt;
	}

	idle(): boolean {
		return !this.done && !this.turns.busy && !this.asks.any && this.calls === 0;
	}

	snapshot(): SessionSnapshot {
		return this.live.snapshot();
	}

	/** Events reach `sink` from now on, and the session's row is announced. */
	attach(sink: SessionSink): void {
		this.live.attach(sink);
		this.row.announceFromNow();
	}

	detach(sink: SessionSink): void {
		this.live.detach(sink);
	}

	summary(): SessionSummary {
		return this.row.summary();
	}

	commandList(): CommandSummary[] | undefined {
		return this.commands === undefined ? undefined : commandSummaries(this.commands);
	}

	prompt(input: PromptInput): PromptResult {
		this.lastUsedAt = this.deps.now();
		return this.turns.prompt(input);
	}

	compact(instructions: string | undefined): ActionResult {
		this.lastUsedAt = this.deps.now();
		return this.turns.compact(instructions);
	}

	abort(): ActionResult {
		return this.turns.abort();
	}

	answer(answer: InteractionAnswer): ActionResult {
		this.lastUsedAt = this.deps.now();
		return this.asks.answer(answer);
	}

	setModel(modelId: string): Promise<ActionResult> {
		return this.choose(modelChoice(this.options, modelId));
	}

	setThinking(value: string): Promise<ActionResult> {
		return this.choose(thinkingChoice(this.options, value));
	}

	setMode(axis: string, value: string): Promise<ActionResult> {
		return this.choose(modeChoice(this.options, axis, value));
	}

	/** What a load replays of the session beyond its history: its context fill, commands and title. */
	replayed(update: SessionUpdate): void {
		this.update(update);
	}

	/** The worker or the front went: the turn ends failed, the asks are withdrawn, and the lock is let go. */
	lose(reason: string): void {
		if (this.done) return;
		this.done = true;
		this.turns.lose(reason);
		this.asks.withdrawAll();
		this.release();
	}

	/** `session/close`, which ends the session's worker; only an idle host is closed. */
	async close(): Promise<void> {
		if (this.done) return;
		this.done = true;
		if (isOffered(this.deps.agy.agent.agentCapabilities?.sessionCapabilities?.close)) {
			await this.deps.agy.acp.rpc.request("session/close", { sessionId: this.sessionId }, AnyResult);
		}
		this.release();
	}

	/** The bridge is shutting down: nothing answers any more, and the front's stop ends the worker. */
	shutDown(): void {
		if (this.done) return;
		this.done = true;
		this.asks.expireAll();
		this.detachRoute();
		this.deps.ended(this);
	}

	/** The lock of a host shut down, once the front and its workers have stopped. */
	releaseLock(): void {
		this.deps.lock.release();
	}

	private release(): void {
		this.detachRoute();
		this.deps.lock.release();
		this.deps.ended(this);
	}

	private turnsOf(): Turns {
		const { sessionId } = this;
		return new Turns({
			sessionId,
			asks: this.asks,
			prompts: this.deps.prompts,
			emit: (event) => this.emit(event),
			snapshot: () => this.live.snapshot(),
			request: (prompt) => this.request("session/prompt", { sessionId, prompt }, PromptAnswer, NO_DEADLINE),
			cancel: () => this.deps.agy.acp.rpc.notify("session/cancel", { sessionId }),
			commands: () => (this.commands === undefined ? undefined : new Set(this.commands.map((command) => command.name))),
			turnUsage: (usage) => this.turnUsage(usage),
			ran: () => {
				this.row.ran();
				this.deps.ran(this);
			},
			settled: () => this.settled(),
		});
	}

	private route(): SessionRoute {
		return {
			update: (update) => this.update(update),
			call: (call) => {
				this.lastUsedAt = this.deps.now();
				this.turns.call(call);
			},
			fault: (message) => this.deps.log(`session ${this.sessionId}: ${message}`),
		};
	}

	private update(update: SessionUpdate): void {
		switch (update.sessionUpdate) {
			case "usage_update":
				this.contextReported(update.used, update.size);
				return;
			case "session_info_update":
				this.row.titled(update.title);
				return;
			case "available_commands_update":
				this.commands = update.availableCommands;
				this.deps.commandsAnnounced(this.cwd, commandSummaries(update.availableCommands));
				this.deps.catalog.emit({ type: "catalog_invalidated", scope: "commands" });
				return;
			case "config_option_update":
				this.optionsChanged(update.configOptions);
				return;
			case "current_mode_update":
				this.modeChanged(update.currentModeId);
				return;
			case "user_message_chunk":
				return;
			default:
				this.turns.update(update);
		}
	}

	/** One `session/set_config_option`; its answer holds every option as it now is. */
	private async choose(choice: Choice | ActionResult): Promise<ActionResult> {
		if ("status" in choice) return choice;
		if (this.options.some((option) => option.id === choice.configId && option.currentValue === choice.value)) {
			this.emit(chosenAgain(this.live.snapshot(), this.options, choice));
			return ACCEPTED;
		}
		const { sessionId } = this;
		const set = await this.request("session/set_config_option", { sessionId, ...choice }, SetConfigOptionResult);
		if (!set.ok) return rejected("backend_error", `Antigravity did not take the setting: ${set.failure.message}`);
		this.optionsChanged(set.result.configOptions);
		return ACCEPTED;
	}

	/** Every request of the session's, so a worker that went is seen whichever request meets it first. */
	private async request<T>(method: string, params: unknown, schema: z.ZodType<T>, deadline?: number) {
		this.lastUsedAt = this.deps.now();
		this.calls += 1;
		const result: RpcResult<T> = await this.deps.agy.acp.rpc.request(method, params, schema, deadline);
		this.calls -= 1;
		if (!result.ok && (isWorkerLoss(result.failure) || !this.deps.agy.acp.running)) this.lose(result.failure.message);
		else this.settled();
		return result;
	}

	/**
	 * agy offering other models or modes means the lists the phone has are stale, and so does a model's own levels
	 * changing while it stays selected; another model's levels are that model's, which the catalog already lists.
	 */
	private optionsChanged(options: readonly ConfigOption[]): void {
		const before = this.options;
		this.options = options;
		for (const event of settingEvents(this.live.snapshot(), settingsOf(options))) this.emit(event);
		const sameModel = settingsOf(before).modelId === settingsOf(options).modelId;
		const models =
			offeredKey(before, "model") !== offeredKey(options, "model") ||
			(sameModel && offeredKey(before, "thought_level") !== offeredKey(options, "thought_level"));
		const modes = offeredKey(before, MODE_AXIS_ID) !== offeredKey(options, MODE_AXIS_ID);
		if (models || modes) this.deps.catalogChanged();
		if (models) this.deps.catalog.emit({ type: "catalog_invalidated", scope: "models" });
		if (modes) this.deps.catalog.emit({ type: "catalog_invalidated", scope: "modes" });
	}

	private modeChanged(value: string): void {
		const current = this.live.snapshot().modes.find((setting) => setting.axis === MODE_AXIS_ID)?.value;
		if (value === current || value === "" || value.length > MAX_NAME_CHARS) return;
		this.emit({ type: "mode_changed", axis: MODE_AXIS_ID, value });
	}

	/** An update that says what the snapshot already holds changes nothing, so nothing is emitted. */
	private contextReported(used: number, size: number): void {
		const before = this.live.snapshot().usage;
		const next = withContext(before, used, size);
		if (next !== before && next !== undefined) this.emit({ type: "usage_updated", usage: next });
	}

	private turnUsage(usage: TurnUsage): void {
		const snapshot = this.live.snapshot();
		const next = withTurnCache(snapshot.usage, usage, this.deps.now());
		if (next !== snapshot.usage && next !== undefined) this.emit({ type: "usage_updated", usage: next });
	}

	private settled(): void {
		if (this.idle()) this.deps.idle(this);
	}

	private emit(event: AgentEvent): void {
		this.live.emit(event);
		this.row.touched();
	}

	/** The ask desk's records, whose time is the desk's. */
	private record(record: SinkRecord): void {
		this.live.emit(record.event, record.native, record.at);
		this.row.touched();
		if (record.event.type === "interaction_resolved") this.settled();
	}
}
