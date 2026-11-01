/**
 * One transcript a terminal writes, followed live: the tail reads what was appended, the translator turns lines into
 * events, and the live state hands them to the sink attached now. It writes nothing; the terminal's `claude` is the
 * file's only writer (D21).
 */

import {
	type AgentEvent,
	applyEvent,
	emptySnapshot,
	type RunId,
	type SessionSink,
	type SessionSnapshot,
} from "../../../contract";
import { LiveState } from "../live/live-state";
import type { MappedEvent } from "../ports/mapping";
import type { Clock } from "../ports/time";
import { HookDesk } from "./hook-desk";
import { type TailRead, TranscriptTail } from "./tail";
import { LineTranslator } from "./translate";

/** A run with nothing left to wait for is finished after this long without a new line, when the file never says so. */
export const QUIET_MS = 2_500;
/** Lines older than the tail's start (by their own timestamps) that a reset re-reads are history, not news. */
const HISTORY_SLACK_MS = 1_000;

export class WatchedSession {
	readonly live: LiveState;
	readonly desk: HookDesk;
	private readonly attachedAt: number;
	private pumping: Promise<void> | undefined;
	private dirty = false;
	private closed = false;
	private cancelQuiet: (() => void) | undefined;
	private readonly sinks = new Set<SessionSink>();

	private constructor(
		readonly path: string,
		private readonly clock: Clock,
		private readonly tail: TranscriptTail,
		private readonly translator: LineTranslator,
		initial: SessionSnapshot,
	) {
		this.live = new LiveState(initial, () => clock.now());
		this.live.attach({
			emit: (record) => {
				for (const sink of this.sinks) sink.emit(record);
			},
		});
		this.attachedAt = clock.now();
		this.desk = new HookDesk({
			emit: (event) => this.publish([{ event }]),
			ensureRun: () => this.ensureRun(),
			toolMatching: (name, input) => this.translator.openToolMatching(name, input),
			openToolsNamed: (name) => this.translator.openToolsNamed(name),
			catchUp: () => this.catchUp(),
			now: () => clock.now(),
		});
	}

	/**
	 * Starts at the end of the file. What it held is the transcript's to show, except a turn still under way: that one is
	 * the open snapshot's run, so its running tools can be finished, and its asks answered, by what is written next.
	 */
	static async open(path: string, clock: Clock): Promise<WatchedSession> {
		const tail = new TranscriptTail(path);
		const translator = new LineTranslator();
		const initial = seeded(translator, await tail.attach(), clock.now());
		return new WatchedSession(path, clock, tail, translator, initial);
	}

	/** Every open of the session gets its events; the snapshot is the state they apply on top of. */
	attach(sink: SessionSink): SessionSnapshot {
		this.sinks.add(sink);
		return this.live.snapshot();
	}

	detach(sink: SessionSink): void {
		this.sinks.delete(sink);
	}

	get runId(): RunId | undefined {
		return this.translator.runId;
	}

	/** The file may have grown: read what is new, once at a time. */
	schedule(): void {
		if (this.closed) return;
		this.dirty = true;
		this.pumping ??= this.pump();
	}

	/** Resolves once everything written to the file by now has been read and shown. */
	catchUp(): Promise<void> {
		this.schedule();
		return this.pumping ?? Promise.resolve();
	}

	dispose(): void {
		this.closed = true;
		this.cancelQuiet?.();
		this.cancelQuiet = undefined;
		this.desk.withdrawAll();
	}

	private async pump(): Promise<void> {
		try {
			while (this.dirty && !this.closed) {
				this.dirty = false;
				const read = await this.tail.read();
				if (this.closed) return;
				this.apply(read);
				if (read.more) this.dirty = true;
			}
		} finally {
			this.pumping = undefined;
		}
	}

	private apply(read: TailRead): void {
		if (read.lines.length === 0) return;
		this.cancelQuiet?.();
		this.cancelQuiet = undefined;
		for (const line of read.lines) {
			const entry = parse(line);
			if (read.reset && isHistory(entry, this.attachedAt)) this.translator.remember(entry);
			else this.publish(this.translator.translate(entry));
		}
		this.armQuiet();
	}

	private armQuiet(): void {
		if (this.closed || !this.translator.settled) return;
		this.cancelQuiet = this.clock.after(QUIET_MS, () => {
			this.cancelQuiet = undefined;
			if (!this.closed) this.publish(this.translator.settle());
		});
	}

	private ensureRun(): RunId {
		const { runId, events } = this.translator.ensureRun();
		this.publish(events);
		return runId;
	}

	private publish(events: readonly MappedEvent[]): void {
		for (const { event, native } of events) {
			this.beforeEmit(event);
			try {
				this.live.emit(event, native);
			} catch {
				// An event the reducer refuses is dropped, not allowed to stop the tail.
			}
		}
	}

	private beforeEmit(event: AgentEvent): void {
		if (event.type === "tool_started") this.desk.toolStarted(event.toolCallId, event.name, event.input);
		else if (event.type === "tool_finished") this.desk.withdrawForTool(event.toolCallId);
		else if (event.type === "run_finished") this.desk.withdrawForRun(event.runId);
	}
}

/** The live state of the lines already in the file: the turn still under way, else nothing. */
function seeded(translator: LineTranslator, lines: readonly string[], now: number): SessionSnapshot {
	const events = lines.flatMap((line) => translator.translate(parse(line)));
	events.push(...translator.settle());
	try {
		const state = events.reduce((snapshot, { event }) => applyEvent(snapshot, { at: now, event }), emptySnapshot());
		return state.run === undefined ? emptySnapshot() : state;
	} catch {
		return emptySnapshot();
	}
}

function parse(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

function isHistory(entry: unknown, attachedAt: number): boolean {
	if (typeof entry !== "object" || entry === null || !("timestamp" in entry)) return false;
	const stamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
	return Number.isFinite(stamp) && stamp < attachedAt - HISTORY_SLACK_MS;
}
