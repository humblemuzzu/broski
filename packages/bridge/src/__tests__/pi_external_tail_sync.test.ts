/**
 * The session-file tail of a Pi session someone views. Finding the file takes awaits, so starts, stops and
 * bridge turns overlap; a tail that lost its slot keeps replaying the file on top of the live stream, where
 * `pauseTail` cannot reach it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearPiSessionListCache, defaultSessionDirForCwd } from "../connectors/pi/pi-session-list-cache";
import {
	onBridgeTurnBoundary,
	stopAllPiExternalTails,
	stopPiExternalTail,
	syncPiExternalTail,
} from "../handlers/pi_external_tail_sync";
import type { ServerMessage } from "../types";
import { setupTestEnv, type TestEnv } from "./e2e/harness";

const CWD = "/tmp/broski-tail-sync-project";
const SESSION_ID = "tail-sync-session";
const POLL_SETTLE_MS = 600;

let env: TestEnv;
let file: string;
let sent: ServerMessage[];

const broadcast = (message: ServerMessage): void => {
	sent.push(message);
};

function entry(id: string, role: "user" | "assistant", text: string): string {
	const message =
		role === "user"
			? { role, content: text, timestamp: 1 }
			: { role, content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1 }, timestamp: 2 };
	return `${JSON.stringify({ type: "message", id, parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message })}\n`;
}

function sentContents(): string[] {
	return sent.flatMap((message) => {
		if (message.type !== "runtime_event") return [];
		const { data } = message;
		if (data.type === "assistant_text_delta") return [data.delta];
		const payload = data.type === "backend_event" ? data.payload : undefined;
		return typeof payload === "object" && payload !== null && "content" in payload ? [String(payload.content)] : [];
	});
}

const view = (): Promise<void> => syncPiExternalTail(SESSION_ID, broadcast, false, () => {});

beforeEach(async () => {
	env = setupTestEnv();
	sent = [];
	const dir = defaultSessionDirForCwd(CWD, join(env.piAgentDir, "sessions"));
	await mkdir(dir, { recursive: true });
	file = join(dir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
	const header = { type: "session", version: 3, id: SESSION_ID, timestamp: "2026-01-01T00:00:00.000Z", cwd: CWD };
	await writeFile(file, `${JSON.stringify(header)}\n${entry("seed", "user", "before")}`);
	clearPiSessionListCache();
});

afterEach(() => {
	stopAllPiExternalTails();
	clearPiSessionListCache();
	env.restore();
});

describe("two views of one session", () => {
	test("start one tail, so a line is sent once and stopping the view stops it", async () => {
		await Promise.all([view(), view()]);
		await Bun.sleep(POLL_SETTLE_MS);

		await appendFile(file, entry("a1", "assistant", "answer"));
		await Bun.sleep(POLL_SETTLE_MS);
		expect(sentContents()).toEqual(["answer"]);

		stopPiExternalTail(SESSION_ID);
		await appendFile(file, entry("a2", "assistant", "after the view ended"));
		await Bun.sleep(POLL_SETTLE_MS);
		expect(sentContents()).toEqual(["answer"]);
	});
});

describe("a bridge turn that begins while the tail is being started", () => {
	test("keeps the tail off until the agent has settled, then it comes back at the end of the file", async () => {
		const viewing = view();
		onBridgeTurnBoundary(SESSION_ID, "agent-start");
		await viewing;
		await Bun.sleep(POLL_SETTLE_MS);

		await appendFile(file, entry("turn-user", "user", "typed on the phone"));
		await appendFile(file, entry("turn-answer", "assistant", "the bridge streams this itself"));
		await Bun.sleep(POLL_SETTLE_MS);
		expect(sentContents()).toEqual([]);

		onBridgeTurnBoundary(SESSION_ID, "agent-settled");
		await Bun.sleep(POLL_SETTLE_MS);
		await appendFile(file, entry("terminal-answer", "assistant", "typed in the terminal"));
		await Bun.sleep(POLL_SETTLE_MS);
		expect(sentContents()).toEqual(["typed in the terminal"]);
	});
});
