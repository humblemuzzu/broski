/**
 * The terminal sessions the bridge follows, each across the link connections its `pi` makes. A connection that drops
 * while that `pi` still lives leaves its session held: the extension dials again within a second
 * (`extension/link.ts`), and the snapshot it sends picks the session up where it was, so a viewer sees no abort and
 * no flip to watch-only and back. A `bye` ends the session at once (the terminal quit, or switched sessions), and so
 * does a dropped connection whose process is gone; a process that never dials again is let go after `graceMs`.
 */

import { TerminalFeed } from "./feed";
import type { Command, CommandAnswer, TerminalState } from "./protocol";
import type { TerminalRegistry, TerminalSession } from "./registry";

export const RECONNECT_GRACE_MS = 5_000;
const LIVENESS_MS = 250;

export type CommandLink = (command: Command) => Promise<CommandAnswer>;

export const GONE: CommandAnswer = { ok: false, code: "backend_error", message: "The terminal closed." };
export const DROPPED: CommandAnswer = {
	ok: false,
	code: "busy",
	message: "The terminal's link dropped; it reconnects in a moment.",
};

export interface LinkedTerminalsDeps {
	readonly registry: TerminalRegistry;
	readonly now: () => number;
	readonly changed: (sessionId: string, path: string) => void;
	readonly graceMs?: number;
}

export interface TerminalIdentity {
	readonly pid: number;
	readonly file: string;
	readonly id: string;
	readonly cwd?: string;
	readonly extensionVersion?: number;
}

/** Whether process `pid` exists; another user's counts. A zombie counts too, until its parent reaps it. */
export function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

export class LinkedTerminals {
	private readonly terminals = new Set<LinkedTerminal>();

	constructor(private readonly deps: LinkedTerminalsDeps) {}

	/** The session `identity` names: the one its process held before it dialled again, or a new one. */
	take(identity: TerminalIdentity): LinkedTerminal {
		for (const terminal of this.terminals) if (terminal.is(identity)) return terminal;
		const terminal: LinkedTerminal = new LinkedTerminal(identity, {
			...this.deps,
			graceMs: this.deps.graceMs ?? RECONNECT_GRACE_MS,
			forget: () => this.terminals.delete(terminal),
		});
		this.terminals.add(terminal);
		return terminal;
	}

	/** The bridge stops: nothing is held for a reconnection. */
	endAll(): void {
		for (const terminal of [...this.terminals]) terminal.end();
	}
}

interface TerminalDeps extends Omit<LinkedTerminalsDeps, "graceMs"> {
	readonly graceMs: number;
	readonly forget: () => void;
}

export class LinkedTerminal implements TerminalSession {
	readonly pid: number;
	readonly sessionPath: string;
	readonly sessionId: string;
	readonly cwd: string | undefined;
	readonly extensionVersion: number;
	readonly feed: TerminalFeed;
	private link: CommandLink | undefined;
	private unregister: (() => void) | undefined;
	private waiting:
		| { readonly deadline: ReturnType<typeof setTimeout>; readonly liveness: ReturnType<typeof setInterval> }
		| undefined;
	private ended = false;

	constructor(
		identity: TerminalIdentity,
		private readonly deps: TerminalDeps,
	) {
		this.pid = identity.pid;
		this.sessionPath = identity.file;
		this.sessionId = identity.id;
		this.cwd = identity.cwd;
		this.extensionVersion = identity.extensionVersion ?? 0;
		this.feed = new TerminalFeed(
			deps.now,
			() => this.announce(),
			(command) => void this.command(command),
			identity.cwd,
		);
	}

	is(identity: TerminalIdentity): boolean {
		return identity.pid === this.pid && identity.file === this.sessionPath && identity.id === this.sessionId;
	}

	command(command: Command): Promise<CommandAnswer> {
		return this.link?.(command) ?? Promise.resolve(this.ended ? GONE : DROPPED);
	}

	/** `link` is the connection that speaks for the terminal now, and `state` what the terminal says it is doing. */
	attach(link: CommandLink, state: TerminalState): void {
		if (this.ended) return;
		this.stopWaiting();
		this.link = link;
		this.feed.reconcile(state);
		if (this.unregister) return;
		this.unregister = this.deps.registry.add(this);
		this.announce();
	}

	/** `link`'s connection broke without a `bye`: held while the process lives, for at most `graceMs`. */
	dropped(link: CommandLink): void {
		if (this.link !== link) return;
		this.link = undefined;
		if (!processAlive(this.pid)) {
			this.end();
			return;
		}
		const deadline = setTimeout(() => this.end(), this.deps.graceMs);
		const liveness = setInterval(() => {
			if (!processAlive(this.pid)) this.end();
		}, LIVENESS_MS);
		deadline.unref();
		liveness.unref();
		this.waiting = { deadline, liveness };
	}

	/** The terminal is gone: what it ran ends, aborted, for its viewers. A connection that no longer speaks for it is ignored. */
	end(link?: CommandLink): void {
		if (this.ended || (link !== undefined && link !== this.link)) return;
		this.ended = true;
		this.link = undefined;
		this.stopWaiting();
		this.deps.forget();
		this.feed.close();
		const registered = this.unregister !== undefined;
		this.unregister?.();
		if (registered) this.deps.changed(this.sessionId, this.sessionPath);
	}

	private announce(): void {
		if (this.unregister && !this.ended) this.deps.changed(this.sessionId, this.sessionPath);
	}

	private stopWaiting(): void {
		if (!this.waiting) return;
		clearTimeout(this.waiting.deadline);
		clearInterval(this.waiting.liveness);
		this.waiting = undefined;
	}
}
