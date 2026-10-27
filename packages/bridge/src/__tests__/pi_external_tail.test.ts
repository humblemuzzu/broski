import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPiExternalTail } from "../connectors/pi/pi-external-tail";
import type { PiStreamMessage } from "../types/pi";

const HEADER = { type: "session", id: "tail-test", cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z" };

let tmpDirs: string[] = [];

function messageEntry(id: string, role: string, content: string): object {
	return {
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:01.000Z",
		type: "message",
		message: { role, content, timestamp: 1 },
	};
}

function assistantEntry(id: string, stopReason: "toolUse" | "stop"): object {
	const content =
		stopReason === "toolUse"
			? [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }]
			: [{ type: "text", text: "done" }];
	return {
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:02.000Z",
		type: "message",
		message: { role: "assistant", content, stopReason, usage: { input: 1, output: 1 }, timestamp: 2 },
	};
}

async function makeSessionFile(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-pi-tail-"));
	tmpDirs.push(dir);
	const filePath = join(dir, "session.jsonl");
	await writeFile(
		filePath,
		`${[
			HEADER,
			messageEntry("baseline-user", "user", "before"),
			messageEntry("baseline-assistant", "assistant", "answer"),
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n")}\n`,
	);
	return filePath;
}

function startTail(filePath: string): { emitted: PiStreamMessage[]; stop: () => void } {
	const emitted: PiStreamMessage[] = [];
	const tail = startPiExternalTail(filePath, {
		emitPiStream: (message) => emitted.push(message),
		logDebug: () => {},
		DEBUG_RTS: false,
	});
	return { emitted, stop: tail.stop };
}

/** The tail polls every 150ms; a delayed poll must not fail the test, only a missing event must. */
async function waitForEmission(emitted: PiStreamMessage[]): Promise<PiStreamMessage[]> {
	const deadline = Date.now() + 10_000;
	while (emitted.length === 0 && Date.now() < deadline) await Bun.sleep(25);
	return emitted;
}

/** A quiet window long enough for several poll cycles, to catch a duplicate emission. */
const QUIET_WINDOW_MS = 500;

afterEach(async () => {
	for (const dir of tmpDirs) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	tmpDirs = [];
});

describe("startPiExternalTail", () => {
	test("emits an appended line exactly once across many polls", async () => {
		const filePath = await makeSessionFile();
		const tail = startTail(filePath);

		await Bun.sleep(QUIET_WINDOW_MS);
		expect(tail.emitted).toHaveLength(0);

		await appendFile(filePath, `${JSON.stringify(messageEntry("live-user", "user", "hello from tail"))}\n`);
		expect(await waitForEmission(tail.emitted)).toHaveLength(2);
		await Bun.sleep(QUIET_WINDOW_MS);

		expect(tail.emitted.map((message) => message.type)).toEqual(["external-user-message", "agent-start"]);
		tail.stop();
	});

	test("ignores system, usage and context_edit entries", async () => {
		const filePath = await makeSessionFile();
		const tail = startTail(filePath);

		await Bun.sleep(QUIET_WINDOW_MS);
		await appendFile(
			filePath,
			`${[
				messageEntry("live-system", "system", "hidden instructions"),
				{
					id: "live-usage",
					parentId: "live-system",
					timestamp: "2026-01-01T00:00:02.000Z",
					type: "usage",
					kind: "turn",
					provider: "anthropic",
					model: "test",
					usage: { input: 1, output: 1 },
				},
				{
					id: "live-context-edit",
					parentId: "live-usage",
					timestamp: "2026-01-01T00:00:03.000Z",
					type: "context_edit",
					targetId: "live-system",
					replacement: null,
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n")}\n`,
		);
		await Bun.sleep(1000);

		expect(tail.emitted).toHaveLength(0);

		await appendFile(filePath, `${JSON.stringify(messageEntry("live-user", "user", "hello"))}\n`);
		expect(await waitForEmission(tail.emitted)).toHaveLength(2);
		expect(tail.emitted.map((message) => message.type)).toEqual(["external-user-message", "agent-start"]);
		tail.stop();
	});

	test("stop() halts emission for later appends", async () => {
		const filePath = await makeSessionFile();
		const tail = startTail(filePath);

		await Bun.sleep(QUIET_WINDOW_MS);
		await appendFile(filePath, `${JSON.stringify(messageEntry("live-user", "user", "hello"))}\n`);
		const emittedBeforeStop = (await waitForEmission(tail.emitted)).length;
		expect(emittedBeforeStop).toBeGreaterThan(0);

		tail.stop();
		await appendFile(filePath, `${JSON.stringify(messageEntry("after-stop", "user", "ignored"))}\n`);
		await Bun.sleep(700);

		expect(tail.emitted).toHaveLength(emittedBeforeStop);
	});

	test("an assistant message that stopped for its tools does not end the agent", async () => {
		const filePath = await makeSessionFile();
		const tail = startTail(filePath);

		await Bun.sleep(QUIET_WINDOW_MS);
		await appendFile(filePath, `${JSON.stringify(assistantEntry("calls-tool", "toolUse"))}\n`);
		await appendFile(filePath, `${JSON.stringify(assistantEntry("answers", "stop"))}\n`);
		const deadline = Date.now() + 10_000;
		while (!tail.emitted.some((message) => message.type === "agent-end") && Date.now() < deadline) await Bun.sleep(25);
		tail.stop();

		const types = tail.emitted.map((message) => message.type);
		expect(types.filter((type) => type === "agent-start")).toHaveLength(1);
		expect(types.filter((type) => type === "agent-end")).toHaveLength(1);
		expect(types.indexOf("agent-end")).toBeGreaterThan(types.indexOf("tool-exec-start"));
	});
});
