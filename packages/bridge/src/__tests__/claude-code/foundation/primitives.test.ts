import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { LiveState } from "../../../backends/claude-code/live/live-state";
import { isPermissionMode, PERMISSION_MODES } from "../../../backends/claude-code/permission-modes";
import { cliEnv } from "../../../backends/claude-code/process/env";
import { createInbox } from "../../../backends/claude-code/process/inbox";
import { interruptQuery } from "../../../backends/claude-code/sdk/interrupt";
import { asCommandLifecycle } from "../../../backends/claude-code/sdk/lifecycle";
import { emptySnapshot, type SinkRecord } from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";

describe("D4 environment", () => {
	test("adds the adapter's variables and drops what the SDK must stamp itself", () => {
		const env = cliEnv({
			base: { PATH: "/bin", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_AGENT_SDK_VERSION: "0.0.1" },
			clientApp: "broski/1.0.0",
		});
		expect(env).toEqual({
			PATH: "/bin",
			CLAUDE_AGENT_SDK_CLIENT_APP: "broski/1.0.0",
			CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
			CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1",
		});
		expect(cliEnv({ base: {}, clientApp: "b" })).not.toHaveProperty("CLAUDE_CONFIG_DIR");
	});
});

describe("the inbox", () => {
	test("stays open between pushes and ends after what was pushed", async () => {
		const inbox = createInbox();
		const message = (uuid: `${string}-${string}-${string}-${string}-${string}`) => ({
			type: "user" as const,
			message: { role: "user" as const, content: "hi" },
			parent_tool_use_id: null,
			uuid,
		});
		const read: string[] = [];
		const reading = (async () => {
			for await (const item of inbox.iterable) read.push(item.uuid ?? "");
		})();
		inbox.push(message("0-0-0-0-1"));
		await Bun.sleep(5);
		inbox.push(message("0-0-0-0-2"));
		inbox.end();
		inbox.push(message("0-0-0-0-3"));
		await reading;
		expect(read).toEqual(["0-0-0-0-1", "0-0-0-0-2"]);
		expect(inbox.ended).toBe(true);
	});
});

describe("live state", () => {
	test("applies every event and hands it to the attached sink only", () => {
		const state = new LiveState(emptySnapshot(), () => 7);
		const seen: SinkRecord[] = [];
		const sink = { emit: (record: SinkRecord) => seen.push(record) };
		state.emit({ type: "run_started", runId: "r", trigger: "prompt" });
		expect(state.attach(sink).run?.runId).toBe("r");
		state.emit({ type: "notice", level: "info", text: "x" });
		state.detach(sink);
		state.emit({ type: "run_finished", runId: "r", outcome: { kind: "completed" } });
		expect(seen.map((record) => record.event.type)).toEqual(["notice"]);
		expect(state.snapshot().lastOutcome).toEqual({ kind: "completed" });
		expect(state.attached).toBe(false);
	});
});

describe("SDK wrappers", () => {
	test("reads the recorded command_lifecycle frames and nothing else", () => {
		const frames: SDKMessage[] = readFrameFixture("text");
		const lifecycles = frames.flatMap((frame) => asCommandLifecycle(frame) ?? []);
		expect(lifecycles.map((frame) => frame.state)).toEqual(["queued", "started", "completed"]);
		const all = frameScenarios().flatMap(readFrameFixture);
		const raw = all.filter((frame) => JSON.stringify(frame).startsWith('{"type":"command_lifecycle"'));
		expect(all.filter((frame) => asCommandLifecycle(frame) !== undefined)).toEqual(raw);
	});

	test("interruptQuery passes {cancelQueued} to the runtime method", async () => {
		const query = new FakeQuery({ interrupt: async () => ({ still_queued: [], cancelled: ["a"] }) });
		expect(await interruptQuery(query, { cancelQueued: true })).toEqual({ still_queued: [], cancelled: ["a"] });
		expect(query.calls).toEqual([{ method: "interrupt", args: [{ cancelQueued: true }] }]);
	});

	test("every permission mode is listed once and recognised", () => {
		expect(new Set(PERMISSION_MODES).size).toBe(6);
		expect(PERMISSION_MODES.every(isPermissionMode)).toBe(true);
		expect(isPermissionMode("toString")).toBe(false);
	});
});
