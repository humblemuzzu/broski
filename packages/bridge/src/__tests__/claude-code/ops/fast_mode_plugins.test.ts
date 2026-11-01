/**
 * Step 7: what a host's latest `system/init` adds to the ops: fast mode in `session_settings` (only on a model that
 * supports it, set through `applyFlagSettings`) and the loaded and failed plugins in `plugins`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ModelInfo, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { FAILED_GROUP, LOADED_GROUP } from "../../../backends/claude-code/ops/plugin-load-rows";
import type { ActionList, BackendCallResult, SessionSetting, SettingChange } from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { readFrameFixture } from "../helpers/frame-fixtures";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld | undefined;

afterEach(async () => {
	await world?.cleanup();
	world = undefined;
});

/** A real `system/init` the spike recorded, changed where the test says. */
function recordedInit(change: Partial<SDKSystemMessage> = {}): SDKSystemMessage {
	const init = readFrameFixture("text").find(
		(frame): frame is SDKSystemMessage => frame.type === "system" && frame.subtype === "init",
	);
	if (init === undefined) throw new Error("the text scenario has no init");
	return { ...init, ...change };
}

const MODELS: ModelInfo[] = [
	{ value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus", description: "", supportsFastMode: true },
	{ value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku", description: "" },
];

function accepted(result: BackendCallResult) {
	if (result.status !== "accepted") throw new Error(`refused: ${JSON.stringify(result)}`);
	return result.result;
}

describe("fast mode in session_settings", () => {
	let init: SDKSystemMessage | undefined;
	let query: FakeQuery;

	function start(first: SDKSystemMessage | undefined): string {
		const sessionId = randomUUID();
		init = first;
		query = new FakeQuery({ applyFlagSettings: async () => undefined });
		world = opsWorld({ hosts: { [sessionId]: { query, init: () => init } }, init: { models: MODELS } });
		return sessionId;
	}

	async function settings(sessionId: string, change?: SettingChange): Promise<SessionSetting[]> {
		const done = accepted(await world!.call({ kind: "session_settings", sessionId, ...(change && { change }) }));
		if (done.kind !== "session_settings") throw new Error(done.kind);
		return done.settings;
	}

	const fast = (all: SessionSetting[]) => all.find((item) => item.key === "fastMode");

	test("is offered on a model that supports it, as the CLI reports it", async () => {
		const sessionId = start(recordedInit({ model: "claude-opus-5-5" }));
		expect(fast(await settings(sessionId))).toMatchObject({ kind: "toggle", enabled: false });
		expect(fast(await settings(sessionId))).not.toHaveProperty("note");
		init = recordedInit({ model: "claude-opus-5-5", fast_mode_state: "on", fast_mode_disabled_reason: undefined });
		expect(fast(await settings(sessionId))).toMatchObject({ enabled: true });
		init = recordedInit({ model: "claude-opus-5-5", fast_mode_state: "cooldown" });
		expect(fast(await settings(sessionId))).toMatchObject({
			enabled: true,
			note: expect.stringContaining("rate limit"),
		});
	});

	test("is not offered on a model without it, nor before the host ran a turn", async () => {
		const haiku = start(recordedInit({ model: "claude-haiku-5-5" }));
		expect(fast(await settings(haiku))).toBeUndefined();
		const fresh = start(undefined);
		expect(fast(await settings(fresh))).toBeUndefined();
		const refused = await world!.call({
			kind: "session_settings",
			sessionId: fresh,
			change: { kind: "toggle", key: "fastMode", enabled: true },
		});
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		expect(query.calls).toEqual([]);
	});

	test("a change goes through applyFlagSettings and shows until the next init says", async () => {
		const sessionId = start(recordedInit({ model: "claude-opus-5-5" }));
		const after = await settings(sessionId, { kind: "toggle", key: "fastMode", enabled: true });
		expect(query.calls).toEqual([{ method: "applyFlagSettings", args: [{ fastMode: true }] }]);
		expect(fast(after)).toMatchObject({ enabled: true, note: "Takes effect from the next message." });
	});

	test("a reason that blocks it is told in words", async () => {
		const sessionId = start(
			recordedInit({ model: "opus", fast_mode_state: "off", fast_mode_disabled_reason: "not_first_party" }),
		);
		expect(fast(await settings(sessionId))).toMatchObject({
			enabled: false,
			note: "Fast mode is only available when using the Anthropic API directly.",
		});
	});
});

describe("plugins with a live session", () => {
	async function list(init: SDKSystemMessage | undefined, withSession = true): Promise<ActionList> {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: { query: new FakeQuery(), init: () => init } } });
		const op = { kind: "plugins" as const, cwd: world.cwd, ...(withSession && { sessionId }) };
		const done = accepted(await world.call(op));
		if (done.kind !== "plugins") throw new Error(done.kind);
		return done.list;
	}

	const loadedInit = recordedInit({
		plugins: [{ name: "formatter", path: "/plugins/formatter", version: "1.2.0" }],
		plugin_errors: [{ plugin: "broken@market", type: "manifest-validation-error", message: "bad \u001b[31mmanifest" }],
	});

	test("lists what the CLI loaded and what failed, read only and sanitised", async () => {
		const rows = (await list(loadedInit)).rows;
		expect(rows.find((row) => row.group === LOADED_GROUP)).toMatchObject({
			title: "formatter",
			subtitle: "/plugins/formatter",
			status: { label: "loaded", tone: "ok" },
			badges: ["1.2.0"],
			actions: [],
		});
		expect(rows.find((row) => row.group === FAILED_GROUP)).toMatchObject({
			title: "broken@market",
			subtitle: "bad manifest",
			status: { label: "failed", tone: "error" },
			badges: ["manifest-validation-error"],
			actions: [],
		});
	});

	test("without a session, or before its first turn, shows none of them", async () => {
		expect((await list(loadedInit, false)).rows.filter((row) => row.group === LOADED_GROUP)).toEqual([]);
		expect((await list(undefined)).rows).toEqual([]);
	});

	test("a loaded row takes no action", async () => {
		const sessionId = randomUUID();
		world = opsWorld({ hosts: { [sessionId]: { query: new FakeQuery(), init: () => loadedInit } } });
		const refused = await world.call({
			kind: "plugins",
			cwd: world.cwd,
			sessionId,
			change: { rowId: "loaded:0", actionId: "disable" },
		});
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});
});
