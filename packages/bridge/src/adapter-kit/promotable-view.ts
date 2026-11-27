/**
 * A watch-only view of a session another process (a terminal agent) holds, which promotes itself to controllable as
 * soon as that process lets go: first dormant (controllable, nothing started), then hosted by the adapter on the
 * phone's first action. It goes back to watching if the terminal takes the session again before the phone acts. Each
 * change of what the session allows is a new stream: `resynced` with the state, then `session_replaced` naming it.
 */

import type {
	ActionResult,
	InteractionAnswer,
	OpenResult,
	OpenSession,
	Rejected,
	SessionControl,
	SessionRef,
	SessionSink,
	SessionSnapshot,
	SinkRecord,
} from "../contract";
import { ACCEPTED, CLOSED, isRejected, rejected } from "./rejections";

export type PresenceEvent = "active" | "idle";

export interface PromotableViewDeps<S extends object> {
	readonly ref: SessionRef;
	/** Tells `listener` when the terminal takes the session (`active`) or lets it go (`idle`); the result stops it. */
	readonly watchPresence: (listener: (event: PresenceEvent) => void) => () => void;
	/** Whatever the watch still owes once the terminal has gone (a last flush), before the view promotes. */
	readonly finishExited: () => Promise<void>;
	readonly isTerminalActive: () => Promise<boolean>;
	readonly locate: () => Promise<S | Rejected>;
	/** Whether the adapter could host the session as it is stored (its working directory is there). */
	readonly promotable: (stored: S) => boolean;
	readonly dormantSnapshot: (stored: S) => Promise<SessionSnapshot>;
	readonly openWatch: (stored: S, sink: SessionSink) => Promise<OpenResult>;
	readonly openHosted: (sink: SessionSink) => Promise<OpenResult>;
	/** The optional controls a hosted session of this adapter has. */
	readonly hostedMethods: { readonly compact: boolean; readonly cancelQueued: boolean };
	readonly now: () => number;
}

type Mode =
	| { readonly kind: "watching"; readonly view: OpenSession }
	| { readonly kind: "dormant"; readonly snapshot: SessionSnapshot }
	| { readonly kind: "hosted"; readonly view: OpenSession };

const NO_INTERACTION = rejected("not_found", "no such interaction");
const NO_QUEUED = rejected("not_found", "no such queued item");

export async function openPromotableView<S extends object>(
	deps: PromotableViewDeps<S>,
	stored: S,
	sink: SessionSink,
	start: "watching" | "dormant" = "watching",
): Promise<OpenResult> {
	let view: PromotableView<S> | undefined;
	let pendingEvent: PresenceEvent | undefined;
	const stopWatching = deps.watchPresence((event) => {
		if (view !== undefined) view.presenceChanged(event);
		else pendingEvent = event;
	});
	const initial = await initialMode(deps, stored, start, () => view);
	if (isRejected(initial)) {
		stopWatching();
		return initial;
	}
	view = new PromotableView(deps, sink, initial, stopWatching);
	if (pendingEvent !== undefined) view.presenceChanged(pendingEvent);
	return { status: "accepted", session: view, snapshot: view.snapshot() };
}

async function initialMode<S extends object>(
	deps: PromotableViewDeps<S>,
	stored: S,
	start: "watching" | "dormant",
	viewOf: () => PromotableView<S> | undefined,
): Promise<Mode | Rejected> {
	if (start === "dormant") {
		const snapshot = await deps.dormantSnapshot(stored);
		if (!(await deps.isTerminalActive())) return { kind: "dormant", snapshot };
	}
	const opened = await deps.openWatch(stored, { emit: (record) => viewOf()?.emitFrom("watching", record) });
	return isRejected(opened) ? opened : { kind: "watching", view: opened.session };
}

class PromotableView<S extends object> implements OpenSession {
	private mode: Mode;
	private closed = false;
	private promoting = false;
	private reentering = false;
	private reviving: Promise<Rejected | undefined> | undefined;
	private readonly hostedControl: SessionControl;

	constructor(
		private readonly deps: PromotableViewDeps<S>,
		private readonly sink: SessionSink,
		initialMode: Mode,
		private readonly stopWatching: () => void,
	) {
		this.mode = initialMode;
		this.hostedControl = {
			prompt: (input) => this.onHost((control) => control.prompt(input)),
			abort: () => this.abortHosted(),
			answer: (answer) => this.answerHosted(answer),
			setModel: (modelId) => this.onHost((control) => control.setModel(modelId)),
			setThinking: (value) => this.onHost((control) => control.setThinking(value)),
			setMode: (axis, value) => this.onHost((control) => control.setMode(axis, value)),
			...(deps.hostedMethods.compact && {
				compact: (instructions: string | undefined) =>
					this.onHost((control) => control.compact?.(instructions) ?? Promise.resolve(CLOSED)),
			}),
			...(deps.hostedMethods.cancelQueued && { cancelQueued: (id: string) => this.cancelQueuedHosted(id) }),
		};
	}

	get session(): SessionRef {
		return this.mode.kind === "hosted" ? this.mode.view.session : this.deps.ref;
	}

	snapshot(): SessionSnapshot {
		return this.mode.kind === "dormant" ? this.mode.snapshot : this.mode.view.snapshot();
	}

	get control(): SessionControl | undefined {
		return this.mode.kind === "watching" ? undefined : this.hostedControl;
	}

	get answer(): SessionControl["answer"] | undefined {
		if (this.mode.kind !== "watching") return undefined;
		const watchedAnswer = this.mode.view.answer;
		return watchedAnswer === undefined
			? undefined
			: (reply) => (this.closed ? Promise.resolve(CLOSED) : watchedAnswer(reply));
	}

	emitFrom(kind: "watching" | "hosted", record: SinkRecord): void {
		if (!this.closed && this.mode.kind === kind) this.sink.emit(record);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.stopWatching();
		if (this.mode.kind !== "dormant") await this.mode.view.close();
	}

	presenceChanged(event: PresenceEvent): void {
		if (this.closed) return;
		if (event === "idle" && this.mode.kind === "watching") void this.promote(this.mode);
		else if (event === "active" && this.mode.kind === "dormant") void this.reenterWatch(this.mode);
	}

	private async promote(watching: Extract<Mode, { kind: "watching" }>): Promise<void> {
		if (this.promoting) return;
		this.promoting = true;
		try {
			const stored = await this.deps.locate();
			if (this.closed || this.mode !== watching || isRejected(stored)) return;
			if (!this.deps.promotable(stored)) return;
			await this.deps.finishExited();
			if (this.closed || this.mode !== watching) return;
			if (await this.deps.isTerminalActive()) return;
			const snapshot = await this.deps.dormantSnapshot(stored);
			if (this.closed || this.mode !== watching) return;
			if (await this.deps.isTerminalActive()) return;
			await watching.view.close();
			if (this.closed || this.mode !== watching) return;
			this.mode = { kind: "dormant", snapshot };
			this.resyncAndReplace();
		} finally {
			this.promoting = false;
		}
	}

	private async reenterWatch(dormant: Extract<Mode, { kind: "dormant" }>): Promise<void> {
		if (this.reentering) return;
		this.reentering = true;
		try {
			const stored = await this.deps.locate();
			if (this.closed || this.mode !== dormant || isRejected(stored)) return;
			const opened = await this.deps.openWatch(stored, { emit: (record) => this.emitFrom("watching", record) });
			if (isRejected(opened)) return;
			if (this.closed || this.mode !== dormant) {
				await opened.session.close();
				return;
			}
			this.mode = { kind: "watching", view: opened.session };
			this.resyncAndReplace();
		} finally {
			this.reentering = false;
		}
	}

	private async onHost<T extends ActionResult>(call: (control: SessionControl) => Promise<T>): Promise<T | Rejected> {
		const revived = await this.reviveIfDormant();
		if (revived !== undefined) return revived;
		if (this.closed || this.mode.kind !== "hosted" || this.mode.view.control === undefined) return CLOSED;
		return call(this.mode.view.control);
	}

	private async abortHosted(): Promise<ActionResult> {
		if (this.closed) return CLOSED;
		if (this.mode.kind === "dormant") return ACCEPTED;
		return this.mode.kind === "hosted" && this.mode.view.control !== undefined
			? this.mode.view.control.abort()
			: CLOSED;
	}

	private async answerHosted(answer: InteractionAnswer): Promise<ActionResult> {
		if (this.closed) return CLOSED;
		if (this.mode.kind === "dormant") return NO_INTERACTION;
		return this.mode.kind === "hosted" && this.mode.view.control !== undefined
			? this.mode.view.control.answer(answer)
			: CLOSED;
	}

	private async cancelQueuedHosted(id: string): Promise<ActionResult> {
		if (this.closed) return CLOSED;
		if (this.mode.kind === "dormant") return NO_QUEUED;
		const cancel = this.mode.kind === "hosted" ? this.mode.view.control?.cancelQueued : undefined;
		return cancel === undefined ? CLOSED : cancel(id);
	}

	private reviveIfDormant(): Promise<Rejected | undefined> {
		const mode = this.mode;
		if (this.closed || mode.kind !== "dormant") return Promise.resolve(undefined);
		this.reviving ??= this.doRevive(mode).finally(() => {
			this.reviving = undefined;
		});
		return this.reviving;
	}

	private async doRevive(dormant: Extract<Mode, { kind: "dormant" }>): Promise<Rejected | undefined> {
		if (await this.deps.isTerminalActive()) {
			return rejected("busy", "A terminal just opened this session; try again.");
		}
		const opened = await this.deps.openHosted({ emit: (record) => this.emitFrom("hosted", record) });
		if (isRejected(opened)) return opened;
		if (this.closed || this.mode !== dormant) {
			await opened.session.close();
			return CLOSED;
		}
		this.mode = { kind: "hosted", view: opened.session };
		this.sink.emit({ at: this.deps.now(), event: { type: "resynced", snapshot: opened.snapshot } });
		return undefined;
	}

	private resyncAndReplace(): void {
		const at = this.deps.now();
		this.sink.emit({ at, event: { type: "resynced", snapshot: this.snapshot() } });
		this.sink.emit({ at, event: { type: "session_replaced", session: this.session } });
	}
}
