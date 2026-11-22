/**
 * The wire under the adapter, on its own: records split as `pi --mode rpc` writes them (LF alone, CR dropped, never
 * on U+2028, multi-byte characters across chunks), a record past the bound skipped and reported, and frames read by
 * their schemas: an unknown event or dialog is ignored, a known one that breaks its schema is invalid, never guessed.
 */

import { describe, expect, test } from "bun:test";
import { type Delivery, RpcClient } from "../../backends/pi/rpc/client";
import { parseFrame } from "../../backends/pi/rpc/frames";
import { JsonlSplitter, MAX_RECORD_BYTES } from "../../backends/pi/rpc/jsonl";
import type { TransportSink } from "../../backends/pi/rpc/transport";

const bytes = (text: string) => new TextEncoder().encode(text);

function splitAll(chunks: readonly Uint8Array[], maxBytes?: number) {
	const splitter = new JsonlSplitter(maxBytes);
	return [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.end()];
}

describe("JSONL records", () => {
	test("split on LF only, a CR before it dropped, U+2028 and U+2029 kept inside a record", () => {
		expect(splitAll([bytes('{"a":1}\r\n{"b":"x\u2028y\u2029z"}\n')])).toEqual([
			{ kind: "line", text: '{"a":1}' },
			{ kind: "line", text: '{"b":"x\u2028y\u2029z"}' },
		]);
	});

	test("a record and a character split across chunks come out whole", () => {
		const whole = bytes('{"t":"héllo 😀"}\n');
		const chunks = Array.from(whole, (byte) => Uint8Array.of(byte));
		expect(splitAll(chunks)).toEqual([{ kind: "line", text: '{"t":"héllo 😀"}' }]);
	});

	test("a last record without its LF is still one when the stream ends; an empty stream is none", () => {
		expect(splitAll([bytes('{"a":1}\n{"b":2}')])).toEqual([
			{ kind: "line", text: '{"a":1}' },
			{ kind: "line", text: '{"b":2}' },
		]);
		expect(splitAll([])).toEqual([]);
	});

	test("a record past the bound is skipped and reported by its size and first bytes, and the next one reads", () => {
		const big = `{"x":"${"a".repeat(100)}"}`;
		expect(splitAll([bytes(`${big}\n`), bytes('{"ok":true}\n')], 50)).toEqual([
			{ kind: "oversized", bytes: big.length, head: big },
			{ kind: "line", text: '{"ok":true}' },
		]);
		const chunked = Array.from({ length: 30 }, (_, at) => bytes(at === 0 ? '{"type":"agent_end",' : "a".repeat(20)));
		const [skipped] = splitAll([...chunked, bytes("\n")], 100);
		expect(skipped).toEqual({ kind: "oversized", bytes: 600, head: `{"type":"agent_end",${"a".repeat(100)}` });
	});
});

describe("a record past the bound under the client", () => {
	/** What `records`, written by Pi and split as `pi`'s stdout is, deliver. */
	async function delivered(records: readonly string[]): Promise<Delivery[]> {
		const deliveries: Delivery[] = [];
		let sink: TransportSink | undefined;
		new RpcClient(
			(given) => {
				sink = given;
				const ended = new Promise<never>(() => undefined);
				const stop = () => Promise.resolve();
				return { ended, running: true, write() {}, pause() {}, resume() {}, stop, detach() {} };
			},
			(delivery) => {
				deliveries.push(delivery);
			},
		);
		const splitter = new JsonlSplitter();
		for (const record of records) for (const item of splitter.push(bytes(`${record}\n`))) sink?.(item);
		await new Promise((resolve) => setImmediate(resolve));
		return deliveries;
	}

	const filler = "x".repeat(MAX_RECORD_BYTES);

	test("a run's agent_end, which repeats what was read already, is dropped without a word", async () => {
		const records = [
			`{"type":"agent_end","messages":[{"role":"user","content":"${filler}"}]}`,
			'{"type":"agent_start"}',
		];
		expect(await delivered(records)).toMatchObject([{ kind: "event", event: { type: "agent_start" } }]);
	});

	test("any other record past the bound is reported", async () => {
		const record = `{"type":"message_end","message":{"role":"user","content":"${filler}","timestamp":1}}`;
		expect(await delivered([record])).toMatchObject([
			{ kind: "fault", message: `Pi sent a record of ${bytes(record).length} bytes, which the bridge cannot read` },
		]);
	});
});

describe("frames", () => {
	test("a response is read with its id and result", () => {
		expect(parseFrame('{"id":"b1","type":"response","command":"get_state","success":true,"data":{}}')).toMatchObject({
			kind: "response",
			response: { id: "b1", success: true },
		});
	});

	test("an event or dialog the adapter does not read is ignored; one it reads that breaks its schema is invalid", () => {
		expect(parseFrame('{"type":"turn_start"}').kind).toBe("ignored");
		expect(parseFrame('{"type":"extension_ui_request","id":"u","method":"custom"}').kind).toBe("ignored");
		expect(parseFrame('{"type":"agent_settled"}').kind).toBe("invalid");
		expect(parseFrame('{"type":"extension_ui_request","id":"u","method":"confirm","title":3}').kind).toBe("invalid");
	});

	test("an appended entry keeps a usage entry's time, kind, provider and usage; any other entry still reads", () => {
		const usage = { input: 2, output: 1, cacheRead: 900, cacheWrite: 0, totalTokens: 903, cost: { total: 0.01 } };
		const warm = { type: "usage", id: "u1", parentId: "m1", kind: "cache_warm", provider: "anthropic", usage };
		const at = "2026-11-22T10:00:00.000Z";
		expect(parseFrame(JSON.stringify({ type: "entry_appended", entry: { ...warm, timestamp: at } }))).toMatchObject({
			kind: "event",
			event: {
				entry: { id: "u1", timestamp: at, kind: "cache_warm", provider: "anthropic", usage: { cacheRead: 900 } },
			},
		});
		const odd = { type: "label", id: "l1", parentId: null, timestamp: 5, kind: 3, usage: "none" };
		expect(parseFrame(JSON.stringify({ type: "entry_appended", entry: odd }))).toMatchObject({
			kind: "event",
			event: { entry: { id: "l1", type: "label", timestamp: undefined, kind: undefined, usage: undefined } },
		});
	});

	test("what is not a JSON object is invalid", () => {
		for (const text of ["not json", "[1,2]", '"text"', "{}"]) expect(parseFrame(text).kind).toBe("invalid");
	});
});
