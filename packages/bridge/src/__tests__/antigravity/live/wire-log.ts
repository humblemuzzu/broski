/**
 * The frames the backend and the real `agy` exchanged, as the wire tap (`wire-tap.ts`) logged them: one log per `agy`
 * the backend started (the live front, each short job), each in the order the tap passed its frames. `install` writes
 * the script the backend runs as its `agy`, so the backend under test is the production one, spawning, stopping and
 * reading its `agy` as it always does; only the bytes are copied on the way, and the tap's own `authenticate` added.
 */

import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import type { AgyProfile } from "./profile";

const TAP = join(import.meta.dir, "wire-tap.ts");

type Fields = Readonly<Record<string, unknown>>;

export interface Frame {
	/** Milliseconds since the tap started this `agy`. */
	readonly at: number;
	/** The backend, `agy`, or the tap itself (its `authenticate`). */
	readonly from: "client" | "agent" | "tap";
	/** The JSON-RPC message, parsed. */
	readonly message: Fields;
	/** On the live front, the pids of agy's children as the tap passed on a session open or its answer. */
	readonly children?: readonly number[];
}

export interface TappedAgy {
	/** The tap's own pid: the process the backend spawned and signals. */
	readonly tapPid: number;
	/** The real `agy`'s pid. */
	readonly pid: number;
	readonly args: readonly string[];
	/** When the tap started, in ms since the epoch: a frame was passed `at` ms later. */
	readonly startedAt: number;
	readonly frames: readonly Frame[];
	readonly exit?: { readonly code: number | null; readonly signal: string | null };
}

/** A request one side sent, with what the other answered when it has. */
export interface Exchange {
	readonly agy: TappedAgy;
	readonly request: Frame;
	readonly answer?: Frame;
}

function quoted(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}

export class WireLog {
	private constructor(readonly dir: string) {}

	/** A log under `root`, and the executable the backend is to run as `agy`, in `profile`. */
	static install(root: string, agy: string, profile: AgyProfile): { readonly log: WireLog; readonly cliPath: string } {
		const dir = join(root, "wire");
		mkdirSync(dir, { recursive: true });
		const cliPath = join(root, "agy");
		const exec = [process.execPath, TAP, agy, dir, profile.root].map(quoted).join(" ");
		writeFileSync(cliPath, `#!/bin/sh\nexec ${exec} "$@"\n`);
		chmodSync(cliPath, 0o755);
		return { log: new WireLog(dir), cliPath };
	}

	/** Every `agy` the backend started, oldest first. */
	processes(): TappedAgy[] {
		return readdirSync(this.dir)
			.filter((name) => name.endsWith(".jsonl"))
			.flatMap((name) => tappedAgy(Number(name.slice(0, -".jsonl".length)), readFileSync(join(this.dir, name), "utf8")))
			.sort((a, b) => a.startedAt - b.startedAt);
	}

	/** The live front the backend runs now: the newest `agy acp --process-per-session` that has not exited. */
	front(): TappedAgy | undefined {
		return this.processes().findLast((agy) => isFront(agy) && agy.exit === undefined);
	}

	/**
	 * The requests of `method` that `asker` sent (about `sessionId`, when named), oldest first across every `agy`: a
	 * short job that outlived a front started after it may well send the newest.
	 */
	exchanges(method: string, sessionId?: string, asker: Frame["from"] = "client"): Exchange[] {
		const exchanges = this.processes().flatMap((agy) =>
			agy.frames.flatMap((request): Exchange[] => {
				if (request.from !== asker || request.message.method !== method || request.message.id === undefined) return [];
				if (sessionId !== undefined && paramsOf(request).sessionId !== sessionId) return [];
				const answer = agy.frames.find(
					(frame) =>
						frame.from !== asker && frame.message.method === undefined && frame.message.id === request.message.id,
				);
				return [{ agy, request, ...(answer !== undefined && { answer }) }];
			}),
		);
		return exchanges.sort((a, b) => timeOf(a.agy, a.request) - timeOf(b.agy, b.request));
	}

	/** The notifications of `method` either side sent about `sessionId`, oldest first across every `agy`. */
	notifications(method: string, sessionId: string): Array<{ readonly agy: TappedAgy; readonly frame: Frame }> {
		return this.processes()
			.flatMap((agy) =>
				agy.frames
					.filter((frame) => frame.message.method === method && frame.message.id === undefined)
					.filter((frame) => paramsOf(frame).sessionId === sessionId)
					.map((frame) => ({ agy, frame })),
			)
			.sort((a, b) => timeOf(a.agy, a.frame) - timeOf(b.agy, b.frame));
	}

	/** The exchange in which a front last made or loaded `sessionId`: its newest `session/new` or `session/load` there. */
	hosting(sessionId: string): Exchange | undefined {
		const made = this.exchanges("session/new").filter((exchange) => resultOf(exchange.answer)?.sessionId === sessionId);
		const loaded = this.exchanges("session/load", sessionId);
		return [...made, ...loaded]
			.filter((exchange) => isFront(exchange.agy))
			.sort((a, b) => timeOf(a.agy, a.request) - timeOf(b.agy, b.request))
			.at(-1);
	}
}

/** When the tap passed `frame` on, in ms since the epoch. */
export function timeOf(agy: TappedAgy, frame: Frame): number {
	return agy.startedAt + frame.at;
}

export function isFront(agy: Pick<TappedAgy, "args">): boolean {
	return agy.args.includes("--process-per-session");
}

/** The pids that joined the front's children while it opened a session: the session's own worker. */
export function appeared(open: Exchange): number[] {
	const before = open.request.children;
	const after = open.answer?.children;
	if (before === undefined || after === undefined) {
		throw new Error(`the tap noted no children of agy ${open.agy.pid} around its ${open.request.message.method}`);
	}
	return after.filter((pid) => !before.includes(pid));
}

/** The frames the exchange's `agy` passed after its request and before its answer (all since, while it has none). */
export function framesDuring(exchange: Exchange): readonly Frame[] {
	const { frames } = exchange.agy;
	const to = exchange.answer === undefined ? frames.length : frames.indexOf(exchange.answer);
	return frames.slice(frames.indexOf(exchange.request) + 1, to);
}

export function paramsOf(frame: Frame): Fields {
	return isRecord(frame.message.params) ? frame.message.params : {};
}

export function resultOf(frame: Frame | undefined): Fields | undefined {
	return frame !== undefined && isRecord(frame.message.result) ? frame.message.result : undefined;
}

/** A `session/update`'s update, for one sent about a session. */
export function updateOf(frame: Frame): Fields | undefined {
	const { update } = paramsOf(frame);
	return isRecord(update) ? update : undefined;
}

/** A log whose last line the tap is still writing reads up to the line before. */
function tappedAgy(tapPid: number, text: string): TappedAgy[] {
	const records = text.split("\n").flatMap((line): Fields[] => {
		try {
			const record: unknown = JSON.parse(line);
			return isRecord(record) ? [record] : [];
		} catch {
			return [];
		}
	});
	const start = records.find((record) => isRecord(record.start))?.start;
	if (!isRecord(start) || typeof start.pid !== "number" || !Array.isArray(start.args)) return [];
	const exit = records.find((record) => isRecord(record.exit))?.exit;
	return [
		{
			tapPid,
			pid: start.pid,
			args: start.args.filter((arg): arg is string => typeof arg === "string"),
			startedAt: typeof start.startedAt === "number" ? start.startedAt : 0,
			frames: records.flatMap(frameOf),
			...(isRecord(exit) && {
				exit: {
					code: typeof exit.code === "number" ? exit.code : null,
					signal: typeof exit.signal === "string" ? exit.signal : null,
				},
			}),
		},
	];
}

function frameOf(record: Fields): Frame[] {
	const { at, from, line, children } = record;
	if (typeof at !== "number" || (from !== "client" && from !== "agent" && from !== "tap") || typeof line !== "string") {
		return [];
	}
	const pids = Array.isArray(children) ? children.filter((pid): pid is number => typeof pid === "number") : undefined;
	try {
		const message: unknown = JSON.parse(line);
		return isRecord(message) ? [{ at, from, message, ...(pids !== undefined && { children: pids }) }] : [];
	} catch {
		return [];
	}
}
