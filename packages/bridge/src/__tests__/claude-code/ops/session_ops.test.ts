/** `rewind_files`, `changed_files`, `refresh_models` and `session_settings`: per-session ops over real files and a scripted host. */

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rejected } from "../../../backends/claude-code/rejections";
import type {
	BackendCallResult,
	ClaudeCodeOp,
	SessionSetting,
	SettingChange,
	ToolOutcome,
	TranscriptItem,
	TranscriptReadResult,
} from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

function codeOf(result: BackendCallResult): string | undefined {
	return result.status === "rejected" ? result.rejection.code : undefined;
}

function accepted(result: BackendCallResult) {
	if (result.status !== "accepted") throw new Error(JSON.stringify(result));
	return result.result;
}

describe("rewind_files", () => {
	const USER_UUID = randomUUID();
	const entryOf = async (_sessionId: string, itemId: string) =>
		itemId === USER_UUID
			? { uuid: USER_UUID, type: "user" as const }
			: itemId === "assistant-item"
				? { uuid: "a-uuid", type: "assistant" as const }
				: rejected("not_found", `no item ${itemId}`);

	function rewind(sessionId: string, userItemId: string, dryRun: boolean): Promise<BackendCallResult> {
		return world.call({ kind: "rewind_files", sessionId, userItemId, dryRun });
	}

	test("a dry run asks the host for the preview and passes the CLI's numbers through", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({
			rewindFiles: async () => ({ canRewind: true, filesChanged: ["/p/a.ts", "/p/b.ts"], insertions: 3, deletions: 1 }),
		});
		world = opsWorld({ hosts: { [sessionId]: { query, busy: true } }, known: { [sessionId]: "/p" }, entryOf });
		const result = accepted(await rewind(sessionId, USER_UUID, true));
		expect(result).toEqual({
			kind: "rewind_files",
			canRewind: true,
			filesChanged: ["/p/a.ts", "/p/b.ts"],
			insertions: 3,
			deletions: 1,
		});
		expect(query.calls).toEqual([{ method: "rewindFiles", args: [USER_UUID, { dryRun: true }] }]);
	});

	test("a real rewind restores through the host, reports skipped links, and is refused while the session works", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({
			rewindFiles: async () => ({ canRewind: true, filesChanged: ["/p/a.ts"], skippedLinks: 2 }),
		});
		world = opsWorld({ hosts: { [sessionId]: { query } }, known: { [sessionId]: "/p" }, entryOf });
		expect(accepted(await rewind(sessionId, USER_UUID, false))).toMatchObject({ canRewind: true, skippedLinks: 2 });
		expect(query.calls[0]?.args).toEqual([USER_UUID, { dryRun: false }]);
		world.cleanup();
		const busy = new FakeQuery({ rewindFiles: async () => ({ canRewind: true }) });
		world = opsWorld({ hosts: { [sessionId]: { query: busy, busy: true } }, known: { [sessionId]: "/p" }, entryOf });
		expect(codeOf(await rewind(sessionId, USER_UUID, false))).toBe("busy");
		expect(busy.calls).toEqual([]);
	});

	test("canRewind false is an answer with the CLI's reason, not a rejection", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({
			rewindFiles: async () => ({ canRewind: false, error: "No file checkpoint found for this message" }),
		});
		world = opsWorld({ hosts: { [sessionId]: { query } }, known: { [sessionId]: "/p" }, entryOf });
		expect(accepted(await rewind(sessionId, USER_UUID, true))).toEqual({
			kind: "rewind_files",
			canRewind: false,
			error: "No file checkpoint found for this message",
		});
	});

	test("an unknown session or item is not_found, a reply that is not a user message is invalid_input, and no host starts", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: "idle" }, known: { [sessionId]: "/p" }, entryOf });
		expect(codeOf(await rewind(randomUUID(), USER_UUID, true))).toBe("not_found");
		expect(codeOf(await rewind(sessionId, "item", true))).toBe("not_found");
		expect(codeOf(await rewind(sessionId, "assistant-item", true))).toBe("invalid_input");
		expect(world.transient).toHaveLength(0);
	});

	test("a session nobody hosts is rewound on a transient host", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: "idle" }, known: { [sessionId]: "/p" }, entryOf });
		const result = await rewind(sessionId, USER_UUID, true);
		expect(world.transient).toHaveLength(1);
		expect(world.transient[0]?.calls[0]?.method).toBe("rewindFiles");
		expect(result.status).toBe("rejected");
	});
});

function toolResult(
	id: string,
	changes: { path: string; additions?: number; deletions?: number }[],
	outcome: ToolOutcome = "completed",
): TranscriptItem {
	return {
		kind: "tool_result",
		id,
		toolCallId: `call-${id}`,
		outcome,
		result: { content: [], fileChanges: changes.map((change) => ({ ...change, change: "modified" as const })) },
	};
}

describe("changed_files", () => {
	function pages(...items: TranscriptItem[][]) {
		const seen: (string | undefined)[] = [];
		const transcript = async (_id: string, page: { cursor?: string; limit: number }): Promise<TranscriptReadResult> => {
			seen.push(page.cursor);
			const index = page.cursor === undefined ? 0 : Number(page.cursor);
			const next = index + 1 < items.length ? String(index + 1) : undefined;
			const body = { items: items[index] ?? [], idStability: "stable" as const, ...(next && { nextCursor: next }) };
			return { status: "accepted", page: body };
		};
		return { transcript, seen };
	}

	test("folds every completed tool result per file, most edited first, across pages", async () => {
		const sessionId = randomUUID();
		const { transcript, seen } = pages(
			[
				toolResult("1", [{ path: "/p/b.ts", additions: 2, deletions: 1 }]),
				toolResult("2", [{ path: "/p/a.ts", additions: 5 }]),
			],
			[
				toolResult("3", [{ path: "/p/b.ts", additions: 4 }]),
				toolResult("4", [{ path: "/p/c.ts", additions: 100 }], "failed"),
			],
		);
		world = opsWorld({ transcript });
		const result = accepted(await world.call({ kind: "changed_files", sessionId }));
		expect(result).toEqual({
			kind: "changed_files",
			files: [
				{ path: "/p/b.ts", change: "modified", additions: 6, deletions: 1 },
				{ path: "/p/a.ts", change: "modified", additions: 5 },
			],
			omitted: 0,
			additions: 11,
			deletions: 1,
		});
		expect(seen).toEqual([undefined, "1"]);
	});

	test("an unknown session is the store's not_found; a session with no edits is an empty list", async () => {
		world = opsWorld({ transcript: async () => rejected("not_found", "no session") });
		expect(codeOf(await world.call({ kind: "changed_files", sessionId: randomUUID() }))).toBe("not_found");
		world.cleanup();
		world = opsWorld({ transcript: pages([]).transcript });
		expect(accepted(await world.call({ kind: "changed_files", sessionId: randomUUID() }))).toEqual({
			kind: "changed_files",
			files: [],
			omitted: 0,
			additions: 0,
			deletions: 0,
		});
	});

	test("stops after a bounded number of pages instead of walking a transcript for ever", async () => {
		let reads = 0;
		world = opsWorld({
			transcript: async () => {
				reads += 1;
				return { status: "accepted", page: { items: [], idStability: "stable", nextCursor: "again" } };
			},
		});
		await world.call({ kind: "changed_files", sessionId: randomUUID() });
		expect(reads).toBe(60);
	});
});

describe("refresh_models", () => {
	test("drops the cached initialize answers of every cwd and reports no problem", async () => {
		world = opsWorld();
		expect(accepted(await world.call({ kind: "refresh_models" }))).toEqual({ kind: "refresh_models", problems: [] });
		expect(world.invalidated).toEqual([undefined]);
	});
});

describe("session_settings", () => {
	function settingsOf(result: BackendCallResult): SessionSetting[] {
		const done = accepted(result);
		if (done.kind !== "session_settings") throw new Error(done.kind);
		return done.settings;
	}

	function settings(sessionId: string, change?: SettingChange): Promise<BackendCallResult> {
		const op: ClaudeCodeOp = { kind: "session_settings", sessionId, ...(change && { change }) };
		return world.call(op);
	}

	const byKey = (all: SessionSetting[], key: string) => all.find((item) => item.key === key);
	const style = (value: string): SettingChange => ({ kind: "choice", key: "outputStyle", value });
	const toggle = (key: string, enabled: boolean): SettingChange => ({ kind: "toggle", key, enabled });

	test("reads the three settings from the cascade, with the defaults the CLI applies", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: { query: new FakeQuery() } } });
		const all = settingsOf(await settings(sessionId));
		expect(byKey(all, "outputStyle")).toMatchObject({
			kind: "choice",
			value: "default",
			options: [{ value: "default" }, { value: "Concise" }],
		});
		expect(byKey(all, "autoMemoryEnabled")).toMatchObject({ kind: "toggle", enabled: true });
		expect(byKey(all, "promptSuggestionEnabled")).toMatchObject({ kind: "toggle", enabled: true });
		world.write(
			join(world.configDir, "settings.json"),
			JSON.stringify({ autoMemoryEnabled: false, promptSuggestionEnabled: false }),
		);
		world.write(join(world.cwd, ".claude", "settings.local.json"), JSON.stringify({ outputStyle: "Concise" }));
		const changed = settingsOf(await settings(sessionId));
		expect(byKey(changed, "outputStyle")).toMatchObject({ value: "Concise" });
		expect(byKey(changed, "autoMemoryEnabled")).toMatchObject({ enabled: false });
		expect(byKey(changed, "promptSuggestionEnabled")).toMatchObject({ enabled: false });
	});

	test("a toggle is saved in user settings, keeping every other key, and the answer shows it", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: { query: new FakeQuery() } } });
		const path = world.write(join(world.configDir, "settings.json"), '{\n  "model": "opus",\n  "theme": "dark"\n}\n');
		const after = settingsOf(await settings(sessionId, toggle("autoMemoryEnabled", false)));
		expect(byKey(after, "autoMemoryEnabled")).toMatchObject({ enabled: false });
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ model: "opus", theme: "dark", autoMemoryEnabled: false });
		expect(Object.keys(JSON.parse(readFileSync(path, "utf8")))).toEqual(["model", "theme", "autoMemoryEnabled"]);
	});

	test("the output style goes through the running host's own writer, not the file", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ updateSettings: async () => undefined });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		expect((await settings(sessionId, style("Concise"))).status).toBe("accepted");
		expect(query.calls).toEqual([{ method: "updateSettings", args: ["localSettings", { outputStyle: "Concise" }] }]);
		expect(existsSync(join(world.cwd, ".claude", "settings.local.json"))).toBe(false);
	});

	test("a session nobody hosts gets the style in its project's local settings, other keys kept", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: "idle" } });
		world.write(join(world.cwd, ".claude", "settings.local.json"), '{"permissions":{"deny":["Bash(rm *)"]}}');
		const done = settingsOf(await settings(sessionId, style("Concise")));
		expect(byKey(done, "outputStyle")).toMatchObject({ value: "Concise" });
		const written = JSON.parse(readFileSync(join(world.cwd, ".claude", "settings.local.json"), "utf8"));
		expect(written).toEqual({ permissions: { deny: ["Bash(rm *)"] }, outputStyle: "Concise" });
	});

	test("a failing host writer is a rejection and the file is left alone", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({
			updateSettings: async () => Promise.reject(new Error("update_settings keys not allowed")),
		});
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		const result = await settings(sessionId, style("Concise"));
		expect(result.status === "rejected" && result.rejection.code).toBe("backend_error");
		expect(existsSync(join(world.cwd, ".claude", "settings.local.json"))).toBe(false);
	});

	test("refuses an unknown key, the wrong kind, a style Claude Code does not have, and a managed setting", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: { query: new FakeQuery() } } });
		expect(codeOf(await settings(sessionId, toggle("fastMode", true)))).toBe("not_found");
		expect(codeOf(await settings(sessionId, toggle("outputStyle", true)))).toBe("invalid_input");
		expect(codeOf(await settings(sessionId, style("Nonexistent")))).toBe("invalid_input");
		expect(codeOf(await settings(randomUUID(), toggle("autoMemoryEnabled", true)))).toBe("not_found");
		expect(existsSync(join(world.configDir, "settings.json"))).toBe(false);
		world.cleanup();
		world = opsWorld({
			hosts: { [sessionId]: { query: new FakeQuery() } },
			resolved: {
				effective: { autoMemoryEnabled: false },
				provenance: { autoMemoryEnabled: { source: "managed", policyOrigin: "file" } },
				sources: [{ source: "managed", settings: { autoMemoryEnabled: false }, policyOrigin: "file" }],
			},
		});
		expect(codeOf(await settings(sessionId, toggle("autoMemoryEnabled", true)))).toBe("unsupported");
	});

	test("says when an environment variable or a higher tier decides the value", async () => {
		const sessionId = randomUUID();
		world = opsWorld({
			hosts: { [sessionId]: { query: new FakeQuery() } },
			env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false" },
		});
		world.write(join(world.cwd, ".claude", "settings.json"), JSON.stringify({ promptSuggestionEnabled: true }));
		const all = settingsOf(await settings(sessionId));
		expect(byKey(all, "autoMemoryEnabled")).toMatchObject({
			enabled: false,
			note: expect.stringContaining("CLAUDE_CODE_DISABLE_AUTO_MEMORY"),
		});
		expect(byKey(all, "promptSuggestionEnabled")).toMatchObject({
			enabled: false,
			note: expect.stringContaining("CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION"),
		});
		world.cleanup();
		world = opsWorld({ hosts: { [sessionId]: { query: new FakeQuery() } } });
		world.write(join(world.cwd, ".claude", "settings.json"), JSON.stringify({ autoMemoryEnabled: false }));
		const project = settingsOf(await settings(sessionId));
		expect(byKey(project, "autoMemoryEnabled")).toMatchObject({
			enabled: false,
			note: expect.stringContaining("project settings"),
		});
	});
});
