/**
 * An app that reconnects can have a pile of requests waiting; the bridge answers them all at once while the
 * daemon, whose own gate stops it reading once the phone's window is full, is not reading. The replies
 * together are far more than the 32 MiB a link socket may buffer, and every one of them must still arrive.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSessionDirForCwd } from "../connectors/pi/pi-session-list-cache";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { framesOf, type PiLiveRig, startPiLiveRig } from "./helpers/pi-live-rig";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const MESSAGE_BYTES = 1024 * 1024;
const MESSAGES_IN_SESSION = 3;
const REQUESTS = 16;
const LINK_WINDOW_BYTES = 32 * 1024 * 1024;
/** Long enough for the bridge to answer every request while the client reads nothing. */
const PRODUCE_WHILE_UNREAD_MS = 1500;

let rig: PiLiveRig | null = null;

afterEach(async () => {
	await rig?.stop();
	rig = null;
});

function writeLargeSession(live: PiLiveRig): void {
	const dir = defaultSessionDirForCwd(live.repo, join(live.env.piAgentDir, "sessions"));
	mkdirSync(dir, { recursive: true });
	const header = {
		type: "session",
		version: 3,
		id: "large-session",
		timestamp: new Date().toISOString(),
		cwd: live.repo,
	};
	const entries = Array.from({ length: MESSAGES_IN_SESSION }, (_, index) => ({
		type: "message",
		id: `m${index}`,
		parentId: index === 0 ? null : `m${index - 1}`,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: "p".repeat(MESSAGE_BYTES), timestamp: Date.now() + index },
	}));
	writeFileSync(
		join(dir, `${new Date().toISOString().replaceAll(":", "-")}_large-session.jsonl`),
		`${[header, ...entries].map((line) => JSON.stringify(line)).join("\n")}\n`,
	);
}

describe("a burst of large replies to a link client", () => {
	test("arrives whole although the client is not reading while it is produced", async () => {
		rig = await startPiLiveRig({ turns: [] });
		writeLargeSession(rig);
		const ids = Array.from({ length: REQUESTS }, (_, index) => `burst-${index}`);

		rig.client.pause();
		for (const requestId of ids) rig.client.send({ type: "pi_get_messages", projectPath: rig.repo, requestId });
		await Bun.sleep(PRODUCE_WHILE_UNREAD_MS);
		rig.client.resume();

		for (const requestId of ids) {
			await rig.client.waitForWhere(
				(frame) => framesIn(frame).some((message) => message.requestId === requestId),
				`the reply to ${requestId}`,
				20_000,
			);
		}
		const replied = framesOf(rig.client)
			.filter((frame) => frame.type === "pi_messages")
			.map((frame) => frame.requestId);
		expect(rig.client.closed()).toBeNull();
		expect([...replied].sort()).toEqual([...ids].sort());
		expect(REQUESTS * MESSAGES_IN_SESSION * MESSAGE_BYTES).toBeGreaterThan(LINK_WINDOW_BYTES);
	});
});

function framesIn(frame: Record<string, unknown>): Array<Record<string, unknown>> {
	return frame.type === "batch" ? (frame.messages as Array<Record<string, unknown>>) : [frame];
}
