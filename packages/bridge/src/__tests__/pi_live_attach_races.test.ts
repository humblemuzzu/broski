/**
 * A phone that attaches to Pi the way the app does after a bridge restart: several requests at once, against a
 * bridge that has not opened the session yet. Whatever the order they finish in, the turn that follows reaches
 * the phone once.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as pi from "../connectors/pi";
import { defaultSessionDirForCwd } from "../connectors/pi/pi-session-list-cache";
import { ensureStreamBridge } from "../handlers/pi_stream_bridge";
import type { BroskiRuntimeEvent } from "../types/runtime";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type PiLiveRig, runtimeEventsOf, startPiLiveRig, waitForEvent } from "./helpers/pi-live-rig";
import type { ScriptedTurn } from "./helpers/scripted-openai-server";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const SESSION_ID = "attach-race-session";
const SETTLE_MS = 800;

const TURNS: ScriptedTurn[] = [
	{
		thinking: ["Count the ", "commits."],
		toolCalls: [{ name: "bash", args: { command: "echo first-output", timeout: 15 } }],
	},
	{ text: ["Nothing ", "to push."] },
];

let rig: PiLiveRig | null = null;

afterEach(async () => {
	await rig?.stop();
	rig = null;
});

function ofType<T extends BroskiRuntimeEvent["type"]>(events: BroskiRuntimeEvent[], type: T) {
	return events.filter((event): event is Extract<BroskiRuntimeEvent, { type: T }> => event.type === type);
}

function joined(events: BroskiRuntimeEvent[], type: "assistant_text_delta" | "assistant_thinking_delta"): string {
	return ofType(events, type)
		.map((event) => event.delta)
		.join("");
}

function expectOneTurn(events: BroskiRuntimeEvent[]): void {
	expect(ofType(events, "agent_started")).toHaveLength(1);
	expect(ofType(events, "agent_finished")).toHaveLength(1);
	expect(ofType(events, "tool_started")).toHaveLength(1);
	expect(ofType(events, "tool_finished")).toHaveLength(1);
	expect(ofType(events, "backend_event")).toHaveLength(0);
	expect(joined(events, "assistant_thinking_delta")).toBe("Count the commits.");
	expect(joined(events, "assistant_text_delta")).toBe("Nothing to push.");
}

async function writeStoredSession(live: PiLiveRig): Promise<void> {
	const dir = defaultSessionDirForCwd(live.repo, join(live.env.piAgentDir, "sessions"));
	await mkdir(dir, { recursive: true });
	const at = "2026-01-01T00:00:00.000Z";
	const lines = [
		{ type: "session", version: 3, id: SESSION_ID, timestamp: at, cwd: live.repo },
		{
			type: "model_change",
			id: "m1",
			parentId: null,
			timestamp: at,
			provider: live.scripted.provider,
			modelId: live.scripted.modelId,
		},
		{
			type: "message",
			id: "u1",
			parentId: "m1",
			timestamp: at,
			message: { role: "user", content: "an earlier question", timestamp: 1 },
		},
	];
	await writeFile(
		join(dir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`),
		`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
	);
}

describe("a phone attaching to Pi with several requests at once", () => {
	test("two set_views of a stored session the bridge has not opened, then a turn, send each event once", async () => {
		rig = await startPiLiveRig({ turns: TURNS });
		await writeStoredSession(rig);

		for (let attach = 0; attach < 2; attach++) {
			rig.client.send({ type: "set_view", agent: "pi", sessionId: SESSION_ID, projectPath: rig.repo });
		}
		await Bun.sleep(SETTLE_MS);
		rig.client.send({ type: "pi_get_state", projectPath: rig.repo, requestId: "state" });
		await rig.client.waitForWhere((frame) => frame.requestId === "state", "pi_state");
		rig.client.clear();

		await rig.chat("now?");
		await waitForEvent(rig.client, "agent_finished");
		await Bun.sleep(SETTLE_MS);

		expectOneTurn(runtimeEventsOf(rig.client));
	});

	test("two requests that re-register the stream listener leave one listener, not a leaked second", async () => {
		rig = await startPiLiveRig({ turns: TURNS });
		await rig.newSession();
		const instance = pi.getInstance(rig.repo);
		const listenersBefore = instance?.listeners.size;

		await Promise.all([ensureStreamBridge(rig.repo, () => {}, true), ensureStreamBridge(rig.repo, () => {}, true)]);

		expect(instance?.listeners.size).toBe(listenersBefore);
	});
});
