import type {
	AgentBackend,
	BackendTraits,
	CatalogSink,
	OpenSession,
	OpenTarget,
	SessionControl,
	SessionSink,
	SinkRecord,
} from "../backend";
import { CatalogEvent } from "../catalog-events";
import type { AgentEvent } from "../events";
import type { RunId, SessionRef } from "../ids";
import type { PromptInput, PromptMode, PromptResult } from "../input";
import type { JsonValue } from "../json";
import type { RunOutcome } from "../runs";
import { applyEvent } from "../session-reducer";
import type { NewSessionOptions } from "../sessions";
import type { SessionSnapshot } from "../snapshot";
import type { ConformanceDriver, Scenario } from "./conformance-types";
import { streamViolations, unsettledParts } from "./stream-rules";

export class ConformanceFailure extends Error {}

export function fail(message: string): never {
	throw new ConformanceFailure(message);
}

export function expect(condition: boolean, message: string): asserts condition {
	if (!condition) fail(message);
}

type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;

function isEvent<T extends AgentEvent["type"]>(event: AgentEvent, type: T): event is EventOf<T> {
	return event.type === type;
}

/** Collects what a sink receives and lets a rule wait for something to arrive. */
class Recorder<T> {
	readonly items: T[] = [];
	private readonly listeners = new Set<() => void>();

	constructor(private readonly timeoutMs: number) {}

	push(item: T): void {
		this.items.push(item);
		for (const listener of this.listeners) listener();
	}

	waitFor<R>(find: (items: readonly T[]) => R | undefined, what: string): Promise<R> {
		const found = find(this.items);
		if (found !== undefined) return Promise.resolve(found);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.listeners.delete(check);
				reject(new ConformanceFailure(`timed out after ${this.timeoutMs} ms waiting for ${what}`));
			}, this.timeoutMs);
			const check = () => {
				const match = find(this.items);
				if (match === undefined) return;
				clearTimeout(timer);
				this.listeners.delete(check);
				resolve(match);
			};
			this.listeners.add(check);
		});
	}
}

export class CatalogRecorder extends Recorder<CatalogEvent> implements CatalogSink {
	emit(event: CatalogEvent): void {
		const parsed = CatalogEvent.safeParse(event);
		if (!parsed.success) fail(`an invalid catalog event: ${parsed.error.message}`);
		this.push(event);
	}
}

export class SessionRecorder extends Recorder<SinkRecord> implements SessionSink {
	private closedAt: number | undefined;

	emit(record: SinkRecord): void {
		this.push(record);
	}

	markClosed(): void {
		this.closedAt ??= this.items.length;
	}

	recordsAfterClose(): number {
		return this.closedAt === undefined ? 0 : this.items.length - this.closedAt;
	}
}

/** A session a rule opened, with everything its sink received. */
export class LiveSession {
	constructor(
		readonly session: OpenSession,
		readonly initial: SessionSnapshot,
		readonly recorder: SessionRecorder,
		private readonly traits: BackendTraits,
	) {}

	get ref(): SessionRef {
		return this.session.session;
	}

	get control(): SessionControl {
		const control = this.session.control;
		if (!control) fail("a session this bridge created cannot be controlled");
		return control;
	}

	events(): AgentEvent[] {
		return this.recorder.items.map((record) => record.event);
	}

	prompt(text: string, mode: PromptMode = "start", clientRequestId = crypto.randomUUID()): Promise<PromptResult> {
		return this.control.prompt(promptInput(text, mode, clientRequestId));
	}

	waitFor<T extends AgentEvent["type"]>(
		type: T,
		matches: (event: EventOf<T>) => boolean = () => true,
		after = 0,
	): Promise<EventOf<T>> {
		return this.recorder.waitFor(
			(records) =>
				records
					.slice(after)
					.map((record) => record.event)
					.find((event): event is EventOf<T> => isEvent(event, type) && matches(event)),
			type,
		);
	}

	/** The run that started after record `after`, followed to its end. */
	async runAfter(after: number): Promise<{ runId: RunId; outcome: RunOutcome }> {
		const started = await this.waitFor("run_started", () => true, after);
		const finished = await this.waitFor("run_finished", (event) => event.runId === started.runId, after);
		return { runId: started.runId, outcome: finished.outcome };
	}

	/** Sends `input` as a start prompt and waits for the run it started to end. */
	async runInput(input: PromptInput): Promise<{ runId: RunId; outcome: RunOutcome }> {
		const mark = this.recorder.items.length;
		const result = await this.control.prompt(input);
		expect(
			result.status === "accepted" && result.disposition === "started",
			`the prompt was not started: ${canonical(result)}`,
		);
		return this.runAfter(mark);
	}

	/** Prompts and waits for the run the prompt started to end. */
	async run(text: string): Promise<{ runId: RunId; outcome: RunOutcome; clientRequestId: string }> {
		const clientRequestId = crypto.randomUUID();
		return { ...(await this.runInput(promptInput(text, "start", clientRequestId))), clientRequestId };
	}

	/** The open snapshot with every recorded event applied. */
	reduced(): SessionSnapshot {
		return this.recorder.items.reduce(applyEvent, this.initial);
	}

	assertValid(): void {
		const violations = streamViolations(this.recorder.items, this.traits, this.initial);
		expect(violations.length === 0, `the event stream breaks the contract:\n${violations.join("\n")}`);
	}

	assertSettled(): void {
		this.assertValid();
		const open = unsettledParts(this.recorder.items, this.initial);
		expect(open.length === 0, `the session is not at rest:\n${open.join("\n")}`);
	}

	async close(): Promise<void> {
		this.recorder.markClosed();
		await this.session.close();
	}
}

/** One fresh backend for one rule; a restart swaps in the backend the driver starts next. */
export class Rig {
	constructor(
		public backend: AgentBackend,
		readonly driver: ConformanceDriver,
		readonly catalog: CatalogRecorder,
		readonly timeoutMs: number,
	) {}

	get traits(): BackendTraits {
		return this.backend.traits;
	}

	async openNew(options: Partial<NewSessionOptions> = {}): Promise<LiveSession> {
		return this.openTarget({ kind: "new", options: { cwd: this.driver.cwd, ...options } });
	}

	async open(session: SessionRef): Promise<LiveSession> {
		return this.openTarget({ kind: "existing", session });
	}

	/** Arranges `scenario` in a session, failing when the backend declares it can and the driver cannot. */
	async arrange(session: SessionRef, scenario: Scenario): Promise<void> {
		expect(await this.driver.arrange(session, scenario), `the driver cannot arrange ${canonical(scenario)}`);
	}

	async restart(): Promise<void> {
		this.backend = await this.driver.restart({ catalog: this.catalog });
	}

	private async openTarget(target: OpenTarget): Promise<LiveSession> {
		const recorder = new SessionRecorder(this.timeoutMs);
		const opened = await this.backend.open(target, recorder);
		if (opened.status === "rejected") fail(`open was rejected: ${opened.rejection.code} ${opened.rejection.message}`);
		return new LiveSession(opened.session, opened.snapshot, recorder, this.traits);
	}
}

export function promptInput(
	text: string,
	mode: PromptMode,
	clientRequestId: string,
	extra: Pick<PromptInput, "attachments" | "command"> = { attachments: [] },
): PromptInput {
	return { clientRequestId, mode, text, ...extra };
}

/** JSON with sorted keys, so two values compare by content. */
export function canonical<T>(value: T): string {
	return JSON.stringify(value, (_key, item: JsonValue) =>
		item !== null && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: item,
	);
}
