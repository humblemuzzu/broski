/**
 * Commands to one `pi --mode rpc` and what it answers, as values (pi-coding-agent 1.5.2 `docs/rpc.md:35-48, 73-89`).
 * Every command carries an id, its response is matched by that id, and every request ends: with Pi's answer, its
 * refusal, a deadline, or the process's exit. Events and extension UI requests reach `deliver` one at a time, in the
 * order Pi wrote them. An `ordered` request's answer takes its place in that order too, so a prompt's disposition is
 * read after the events Pi sent before it; the lookups that delivery itself awaits are answered as they arrive.
 */

import type { z } from "zod";
import { errorText } from "../error-text";
import { type PiExit, type PiLaunch, PiProcess } from "./child";
import { type InboundFrame, type PiEvent, parseFrame, type ResponseFrame, type UiRequest } from "./frames";
import type { JsonlItem } from "./jsonl";

export type RpcAnswer<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/** What reaches the session, in Pi's order; `exit` comes last, after every record the process wrote. */
export type Delivery =
	| { readonly kind: "event"; readonly event: PiEvent }
	| { readonly kind: "ui"; readonly request: UiRequest }
	| { readonly kind: "fault"; readonly message: string }
	| { readonly kind: "exit"; readonly exit: PiExit; readonly stderr: string };

export type Deliver = (delivery: Delivery) => void | Promise<void>;

export interface RpcCommand {
	readonly type: string;
	readonly [field: string]: unknown;
}

export interface RequestOptions {
	readonly deadlineMs: number;
	/** The answer is read in its place among the events (module comment). Default true. */
	readonly ordered?: boolean;
}

type Queued = (Delivery | { readonly kind: "answer"; readonly settle: () => void }) & { readonly chars?: number };

interface Pending {
	readonly command: string;
	readonly ordered: boolean;
	readonly settle: (response: ResponseFrame | string) => void;
}

/** Past these many characters of records waiting for delivery, stdout is not read until delivery catches up. */
const PAUSE_AT_CHARS = 16 * 1024 * 1024;
const RESUME_AT_CHARS = 4 * 1024 * 1024;

export class RpcClient {
	private readonly process: PiProcess;
	private readonly pending = new Map<string, Pending>();
	private readonly queue: Queued[] = [];
	private queuedChars = 0;
	private delivering = false;
	private nextId = 0;

	constructor(
		launch: PiLaunch,
		private readonly deliver: Deliver,
	) {
		this.process = new PiProcess(launch, (item) => this.received(item));
		void this.process.exited.then((exit) => this.ended(exit));
	}

	get exited(): Promise<PiExit> {
		return this.process.exited;
	}

	get running(): boolean {
		return this.process.running;
	}

	request<T>(command: RpcCommand, reply: z.ZodType<T>, options: RequestOptions): Promise<RpcAnswer<T>> {
		if (!this.process.running) return Promise.resolve({ ok: false, error: "Pi is not running" });
		const id = `b${++this.nextId}`;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ ok: false, error: `Pi did not answer ${command.type} within ${options.deadlineMs / 1000} s` });
			}, options.deadlineMs);
			this.pending.set(id, {
				command: command.type,
				ordered: options.ordered ?? true,
				settle: (response) => {
					clearTimeout(timer);
					resolve(answerOf(response, reply));
				},
			});
			this.process.write(`${JSON.stringify({ ...command, id })}\n`);
		});
	}

	/** A record Pi answers nothing to: an `extension_ui_response`. */
	send(record: RpcCommand): void {
		this.process.write(`${JSON.stringify(record)}\n`);
	}

	stop(): Promise<PiExit> {
		return this.process.stop();
	}

	private received(item: JsonlItem): void {
		const frame: InboundFrame =
			item.kind === "line" ? parseFrame(item.text) : { kind: "invalid", reason: `a record of ${item.bytes} bytes` };
		switch (frame.kind) {
			case "response":
				this.answered(frame.response);
				return;
			case "event":
				this.enqueue({ kind: "event", event: frame.event }, item);
				return;
			case "ui":
				this.enqueue({ kind: "ui", request: frame.request }, item);
				return;
			case "invalid":
				this.enqueue({ kind: "fault", message: `Pi sent ${frame.reason}, which the bridge cannot read` }, item);
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
		if (pending.ordered) this.enqueue({ kind: "answer", settle: () => pending.settle(response) });
		else pending.settle(response);
	}

	private ended(exit: PiExit): void {
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			pending.settle(exitText(exit, this.process.stderrTail()));
		}
		this.enqueue({ kind: "exit", exit, stderr: this.process.stderrTail() });
	}

	private enqueue(entry: Queued, item?: JsonlItem): void {
		const chars = item?.kind === "line" ? item.text.length : 0;
		this.queue.push({ ...entry, chars });
		this.queuedChars += chars;
		if (this.queuedChars > PAUSE_AT_CHARS) this.process.pause();
		if (!this.delivering) void this.drain();
	}

	private async drain(): Promise<void> {
		this.delivering = true;
		for (let entry = this.queue.shift(); entry !== undefined; entry = this.queue.shift()) {
			this.queuedChars -= entry.chars ?? 0;
			if (this.queuedChars < RESUME_AT_CHARS) this.process.resume();
			if (entry.kind === "answer") await settleInTurn(entry.settle);
			else await this.deliverSafely(entry);
		}
		this.delivering = false;
	}

	private async deliverSafely(delivery: Delivery): Promise<void> {
		try {
			await this.deliver(delivery);
		} catch (error) {
			if (delivery.kind !== "fault") await this.deliverSafely({ kind: "fault", message: errorText(error) });
		}
	}
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
