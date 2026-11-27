/**
 * One recorded `agy` played back to the bridge's own JSON-RPC layer. Each record agy wrote goes through the JSONL
 * framing and `JsonRpc.receive` in the recorded order, an answer carrying the id the code under test gave its request;
 * each record the bridge sent agy in the recording is the one the code under test must have written by then, the same
 * but for its own request ids. Where the recording shows the bridge speaking and the code has written nothing yet,
 * `act` makes it speak: the person's action on the phone, or a request the bridge makes before the code under test
 * takes over. Nothing reaches the code that agy did not write: the tap's own `authenticate` and its answer, which the
 * backend never saw, are left out.
 */

import { expect } from "bun:test";
import type { z } from "zod";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { JsonlSplitter } from "../../../adapter-kit/jsonl";
import type { InitializeResult } from "../../../backends/antigravity/acp/frames";
import { JsonRpc } from "../../../backends/antigravity/acp/rpc";
import type { AgyProcess } from "../../../backends/antigravity/agy-process";
import type { Frame } from "../live/wire-log";
import type { RecordedAgy } from "../record/scrub";

type Message = Frame["message"];

/** What makes the code under test send `recorded`, which the recording shows the bridge sent next. */
export type Act = (recorded: Message) => void;

const encoder = new TextEncoder();

/** Lets every promise the last record settled run on, as they do between two reads of agy's output. */
function settled(): Promise<void> {
	return Bun.sleep(0);
}

export function isAnswer(message: Message): boolean {
	return message.method === undefined && message.id !== undefined;
}

export class Replay {
	readonly faults: string[] = [];
	readonly rpc: JsonRpc;
	private readonly frames: readonly Frame[];
	private readonly written: Message[] = [];
	private matched = 0;
	private next = 0;
	/** The id the code under test gave each request the recording shows, by the recorded id as JSON. */
	private readonly ids = new Map<string, unknown>();
	private readonly splitter = new JsonlSplitter();

	constructor(agy: RecordedAgy) {
		const tapIds = new Set(agy.frames.filter((frame) => frame.from === "tap").map((frame) => frame.message.id));
		this.frames = agy.frames.filter((frame) => frame.from !== "tap" && !tapIds.has(frame.message.id));
		this.rpc = new JsonRpc(
			"agy",
			(record) => this.wrote(record),
			(fault) => this.faults.push(fault),
		);
	}

	/** The recorded `agy` as the backend's parts take one, `agent` its `initialize` answer. */
	process(agent: InitializeResult): AgyProcess {
		const ended = new Promise<string>(() => undefined);
		return { acp: { rpc: this.rpc, running: true, ended, stop: async () => undefined }, agent };
	}

	/** The record the recording shows the bridge sending next. */
	nextSent(): Message | undefined {
		return this.frames.slice(this.next).find((frame) => frame.from === "client")?.message;
	}

	/** What the code under test wrote that the recording does not show the bridge sending. */
	unrecorded(): readonly Message[] {
		return this.written.slice(this.matched);
	}

	/** Plays on up to and including the first frame `until` holds for, or to the end. */
	async play(act: Act, until: (frame: Frame) => boolean = () => false): Promise<void> {
		for (let frame = this.frames[this.next]; frame !== undefined; frame = this.frames[this.next]) {
			this.next += 1;
			if (frame.from === "agent") this.fromAgy(frame.message);
			else await this.fromBridge(frame.message, act);
			await settled();
			if (until(frame)) return;
		}
	}

	/** A stop for `play`: agy's answer to the next request of `method` the recording shows the bridge sending. */
	answerOf(method: string): (frame: Frame) => boolean {
		const ahead = this.frames.slice(this.next);
		const id = ahead.find((frame) => frame.from === "client" && frame.message.method === method)?.message.id;
		if (id === undefined) throw new Error(`the recording shows no ${method} ahead`);
		return (frame) => frame.from === "agent" && isAnswer(frame.message) && frame.message.id === id;
	}

	/** The recorded request of `method` the bridge sent next, sent now with its recorded params; agy's answer to it. */
	async request<T>(method: string, schema: z.ZodType<T>): Promise<T> {
		const result = await this.sent(method, (params) => this.rpc.request(method, params, schema));
		if (!result.ok) throw new Error(`agy's recorded answer to ${method} did not read: ${result.failure.message}`);
		return result.result;
	}

	/** The recorded request of `method` the bridge sent next, sent now by `send` from its recorded params. */
	async sent<T>(method: string, send: (params: unknown) => Promise<T>): Promise<T> {
		expect(this.nextSent()?.method).toBe(method);
		let sending: Promise<T> | undefined;
		await this.play((message) => {
			sending = send(message.params);
		}, this.answerOf(method));
		if (sending === undefined) throw new Error(`the code under test sent ${method} itself, before the replay did`);
		return sending;
	}

	private wrote(record: string): void {
		const message: unknown = JSON.parse(record);
		if (!isRecord(message)) throw new Error(`the code under test wrote ${record}`);
		this.written.push(message);
	}

	private fromAgy(message: Message): void {
		let record = message;
		if (isAnswer(message)) {
			const key = JSON.stringify(message.id);
			if (!this.ids.has(key)) throw new Error(`agy answered request ${key}, which the code under test never sent`);
			record = { ...message, id: this.ids.get(key) };
		}
		for (const item of this.splitter.push(encoder.encode(`${JSON.stringify(record)}\n`))) this.rpc.receive(item);
	}

	private async fromBridge(recorded: Message, act: Act): Promise<void> {
		if (this.written.length === this.matched) {
			act(recorded);
			await settled();
		}
		const sent = this.written[this.matched];
		if (sent === undefined) throw new Error(`the bridge sent agy ${JSON.stringify(recorded)}; the code sent nothing`);
		this.matched += 1;
		const ours = recorded.method !== undefined && recorded.id !== undefined;
		if (ours) this.ids.set(JSON.stringify(recorded.id), sent.id);
		expect(ours ? { ...sent, id: recorded.id } : sent).toEqual(recorded);
	}
}
