/**
 * A watch-only Claude Code view that promotes to controllable dormant-hosted mode as soon as the tracked terminal
 * `claude` process exits, and switches back if a terminal opens the session again before the phone acts.
 */

import { statSync } from "node:fs";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import {
	type ActionResult,
	emptySnapshot,
	type OpenResult,
	type OpenSession,
	type Rejected,
	type SessionControl,
	type SessionRef,
	type SessionSink,
	type SessionSnapshot,
} from "../../../contract";
import { DEFAULT_PERMISSION_MODE, PERMISSIONS_AXIS } from "../permission-modes";
import type { StoredSession } from "../ports/store";
import type { TerminalPresenceEvent } from "../ports/terminal";
import { ACCEPTED, CLOSED, isRejected, rejected } from "../rejections";

export interface PromotableWatchDeps {
	readonly ref: SessionRef;
	readonly watchPresence: (listener: (event: TerminalPresenceEvent) => void) => () => void;
	readonly finishExited: () => Promise<void>;
	readonly isTerminalActive: () => Promise<boolean>;
	readonly locate: () => Promise<StoredSession | Rejected>;
	readonly dormantSnapshot: (stored: StoredSession) => Promise<SessionSnapshot>;
	readonly openWatch: (stored: StoredSession, sink: SessionSink) => Promise<OpenResult>;
	readonly openHosted: (sink: SessionSink) => Promise<OpenResult>;
	readonly now: () => number;
}

type Mode =
	| { readonly kind: "watching"; readonly view: OpenSession }
	| { readonly kind: "dormant"; readonly snapshot: SessionSnapshot }
	| { readonly kind: "hosted"; readonly view: OpenSession };

const NO_INTERACTION = rejected("not_found", "no such interaction");
const NO_QUEUED = rejected("not_found", "no such queued item");

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export async function openPromotableWatch(
	deps: PromotableWatchDeps,
	stored: StoredSession,
	sink: SessionSink,
): Promise<OpenResult> {
	let view: PromotableWatchView | undefined;
	let pendingEvent: TerminalPresenceEvent | undefined;
	const stopWatching = deps.watchPresence((event) => {
		if (view !== undefined) view.presenceChanged(event);
		else pendingEvent = event;
	});
	const watchSink: SessionSink = {
		emit: (record) => view?.emitFrom("watching", record),
	};
	const opened = await deps.openWatch(stored, watchSink);
	if (isRejected(opened)) {
		stopWatching();
		return opened;
	}
	view = new PromotableWatchView(deps, sink, opened.session, stopWatching);
	if (pendingEvent !== undefined) view.presenceChanged(pendingEvent);
	return { status: "accepted", session: view, snapshot: view.snapshot() };
}

class PromotableWatchView implements OpenSession {
	private mode: Mode;
	private closed = false;
	private promoting = false;
	private reentering = false;
	private reviving: Promise<Rejected | undefined> | undefined;
	private readonly hostedControl: SessionControl = {
		prompt: (input) => this.onHost((control) => control.prompt(input)),
		abort: () => this.abortHosted(),
		answer: (answer) => this.answerHosted(answer),
		setModel: (modelId) => this.onHost((control) => control.setModel(modelId)),
		setThinking: (value) => this.onHost((control) => control.setThinking(value)),
		setMode: (axis, value) => this.onHost((control) => control.setMode(axis, value)),
		compact: (instructions) => this.onHost((control) => control.compact?.(instructions) ?? Promise.resolve(CLOSED)),
		cancelQueued: (id) => this.cancelQueuedHosted(id),
	};

	constructor(
		private readonly deps: PromotableWatchDeps,
		private readonly sink: SessionSink,
		initialWatch: OpenSession,
		private readonly stopWatching: () => void,
	) {
		this.mode = { kind: "watching", view: initialWatch };
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

	emitFrom(kind: "watching" | "hosted", record: Parameters<SessionSink["emit"]>[0]): void {
		if (!this.closed && this.mode.kind === kind) this.sink.emit(record);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.stopWatching();
		if (this.mode.kind !== "dormant") await this.mode.view.close();
	}

	presenceChanged(event: TerminalPresenceEvent): void {
		if (this.closed) return;
		if (event === "exited" && this.mode.kind === "watching") void this.promote(this.mode);
		else if (event === "entered" && this.mode.kind === "dormant") void this.reenterWatch(this.mode);
	}

	private async promote(watching: Extract<Mode, { kind: "watching" }>): Promise<void> {
		if (this.promoting) return;
		this.promoting = true;
		try {
			const stored = await this.deps.locate();
			if (this.closed || this.mode !== watching || isRejected(stored)) return;
			if (stored.cwd === undefined || !isDirectory(stored.cwd)) return;
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

	private async answerHosted(answer: Parameters<SessionControl["answer"]>[0]): Promise<ActionResult> {
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

export function dormantClaudeSnapshot(
	modelId: string | undefined,
	mode: PermissionMode = DEFAULT_PERMISSION_MODE,
): SessionSnapshot {
	return {
		...emptySnapshot(),
		modes: [{ axis: PERMISSIONS_AXIS, value: mode }],
		...(modelId !== undefined && { modelId }),
	};
}
