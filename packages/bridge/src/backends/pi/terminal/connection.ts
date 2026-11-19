/**
 * One terminal's connection: lines in, checked frames out. Once the terminal has said who it is and what it is doing,
 * the connection speaks for its session (`linked-terminal.ts`), which the registry holds. A connection that breaks a
 * rule is closed, and so is the session; one that merely drops leaves the session to the next connection of its `pi`.
 */

import { timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { isAbsolute } from "node:path";
import { MAX_LIST_ITEMS } from "../../../contract";
import {
	type CommandLink,
	DROPPED,
	GONE,
	type LinkedTerminal,
	type LinkedTerminals,
	type TerminalIdentity,
} from "./linked-terminal";
import {
	type BridgeFrame,
	type Command,
	type CommandAnswer,
	ExtensionFrame,
	LINK_VERSION,
	MAX_LINE_BYTES,
} from "./protocol";

export interface ConnectionDeps {
	readonly terminals: LinkedTerminals;
	/** The key the bridge wrote at its start. */
	readonly key: () => string;
	/** Whether the bridge is running the session now, so the terminal can warn its user. */
	readonly busy: (sessionId: string) => boolean;
}

function keysMatch(offered: string, expected: string): boolean {
	const a = Buffer.from(offered);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

export class TerminalConnection {
	private buffered = "";
	private identity: TerminalIdentity | undefined;
	private terminal: LinkedTerminal | undefined;
	private nextCommand = 0;
	private readonly pending = new Map<string, (answer: CommandAnswer) => void>();
	private readonly link: CommandLink = (command) => this.send(command);
	private closed = false;

	constructor(
		private readonly socket: Socket,
		private readonly deps: ConnectionDeps,
	) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.read(chunk));
		socket.on("error", () => this.drop());
		socket.on("close", () => this.drop());
	}

	/** The bridge's own `pi` started or stopped running `sessionId`: a terminal that has it open is told. */
	hosted(sessionId: string, running: boolean): void {
		if (!this.closed && this.identity?.id === sessionId) this.write({ t: "hosted", running });
	}

	/** The terminal said `bye`, broke a rule, or the bridge stops: its session ends now. */
	close(): void {
		if (!this.shut(GONE)) return;
		this.terminal?.end(this.link);
	}

	/** The socket broke without a `bye`: the session waits for its `pi` to dial again. */
	private drop(): void {
		if (!this.shut(DROPPED)) return;
		this.terminal?.dropped(this.link);
	}

	/** False when the connection was already shut. */
	private shut(answer: CommandAnswer): boolean {
		if (this.closed) return false;
		this.closed = true;
		this.socket.destroy();
		for (const reply of this.pending.values()) reply(answer);
		this.pending.clear();
		return true;
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
				this.terminal?.feed.event(frame.event);
				return this.terminal !== undefined;
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
		this.identity = {
			pid: frame.pid,
			file: frame.session.file,
			id: frame.session.id,
			...(frame.session.cwd !== "" && { cwd: frame.session.cwd }),
		};
		this.write({ t: "welcome", running: this.deps.busy(frame.session.id) });
		return true;
	}

	private snapshot(frame: Extract<ExtensionFrame, { t: "snapshot" }>): boolean {
		const identity = this.identity;
		if (!identity) return false;
		this.terminal ??= this.deps.terminals.take(identity);
		this.terminal.attach(this.link, frame.state);
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
