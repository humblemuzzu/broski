/** The terminal `pi` processes connected through the Broski link extension, by the session file each has open. */

import type { LiveRow, TerminalHolder, TerminalPresence } from "../ports";
import type { TerminalFeed } from "./feed";
import type { Command, CommandAnswer } from "./protocol";

export interface TerminalSession extends TerminalHolder {
	readonly sessionPath: string;
	readonly sessionId: string;
	readonly cwd?: string;
	readonly extensionVersion: number;
	readonly feed: TerminalFeed;
	/** Sends `command` to the terminal; resolves with its answer, or `backend_error` once the terminal is gone. */
	command(command: Command): Promise<CommandAnswer>;
}

type Watcher = (session: TerminalSession | undefined) => void;

export class TerminalRegistry implements TerminalPresence {
	private readonly byPath = new Map<string, TerminalSession>();
	private readonly watchers = new Map<string, Set<Watcher>>();

	/**
	 * A terminal has `session.sessionPath` open; the returned function removes it when it goes. A second terminal on
	 * the same file replaces the first in the registry, which is the one that last said so.
	 */
	add(session: TerminalSession): () => void {
		this.byPath.set(session.sessionPath, session);
		this.tell(session.sessionPath, session);
		return () => {
			if (this.byPath.get(session.sessionPath) !== session) return;
			this.byPath.delete(session.sessionPath);
			this.tell(session.sessionPath, undefined);
		};
	}

	holder(sessionPath: string): TerminalHolder | undefined {
		return this.byPath.get(sessionPath);
	}

	session(sessionPath: string): TerminalSession | undefined {
		return this.byPath.get(sessionPath);
	}

	/** What a session list shows of the terminal session `sessionId`, if a terminal runs it. */
	row(sessionId: string): LiveRow | undefined {
		for (const session of this.byPath.values()) if (session.sessionId === sessionId) return session.feed.row();
		return undefined;
	}

	/** `watcher` is told whenever the terminal that has `sessionPath` open changes: it appears, or it goes. */
	watch(sessionPath: string, watcher: Watcher): () => void {
		const set = this.watchers.get(sessionPath) ?? new Set<Watcher>();
		set.add(watcher);
		this.watchers.set(sessionPath, set);
		return () => {
			set.delete(watcher);
			if (set.size === 0 && this.watchers.get(sessionPath) === set) this.watchers.delete(sessionPath);
		};
	}

	private tell(sessionPath: string, session: TerminalSession | undefined): void {
		for (const watcher of [...(this.watchers.get(sessionPath) ?? [])]) watcher(session);
	}
}
