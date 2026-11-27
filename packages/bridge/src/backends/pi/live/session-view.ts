/**
 * The `OpenSession` the core holds for a session. It is one of four things, and changes between them as the session's
 * circumstances do:
 *
 * - hosted: this bridge runs the session (`SessionHost`), and the view is the host's. When the host's `pi` exits
 *   unasked, the view keeps what it last showed, and the phone's next control call starts a new host, whose state
 *   replaces it (`resynced`, the contract's event for a restarted backend);
 * - dormant: no `pi` runs it right now (for instance, a terminal just quit or switched sessions), yet its working
 *   directory exists and the phone can drive it: the view keeps `hostedControl`, and the phone's next action starts a
 *   host through the revive path without spawning one for a `/quit` or `/reload` nobody acts on;
 * - watching: nobody can run it here (its working directory is gone): the session as it was read, nothing emitted;
 * - terminal: a terminal `pi` that runs the Broski link extension has it open. Its events are the session's live events
 *   and the phone may send it a message and stop it, through that terminal. A hosted session that is idle when a terminal
 *   opens it gives way to the terminal, whose file the host's in-memory copy would otherwise diverge from.
 *
 * What the session allows has changed each time, and the only way the contract tells viewers that is a new stream:
 * `session_replaced` naming the same session, after which they attach again and are given its capabilities afresh.
 */

import { ACCEPTED, CLOSED, rejected } from "../../../adapter-kit/rejections";
import {
	type ActionResult,
	emptySnapshot,
	type OpenSession,
	type Rejected,
	type SessionControl,
	type SessionRef,
	type SessionSink,
	type SessionSnapshot,
} from "../../../contract";
import { isDirectory } from "../is-directory";
import type { ModelCatalogue } from "../models/catalogue";
import { permissionsSetting } from "../modes";
import type { SessionStore } from "../ports";
import { terminalControl } from "../terminal/control";
import type { TerminalRegistry, TerminalSession } from "../terminal/registry";
import type { LiveImageCache } from "./image-cache";

export interface RereadResult {
	readonly snapshot: SessionSnapshot;
	readonly hostable: boolean;
}

export interface SessionViewDeps {
	readonly sessionId: string;
	readonly path: string;
	readonly terminals: Pick<TerminalRegistry, "session" | "watch">;
	readonly models?: Pick<ModelCatalogue, "find" | "missing">;
	readonly images?: LiveImageCache;
	/** The session as it reads now, and whether it can be hosted, for when its terminal goes. */
	readonly reread: () => Promise<RereadResult>;
	/** A new host for the session, its events going to `sink`, once dormant or once the last host's `pi` exited. */
	readonly revive: (sink: SessionSink) => Promise<HostedPart | Rejected>;
	readonly now: () => number;
	/** The view is closed: the registry forgets it. */
	readonly release: () => void;
}

/** The host's own view of a session this bridge runs, and whether the host has nothing in flight. */
export interface HostedPart {
	readonly view: OpenSession;
	readonly idle: () => boolean;
	readonly ended: () => boolean;
}

type Mode =
	| { readonly kind: "watching"; readonly snapshot: SessionSnapshot }
	| { readonly kind: "dormant"; readonly snapshot: SessionSnapshot }
	| ({ readonly kind: "hosted" } & HostedPart)
	| { readonly kind: "terminal"; readonly session: TerminalSession; readonly control: SessionControl };

export type ViewStart = HostedPart | { readonly kind: "dormant" | "watching"; readonly snapshot: SessionSnapshot };

const NO_INTERACTION = rejected("not_found", "no such interaction");

export class SessionView implements OpenSession {
	private mode: Mode;
	private closed = false;
	private readonly stopWatching: () => void;
	private reviving: Promise<Rejected | undefined> | undefined;
	private givingWay = false;
	private pendingReplace = false;
	private readonly hostedControl: SessionControl = {
		prompt: (input) => this.onHost((control) => control.prompt(input)),
		abort: () => this.abortHosted(),
		answer: (answer) => this.answerHosted(answer),
		setModel: (modelId) => this.onHost((control) => control.setModel(modelId)),
		setThinking: (value) => this.onHost((control) => control.setThinking(value)),
		setMode: (axis, value) => this.onHost((control) => control.setMode(axis, value)),
		compact: (instructions) => this.onHost((control) => control.compact?.(instructions) ?? Promise.resolve(CLOSED)),
	};

	/** `start` is the host's part, or the dormant/watching state when no host runs it yet. */
	constructor(
		private readonly deps: SessionViewDeps,
		readonly sink: SessionSink,
		start: ViewStart,
	) {
		if ("view" in start) this.mode = { kind: "hosted", ...start };
		else {
			const present = deps.terminals.session(deps.path);
			this.mode = present ? this.terminalMode(present) : start;
		}
		this.stopWatching = deps.terminals.watch(deps.path, (session) => this.terminalChanged(session));
	}

	get session(): SessionRef {
		return { backend: "pi", sessionId: this.deps.sessionId };
	}

	snapshot(): SessionSnapshot {
		switch (this.mode.kind) {
			case "hosted":
				return this.mode.view.snapshot();
			case "terminal":
				return this.mode.session.feed.snapshot();
			case "dormant":
			case "watching":
				return this.mode.snapshot;
		}
	}

	get control(): SessionControl | undefined {
		if (this.mode.kind === "hosted" || this.mode.kind === "dormant") return this.hostedControl;
		return this.mode.kind === "terminal" ? this.mode.control : undefined;
	}

	/** A call that needs the session running: a dormant view or an exited host is replaced first. */
	private async onHost<T extends ActionResult>(call: (control: SessionControl) => Promise<T>): Promise<T | Rejected> {
		const revived = await this.revivedIfNeeded();
		if (revived !== undefined) return revived;
		if (this.closed) return CLOSED;
		if (this.mode.kind === "terminal") return call(this.mode.control);
		return this.onLiveHost(call);
	}

	private async abortHosted(): Promise<ActionResult> {
		if (this.closed) return CLOSED;
		if (this.mode.kind === "dormant") return ACCEPTED;
		if (this.mode.kind === "terminal") return this.mode.control.abort();
		return this.onLiveHost((control) => control.abort());
	}

	private async answerHosted(answer: Parameters<SessionControl["answer"]>[0]): Promise<ActionResult> {
		if (this.closed) return CLOSED;
		if (this.mode.kind === "dormant") return NO_INTERACTION;
		if (this.mode.kind === "terminal") return this.mode.control.answer(answer);
		return this.onLiveHost((control) => control.answer(answer));
	}

	/** Stop and an answer need no new host: an exited one runs nothing and asks nothing. */
	private async onLiveHost<T extends ActionResult>(
		call: (control: SessionControl) => Promise<T>,
	): Promise<T | Rejected> {
		const control = this.mode.kind === "hosted" && !this.closed ? this.mode.view.control : undefined;
		return control === undefined ? CLOSED : call(control);
	}

	/**
	 * The host's session changed. A terminal that opened it while the host was busy was told not to type in it; once the
	 * host is idle the terminal takes the session, as it would have had the host been idle when it opened it.
	 */
	hostChanged(): void {
		const mode = this.mode;
		if (this.closed || mode.kind !== "hosted") return;
		const session = this.deps.terminals.session(this.deps.path);
		if (session && (mode.idle() || mode.ended())) void this.giveWayTo(mode);
	}

	/** The session's host ended and another took over: the view follows it now, not at the phone's next action. */
	resume(): void {
		void this.revivedIfNeeded();
	}

	/** Undefined once the session has a running host (or moved to a terminal meanwhile); why not otherwise. */
	private revivedIfNeeded(): Promise<Rejected | undefined> {
		const mode = this.mode;
		const needsRevive = mode.kind === "dormant" || (mode.kind === "hosted" && mode.ended());
		if (this.closed || !needsRevive) return Promise.resolve(undefined);
		this.reviving ??= this.deps.revive(this.sink).then((part) => {
			this.reviving = undefined;
			if ("status" in part) return this.mode === mode ? part : undefined;
			if (this.closed || this.mode !== mode) {
				void part.view.close();
				return undefined;
			}
			this.mode = { kind: "hosted", ...part };
			if (mode.kind === "hosted") void mode.view.close();
			if (this.pendingReplace) this.resyncAndReplace();
			else this.sink.emit({ at: this.deps.now(), event: { type: "resynced", snapshot: part.view.snapshot() } });
			return undefined;
		});
		return this.reviving;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.stopWatching();
		const mode = this.mode;
		this.leave();
		this.deps.release();
		if (mode.kind === "hosted") await mode.view.close();
	}

	private terminalChanged(session: TerminalSession | undefined): void {
		if (this.closed) return;
		const mode = this.mode;
		if (mode.kind === "hosted") {
			if (session && (mode.idle() || mode.ended())) void this.giveWayTo(mode);
			return;
		}
		const before = this.snapshot();
		this.leave();
		if (!session) {
			if (mode.kind === "terminal") this.leaveTerminal(before);
			return;
		}
		this.mode = this.terminalMode(session);
		this.resyncAndReplace();
	}

	/** After a terminal leaves: keep the view controllable while rereading disk, dropping to watching only if unhostable. */
	private leaveTerminal(before: SessionSnapshot): void {
		this.pendingReplace = true;
		const tentative: Mode = { kind: "dormant", snapshot: idleSnapshot(before) };
		this.mode = tentative;
		void this.deps.reread().then(({ snapshot, hostable }) => {
			if (this.closed || this.mode !== tentative) return;
			const merged: SessionSnapshot = {
				...snapshot,
				...(snapshot.modelId === undefined && before.modelId !== undefined && { modelId: before.modelId }),
				...(snapshot.thinking === undefined && before.thinking !== undefined && { thinking: before.thinking }),
			};
			this.mode = hostable ? { kind: "dormant", snapshot: merged } : { kind: "watching", snapshot: merged };
			this.resyncAndReplace();
		});
	}

	/** Closing the host's view lets the idle host end; the terminal's file is then the only one that moves. */
	private async giveWayTo(hosted: Extract<Mode, { kind: "hosted" }>): Promise<void> {
		if (this.givingWay) return;
		this.givingWay = true;
		try {
			await hosted.view.close();
		} finally {
			this.givingWay = false;
		}
		if (this.closed || this.mode !== hosted) return;
		const current = this.deps.terminals.session(this.deps.path);
		if (current === undefined) {
			this.leaveTerminal(hosted.view.snapshot());
			return;
		}
		this.mode = this.terminalMode(current);
		this.resyncAndReplace();
	}

	private terminalMode(session: TerminalSession): Mode {
		session.feed.live.attach(this.sink);
		const control = terminalControl(session, {
			...(this.deps.models !== undefined && { models: this.deps.models }),
			...(this.deps.images !== undefined && { imageCache: this.deps.images }),
		});
		const whileOpen = <T>(call: () => Promise<T>) => (this.closed ? Promise.resolve(CLOSED) : call());
		const compact = control.compact;
		return {
			kind: "terminal",
			session,
			control: {
				prompt: (input) => whileOpen(() => control.prompt(input)),
				abort: () => whileOpen(() => control.abort()),
				answer: (answer) => whileOpen(() => control.answer(answer)),
				setModel: (modelId) => whileOpen(() => control.setModel(modelId)),
				setThinking: (value) => whileOpen(() => control.setThinking(value)),
				setMode: (axis, value) => whileOpen(() => control.setMode(axis, value)),
				...(compact !== undefined && { compact: (instructions) => whileOpen(() => compact(instructions)) }),
			},
		};
	}

	/** Leaves a terminal's feed; a mode other than a terminal has nothing to leave. */
	private leave(): void {
		if (this.mode.kind === "terminal") this.mode.session.feed.live.detach(this.sink);
	}

	private resyncAndReplace(): void {
		this.pendingReplace = false;
		const at = this.deps.now();
		this.sink.emit({ at, event: { type: "resynced", snapshot: this.snapshot() } });
		this.sink.emit({ at, event: { type: "session_replaced", session: this.session } });
	}
}

function idleSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
	return {
		...emptySnapshot(),
		...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
		...(snapshot.thinking !== undefined && { thinking: snapshot.thinking }),
		modes: snapshot.modes,
	};
}

/** What a session reads from disk when no host runs it: its snapshot and whether a host can run in its directory. */
export async function rereadSession(sessionId: string, store: SessionStore): Promise<RereadResult> {
	const stored = await store.locate(sessionId);
	if ("status" in stored) {
		return { snapshot: { ...emptySnapshot(), modes: [permissionsSetting("off")] }, hostable: false };
	}
	const hostable = stored.cwd !== undefined && isDirectory(stored.cwd);
	const facts = await store.facts(stored);
	const modelId = "status" in facts ? undefined : facts.summary?.modelId;
	const thinking = "status" in facts ? undefined : facts.thinking;
	const mode = "status" in facts ? "off" : facts.permissions.mode;
	return {
		snapshot: {
			...emptySnapshot(),
			...(modelId !== undefined && { modelId }),
			...(thinking !== undefined && { thinking }),
			modes: [permissionsSetting(mode)],
		},
		hostable,
	};
}
