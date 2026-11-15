/**
 * The wire under the adapter, on its own: records split as `pi --mode rpc` writes them (LF alone, CR dropped, never
 * on U+2028, multi-byte characters across chunks), a record past the bound skipped and reported, and frames read by
 * their schemas: an unknown event or dialog is ignored, a known one that breaks its schema is invalid, never guessed.
 */

import { describe, expect, test } from "bun:test";
import { parseFrame } from "../../backends/pi/rpc/frames";
import { JsonlSplitter } from "../../backends/pi/rpc/jsonl";

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

	test("a record past the bound is skipped and reported by its size, and the next one reads", () => {
		const big = `{"x":"${"a".repeat(100)}"}`;
		expect(splitAll([bytes(`${big}\n`), bytes('{"ok":true}\n')], 50)).toEqual([
			{ kind: "oversized", bytes: big.length },
			{ kind: "line", text: '{"ok":true}' },
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

	test("what is not a JSON object is invalid", () => {
		for (const text of ["not json", "[1,2]", '"text"', "{}"]) expect(parseFrame(text).kind).toBe("invalid");
	});
});
