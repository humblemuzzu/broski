import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";
import { clipEnd, clipStart } from "../../backends/pi/bounds";
import {
	PERMISSIONS_ENTRY,
	PROMPT_ENTRY,
	permissionsEntryData,
	promptEntryData,
	readPermissionsRecord,
	readPromptRecord,
} from "../../backends/pi/broski-entries";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import { commandId, commandKind, commandText, parseCommandId } from "../../backends/pi/command-ids";
import { boundedJson } from "../../backends/pi/json";
import { hasWireId, ModelTable, modelWireId } from "../../backends/pi/models/model-ids";
import { initialPermissions, listPiModes, modeProblem } from "../../backends/pi/modes";
import { rejected } from "../../backends/pi/rejections";
import { withoutTerminalEscapes } from "../../backends/pi/terminal-text";
import { PI_TRAITS } from "../../backends/pi/traits";
import { plainTheme } from "../../backends/pi/ui/plain-theme";
import {
	Capabilities,
	type CatalogEvent,
	CommandId,
	JsonValue,
	MAX_CATALOG_ITEMS,
	MAX_JSON_DEPTH,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	ModesListed,
	Rejected,
} from "../../contract";

describe("bounded text", () => {
	test("never splits a surrogate pair", () => {
		const text = "ab😀cd";
		expect(clipStart(text, 3)).toBe("ab");
		expect(clipStart(text, 4)).toBe("ab😀");
		expect(clipEnd(text, 3)).toBe("cd");
		expect(clipEnd(text, 4)).toBe("😀cd");
		expect(clipStart("short", 10)).toBe("short");
	});
});

describe("bounded JSON", () => {
	test("keeps what fits and shortens what does not, always within the contract's bounds", () => {
		let deep: unknown = "bottom";
		for (let level = 0; level < MAX_JSON_DEPTH + 5; level++) deep = [deep];
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		const value = {
			text: "x".repeat(MAX_TEXT_CHARS + 10),
			list: Array.from({ length: MAX_LIST_ITEMS + 10 }, (_, index) => index),
			deep,
			cyclic,
			nan: Number.NaN,
			skipped: undefined,
			call: () => 1,
			nested: { ok: [true, null, 1.5, "fine"] },
		};
		const bounded = boundedJson(value);
		expect(JsonValue.safeParse(bounded).success).toBe(true);
		if (typeof bounded !== "object" || bounded === null || Array.isArray(bounded)) throw new Error("not an object");
		expect(bounded.text).toHaveLength(MAX_TEXT_CHARS);
		expect(bounded.list).toHaveLength(MAX_LIST_ITEMS);
		expect(bounded.cyclic).toEqual({ self: null });
		expect(bounded.nan).toBeNull();
		expect(Object.keys(bounded)).not.toContain("skipped");
		expect(Object.keys(bounded)).not.toContain("call");
		expect(bounded.nested).toEqual({ ok: [true, null, 1.5, "fine"] });
	});

	test("long keys are cut, and a key that cuts to one already kept is dropped", () => {
		const long = "k".repeat(MAX_NAME_CHARS + 5);
		const bounded = boundedJson({ [long]: 1, [`${long}x`]: 2 });
		expect(bounded).toEqual({ ["k".repeat(MAX_NAME_CHARS)]: 1 });
		expect(JsonValue.safeParse(bounded).success).toBe(true);
	});

	test("a __proto__ key stays an own key", () => {
		const parsed = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
		const bounded = boundedJson(parsed);
		expect(Object.hasOwn(Object(bounded), "__proto__")).toBe(true);
		expect(Object.getPrototypeOf(bounded)).toBe(Object.prototype);
		expect(JsonValue.safeParse(bounded).success).toBe(true);
	});
});

describe("terminal text", () => {
	test("loses its escape sequences and nothing else", () => {
		const esc = "\u001B";
		expect(withoutTerminalEscapes(`${esc}[1;31mred${esc}[0m and ${esc}[2K${esc}[Gplain`)).toBe("red and plain");
		expect(withoutTerminalEscapes(`${esc}]8;;https://pi.dev${esc}\\link${esc}]8;;\u0007`)).toBe("link");
		expect(withoutTerminalEscapes(`${esc}7saved${esc}(Bascii\u009B33mc1`)).toBe("savedasciic1");
		expect(withoutTerminalEscapes("tabs\tand\nlines [1m stay")).toBe("tabs\tand\nlines [1m stay");
	});

	test("undoes what the plain theme adds", () => {
		const theme = plainTheme();
		const styled = `${theme.fg("accent", "Title")}: ${theme.bg("selectedBg", "body")}`;
		expect(styled).not.toBe("Title: body");
		expect(withoutTerminalEscapes(styled)).toBe("Title: body");
	});

	test("an unterminated command costs one pass", () => {
		const hostile = `${"\u001B]".repeat(50_000)}tail`;
		const started = performance.now();
		expect(withoutTerminalEscapes(hostile)).toBe("tail");
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});

describe("command ids", () => {
	test("round-trip, and turn into the text a terminal user would type", () => {
		const template = { source: "template", name: "review" } as const;
		const skill = { source: "skill", name: "tidy-up" } as const;
		const extension = { source: "extension", name: "mcp" } as const;
		for (const ref of [template, skill, extension]) {
			const id = commandId(ref);
			if (id === undefined) throw new Error(`no id for ${ref.name}`);
			expect(CommandId.safeParse(id).success).toBe(true);
			expect(parseCommandId(id)).toEqual(ref);
		}
		expect(commandText(template, "src/a.ts")).toBe("/review src/a.ts");
		expect(commandText(skill, "")).toBe("/skill:tidy-up");
		expect(commandText(extension, "status")).toBe("/mcp status");
		expect([commandKind("template"), commandKind("skill"), commandKind("extension")]).toEqual([
			"prompt",
			"skill",
			"command",
		]);
	});

	test("names Pi could not parse back, and foreign ids, are refused", () => {
		expect(commandId({ source: "template", name: "two words" })).toBeUndefined();
		expect(commandId({ source: "template", name: "" })).toBeUndefined();
		expect(commandId({ source: "skill", name: "s".repeat(300) })).toBeUndefined();
		for (const id of ["/review", "review", "extX", "promptX", "tool:x", "prompt:", "skill:a b", ":x"]) {
			expect(parseCommandId(id)).toBeUndefined();
		}
	});
});

function model(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "faux",
		provider,
		baseUrl: "http://localhost:0",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

describe("model ids", () => {
	test("a wire id is looked up whole, so an id holding a slash still resolves", () => {
		const routed = model("openrouter", "anthropic/claude-sonnet-4");
		const table = new ModelTable();
		table.replace([routed, model("anthropic", "claude-sonnet-4")]);
		expect(modelWireId(routed)).toBe("openrouter/anthropic/claude-sonnet-4");
		expect(table.get("openrouter/anthropic/claude-sonnet-4")).toBe(routed);
		expect(table.get("openrouter/anthropic")).toBeUndefined();
	});

	test("the table keeps the first of a repeated id, drops ids too long, and stays within the catalog bound", () => {
		const first = model("p", "m");
		const table = new ModelTable();
		const many = Array.from({ length: MAX_CATALOG_ITEMS + 5 }, (_, index) => model("p", `m${index}`));
		table.replace([first, model("p", "m"), model("p", "x".repeat(300)), ...many]);
		expect(table.get("p/m")).toBe(first);
		expect(hasWireId(model("p", "x".repeat(300)))).toBe(false);
		expect(table.models()).toHaveLength(MAX_CATALOG_ITEMS);
		table.replace([]);
		expect(table.get("p/m")).toBeUndefined();
	});
});

describe("the broski.prompt entry", () => {
	const clientRequestId = "0198f2e4-7c1a-7bde-9a51-3f5e0a2b4c6d";

	function entry(data: unknown, customType = PROMPT_ENTRY): CustomEntry {
		return { type: "custom", id: "a1b2c3d4", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", customType, data };
	}

	test("reads back what was written", () => {
		const record = { clientRequestId, imageNames: ["pixel.png", null] };
		expect(readPromptRecord(entry(promptEntryData(record)))).toEqual(record);
	});

	test("the permissions entry reads back its mode and the tools allowed for the session, and nothing else", () => {
		expect(readPermissionsRecord(entry(permissionsEntryData("ask", ["bash"]), PERMISSIONS_ENTRY))).toEqual({
			mode: "ask",
			allowedTools: ["bash"],
		});
		expect(readPermissionsRecord(entry({ mode: "ask" }, PERMISSIONS_ENTRY))).toEqual({ mode: "ask", allowedTools: [] });
		expect(readPermissionsRecord(entry({ mode: "ask", allowedTools: [""] }, PERMISSIONS_ENTRY))).toBeUndefined();
		expect(readPermissionsRecord(entry({ mode: "ask", allowedTools: "bash" }, PERMISSIONS_ENTRY))).toBeUndefined();
		expect(readPermissionsRecord(entry({ mode: "all" }, PERMISSIONS_ENTRY))).toBeUndefined();
		expect(readPermissionsRecord(entry({ mode: "ask" }))).toBeUndefined();
	});

	test("anything else is no record", () => {
		expect(readPromptRecord(entry({ clientRequestId, imageNames: [] }, "other"))).toBeUndefined();
		expect(readPromptRecord(entry({ clientRequestId: "not-a-uuid", imageNames: [] }))).toBeUndefined();
		expect(readPromptRecord(entry({ clientRequestId }))).toBeUndefined();
		expect(readPromptRecord(entry({ clientRequestId, imageNames: [3] }))).toBeUndefined();
		expect(readPromptRecord(entry({ clientRequestId, imageNames: ["n".repeat(MAX_NAME_CHARS + 1)] }))).toBeUndefined();
		const tooMany = Array.from({ length: MAX_LIST_ITEMS + 1 }, () => null);
		expect(readPromptRecord(entry({ clientRequestId, imageNames: tooMany }))).toBeUndefined();
		expect(readPromptRecord(entry(null))).toBeUndefined();
	});
});

describe("modes and traits", () => {
	test("the permissions axis lists as a valid mode, off by default", () => {
		expect(ModesListed.safeParse(listPiModes()).success).toBe(true);
		expect(modeProblem({ axis: "permissions", value: "ask" })).toBeUndefined();
		expect(modeProblem({ axis: "permissions", value: "all" })?.rejection.code).toBe("invalid_input");
		expect(modeProblem({ axis: "agent", value: "off" })?.rejection.code).toBe("invalid_input");
		expect(initialPermissions(undefined)).toBe("off");
		expect(initialPermissions([{ axis: "permissions", value: "ask" }])).toBe("ask");
	});

	test("the declared traits are valid capabilities beside fork, rename and delete without archive", () => {
		const capabilities = { ...PI_TRAITS, fork: true, rename: true, delete: true, archive: false };
		expect(Capabilities.safeParse(capabilities).success).toBe(true);
	});
});

describe("rejections", () => {
	test("carry a message cut to the contract's bound", () => {
		const refusal = rejected("backend_error", "x".repeat(MAX_TEXT_CHARS + 1));
		expect(Rejected.safeParse(refusal).success).toBe(true);
		expect(refusal.rejection.message).toHaveLength(MAX_TEXT_CHARS);
	});
});

describe("the catalog feed", () => {
	test("forwards until silenced, then nothing", () => {
		const seen: CatalogEvent[] = [];
		const feed = new CatalogFeed({ emit: (event) => seen.push(event) });
		const event: CatalogEvent = { type: "catalog_invalidated", scope: "models" };
		feed.emit(event);
		feed.silence();
		feed.emit(event);
		expect(seen).toEqual([event]);
	});
});
