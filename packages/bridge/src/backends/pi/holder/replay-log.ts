/**
 * The holder's record of what `pi` said since the session was last at rest, for a bridge that takes the session over:
 * replayed through its ordinary event path, it rebuilds the run under way, the asks still open and the extensions'
 * statuses (pi-coding-agent 1.5.2 `docs/json.md`, `docs/rpc-extension-ui.md`). Command responses answer only the bridge
 * that sent them and are not kept. At rest (`agent_settled`, with no compaction or retry open) the record starts over
 * with only the asks nobody answered that have not timed out, and the last status per key. A permission ask and the
 * questions of `broski_ask` (which say `"run":true`) are bound to their run's signal, so Pi dropped them without a word
 * when the run ended (`rpc-mode.js:51-82`): they go then too. Another extension's questions may outlive any run.
 */

import { isRecord } from "./protocol";

export const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

const DIALOGS: ReadonlySet<unknown> = new Set(["select", "confirm", "input", "editor"]);
const PERMISSION_PREFIX = "broski-permission:";
const QUESTIONS_PREFIX = "broski-questions:";

/** `delta` and `tool_update` lines may go once their message or call has ended: its end line carries all of it. */
type Kind = "structure" | "delta" | "tool_update" | "transient" | "ask" | "status";

interface Logged {
	readonly text: string;
	readonly kind: Kind;
	readonly key: string;
	readonly ask?: { readonly expiresAt: number | undefined; readonly runBound: boolean };
	dropped: boolean;
}

export interface ReplayState {
	/** A run, compaction or retry is under way. */
	readonly running: boolean;
	/** An ask waits for a human. */
	readonly asking: boolean;
}

export class ReplayLog {
	private lines: Logged[] = [];
	private bytes = 0;
	private askCount = 0;
	private truncated = false;
	private agentActive = false;
	private compacting = false;
	private retrying = false;
	private startedAt: number | undefined;
	private messageSeq = 0;
	private endedMessages = new Set<string>();
	private endedTools = new Set<string>();
	private latestUpdate = new Map<string, Logged>();
	private statuses = new Map<string, Logged>();

	constructor(
		private readonly now: () => number,
		private readonly maxBytes = MAX_REPLAY_BYTES,
		private readonly wallNow: () => number = Date.now,
	) {}

	/** One line `pi` wrote on stdout. */
	take(text: string): void {
		const record = parsed(text);
		const type = record?.type;
		if (type === "response") return;
		this.follow(type);
		const logged = record === undefined ? transient(text) : this.classify(text, record);
		if (!this.truncated || logged.kind === "ask" || logged.kind === "status") this.add(logged);
		if (type === "agent_settled" || type === "compaction_end" || type === "auto_retry_end") this.resetIfAtRest();
	}

	/** The bridge answered the ask `id`. */
	resolved(id: string): void {
		for (const line of this.lines) if (line.kind === "ask" && line.key === id) this.drop(line);
	}

	/** What a bridge taking over reads first; an ask's `timeout` is what is left of it. */
	replay(): { readonly lines: readonly string[]; readonly truncated: boolean; readonly runStartedAt?: number } {
		const now = this.now();
		const lines: string[] = [];
		for (const line of this.lines) {
			if (line.dropped) continue;
			const expiresAt = line.ask?.expiresAt;
			if (expiresAt === undefined) lines.push(line.text);
			else if (expiresAt > now) lines.push(withTimeout(line.text, expiresAt - now));
		}
		return {
			lines,
			truncated: this.truncated,
			...(this.startedAt !== undefined && { runStartedAt: this.startedAt }),
		};
	}

	/** The dialogs still waiting for an answer. */
	openAsks(): string[] {
		const now = this.now();
		return this.lines
			.filter((line) => line.ask !== undefined && !line.dropped && !expired(line, now))
			.map((line) => line.key);
	}

	state(): ReplayState {
		const now = this.now();
		const asking =
			this.askCount > 0 && this.lines.some((line) => line.ask !== undefined && !line.dropped && !expired(line, now));
		return { running: this.agentActive || this.compacting || this.retrying, asking };
	}

	private follow(type: unknown): void {
		if (type === "agent_start") {
			this.agentActive = true;
			this.startedAt ??= this.wallNow();
		} else if (type === "agent_settled") this.agentActive = false;
		else if (type === "compaction_start") {
			this.compacting = true;
			this.startedAt ??= this.wallNow();
		} else if (type === "compaction_end") this.compacting = false;
		else if (type === "auto_retry_start") this.retrying = true;
		else if (type === "auto_retry_end") this.retrying = false;
	}

	private classify(text: string, record: Readonly<Record<string, unknown>>): Logged {
		switch (record.type) {
			case "message_start":
				this.messageSeq += 1;
				return structure(text);
			case "message_update":
				return { text, kind: "delta", key: String(this.messageSeq), dropped: false };
			case "message_end":
				this.endedMessages.add(String(this.messageSeq));
				return structure(text);
			case "tool_execution_update":
				return this.toolUpdate(text, String(record.toolCallId));
			case "tool_execution_end":
				this.endedTools.add(String(record.toolCallId));
				return structure(text);
			case "agent_end":
				return transient(text);
			case "extension_ui_request":
				return this.uiRequest(text, record);
			default:
				return structure(text);
		}
	}

	private toolUpdate(text: string, toolCallId: string): Logged {
		const logged: Logged = { text, kind: "tool_update", key: toolCallId, dropped: false };
		this.latestUpdate.set(toolCallId, logged);
		return logged;
	}

	private uiRequest(text: string, record: Readonly<Record<string, unknown>>): Logged {
		const { method, id, title, timeout, statusKey } = record;
		if (method === "setStatus") {
			const key = String(statusKey);
			const before = this.statuses.get(key);
			if (before !== undefined) this.drop(before);
			const logged: Logged = { text, kind: "status", key, dropped: false };
			this.statuses.set(key, logged);
			return logged;
		}
		if (!DIALOGS.has(method) || typeof id !== "string") return transient(text);
		const expiresAt = typeof timeout === "number" && timeout > 0 ? this.now() + timeout : undefined;
		const runBound = typeof title === "string" && isRunBound(title);
		return { text, kind: "ask", key: id, ask: { expiresAt, runBound }, dropped: false };
	}

	private add(logged: Logged): void {
		this.lines.push(logged);
		this.bytes += logged.text.length;
		if (logged.ask !== undefined) this.askCount += 1;
		if (this.bytes > this.maxBytes) this.evict();
	}

	private drop(line: Logged): void {
		if (line.dropped) return;
		line.dropped = true;
		this.bytes -= line.text.length;
		if (line.ask !== undefined) this.askCount -= 1;
	}

	/** First what a later line repeats; then, when the structure alone is too much, all but asks and statuses. */
	private evict(): void {
		for (const line of this.lines) if (this.repeated(line)) this.drop(line);
		this.compact();
		if (this.bytes <= this.maxBytes) return;
		this.truncated = true;
		for (const line of this.lines) if (line.kind !== "ask" && line.kind !== "status") this.drop(line);
		this.compact();
	}

	private repeated(line: Logged): boolean {
		switch (line.kind) {
			case "delta":
				return this.endedMessages.has(line.key);
			case "tool_update":
				return this.endedTools.has(line.key) || this.latestUpdate.get(line.key) !== line;
			case "transient":
				return true;
			default:
				return false;
		}
	}

	private resetIfAtRest(): void {
		if (this.agentActive || this.compacting || this.retrying) return;
		const now = this.now();
		for (const line of this.lines) {
			const ask = line.ask;
			const kept = line.kind === "status" || (ask !== undefined && !ask.runBound && !expired(line, now));
			if (!kept) this.drop(line);
		}
		this.compact();
		this.truncated = false;
		this.startedAt = undefined;
		this.endedMessages = new Set();
		this.endedTools = new Set();
		this.latestUpdate = new Map();
	}

	private compact(): void {
		this.lines = this.lines.filter((line) => !line.dropped);
	}
}

function parsed(text: string): Readonly<Record<string, unknown>> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) && typeof value.type === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}

function isRunBound(title: string): boolean {
	if (title.startsWith(PERMISSION_PREFIX)) return true;
	if (!title.startsWith(QUESTIONS_PREFIX)) return false;
	try {
		const payload: unknown = JSON.parse(title.slice(QUESTIONS_PREFIX.length));
		return isRecord(payload) && payload.run === true;
	} catch {
		return false;
	}
}

function structure(text: string): Logged {
	return { text, kind: "structure", key: "", dropped: false };
}

function transient(text: string): Logged {
	return { text, kind: "transient", key: "", dropped: false };
}

function expired(line: Logged, now: number): boolean {
	const expiresAt = line.ask?.expiresAt;
	return expiresAt !== undefined && expiresAt <= now;
}

function withTimeout(text: string, remainingMs: number): string {
	const record = parsed(text);
	return record === undefined ? text : JSON.stringify({ ...record, timeout: Math.ceil(remainingMs) });
}
