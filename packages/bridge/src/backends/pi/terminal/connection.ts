/**
 * One terminal's connection: lines in, checked frames out. It owns the terminal's `TerminalFeed` and, once the
 * terminal has said who it is and what it is doing, puts it in the registry. A connection that breaks a rule is closed.
 */

import { timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { isAbsolute } from "node:path";
import { MAX_LIST_ITEMS } from "../../../contract";
import { TerminalFeed } from "./feed";
import {
	type BridgeFrame,
	type Command,
	type CommandAnswer,
	ExtensionFrame,
	LINK_VERSION,
	MAX_LINE_BYTES,
} from "./protocol";
import type { TerminalRegistry, TerminalSession } from "./registry";

export interface ConnectionDeps {
	readonly registry: TerminalRegistry;
	readonly now: () => number;
	/** The key the bridge wrote at its start. */
	readonly key: () => string;
	/** Whether the bridge is running the session now, so the terminal can warn its user. */
	readonly busy: (sessionId: string) => boolean;
	/** A terminal session's run started or ended, or the session appeared or went; `path` is its file. */
	readonly changed: (sessionId: string, path: string) => void;
}

const GONE: CommandAnswer = { ok: false, code: "backend_error", message: "The terminal closed." };

function keysMatch(offered: string, expected: string): boolean {
	const a = Buffer.from(offered);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

export class TerminalConnection {
	private buffered = "";
	private identity: { pid: number; file: string; id: string } | undefined;
	private feed: TerminalFeed | undefined;
	private unregister: (() => void) | undefined;
	private nextCommand = 0;
	private readonly pending = new Map<string, (answer: CommandAnswer) => void>();
	private closed = false;

	constructor(
		private readonly socket: Socket,
		private readonly deps: ConnectionDeps,
	) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.read(chunk));
		socket.on("error", () => this.close());
		socket.on("close", () => this.close());
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.socket.destroy();
		this.feed?.close();
		this.unregister?.();
		for (const answer of this.pending.values()) answer(GONE);
		this.pending.clear();
		if (this.identity) this.deps.changed(this.identity.id, this.identity.file);
	}

	private read(chunk: string): void {
		this.buffered += chunk;
		if (this.buffered.length > MAX_LINE_BYTES) {
			this.close();
			return;
		}
		for (let end = this.buffered.indexOf("\n"); end !== -1 && !this.closed; end = this.buffered.indexOf("\n")) {
			const line = this.buffered.slice(0, end);
			this.buffered = this.buffered.slice(end + 1);
			if (!this.take(line)) {
				this.close();
				return;
			}
		}
	}

	/** False for a line that breaks a rule. */
	private take(line: string): boolean {
		let frame: ExtensionFrame;
		try {
			const parsed = ExtensionFrame.safeParse(JSON.parse(line));
			if (!parsed.success) return false;
			frame = parsed.data;
		} catch {
			return false;
		}
		switch (frame.t) {
			case "hello":
				return this.hello(frame);
			case "snapshot":
				return this.snapshot(frame);
			case "event":
				this.feed?.event(frame.event);
				return this.feed !== undefined;
			case "result":
				return this.answered(frame);
			case "bye":
				this.close();
				return true;
		}
	}

	private hello(frame: Extract<ExtensionFrame, { t: "hello" }>): boolean {
		if (this.identity || frame.v !== LINK_VERSION || !keysMatch(frame.key, this.deps.key())) return false;
		if (!isAbsolute(frame.session.file)) return false;
		this.identity = { pid: frame.pid, file: frame.session.file, id: frame.session.id };
		this.write({ t: "welcome", running: this.deps.busy(frame.session.id) });
		return true;
	}

	private snapshot(frame: Extract<ExtensionFrame, { t: "snapshot" }>): boolean {
		const identity = this.identity;
		if (!identity) return false;
		if (this.feed) {
			this.feed.reconcile(frame.state);
			return true;
		}
		const feed = new TerminalFeed(
			this.deps.now,
			() => this.deps.changed(identity.id, identity.file),
			(command) => void this.send(command),
		);
		feed.reconcile(frame.state);
		this.feed = feed;
		const session: TerminalSession = {
			pid: identity.pid,
			sessionPath: identity.file,
			sessionId: identity.id,
			feed,
			command: (command) => this.send(command),
		};
		this.unregister = this.deps.registry.add(session);
		this.deps.changed(identity.id, identity.file);
		return true;
	}

	private answered(frame: Extract<ExtensionFrame, { t: "result" }>): boolean {
		const answer = this.pending.get(frame.id);
		if (!answer) return false;
		this.pending.delete(frame.id);
		answer(frame.answer);
		return true;
	}

	private send(command: Command): Promise<CommandAnswer> {
		if (this.closed) return Promise.resolve(GONE);
		if (this.pending.size >= MAX_LIST_ITEMS) {
			return Promise.resolve({ ok: false, code: "busy", message: "Too many commands wait on the terminal." });
		}
		const id = String(++this.nextCommand);
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.write({ t: "command", id, command });
		});
	}

	private write(frame: BridgeFrame): void {
		this.socket.write(`${JSON.stringify(frame)}\n`);
	}
}
