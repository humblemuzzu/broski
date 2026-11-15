import { describe, expect, test } from "bun:test";
import { encodeFrame } from "../core/frame";
import { wellFormedJson } from "../core/well-formed-json";
import { loneSurrogates } from "./helpers/lone-surrogates";

const HIGH = "\ud83d";
const LOW = "\ude00";
const PAIR = `${HIGH}${LOW}`;

describe("wellFormedJson", () => {
	test("replaces a lone surrogate in a value and in a key, and keeps a pair", () => {
		const text = wellFormedJson({ [`k${HIGH}`]: `a${HIGH}b${PAIR}c${LOW}d` });
		expect(text).toBe(`{"k\\ufffd":"a\\ufffdb${PAIR}c\\ufffdd"}`);
		expect(loneSurrogates(text)).toEqual([]);
	});

	test("leaves the text of an escape alone: a backslash before `ud83d` is text, not an escape", () => {
		const literal = "\\ud83d and \\\\ud83d and \\\\\\ud83d";
		expect(JSON.parse(wellFormedJson(literal))).toBe(literal);
		expect(JSON.parse(wellFormedJson(`${HIGH}\\${HIGH}\\\\${LOW}`))).toBe("\ufffd\\\ufffd\\\\\ufffd");
	});

	test("a high surrogate next to a pair, and a pair next to a low one, lose only the lone one", () => {
		expect(JSON.parse(wellFormedJson(`${HIGH}${PAIR}`))).toBe(`\ufffd${PAIR}`);
		expect(JSON.parse(wellFormedJson(`${PAIR}${LOW}`))).toBe(`${PAIR}\ufffd`);
		expect(JSON.parse(wellFormedJson(`${LOW}${HIGH}`))).toBe("\ufffd\ufffd");
	});

	test("agrees with String.prototype.toWellFormed on every combination of the units that matter", () => {
		const units = [HIGH, LOW, PAIR, "\\", "u", "d", "8", "3", "f", '"', "a", "\n"];
		let seed = 1;
		const next = (bound: number): number => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed % bound;
		};
		for (let round = 0; round < 3_000; round++) {
			const text = Array.from({ length: next(14) }, () => units[next(units.length)]).join("");
			const written = wellFormedJson({ [text]: [text] });
			expect(JSON.parse(written)).toEqual({ [text.toWellFormed()]: [text.toWellFormed()] });
			expect(loneSurrogates(written)).toEqual([]);
		}
	});

	test("never changes the size of what it writes, so measured frames stay exact", () => {
		const message = { type: "error", requestId: "r", error: { code: "internal", message: `${HIGH}${LOW}${LOW}` } };
		expect(wellFormedJson(message).length).toBe(JSON.stringify(message).length);
		expect(encodeFrame(message).bytes).toBe(Buffer.byteLength(encodeFrame(message).text, "utf8"));
	});

	test("every frame the core encodes is well-formed even when the message holds a lone surrogate", () => {
		const frame = encodeFrame({ type: "error", requestId: HIGH, error: { code: "internal", message: LOW } });
		expect(loneSurrogates(frame.text)).toEqual([]);
	});
});
