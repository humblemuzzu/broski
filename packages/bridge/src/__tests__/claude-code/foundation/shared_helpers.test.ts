import { describe, expect, test } from "bun:test";
import { boundList, clip, clipEnd, fitsId, nameOr } from "../../../backends/claude-code/bounds";
import { CatalogFeed } from "../../../backends/claude-code/catalog-feed";
import { cursorScope, decodeCursor, encodeCursor } from "../../../backends/claude-code/cursor";
import { boundedJson } from "../../../backends/claude-code/json";
import { CLOSED, isRejected, rejected } from "../../../backends/claude-code/rejections";
import {
	type CatalogEvent,
	JsonValue,
	MAX_ID_CHARS,
	MAX_JSON_DEPTH,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	Rejected,
} from "../../../contract";

const PAIR = "😀";

describe("bounds", () => {
	test("clip and clipEnd never split a surrogate pair", () => {
		expect(clip(`ab${PAIR}`, 3)).toBe("ab");
		expect(clip(`ab${PAIR}`, 4)).toBe(`ab${PAIR}`);
		expect(clipEnd(`${PAIR}ab`, 3)).toBe("ab");
		expect(clip("short", 10)).toBe("short");
	});

	test("nameOr is never empty and fits a name", () => {
		expect(nameOr("  ", "Untitled")).toBe("Untitled");
		expect(nameOr(undefined, "x")).toBe("x");
		expect(nameOr("a".repeat(MAX_NAME_CHARS + 5), "x")).toHaveLength(MAX_NAME_CHARS);
	});

	test("fitsId refuses empty and long ids instead of cutting them", () => {
		expect(fitsId("")).toBe(false);
		expect(fitsId("a".repeat(MAX_ID_CHARS))).toBe(true);
		expect(fitsId("a".repeat(MAX_ID_CHARS + 1))).toBe(false);
	});

	test("boundList counts what it leaves out", () => {
		expect(boundList([1, 2, 3], 2)).toEqual({ items: [1, 2], omitted: 1 });
		expect(boundList([1], 2)).toEqual({ items: [1], omitted: 0 });
	});
});

describe("boundedJson", () => {
	test("fits the contract's JsonValue whatever it is given", () => {
		const cyclic: Record<string, unknown> = { a: 1 };
		cyclic.self = cyclic;
		let deep: unknown = "leaf";
		for (let level = 0; level < MAX_JSON_DEPTH + 5; level++) deep = [deep];
		const wide = Array.from({ length: MAX_LIST_ITEMS + 3 }, (_, index) => index);
		const value = {
			cyclic,
			deep,
			wide,
			text: "t".repeat(MAX_TEXT_CHARS + 1),
			skip: undefined,
			fn: () => 1,
			nan: Number.NaN,
			big: 1n,
		};
		const bounded = boundedJson(value);
		expect(JsonValue.safeParse(bounded).success).toBe(true);
		expect(bounded).toMatchObject({ cyclic: { a: 1, self: null }, nan: null, big: null });
		expect(JSON.stringify(bounded)).not.toContain('"skip"');
	});

	test("keeps a __proto__ key as an own key", () => {
		const parsed: unknown = JSON.parse('{"__proto__": {"x": 1}}');
		const bounded = boundedJson(parsed);
		expect(typeof bounded === "object" && bounded !== null && Object.hasOwn(bounded, "__proto__")).toBe(true);
		expect(Object.getPrototypeOf(bounded)).toBe(Object.prototype);
	});
});

describe("cursor", () => {
	const isPosition = (value: JsonValue): value is { at: number } & JsonValue =>
		typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.at === "number";

	test("round-trips its own cursor and refuses every other", () => {
		const scope = cursorScope(["/project", "false"]);
		const cursor = encodeCursor("sessions", scope, { at: 3 });
		expect(decodeCursor(cursor, "sessions", scope, isPosition)).toEqual({ at: 3 });
		expect(decodeCursor(cursor, "transcript", scope, isPosition)).toBeUndefined();
		expect(decodeCursor(cursor, "sessions", cursorScope(["/other"]), isPosition)).toBeUndefined();
		expect(decodeCursor("not-a-cursor", "sessions", scope, isPosition)).toBeUndefined();
		expect(decodeCursor(`${cursor}=`, "sessions", scope, isPosition)).toBeUndefined();
		expect(decodeCursor(encodeCursor("sessions", scope, "x"), "sessions", scope, isPosition)).toBeUndefined();
	});

	test("refuses to mint a cursor past the contract's bound", () => {
		expect(() => encodeCursor("sessions", "s", "x".repeat(9_000))).toThrow();
	});
});

describe("rejections and the catalog feed", () => {
	test("rejections are contract values", () => {
		expect(Rejected.safeParse(rejected("busy", "m".repeat(MAX_TEXT_CHARS + 1))).success).toBe(true);
		expect(Rejected.safeParse(CLOSED).success).toBe(true);
		expect(isRejected(CLOSED)).toBe(true);
		expect(isRejected({ status: "accepted" })).toBe(false);
	});

	test("the feed is silent once silenced", () => {
		const seen: CatalogEvent[] = [];
		const feed = new CatalogFeed({ emit: (event) => seen.push(event) });
		const event: CatalogEvent = { type: "catalog_invalidated", scope: "models" };
		feed.emit(event);
		feed.silence();
		feed.emit(event);
		expect(seen).toEqual([event]);
	});
});
