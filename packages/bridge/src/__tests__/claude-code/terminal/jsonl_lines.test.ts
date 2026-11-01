import { describe, expect, test } from "bun:test";
import { JsonlLines, MAX_LINE_BYTES } from "../../../backends/claude-code/terminal/jsonl-lines";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("JsonlLines", () => {
	test("whole lines come out; the partial last line waits for its newline", () => {
		const lines = new JsonlLines();
		expect(lines.push(bytes('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
		expect(lines.push(bytes(":2}\n"))).toEqual(['{"b":2}']);
		expect(lines.push(bytes(""))).toEqual([]);
	});

	test("a multi-byte character split across chunks is whole in its line", () => {
		const lines = new JsonlLines();
		const all = bytes("héllo 🙂 wörld\n");
		const cut = all.indexOf(0xf0) + 2;
		expect(lines.push(all.subarray(0, cut))).toEqual([]);
		expect(lines.push(all.subarray(cut))).toEqual(["héllo 🙂 wörld"]);
	});

	test("a partial line is kept by value: the caller may reuse its read buffer", () => {
		const lines = new JsonlLines();
		const buffer = Buffer.from('{"a":"par');
		expect(lines.push(buffer)).toEqual([]);
		buffer.fill(0x78);
		expect(lines.push(Buffer.from('tial"}\n'))).toEqual(['{"a":"partial"}']);
	});

	test("a CRLF line loses its carriage return, an empty line stays empty", () => {
		expect(new JsonlLines().push(bytes("a\r\n\nb\n"))).toEqual(["a", "", "b"]);
	});

	test("a line past the bound is dropped whole, counted, and the next line is read", () => {
		const lines = new JsonlLines();
		const big = new Uint8Array(MAX_LINE_BYTES + 10).fill(0x61);
		expect(lines.push(big.subarray(0, 1_000_000))).toEqual([]);
		expect(lines.push(big.subarray(1_000_000))).toEqual([]);
		expect(lines.push(bytes("tail of the big line\nnext\n"))).toEqual(["next"]);
		expect(lines.dropped).toBe(1);
	});

	test("a too-long line that arrives in one chunk with its newline is dropped as well", () => {
		const lines = new JsonlLines();
		const big = new Uint8Array(MAX_LINE_BYTES + 1).fill(0x61);
		const chunk = new Uint8Array(big.length + 3);
		chunk.set(big);
		chunk.set(bytes("\nok"), big.length);
		expect(lines.push(chunk)).toEqual([]);
		expect(lines.push(bytes("\n"))).toEqual(["ok"]);
		expect(lines.dropped).toBe(1);
	});

	test("reset forgets a partial line", () => {
		const lines = new JsonlLines();
		lines.push(bytes("half"));
		lines.reset();
		expect(lines.push(bytes("new\n"))).toEqual(["new"]);
	});
});
