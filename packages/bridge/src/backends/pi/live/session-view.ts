/**
 * The `OpenSession` the core holds for a session. It is one of three things, and changes between them as the session's
 * circumstances do:
 *
 * - hosted: this bridge runs the session (`SessionHost`), and the view is the host's. When the host's `pi` exits
 *   unasked, the view keeps what it last showed, and the phone's next control call starts a new host, whose state
 *   replaces it (`resynced`, the contract's event for a restarted backend);
 * - watching: nobody runs it here (another client wrote it, or its working directory is gone): the session as it was
 *   read, nothing emitted;
 * - terminal: a terminal `pi` that runs the Broski link extension has it open. Its events are the session's live events
 *   and the phone may send it a message and stop it, through that terminal. A hosted session that is idle when a terminal
 *   opens it gives way to the terminal, whose file the host's in-memory copy would otherwise diverge from.
 *
 * What the session allows has changed each time, and the only way the contract tells viewers that is a new stream:
 * `session_replaced` naming the same session, after which they attach again and are given its capabilities afresh.
 */

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
import { permissionsSetting } from "../modes";
import type { SessionStore } from "../ports";
import { CLOSED } from "../rejections";
import { NO_LIVE } from "../store/list";
import { terminalControl } from "../terminal/control";
import type { TerminalRegistry, TerminalSession } from "../terminal/registry";

export interface SessionViewDeps {
	readonly sessionId: string;
	readonly path: string;
	readonly terminals: Pick<TerminalRegistry, "session" | "watch">;
	/** The session as it reads now, for when its terminal goes. */
	readonly reread: () => Promise<SessionSnapshot>;
	/** A new host for the session, its events going to `sink`, once the last one's `pi` exited. */
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
	| ({ readonly kind: "hosted" } & HostedPart)
	| { readonly kind: "terminal"; readonly session: TerminalSession; readonly control: SessionControl };

export class SessionView implements OpenSession {
	private mode: Mode;
	private closed = false;
	private readonly stopWatching: () => void;
	private reviving: Promise<Rejected | undefined> | undefined;
	private givingWay = false;
	private readonly hostedControl: SessionControl = {
		prompt: (input) => this.onHost((control) => control.prompt(input)),
		abort: () => this.onLiveHost((control) => control.abort()),
		answer: (answer) => this.onLiveHost((control) => control.answer(answer)),
		setModel: (modelId) => this.onHost((control) => control.setModel(modelId)),
		setThinking: (value) => this.onHost((control) => control.setThinking(value)),
		setMode: (axis, value) => this.onHost((control) => control.setMode(axis, value)),
		compact: (instructions) => this.onHost((control) => control.compact?.(instructions) ?? Promise.resolve(CLOSED)),
	};

	/** `start` is the host's part, or the session as it was read when no host runs it. */
	constructor(
		private readonly deps: SessionViewDeps,
		readonly sink: SessionSink,
		start: HostedPart | SessionSnapshot,
	) {
		if ("view" in start) this.mode = { kind: "hosted", ...start };
		else {
			const present = deps.terminals.session(deps.path);
			this.mode = present ? this.terminalMode(present) : { kind: "watching", snapshot: start };
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
			case "watching":
				return this.mode.snapshot;
		}
	}

	get control(): SessionControl | undefined {
		if (this.mode.kind === "hosted") return this.hostedControl;
		return this.mode.kind === "terminal" ? this.mode.control : undefined;
	}

	/** A call that needs the session running: a host whose `pi` exited is replaced first. */
	private async onHost<T extends ActionResult>(call: (control: SessionControl) => Promise<T>): Promise<T | Rejected> {
		const revived = await this.revivedIfEnded();
		return revived ?? this.onLiveHost(call);
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
		if (session && mode.idle()) void this.giveWayTo(session, mode);
	}

	/** The session's host ended and another took over: the view follows it now, not at the phone's next action. */
	resume(): void {
		void this.revivedIfEnded();
	}

	/** Undefined once the session has a running host; why not otherwise. */
	private revivedIfEnded(): Promise<Rejected | undefined> {
		const mode = this.mode;
		if (this.closed || mode.kind !== "hosted" || !mode.ended()) return Promise.resolve(undefined);
		this.reviving ??= this.deps.revive(this.sink).then((part) => {
			this.reviving = undefined;
			if ("status" in part) return part;
			if (this.closed || this.mode !== mode) {
				void part.view.close();
				return undefined;
			}
			this.mode = { kind: "hosted", ...part };
			void mode.view.close();
			this.sink.emit({ at: this.deps.now(), event: { type: "resynced", snapshot: part.view.snapshot() } });
			return undefined;
		});
		return this.reviving;
	}

	/** A session nobody ran here is run by a host now, whose part this is. */
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
			if (session && mode.idle()) void this.giveWayTo(session, mode);
			return;
		}
		const before = this.snapshot();
		this.leave();
		if (session) {
			this.mode = this.terminalMode(session);
			this.replaced();
			return;
		}
		this.mode = { kind: "watching", snapshot: before };
		void this.deps.reread().then((snapshot) => {
			if (this.closed || this.mode.kind !== "watching") return;
			this.mode = { kind: "watching", snapshot };
			this.replaced();
		});
	}

	/** Closing the host's view lets the idle host end; the terminal's file is then the only one that moves. */
	private async giveWayTo(session: TerminalSession, hosted: Extract<Mode, { kind: "hosted" }>): Promise<void> {
		if (this.givingWay) return;
		this.givingWay = true;
		try {
			await hosted.view.close();
		} finally {
			this.givingWay = false;
		}
		if (this.closed || this.mode !== hosted) return;
		this.mode = this.terminalMode(session);
		this.replaced();
	}

	private terminalMode(session: TerminalSession): Mode {
		session.feed.live.attach(this.sink);
		const control = terminalControl(session);
		const whileOpen = <T>(call: () => Promise<T>) => (this.closed ? Promise.resolve(CLOSED) : call());
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
			},
		};
	}

	/** Leaves a terminal's feed; a mode other than a terminal has nothing to leave. */
	private leave(): void {
		if (this.mode.kind === "terminal") this.mode.session.feed.live.detach(this.sink);
	}

	private replaced(): void {
		this.sink.emit({ at: this.deps.now(), event: { type: "session_replaced", session: this.session } });
	}
}

/** What a session shows before anything live: its model, and the modes it would be hosted in. */
export async function watchedSnapshot(sessionId: string, store: SessionStore): Promise<SessionSnapshot> {
	const found = await store.get(sessionId, NO_LIVE);
	const modelId = found.status === "accepted" ? found.summary.modelId : undefined;
	return { ...emptySnapshot(), ...(modelId !== undefined && { modelId }), modes: [permissionsSetting("off")] };
}
