import { describe, expect, test } from "bun:test";
import { cursorScope, decodeCursor, encodeCursor } from "../../backends/pi/cursor";
import { type JsonValue, PageCursor } from "../../contract";

type Position = { b: number; a: string };

function isPosition(value: JsonValue): value is Position {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Number.isInteger(value.b) &&
		typeof value.a === "string"
	);
}

const scope = cursorScope(["transcript", "0198f2e4-7c1a-7bde-9a51-3f5e0a2b4c6d"]);

function envelope(value: JsonValue): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("page cursors", () => {
	test("decode to the position they were minted with", () => {
		const cursor = encodeCursor("transcript", scope, { b: 40, a: "a1b2c3d4:0" });
		expect(PageCursor.safeParse(cursor).success).toBe(true);
		expect(decodeCursor(cursor, "transcript", scope, isPosition)).toEqual({ b: 40, a: "a1b2c3d4:0" });
	});

	test("a cursor of another kind or another read is foreign", () => {
		const cursor = encodeCursor("transcript", scope, { b: 40, a: "x:0" });
		expect(decodeCursor(cursor, "sessions", scope, isPosition)).toBeUndefined();
		expect(decodeCursor(cursor, "transcript", cursorScope(["transcript", "other"]), isPosition)).toBeUndefined();
	});

	test("anything this adapter did not write is foreign", () => {
		const foreign = [
			"not-a-cursor",
			"",
			"a b",
			"!!!!",
			envelope("just a string"),
			envelope({ v: 2, k: "transcript", s: scope, p: { b: 1, a: "x:0" } }),
			envelope({ v: 1, k: "transcript", s: scope }),
			envelope({ v: 1, k: "transcript", s: scope, p: { b: "1", a: "x:0" } }),
			Buffer.from("{not json").toString("base64url"),
			"A".repeat(9_000),
		];
		for (const cursor of foreign) expect(decodeCursor(cursor, "transcript", scope, isPosition)).toBeUndefined();
	});

	test("a minted cursor with anything added is foreign, even where base64 decoding would skip it", () => {
		const cursor = encodeCursor("transcript", scope, { b: 40, a: "x:0" });
		for (const tampered of [`${cursor}!`, `${cursor}.`, ` ${cursor}`, `${cursor}=`]) {
			expect(decodeCursor(tampered, "transcript", scope, isPosition)).toBeUndefined();
		}
	});

	test("a cursor with no position never reaches the guard", () => {
		const seen: string[] = [];
		const guard = (value: JsonValue): value is JsonValue => {
			seen.push(typeof value);
			return true;
		};
		expect(decodeCursor(envelope({ v: 1, k: "transcript", s: scope }), "transcript", scope, guard)).toBeUndefined();
		expect(seen).toEqual([]);
	});

	test("a scope is a fixed-size digest, so a long cwd keeps the cursor in bounds", () => {
		const longScope = cursorScope(["sessions", "/".repeat(4_096), "false", ""]);
		expect(longScope).toHaveLength(43);
		expect(cursorScope(["a", "bc"])).not.toBe(cursorScope(["ab", "c"]));
		expect(PageCursor.safeParse(encodeCursor("sessions", longScope, [1_700_000_000_000, "id"])).success).toBe(true);
	});
});
