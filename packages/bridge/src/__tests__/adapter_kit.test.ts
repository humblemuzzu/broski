import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAskDesk,
	cursorScope,
	decodeCursor,
	encodeCursor,
	ImageCache,
	moveToTrash,
	phoneName,
	phoneText,
	trashTargetOf,
} from "../adapter-kit";
import type { InteractionRequest, JsonValue, SinkRecord } from "../contract";
import { MAX_NAME_CHARS } from "../contract";

const PERMISSION: InteractionRequest = {
	kind: "tool_permission",
	inputEditable: false,
	previews: [],
	grants: [],
	deliberate: false,
	options: [
		{ id: "allow", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
		{ id: "stop", label: "Deny and stop", effect: "deny", scope: "once", stopsRun: true, message: "none" },
	],
};

function deskRig() {
	const records: SinkRecord[] = [];
	let stops = 0;
	const desk = createAskDesk({ emit: (record) => records.push(record), stopRun: () => stops++, now: () => 42 });
	const resolutions = () =>
		records.flatMap(({ event }) => (event.type === "interaction_resolved" ? [event.reason] : []));
	return { desk, records, resolutions, stops: () => stops };
}

describe("phone text", () => {
	test("drops terminal escapes, controls and bidi overrides, keeping tabs and line breaks", () => {
		const raw = "\u001b[31mred\u001b[0m \u001b]0;title\u0007ok\u0007\tA\u202eevil\u2066x\u0000\r\nend";
		expect(phoneText(raw)).toBe("red ok\tAevilx\r\nend");
	});

	test("a name is one line within its bound", () => {
		expect(phoneName("  two\n\tlines  ")).toBe("two lines");
		expect(phoneName("x".repeat(MAX_NAME_CHARS + 10))).toHaveLength(MAX_NAME_CHARS);
	});
});

describe("page cursors", () => {
	const isNumber = (value: JsonValue): value is number => typeof value === "number";

	test("a cursor reads back only for the kind and scope it was minted for", () => {
		const scope = cursorScope(["/project", "sessions"]);
		const cursor = encodeCursor("sessions", scope, 7);
		expect(decodeCursor(cursor, "sessions", scope, isNumber)).toBe(7);
		expect(decodeCursor(cursor, "sessions", cursorScope(["/other"]), isNumber)).toBeUndefined();
		expect(decodeCursor(cursor, "transcript", scope, isNumber)).toBeUndefined();
	});

	test("anything not minted here is refused", () => {
		const scope = cursorScope(["s"]);
		expect(decodeCursor("not a cursor!", "sessions", scope, isNumber)).toBeUndefined();
		expect(decodeCursor(Buffer.from("{").toString("base64url"), "sessions", scope, isNumber)).toBeUndefined();
		expect(decodeCursor(encodeCursor("sessions", scope, "seven"), "sessions", scope, isNumber)).toBeUndefined();
	});
});

describe("the ask desk", () => {
	test("the first valid answer wins; a later one is stale and an unknown one not found", async () => {
		const { desk, records, resolutions } = deskRig();
		const asked = desk.ask({ runId: "run", title: "Run ls?", request: PERMISSION });
		const [requested] = records;
		if (requested?.event.type !== "interaction_requested") throw new Error("nothing was asked");
		const { interaction } = requested.event;
		expect(interaction).toMatchObject({ runId: "run", blocksRun: true, createdAt: 42 });
		expect(desk.pending()).toEqual([interaction]);
		const wrong = desk.answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } });
		expect(wrong).toMatchObject({ rejection: { code: "invalid_input" } });
		const allow = { kind: "tool_permission" as const, optionId: "allow", grantIds: [] };
		expect(desk.answer({ interactionId: interaction.id, reply: allow })).toEqual({ status: "accepted" });
		expect(await asked).toEqual({ kind: "answered", reply: allow });
		expect(desk.answer({ interactionId: interaction.id, reply: allow })).toMatchObject({
			rejection: { code: "stale" },
		});
		expect(desk.answer({ interactionId: "other", reply: allow })).toMatchObject({ rejection: { code: "not_found" } });
		expect(resolutions()).toEqual(["answered"]);
		expect(desk.pending()).toEqual([]);
	});

	test("a reply that stops the run stops it; one that does not leaves it", async () => {
		const { desk, records, stops } = deskRig();
		void desk.ask({ runId: "run", title: "Run rm?", request: PERMISSION });
		void desk.ask({ runId: "run", title: "Go on?", request: { kind: "confirm" } });
		const [first, second] = desk.pending();
		if (!first || !second) throw new Error("nothing was asked");
		desk.answer({ interactionId: second.id, reply: { kind: "cancel", stopRun: false } });
		expect(stops()).toBe(0);
		desk.answer({ interactionId: first.id, reply: { kind: "tool_permission", optionId: "stop", grantIds: [] } });
		expect(stops()).toBe(1);
		expect(records).toHaveLength(4);
	});

	test("an ask that does not block its run names no run, so it may outlive the run", () => {
		const { desk, records } = deskRig();
		void desk.ask({ runId: "run", title: "Later?", blocksRun: false, request: { kind: "confirm" } });
		const [requested] = records;
		expect(requested?.event).toMatchObject({ type: "interaction_requested", interaction: { blocksRun: false } });
		expect(requested?.event.type === "interaction_requested" && requested.event.interaction.runId).toBeUndefined();
		desk.withdrawRun("run");
		expect(desk.pending()).toHaveLength(1);
	});

	test("an aborted signal withdraws its ask, the end of the run withdraws its blocking asks, expireAll the rest", async () => {
		const { desk, resolutions } = deskRig();
		const controller = new AbortController();
		const signalled = desk.ask({ runId: "run", title: "a", request: { kind: "confirm" }, signal: controller.signal });
		const blocking = desk.ask({ runId: "run", title: "b", request: { kind: "confirm" } });
		const aside = desk.ask({ runId: "run", title: "c", blocksRun: false, request: { kind: "confirm" } });
		controller.abort();
		expect(await signalled).toEqual({ kind: "ended", reason: "withdrawn" });
		desk.withdrawRun("run");
		expect(await blocking).toEqual({ kind: "ended", reason: "withdrawn" });
		desk.expireAll();
		expect(await aside).toEqual({ kind: "ended", reason: "expired" });
		expect(resolutions()).toEqual(["withdrawn", "withdrawn", "expired"]);
		expect(await desk.ask({ title: "late", request: { kind: "confirm" }, signal: controller.signal })).toEqual({
			kind: "ended",
			reason: "withdrawn",
		});
		expect(resolutions()).toHaveLength(3);
	});
});

describe("the trash", () => {
	const homes: string[] = [];
	afterEach(() => {
		for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
	});

	function tempHome(): string {
		const home = mkdtempSync(join(tmpdir(), "adapter-kit-trash-"));
		homes.push(home);
		return home;
	}

	test("moves a file into the given HOME's Trash, keeping both of two with one name", async () => {
		const home = tempHome();
		mkdirSync(join(home, "a"));
		mkdirSync(join(home, "b"));
		writeFileSync(join(home, "a", "notes.jsonl"), "one");
		writeFileSync(join(home, "b", "notes.jsonl"), "two");
		const target = trashTargetOf({ HOME: home }, "darwin");
		const moved = await moveToTrash([join(home, "a", "notes.jsonl"), join(home, "b", "notes.jsonl")], target);
		expect(moved).toEqual({ status: "accepted" });
		expect(readdirSync(join(home, ".Trash")).sort()).toEqual(["notes 2.jsonl", "notes.jsonl"]);
		expect(readdirSync(join(home, "a"))).toEqual([]);
	});

	test("two moves at once of files with one name both land, neither over the other", async () => {
		const home = tempHome();
		const target = trashTargetOf({ HOME: home }, "darwin");
		const paths = ["a", "b"].map((dir) => {
			mkdirSync(join(home, dir));
			writeFileSync(join(home, dir, "notes.md"), dir);
			return join(home, dir, "notes.md");
		});
		const moved = await Promise.all(paths.map((path) => moveToTrash([path], target)));
		expect(moved).toEqual([{ status: "accepted" }, { status: "accepted" }]);
		const trash = join(home, ".Trash");
		const kept = readdirSync(trash).sort();
		expect(kept).toEqual(["notes 2.md", "notes.md"]);
		expect(kept.map((name) => readFileSync(join(trash, name), "utf8")).sort()).toEqual(["a", "b"]);
	});

	test("a move macOS refuses leaves the file where it is and names Full Disk Access", async () => {
		const home = tempHome();
		writeFileSync(join(home, "kept.jsonl"), "x");
		const refuse = async () => {
			throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
		};
		const moved = await moveToTrash([join(home, "kept.jsonl")], { platform: "darwin", home, rename: refuse });
		expect(moved).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(moved.status === "rejected" && moved.rejection.message).toContain("Full Disk Access");
		expect(readdirSync(home)).toContain("kept.jsonl");
		expect(trashTargetOf({ HOME: "relative" }, "darwin")).toBeUndefined();
		expect(await moveToTrash([], undefined)).toMatchObject({ rejection: { code: "backend_error" } });
	});
});

describe("the image cache", () => {
	const image = (data: string) => ({ kind: "image" as const, mimeType: "image/png", data });

	test("keeps the most recently used images within both bounds", () => {
		const cache = new ImageCache({ maxImages: 2, maxChars: 10 });
		expect(cache.put("a", image("aaaa"))).toEqual({ kind: "image_ref", id: "a", mimeType: "image/png" });
		cache.put("b", image("bbbb"));
		expect(cache.get("a")?.data).toBe("aaaa");
		cache.put("c", image("cc"));
		expect([cache.get("a")?.data, cache.get("b"), cache.get("c")?.data]).toEqual(["aaaa", undefined, "cc"]);
		cache.put("d", image("dddddddd"));
		expect([cache.get("a"), cache.get("c")?.data, cache.get("d")?.data]).toEqual([undefined, "cc", "dddddddd"]);
		cache.put("e", image("e".repeat(11)));
		expect(cache.get("e")).toBeUndefined();
	});
});
