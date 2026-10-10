import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startClaudeCodeExternalTail } from "../cc-external-tail";

type Emitted = { type: string; content?: string; messageId?: string };

let tmpDirs: string[] = [];

async function makeSessionFile(lines: string[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-cc-tail-"));
	tmpDirs.push(dir);
	const path = join(dir, "session.jsonl");
	await writeFile(path, `${lines.join("\n")}\n`);
	return path;
}

function assistantRecord(uuid: string, text: string): string {
	return JSON.stringify({
		type: "assistant",
		uuid,
		message: {
			id: uuid,
			content: [{ type: "text", text }],
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	});
}

async function startTail(path: string, emitted: Emitted[]) {
	return startClaudeCodeExternalTail("session-1", {
		claudeCode: { resolveSessionFilePath: async () => path },
		emitCcStream: (_sessionId, message) => {
			emitted.push(message as Emitted);
		},
		safeString: (value) => (typeof value === "string" ? value : ""),
		logDebug: () => {},
		DEBUG_RTS: false,
	});
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await Bun.sleep(25);
	}
}

const textEvents = (emitted: Emitted[]): Emitted[] =>
	emitted.filter((event) => event.type === "assistant-message" || event.type === "assistant-message-delta");

afterEach(async () => {
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

describe("claude code external tail", () => {
	test("emits only the appended text, then a full text when the record is rewritten", async () => {
		const path = await makeSessionFile([assistantRecord("m1", "hello")]);
		const emitted: Emitted[] = [];
		const tail = await startTail(path, emitted);

		try {
			await Bun.sleep(250);
			expect(textEvents(emitted)).toEqual([]);

			await appendFile(path, `${assistantRecord("m1", "hello world")}\n`);
			await waitFor(() => textEvents(emitted).length >= 1);
			expect(textEvents(emitted)).toEqual([{ type: "assistant-message-delta", content: " world", messageId: "m1" }]);

			await appendFile(path, `${assistantRecord("m2", "second")}\n`);
			await waitFor(() => textEvents(emitted).length >= 2);
			expect(textEvents(emitted)[1]).toEqual({ type: "assistant-message", content: "second", messageId: "m2" });

			await appendFile(path, `${assistantRecord("m2", "second message")}\n`);
			await waitFor(() => textEvents(emitted).length >= 3);
			expect(textEvents(emitted)[2]).toEqual({
				type: "assistant-message-delta",
				content: " message",
				messageId: "m2",
			});

			await appendFile(path, `${assistantRecord("m2", "rewritten")}\n`);
			await waitFor(() => textEvents(emitted).length >= 4);
			expect(textEvents(emitted)[3]).toEqual({ type: "assistant-message", content: "rewritten", messageId: "m2" });
		} finally {
			tail.stop();
		}
	});

	test("keeps history out of the event stream when the tail starts", async () => {
		const path = await makeSessionFile([
			assistantRecord("m1", "historical one"),
			assistantRecord("m2", "historical two"),
		]);
		const emitted: Emitted[] = [];
		const tail = await startTail(path, emitted);

		try {
			await Bun.sleep(300);
			expect(textEvents(emitted)).toEqual([]);

			await appendFile(path, `${assistantRecord("m2", "historical two more")}\n`);
			await waitFor(() => textEvents(emitted).length >= 1);
			expect(textEvents(emitted)).toEqual([{ type: "assistant-message-delta", content: " more", messageId: "m2" }]);
		} finally {
			tail.stop();
		}
	});
});
