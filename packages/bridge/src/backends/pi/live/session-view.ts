/**
 * The `OpenSession` the core holds for a session. It is one of three things, and changes between them as the session's
 * circumstances do:
 *
 * - hosted: this bridge runs the session (`SessionHost`), and the view is the host's;
 * - watching: nobody runs it here (another client wrote it, or its working directory is gone): the session as it was
 *   read, nothing emitted (D16);
 * - terminal: a terminal `pi` that runs the Broski link extension has it open. Its events are the session's live events
 *   and the phone may send it a message and stop it, through that terminal. A hosted session that is idle when a terminal
 *   opens it gives way to the terminal, whose file the host's in-memory copy would otherwise diverge from.
 *
 * What the session allows has changed each time, and the only way the contract tells viewers that is a new stream:
 * `session_replaced` naming the same session, after which they attach again and are given its capabilities afresh.
 */

import {
	emptySnapshot,
	type OpenSession,
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
	readonly now: () => number;
	/** The view is closed: the registry forgets it. */
	readonly release: () => void;
}

/** The host's own view of a session this bridge runs, and whether the host has nothing in flight. */
export interface HostedPart {
	readonly view: OpenSession;
	readonly idle: () => boolean;
}

type Mode =
	| { readonly kind: "watching"; readonly snapshot: SessionSnapshot }
	| ({ readonly kind: "hosted" } & HostedPart)
	| { readonly kind: "terminal"; readonly session: TerminalSession; readonly control: SessionControl };

export class SessionView implements OpenSession {
	private mode: Mode;
	private closed = false;
	private readonly stopWatching: () => void;

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
		if (this.mode.kind === "hosted") return this.mode.view.control;
		return this.mode.kind === "terminal" ? this.mode.control : undefined;
	}

	/** A session nobody ran here is run by a host now, whose part this is. */
	becomeHosted(part: HostedPart): void {
		this.leave();
		this.mode = { kind: "hosted", ...part };
		this.replaced();
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
		await hosted.view.close();
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
