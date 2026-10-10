import type { Context } from "@earendil-works/chord";
import type { Models, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
	AgentChange,
	AgentEvent,
	Cursor,
	EntryRecord,
	Extension,
	HarnessInspection,
	HarnessSettings,
	ModelRef,
	ScanOrder,
	SubmissionId,
	UserInput,
} from "@earendil-works/pi-durable";
import { chordContextModule, loadChordContext } from "../../sdk/chord";
import { loadPiDurableBackend, piDurableModule } from "../../sdk/pi-durable";
import { singleFlight } from "../../utils/single-flight";
import { PiDurablePermissions } from "./permissions";
import {
	closePiDurableSessionRuntime,
	inspectPiDurableSession,
	openPiDurableSessionRuntime,
	type PiDurableSessionRuntime,
} from "./session-runtime";
import { PiDurableSessionNotFoundError, PiDurableSessionStore } from "./session-store";

export const PI_DURABLE_IDLE_TIMEOUT_MS = 15 * 60_000;
export const PI_DURABLE_TRANSCRIPT_LIMIT = 200;

export type PiDurableInterruptedTask = { taskId: number; kind: string; status: string };
export type PiDurableInterruptedSubmission = { submissionId: number; type: string; status: string };

export type PiDurableInterruptedWork = {
	tasks: PiDurableInterruptedTask[];
	submissions: PiDurableInterruptedSubmission[];
};

export type PiDurableInterruptedWorkCollector = (
	runtime: PiDurableSessionRuntime,
	context: Context,
) => Promise<PiDurableInterruptedWork>;

export type PiDurableLiveWorkProbe = (runtime: PiDurableSessionRuntime) => Promise<boolean>;

export type PiDurableOpenResult = {
	sessionId: string;
	cwd: string;
	model?: ModelRef;
	thinkingLevel: ModelThinkingLevel;
	interrupted: PiDurableInterruptedWork;
};

export type PiDurableSendDraft = {
	content: UserInput;
	requestId?: string;
	whenBusy?: "steer" | "followUp" | "reject";
};

export type PiDurableConfigureChange = {
	model?: ModelRef;
	thinkingLevel?: ModelThinkingLevel;
};

export type PiDurableTranscriptOptions = {
	limit?: number;
	cursor?: Cursor;
	order?: ScanOrder;
};

export type PiDurableTranscriptPage = {
	entries: EntryRecord[];
	nextCursor?: Cursor;
};

export type PiDurableHarnessHostOptions = {
	models: Models;
	root?: string;
	defaultModel?: ModelRef;
	defaultThinkingLevel?: ModelThinkingLevel;
	isSubscription?: (providerId: string) => boolean;
	extensions?: readonly Extension[];
	permissions?: PiDurablePermissions;
	settings?: HarnessSettings;
	idleTimeoutMs?: number;
	context?: Context;
	collectInterruptedWork?: PiDurableInterruptedWorkCollector;
	hasLiveWork?: PiDurableLiveWorkProbe;
};

export class PiDurableModelRequiredError extends Error {
	constructor(sessionId: string) {
		super(`pi-durable session ${sessionId} has no model: configure one before sending`);
		this.name = "PiDurableModelRequiredError";
	}
}

type PiDurableOpenSession = {
	runtime: PiDurableSessionRuntime;
	cwd: string;
	watchers: number;
	idleTimer?: ReturnType<typeof setTimeout>;
};

const EMPTY_INTERRUPTED: PiDurableInterruptedWork = { tasks: [], submissions: [] };

async function collectInterruptedWork(
	runtime: PiDurableSessionRuntime,
	context: Context,
): Promise<PiDurableInterruptedWork> {
	const inspection = await inspectPiDurableSession(runtime, context);
	return {
		tasks: inspection.tasks.map((task) => ({
			taskId: task.record.id,
			kind: task.record.kind,
			status: task.record.state.status,
		})),
		submissions: inspection.submissions.map((record) => ({
			submissionId: record.id,
			type: record.type,
			status: record.status,
		})),
	};
}

/**
 * Owns the open pi-durable harnesses of one bridge process: one JSONL storage per session, guarded by our lock file,
 * with a shared model runtime. Nothing here knows about the WebSocket protocol.
 */
export class PiDurableHarnessHost {
	readonly store: PiDurableSessionStore;
	readonly permissions: PiDurablePermissions;
	readonly isSubscription: (providerId: string) => boolean;

	private readonly models: Models;
	private readonly defaultModel: ModelRef | undefined;
	private readonly defaultThinkingLevel: ModelThinkingLevel | undefined;
	private readonly extensions: readonly Extension[];
	private readonly settings: HarnessSettings | undefined;
	private readonly idleTimeoutMs: number;
	private readonly fallbackContext: Context | undefined;
	private boundContext: Context | undefined;
	private readonly collectInterrupted: PiDurableInterruptedWorkCollector;
	private readonly liveWorkProbe: PiDurableLiveWorkProbe | undefined;
	private readonly sessions = new Map<string, PiDurableOpenSession>();
	private readonly opening = new Map<string, Promise<PiDurableOpenResult>>();

	constructor(options: PiDurableHarnessHostOptions) {
		this.models = options.models;
		this.store = new PiDurableSessionStore({ root: options.root });
		this.permissions = options.permissions ?? new PiDurablePermissions();
		this.isSubscription = options.isSubscription ?? (() => false);
		this.defaultModel = options.defaultModel;
		this.defaultThinkingLevel = options.defaultThinkingLevel;
		this.extensions = options.extensions ?? [];
		this.settings = options.settings;
		this.idleTimeoutMs = options.idleTimeoutMs ?? PI_DURABLE_IDLE_TIMEOUT_MS;
		this.fallbackContext = options.context;
		this.collectInterrupted = options.collectInterruptedWork ?? collectInterruptedWork;
		this.liveWorkProbe = options.hasLiveWork;
	}

	private async resolveContext(): Promise<Context> {
		if (this.boundContext !== undefined) return this.boundContext;
		if (this.fallbackContext !== undefined) {
			this.boundContext = this.fallbackContext;
			return this.boundContext;
		}
		await loadChordContext();
		this.boundContext = chordContextModule().BACKGROUND_CONTEXT;
		return this.boundContext;
	}

	isOpen(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	openSessionIds(): string[] {
		return [...this.sessions.keys()];
	}

	async open(sessionId: string): Promise<PiDurableOpenResult> {
		const existing = this.sessions.get(sessionId);
		if (existing !== undefined) {
			return this.describe(sessionId, existing, EMPTY_INTERRUPTED);
		}
		return singleFlight(this.opening, sessionId, () => this.openUnopened(sessionId));
	}

	private async openUnopened(sessionId: string): Promise<PiDurableOpenResult> {
		await loadPiDurableBackend();
		const meta = await this.store.read(sessionId);
		if (meta === undefined) throw new PiDurableSessionNotFoundError(sessionId);
		const model = meta.model ?? this.defaultModel;
		if (model === undefined) throw new PiDurableModelRequiredError(sessionId);
		const thinkingLevel = meta.thinkingLevel ?? this.defaultThinkingLevel;
		const agent: AgentChange = { model, cwd: meta.cwd, ...(thinkingLevel !== undefined ? { thinkingLevel } : {}) };

		const runtime = await openPiDurableSessionRuntime({
			sessionId,
			directory: this.store.sessionDir(sessionId),
			cwd: meta.cwd,
			models: this.models,
			agent,
			extensions: [...this.extensions, this.permissions.extensionFor(sessionId)],
			...(this.settings !== undefined ? { settings: this.settings } : {}),
			context: await this.resolveContext(),
		});

		let interrupted: PiDurableInterruptedWork;
		try {
			interrupted = await this.collectInterrupted(runtime, await this.resolveContext());
			runtime.harness.resume();
		} catch (error) {
			await closePiDurableSessionRuntime(runtime, await this.resolveContext());
			throw error;
		}
		const entry: PiDurableOpenSession = { runtime, cwd: meta.cwd, watchers: 0 };
		this.sessions.set(sessionId, entry);
		this.armIdleTimer(sessionId);
		return this.describe(sessionId, entry, interrupted);
	}

	async send(sessionId: string, draft: PiDurableSendDraft): Promise<SubmissionId> {
		const entry = await this.ensureOpen(sessionId);
		const submission = await entry.runtime.conversation.submit(
			{
				type: "input",
				content: draft.content,
				...(draft.requestId !== undefined ? { requestId: draft.requestId } : {}),
				...(draft.whenBusy !== undefined ? { whenBusy: draft.whenBusy } : {}),
			},
			await this.resolveContext(),
		);
		return submission.id;
	}

	async abort(sessionId: string): Promise<void> {
		const entry = await this.ensureOpen(sessionId);
		await entry.runtime.conversation.abort(await this.resolveContext());
	}

	/** Admits a manual compaction: the summary is placed at the next boundary while the conversation keeps working. */
	async compact(sessionId: string, instructions?: string): Promise<void> {
		const entry = await this.ensureOpen(sessionId);
		await entry.runtime.conversation.compact(instructions, await this.resolveContext());
	}

	async configure(sessionId: string, change: PiDurableConfigureChange): Promise<void> {
		const entry = await this.ensureOpen(sessionId);
		await entry.runtime.conversation.configure(
			{
				...(change.model !== undefined ? { model: change.model } : {}),
				...(change.thinkingLevel !== undefined ? { thinkingLevel: change.thinkingLevel } : {}),
			},
			await this.resolveContext(),
		);
		await this.store.update(sessionId, change);
	}

	/** The first callback carries the attachment snapshot; later ones carry committed batches. */
	async watch(sessionId: string, listener: (events: readonly AgentEvent[]) => void): Promise<() => Promise<void>> {
		const entry = await this.ensureOpen(sessionId);
		const stream = await piDurableModule().watchEvents(
			entry.runtime.harness,
			entry.runtime.conversation.id,
			await this.resolveContext(),
		);
		entry.watchers += 1;
		this.clearIdleTimer(entry);
		listener([stream.snapshot]);
		stream.start(async (events) => {
			listener(events);
		});
		let stopped = false;
		return async () => {
			if (stopped) return;
			stopped = true;
			await stream.stop();
			entry.watchers -= 1;
			if (entry.watchers <= 0) this.armIdleTimer(sessionId);
		};
	}

	async transcript(sessionId: string, options: PiDurableTranscriptOptions = {}): Promise<PiDurableTranscriptPage> {
		const entry = await this.ensureOpen(sessionId);
		const page = await entry.runtime.conversation.entries(
			{ order: options.order ?? "ascending" },
			options.limit ?? PI_DURABLE_TRANSCRIPT_LIMIT,
			options.cursor,
			await this.resolveContext(),
		);
		return { entries: [...page.items], ...(page.next !== undefined ? { nextCursor: page.next } : {}) };
	}

	async inspect(sessionId: string): Promise<HarnessInspection> {
		const entry = await this.ensureOpen(sessionId);
		return inspectPiDurableSession(entry.runtime, await this.resolveContext());
	}

	async close(sessionId: string): Promise<void> {
		const entry = this.sessions.get(sessionId);
		if (entry === undefined) return;
		this.sessions.delete(sessionId);
		this.clearIdleTimer(entry);
		await closePiDurableSessionRuntime(entry.runtime, await this.resolveContext());
	}

	async closeAll(): Promise<void> {
		for (const sessionId of this.openSessionIds()) await this.close(sessionId);
	}

	private async describe(
		sessionId: string,
		entry: PiDurableOpenSession,
		interrupted: PiDurableInterruptedWork,
	): Promise<PiDurableOpenResult> {
		const agent = await entry.runtime.conversation.agent(await this.resolveContext());
		return {
			sessionId,
			cwd: entry.cwd,
			...(agent.model !== undefined ? { model: agent.model } : {}),
			thinkingLevel: agent.thinkingLevel,
			interrupted,
		};
	}

	private async ensureOpen(sessionId: string): Promise<PiDurableOpenSession> {
		const existing = this.sessions.get(sessionId);
		if (existing !== undefined) {
			this.clearIdleTimer(existing);
			return existing;
		}
		await this.open(sessionId);
		const opened = this.sessions.get(sessionId);
		if (opened === undefined) throw new PiDurableSessionNotFoundError(sessionId);
		return opened;
	}

	private armIdleTimer(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (entry === undefined || this.idleTimeoutMs <= 0) return;
		this.clearIdleTimer(entry);
		const timer = setTimeout(() => {
			void this.checkIdle(sessionId);
		}, this.idleTimeoutMs);
		timer.unref?.();
		entry.idleTimer = timer;
	}

	private clearIdleTimer(entry: PiDurableOpenSession): void {
		if (entry.idleTimer === undefined) return;
		clearTimeout(entry.idleTimer);
		entry.idleTimer = undefined;
	}

	private async checkIdle(sessionId: string): Promise<void> {
		const entry = this.sessions.get(sessionId);
		if (entry === undefined) return;
		entry.idleTimer = undefined;
		if (entry.watchers > 0) return;
		if (await this.hasLiveWork(entry)) {
			this.armIdleTimer(sessionId);
			return;
		}
		if (this.sessions.get(sessionId) !== entry || entry.watchers > 0) return;
		await this.close(sessionId);
	}

	private async hasLiveWork(entry: PiDurableOpenSession): Promise<boolean> {
		if (this.liveWorkProbe !== undefined) return this.liveWorkProbe(entry.runtime);
		try {
			const inspection = await entry.runtime.harness.inspect(await this.resolveContext());
			return inspection.tasks.length > 0 || inspection.submissions.length > 0;
		} catch {
			return true;
		}
	}
}
