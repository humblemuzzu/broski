/**
 * Commands to one `pi --mode rpc` and what it answers, as values (pi-coding-agent 1.5.2 `docs/rpc.md:35-48, 73-89`).
 * Every command carries an id, its response is matched by that id, and every request ends: with Pi's answer, its
 * refusal, its deadline if it has one, or the process's exit. Events and extension UI requests reach `deliver` one at a time, in the
 * order Pi wrote them. An `ordered` request's answer takes its place in that order too, so a prompt's disposition is
 * read after the events Pi sent before it; the lookups that delivery itself awaits are answered as they arrive.
 *
 * Records waiting for delivery are bounded two ways. A tool's progress that a later one of the same call supersedes
 * before it is delivered is dropped: the adapter reads each as the whole output so far (`mapping/tool-items.ts`,
 * `output_replaced`), as the holder's replay does. Past `PAUSE_AT_CHARS` the transport is paused, but never while a
 * lookup is pending: its answer comes behind the records already sent, and the delivery awaiting it would wait out
 * its deadline.
 */

import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { errorText } from "../error-text";
import type { PiExit } from "./child";
import { type InboundFrame, type PiEvent, parseFrame, type ResponseFrame, type UiRequest } from "./frames";
import type { JsonlItem } from "./jsonl";
import type { OpenTransport, PiEnd, PiTransport, TransportItem } from "./transport";

export type RpcAnswer<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/** What reaches the session, in Pi's order; `exit` or `detached` comes last, after every record the process wrote. */
export type Delivery =
	| { readonly kind: "event"; readonly event: PiEvent }
	| { readonly kind: "ui"; readonly request: UiRequest }
	| { readonly kind: "fault"; readonly message: string }
	| { readonly kind: "replay"; readonly replaying: boolean }
	| PiEnd;

export type Deliver = (delivery: Delivery) => void | Promise<void>;

export interface RpcCommand {
	readonly type: string;
	readonly [field: string]: unknown;
}

export interface RequestOptions {
	/** Without one, only Pi's answer or its exit ends the request: a human may be what Pi is waiting on. */
	readonly deadlineMs?: number;
	/** The answer is read in its place among the events (module comment). Default true. */
	readonly ordered?: boolean;
}

type Queued = (Delivery | { readonly kind: "answer"; readonly settle: () => void }) & {
	chars: number;
	/** A later progress record of the same tool call came before this one was delivered. */
	superseded?: boolean;
};

interface Pending {
	readonly command: string;
	readonly ordered: boolean;
	/** The deadline stops once Pi has answered, though an `ordered` answer is settled later, in its turn. */
	readonly answeredInTime: () => void;
	readonly settle: (response: ResponseFrame | string) => void;
}

/** Past these many characters of records waiting for delivery, stdout is not read until delivery catches up. */
const PAUSE_AT_CHARS = 16 * 1024 * 1024;
const RESUME_AT_CHARS = 4 * 1024 * 1024;

export class RpcClient {
	private readonly process: PiTransport;
	private readonly pending = new Map<string, Pending>();
	private readonly queue: Queued[] = [];
	private queuedChars = 0;
	/** By Pi's tool call id: the newest progress record of the call still waiting for delivery. */
	private readonly queuedUpdates = new Map<string, Queued>();
	private paused = false;
	private delivering = false;
	private detached = false;
	/** A command id of another bridge's client answered after this one took over the same `pi` must never match. */
	private readonly idPrefix = randomUUID().slice(0, 8);
	private nextId = 0;

	constructor(
		open: OpenTransport,
		private readonly deliver: Deliver,
	) {
		this.process = open((item) => this.received(item));
		void this.process.ended.then((end) => this.finished(end));
	}

	get ended(): Promise<PiEnd> {
		return this.process.ended;
	}

	get running(): boolean {
		return this.process.running;
	}

	request<T>(command: RpcCommand, reply: z.ZodType<T>, options: RequestOptions = {}): Promise<RpcAnswer<T>> {
		if (!this.process.running) return Promise.resolve({ ok: false, error: "Pi is not running" });
		const id = `${this.idPrefix}-${++this.nextId}`;
		return new Promise((resolve) => {
			const { deadlineMs } = options;
			const timer =
				deadlineMs === undefined
					? undefined
					: setTimeout(() => {
							this.pending.delete(id);
							this.reviewPause();
							resolve({ ok: false, error: `Pi did not answer ${command.type} within ${deadlineMs / 1000} s` });
						}, deadlineMs);
			this.pending.set(id, {
				command: command.type,
				ordered: options.ordered ?? true,
				answeredInTime: () => clearTimeout(timer),
				settle: (response) => {
					clearTimeout(timer);
					resolve(answerOf(response, reply));
				},
			});
			this.reviewPause();
			this.process.write(`${JSON.stringify({ ...command, id })}\n`);
		});
	}

	/** A record Pi answers nothing to: an `extension_ui_response`. */
	send(record: RpcCommand): void {
		this.process.write(`${JSON.stringify(record)}\n`);
	}

	stop(): Promise<unknown> {
		return this.process.stop();
	}

	/** Nothing more is delivered, and `pi` is left running where the transport can leave it. */
	detach(): void {
		this.detached = true;
		this.queue.length = 0;
		this.queuedUpdates.clear();
		this.queuedChars = 0;
		this.process.detach();
	}

	private received(item: TransportItem): void {
		if (item.kind === "replay") {
			this.enqueue({ ...item, chars: 0 });
			return;
		}
		const frame: InboundFrame =
			item.kind === "line" ? parseFrame(item.text) : { kind: "invalid", reason: `a record of ${item.bytes} bytes` };
		switch (frame.kind) {
			case "response":
				this.answered(frame.response);
				return;
			case "event":
				this.enqueueEvent(frame.event, charsOf(item));
				return;
			case "ui":
				this.enqueue({ kind: "ui", request: frame.request, chars: charsOf(item) });
				return;
			case "invalid":
				this.enqueue({
					kind: "fault",
					message: `Pi sent ${frame.reason}, which the bridge cannot read`,
					chars: charsOf(item),
				});
				return;
			case "ignored":
				return;
		}
	}

	/** A response no request waits for any more (it timed out) is dropped. */
	private answered(response: ResponseFrame): void {
		const pending = response.id === undefined ? undefined : this.pending.get(response.id);
		if (pending === undefined || response.id === undefined) return;
		this.pending.delete(response.id);
		pending.answeredInTime();
		if (pending.ordered) this.enqueue({ kind: "answer", settle: () => pending.settle(response), chars: 0 });
		else {
			this.reviewPause();
			pending.settle(response);
		}
	}

	private finished(end: PiEnd): void {
		const why = end.kind === "exit" ? exitText(end.exit, end.stderr) : "the bridge lost the Pi session";
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			pending.settle(why);
		}
		this.enqueue({ ...end, chars: 0 });
	}

	/** A call's progress drops the one of the same call still waiting; the call's end makes the next one its own. */
	private enqueueEvent(event: PiEvent, chars: number): void {
		const entry: Queued = { kind: "event", event, chars };
		if (event.type === "tool_execution_update") {
			const earlier = this.queuedUpdates.get(event.toolCallId);
			if (earlier !== undefined) {
				earlier.superseded = true;
				this.queuedChars -= earlier.chars;
				earlier.chars = 0;
			}
			this.queuedUpdates.set(event.toolCallId, entry);
		} else if (event.type === "tool_execution_end") {
			this.queuedUpdates.delete(event.toolCallId);
		}
		this.enqueue(entry);
	}

	private enqueue(entry: Queued): void {
		if (this.detached) return;
		this.queue.push(entry);
		this.queuedChars += entry.chars;
		this.reviewPause();
		if (!this.delivering) void this.drain();
	}

	private async drain(): Promise<void> {
		this.delivering = true;
		for (let entry = this.queue.shift(); entry !== undefined && !this.detached; entry = this.queue.shift()) {
			this.queuedChars -= entry.chars;
			this.reviewPause();
			if (entry.superseded) continue;
			if (entry.kind === "event" && entry.event.type === "tool_execution_update") {
				const { toolCallId } = entry.event;
				if (this.queuedUpdates.get(toolCallId) === entry) this.queuedUpdates.delete(toolCallId);
			}
			if (entry.kind === "answer") await settleInTurn(entry.settle);
			else await this.deliverSafely(entry);
		}
		this.delivering = false;
	}

	/** Paused past the bound and resumed below the lower one, but read while a lookup is pending (module comment). */
	private reviewPause(): void {
		const lookup = [...this.pending.values()].some((pending) => !pending.ordered);
		if (!this.paused && !lookup && this.queuedChars > PAUSE_AT_CHARS) {
			this.paused = true;
			this.process.pause();
		} else if (this.paused && (lookup || this.queuedChars < RESUME_AT_CHARS)) {
			this.paused = false;
			this.process.resume();
		}
	}

	private async deliverSafely(delivery: Delivery): Promise<void> {
		try {
			await this.deliver(delivery);
		} catch (error) {
			if (delivery.kind !== "fault") await this.deliverSafely({ kind: "fault", message: errorText(error) });
		}
	}
}

function charsOf(item: JsonlItem): number {
	return item.kind === "line" ? item.text.length : 0;
}

/** Whoever awaited the answer runs its synchronous continuation before the next record is delivered. */
function settleInTurn(settle: () => void): Promise<void> {
	settle();
	return new Promise((resolve) => setImmediate(resolve));
}

function answerOf<T>(response: ResponseFrame | string, reply: z.ZodType<T>): RpcAnswer<T> {
	if (typeof response === "string") return { ok: false, error: response };
	if (!response.success) return { ok: false, error: response.error ?? `Pi refused ${response.command}` };
	const parsed = reply.safeParse(response.data);
	if (parsed.success) return { ok: true, data: parsed.data };
	return { ok: false, error: `Pi answered ${response.command} with data the bridge cannot read` };
}

function exitText(exit: PiExit, stderr: string): string {
	const how = exit.error ?? (exit.signal ? `was stopped by ${exit.signal}` : `exited with code ${exit.code}`);
	const said = stderr === "" ? "" : `: ${stderr}`;
	return `Pi ${exit.error ? `could not start: ${how}` : how}${said}`;
}
