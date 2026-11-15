/**
 * Per-session scripts for the scripted endpoint, and what the driver's extension in each `pi` tells the test. Each
 * request names its session (`x-session-id`), so each test session gets its own turns, its own gates and its own record
 * of what reached the model. A compaction's summary request is answered on the side, by its system prompt
 * (pi-coding-agent 1.5.2 `dist/core/compaction/utils.js:146`), and never takes a turn of the session's script.
 */

import type { ScriptedRequest, ScriptedTurn } from "../../helpers/scripted-openai-server";

/** A turn, or one built from the request it answers (an echo of its model). */
export type ScriptStep = ScriptedTurn | ((request: ScriptedRequest) => ScriptedTurn);

/** What a dialog the driver's extension opened returned to it. */
export interface AskRecord {
	readonly tag: string;
	readonly answer: string | boolean | null;
}

/** A gate the test armed by name: a tool or handler reaching it parks until `open()`. */
export interface ArmedGate {
	readonly entered: PromiseWithResolvers<void>;
	open(): void;
}

export const SUMMARY_TEXT = "The conversation so far, summed up.";
const DEFAULT_TURN: ScriptedTurn = { text: ["Done."] };
const SUMMARIZER = "You are a context summarization assistant.";

interface Gate {
	readonly sessionId: string;
	reached: boolean;
	opened: boolean;
	readonly opening: PromiseWithResolvers<void>;
}

export class PiRouter {
	readonly asks: AskRecord[] = [];
	/** `start <session>` and `shutdown <session>`, in the order the extensions saw them. */
	readonly lifecycle: { readonly event: "start" | "shutdown"; readonly sessionId: string }[] = [];
	/** The arguments of every run of the driver's `/drv-ping`, in order. */
	readonly commandRuns: string[] = [];
	/** The text of every input an extension's `input` handler saw, in order. */
	readonly inputs: string[] = [];
	private readonly armed = new Map<string, ArmedGate & { readonly released: Promise<void> }>();
	private readonly scripts = new Map<string, ScriptStep[]>();
	private readonly gates = new Map<string, Gate>();
	private readonly seen = new Map<string, ScriptedRequest[]>();
	private readonly watchers = new Set<() => void>();
	private gateCount = 0;

	/** Appends to the session's script; a session with none left is answered `Done.`. */
	script(sessionId: string, steps: readonly ScriptStep[]): void {
		this.scripts.set(sessionId, [...(this.scripts.get(sessionId) ?? []), ...steps]);
	}

	/** The session's next run is `steps`: what an earlier run left unconsumed goes. */
	replace(sessionId: string, steps: readonly ScriptStep[]): void {
		this.scripts.set(sessionId, [...steps]);
	}

	/** A gate for one `driver_hold` or subagent call of the session; the script names it in the call's arguments. */
	newGate(sessionId: string): string {
		const name = `${sessionId}#${++this.gateCount}`;
		this.gates.set(name, { sessionId, reached: false, opened: false, opening: Promise.withResolvers<void>() });
		return name;
	}

	/** Gate `name` holds whoever reaches it from now on, until it is opened; a gate by name nobody armed is open. */
	arm(name: string): ArmedGate {
		const released = Promise.withResolvers<void>();
		const gate = { entered: Promise.withResolvers<void>(), released: released.promise, open: () => released.resolve() };
		this.armed.set(name, gate);
		return gate;
	}

	openArmed(): void {
		for (const gate of this.armed.values()) gate.open();
	}

	/** An extension reached the gate: settles once it is opened. */
	gate(name: string): Promise<void> {
		if (name.startsWith("rig:")) {
			const armed = this.armed.get(name);
			armed?.entered.resolve();
			return armed?.released ?? Promise.resolve();
		}
		const gate = this.gates.get(name);
		if (!gate) return Promise.reject(new Error(`a tool names a gate that was never made: ${name}`));
		gate.reached = true;
		this.notify();
		return gate.opening.promise;
	}

	/** Opens every gate of the session, including one not reached yet. */
	release(sessionId: string): void {
		for (const gate of this.gates.values()) {
			if (gate.sessionId !== sessionId || gate.opened) continue;
			gate.opened = true;
			gate.opening.resolve();
		}
	}

	/** Resolves once a tool of the session waits at a gate not yet opened. */
	entered(sessionId: string): Promise<void> {
		return this.until(() =>
			[...this.gates.values()].some((gate) => gate.sessionId === sessionId && gate.reached && !gate.opened)
				? true
				: undefined,
		).then(() => undefined);
	}

	/** Resolves with the dialog's record once the extension has the answer to `tag`. */
	answered(tag: string): Promise<AskRecord> {
		return this.until(() => this.asks.find((ask) => ask.tag === tag));
	}

	/** Resolves once `/drv-ping` has run `count` times. */
	commandsRan(count: number): Promise<void> {
		return this.until(() => (this.commandRuns.length >= count ? true : undefined)).then(() => undefined);
	}

	/** Resolves once the session's `pi` has run `session_shutdown`. */
	shutDown(sessionId: string): Promise<void> {
		return this.until(() =>
			this.lifecycle.some((record) => record.sessionId === sessionId && record.event === "shutdown") ? true : undefined,
		).then(() => undefined);
	}

	/** How many `pi` processes run now, of the session or of all. */
	liveRuntimes(sessionId?: string): number {
		const count = (event: "start" | "shutdown") =>
			this.lifecycle.filter(
				(record) => record.event === event && (sessionId === undefined || record.sessionId === sessionId),
			).length;
		return count("start") - count("shutdown");
	}

	starts(sessionId: string): number {
		return this.lifecycle.filter((record) => record.sessionId === sessionId && record.event === "start").length;
	}

	/** The session's requests, oldest first, summaries left out. */
	requests(sessionId: string): readonly ScriptedRequest[] {
		return this.seen.get(sessionId) ?? [];
	}

	/** A note of the driver's extension (`driver-extension.ts`). */
	readonly note = (text: string): void => {
		const note = JSON.parse(text);
		if (note.kind === "start" || note.kind === "shutdown")
			this.lifecycle.push({ event: note.kind, sessionId: note.sessionId });
		else if (note.kind === "ask") this.asks.push({ tag: note.tag, answer: note.answer });
		else if (note.kind === "input") this.inputs.push(note.text);
		else if (note.kind === "command") this.commandRuns.push(note.args);
		else throw new Error(`the driver's extension sent an unknown note: ${text}`);
		this.notify();
	};

	readonly route = (request: ScriptedRequest): ScriptedTurn => {
		if (isSummary(request)) return { text: [SUMMARY_TEXT] };
		const { sessionId } = request;
		if (sessionId === undefined) return DEFAULT_TURN;
		this.seen.set(sessionId, [...this.requests(sessionId), request]);
		const step = this.scripts.get(sessionId)?.shift();
		if (step === undefined) return DEFAULT_TURN;
		return typeof step === "function" ? step(request) : step;
	};

	private until<T>(find: () => T | undefined): Promise<T> {
		const found = find();
		if (found !== undefined) return Promise.resolve(found);
		return new Promise((resolve) => {
			const check = () => {
				const match = find();
				if (match === undefined) return;
				this.watchers.delete(check);
				resolve(match);
			};
			this.watchers.add(check);
		});
	}

	private notify(): void {
		for (const check of [...this.watchers]) check();
	}
}

function isSummary(request: ScriptedRequest): boolean {
	return request.messages.some(
		(message) => message.role === "system" && textOf(message.content).startsWith(SUMMARIZER),
	);
}

/** A message's text, as OpenAI's chat format holds it: a string, or a list of parts. */
export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("\n");
}
