import { describe, expect, test } from "bun:test";
import { clip, clipEnd } from "../contract";

const PAIR = "😀";

describe("clipping text to a bound", () => {
	test("clip keeps the start and never splits a surrogate pair", () => {
		expect(clip(`ab${PAIR}`, 3)).toBe("ab");
		expect(clip(`ab${PAIR}`, 4)).toBe(`ab${PAIR}`);
		expect(clip("short", 10)).toBe("short");
	});

	test("clipEnd keeps the end and never splits a surrogate pair", () => {
		expect(clipEnd(`${PAIR}ab`, 3)).toBe("ab");
		expect(clipEnd(`${PAIR}ab`, 4)).toBe(`${PAIR}ab`);
		expect(clipEnd("short", 10)).toBe("short");
	});
});
