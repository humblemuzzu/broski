import type {
	BackendHost,
	BackendMeta,
	BackendTraits,
	OpenResult,
	OpenTarget,
	SessionControl,
	SessionSink,
} from "../backend";
import type { CatalogEvent } from "../catalog-events";
import type { BackendId, SessionRef, ToolCallId } from "../ids";
import type { ActionResult } from "../input";
import type { ModeAxis } from "../modes";
import type { SessionGetResult } from "../read-results";
import type { Rejected } from "../rejection";
import { emptySnapshot } from "../session-reducer";
import {
	type ForkPoint,
	type NewSessionOptions,
	type NewSessionResult,
	type ParentKind,
	type SessionQuery,
	type SessionSummary,
	searchWords,
	sessionMatches,
} from "../sessions";
import type { SessionSnapshot } from "../snapshot";
import type { TranscriptItem } from "../transcript";
import { type FakeEnvironment, FakeSession } from "./fake-session";
import { defaultModelId, initialModes, newSessionProblem, rejected } from "./fake-validation";

/** Which optional members the fake has; an absent member is a capability it lacks. */
export interface FakeMethods {
	readonly rename: boolean;
	readonly delete: boolean;
	readonly fork: boolean;
	readonly compact: boolean;
	readonly cancelQueued: boolean;
}

export interface FakeSettings {
	readonly id: BackendId;
	readonly meta: BackendMeta;
	readonly traits: BackendTraits;
	readonly methods: FakeMethods;
	readonly modes: readonly ModeAxis[];
	readonly now: () => number;
	readonly newId: () => string;
	readonly runsSurviveRestart: boolean;
}

export interface SeedOptions {
	readonly cwd: string;
	readonly title?: string;
	/** Created by another client; it can be watched but not controlled. */
	readonly external?: boolean;
	/** With `external`: its asks can still be answered here, as a terminal's permission prompt can. */
	readonly answerable?: boolean;
	readonly parent?: SessionRef;
}

/** The sessions the fake backend keeps, which outlive a restart of the bridge. */
export type FakeStore = Map<string, FakeSession>;

interface OpenView {
	readonly session: FakeSession;
	closed: boolean;
	close(): void;
}

/** The fake backend between two restarts of the bridge: its open views and catalog over the shared store. */
export class FakeWorld implements FakeEnvironment {
	private readonly views = new Set<OpenView>();
	private disposed = false;

	constructor(
		private readonly host: BackendHost,
		readonly settings: FakeSettings,
		readonly sessions: FakeStore,
	) {}

	get id(): BackendId {
		return this.settings.id;
	}

	get traits(): BackendTraits {
		return this.settings.traits;
	}

	get modes(): readonly ModeAxis[] {
		return this.settings.modes;
	}

	now(): number {
		return this.settings.now();
	}

	newId(): string {
		return this.settings.newId();
	}

	catalog(event: CatalogEvent): void {
		if (!this.disposed) this.host.catalog.emit(event);
	}

	createChild(parent: SessionRef, parentToolCallId: ToolCallId): SessionRef {
		const child = this.create({ cwd: this.session(parent).cwd, parent }, false);
		child.summary = { ...child.summary, title: { text: `Subagent of ${parentToolCallId}`, source: "generated" } };
		this.catalog({ type: "session_updated", summary: child.summary });
		return child.summary.session;
	}

	splitOff(live: FakeSession): SessionRef {
		const history = new FakeSession(this, live.cwd, { ...live.summary, status: "idle" }, false, this.idleSnapshot([]));
		history.history.append(live.history.items());
		this.sessions.set(history.summary.session.sessionId, history);
		this.catalog({ type: "session_updated", summary: history.summary });
		const next: SessionRef = { backend: this.id, sessionId: this.newId() };
		this.sessions.set(next.sessionId, live);
		return next;
	}

	rows(query: SessionQuery): SessionSummary[] {
		const words = searchWords(query.search ?? "");
		return [...this.sessions.values()]
			.map((session) => session.summary)
			.filter(
				(row) =>
					(query.cwd === undefined || row.cwd === query.cwd) &&
					sameRef(row.parent?.session, query.parent) &&
					sessionMatches(words, row.title?.text, row.cwd),
			);
	}

	/** The session `ref` names, when this backend has it. */
	find(ref: SessionRef): FakeSession | Rejected {
		const session = ref.backend === this.id ? this.sessions.get(ref.sessionId) : undefined;
		return session ?? rejected("not_found", `no session ${ref.backend}/${ref.sessionId}`);
	}

	summary(ref: SessionRef): SessionGetResult {
		const found = this.find(ref);
		return found instanceof FakeSession ? { status: "accepted", summary: found.summary } : found;
	}

	open(target: OpenTarget, sink: SessionSink): OpenResult {
		const session = target.kind === "new" ? this.createForOpen(target.options) : this.find(target.session);
		if (!(session instanceof FakeSession)) return session;
		const view: OpenView = {
			session,
			closed: false,
			close: () => {
				view.closed = true;
				session.detach(sink);
				this.views.delete(view);
			},
		};
		session.attach(sink);
		this.views.add(view);
		const methods = this.settings.methods;
		return {
			status: "accepted",
			session: {
				get session() {
					return session.summary.session;
				},
				snapshot: () => session.snapshot,
				...(session.external
					? session.answersWatched && { answer: watchedAnswer(session, () => view.closed) }
					: { control: control(session, methods, () => view.closed) }),
				close: async () => view.close(),
			},
			snapshot: session.snapshot,
		};
	}

	rename(ref: SessionRef, title: string): ActionResult {
		return this.update(ref, (summary) => ({ ...summary, title: { text: title, source: "user" } }));
	}

	delete(ref: SessionRef): ActionResult {
		const found = this.find(ref);
		if (!(found instanceof FakeSession)) return found;
		this.sessions.delete(ref.sessionId);
		for (const view of [...this.views]) {
			if (view.session === found) view.close();
		}
		this.catalog({ type: "session_removed", session: ref });
		return { status: "accepted" };
	}

	fork(ref: SessionRef, at: ForkPoint | undefined): NewSessionResult {
		const found = this.find(ref);
		if (!(found instanceof FakeSession)) return found;
		const items = found.history.items();
		const end = at === undefined ? items.length : forkEnd(items, at);
		if (end === undefined) return rejected("not_found", "no such item");
		const fork = this.create({ cwd: found.cwd, parent: ref }, false, "fork");
		fork.history.append(items.slice(0, end));
		this.catalog({ type: "session_updated", summary: fork.summary });
		return { status: "accepted", session: fork.summary.session };
	}

	seed(options: SeedOptions): SessionRef {
		const session = this.create(options, options.external ?? false);
		session.answersWatched = options.answerable ?? false;
		const at = this.now();
		const messageId = this.newId();
		session.history.append([
			{ kind: "user_message", id: this.newId(), at, text: "Hello", attachments: [] },
			{ kind: "block", id: this.newId(), at, messageId, block: "text", text: "Hi." },
			{ kind: "run_boundary", id: this.newId(), at, outcome: { kind: "completed" } },
		]);
		session.summary = {
			...session.summary,
			title: { text: options.title ?? "Hello", source: options.title ? "user" : "first_prompt" },
		};
		this.catalog({ type: "session_updated", summary: session.summary });
		return session.summary.session;
	}

	/** A session the test named; a missing one is a mistake in the test. */
	session(ref: SessionRef): FakeSession {
		const session = this.sessions.get(ref.sessionId);
		if (!session) throw new Error(`the fake has no session ${ref.sessionId}`);
		return session;
	}

	dispose(): void {
		for (const view of [...this.views]) view.close();
		this.disposed = true;
	}

	private createForOpen(options: NewSessionOptions): FakeSession | Rejected {
		const problem = newSessionProblem(options, this.traits, this.modes);
		if (problem) return problem;
		const session = this.create({ cwd: options.cwd }, false, "subagent", options);
		this.catalog({ type: "session_updated", summary: session.summary });
		return session;
	}

	private create(
		options: { cwd: string; parent?: SessionRef },
		external: boolean,
		parentKind: ParentKind = "subagent",
		settings: Pick<NewSessionOptions, "modelId" | "thinking" | "modes"> = {},
	): FakeSession {
		const now = this.now();
		const ref: SessionRef = { backend: this.id, sessionId: this.newId() };
		const snapshot = this.idleSnapshot(settings.modes ?? [], settings.modelId, settings.thinking);
		const summary: SessionSummary = {
			session: ref,
			cwd: options.cwd,
			createdAt: now,
			updatedAt: now,
			...(options.parent && { parent: { kind: parentKind, session: options.parent } }),
			...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
			status: "idle",
			origin: external ? "external" : "broski",
		};
		const session = new FakeSession(this, options.cwd, summary, external, snapshot);
		this.sessions.set(ref.sessionId, session);
		return session;
	}

	private idleSnapshot(
		modes: NonNullable<NewSessionOptions["modes"]>,
		modelId = defaultModelId(),
		thinking?: string,
	): SessionSnapshot {
		return {
			...emptySnapshot(),
			modelId,
			...(thinking !== undefined && { thinking }),
			modes: initialModes(this.modes, modes),
		};
	}

	private update(ref: SessionRef, change: (summary: SessionSummary) => SessionSummary): ActionResult {
		const found = this.find(ref);
		if (!(found instanceof FakeSession)) return found;
		found.summary = { ...change(found.summary), updatedAt: this.now() };
		this.catalog({ type: "session_updated", summary: found.summary });
		return { status: "accepted" };
	}
}

/** Where a fork ends in `items`, or undefined when the item is not in the history. */
function forkEnd(items: readonly TranscriptItem[], at: ForkPoint): number | undefined {
	const index = items.findIndex((item) => item.id === at.itemId);
	if (index < 0) return undefined;
	return at.position === "before" ? index : index + 1;
}

const CLOSED = rejected("closed", "the session is closed");

function control(session: FakeSession, methods: FakeMethods, isClosed: () => boolean): SessionControl {
	return {
		prompt: async (input) => (isClosed() ? CLOSED : session.prompt(input)),
		abort: async () => (isClosed() ? CLOSED : session.abort()),
		answer: async (answer) => (isClosed() ? CLOSED : session.answer(answer)),
		setModel: async (modelId) => (isClosed() ? CLOSED : session.setModel(modelId)),
		setThinking: async (value) => (isClosed() ? CLOSED : session.setThinking(value)),
		setMode: async (axis, value) => (isClosed() ? CLOSED : session.setMode({ axis, value })),
		...(methods.compact && { compact: async () => (isClosed() ? CLOSED : session.compact()) }),
		...(methods.cancelQueued && { cancelQueued: async (id) => (isClosed() ? CLOSED : session.cancelQueued(id)) }),
	};
}

function watchedAnswer(session: FakeSession, isClosed: () => boolean): SessionControl["answer"] {
	return async (answer) => (isClosed() ? CLOSED : session.answer(answer));
}

function sameRef(a: SessionRef | undefined, b: SessionRef | undefined): boolean {
	return a?.backend === b?.backend && a?.sessionId === b?.sessionId;
}
