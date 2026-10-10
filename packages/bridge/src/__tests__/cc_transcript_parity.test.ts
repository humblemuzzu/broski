import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyGetSessionMessages } from "../../bench/lib/cc-legacy-transcript-oracle";
import { writeSessionTranscript } from "../../bench/lib/cc-synthetic-fixtures";
import { buildTranscriptMessages, TRANSCRIPT_TAIL_MIN_BYTES } from "../connectors/claude-code/cc-transcript";

let root = "";
const LIMITS = [undefined, 1, 2, 3, 5, 8, 25, 1000];

const user = (id: string, text: string) => ({
	type: "user",
	uuid: id,
	timestamp: "2026-03-09T12:00:00.000Z",
	message: { role: "user", content: [{ type: "text", text }] },
});

const toolResult = (id: string, toolUseId: string, text: string, withResult = true) => ({
	type: "user",
	uuid: id,
	timestamp: "2026-03-09T12:00:01.000Z",
	message: {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text }] }],
	},
	...(withResult ? { toolUseResult: { filePath: "/tmp/a.ts", structuredPatch: [{ lines: ["+a", "-b"] }] } } : {}),
});

const assistant = (id: string, toolUseId?: string) => ({
	type: "assistant",
	uuid: id,
	timestamp: "2026-03-09T12:00:02.000Z",
	message: {
		role: "assistant",
		model: "claude-sonnet-4-5",
		content: [
			{ type: "thinking", thinking: "why" },
			{ type: "text", text: `text ${id}` },
			...(toolUseId ? [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: "/tmp/a.ts" } }] : []),
		],
	},
});

async function writeLines(name: string, records: unknown[]): Promise<string> {
	const path = join(root, name);
	await writeFile(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
	return path;
}

async function expectParity(path: string): Promise<void> {
	for (const limit of LIMITS) {
		const expected = await legacyGetSessionMessages(path, limit);
		expect(await buildTranscriptMessages(path, limit), `${path} limit=${limit} streamed`).toEqual(expected);
		expect(await buildTranscriptMessages(path, limit, { tailMinBytes: 0 }), `${path} limit=${limit} tailed`).toEqual(
			expected,
		);
	}
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "broski-cc-transcript-"));
});

afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});

describe("cc transcript parity", () => {
	it("matches on generated sessions", async () => {
		for (const turns of [1, 3, 12]) {
			const path = join(root, `turns-${turns}.jsonl`);
			await writeSessionTranscript(path, {
				sessionId: `s-${turns}`,
				cwd: "/tmp/work",
				turns,
			});
			await expectParity(path);
		}
	});

	it("matches when the last records carry no message", async () => {
		const path = await writeLines("trailing-tool-results.jsonl", [
			user("u1", "first prompt"),
			assistant("a1", "tool-1"),
			toolResult("r1", "tool-1", "result one"),
			toolResult("r2", "tool-1", "result two"),
			toolResult("r3", "missing-tool", "orphan result"),
			{ type: "summary", summary: "noise" },
			{
				type: "user",
				uuid: "u-skip",
				timestamp: "2026-03-09T12:00:03.000Z",
				isMeta: true,
				message: { role: "user", content: "meta" },
			},
			user("u2", "second prompt"),
		]);
		await expectParity(path);
	});

	it("matches when a tool result's tool_use sits before the tail window", async () => {
		const records: unknown[] = [user("u1", "first prompt"), assistant("a1", "tool-1")];
		for (let i = 0; i < 40; i++) records.push(toolResult(`r${i}`, "tool-1", `result ${i}`));
		records.push(user("u2", "second prompt"), assistant("a2"), toolResult("r-final", "tool-1", "last result"));
		const path = await writeLines("stale-tool-use.jsonl", records);
		await expectParity(path);
	});

	it("matches with CRLF, no trailing newline, blank and malformed lines", async () => {
		const crlf = join(root, "crlf.jsonl");
		await writeFile(crlf, `${JSON.stringify(user("u1", "crlf prompt"))}\r\n${JSON.stringify(assistant("a1"))}\r\n`);
		await expectParity(crlf);

		const bare = join(root, "no-trailing-newline.jsonl");
		await writeFile(bare, `${JSON.stringify(user("u1", "bare prompt"))}\n${JSON.stringify(assistant("a1"))}`);
		await expectParity(bare);

		const noisy = join(root, "noisy.jsonl");
		await writeFile(
			noisy,
			`\nnot json\n${JSON.stringify(user("u1", "<command-name>/x</command-name>"))}\n\n${JSON.stringify(user("u2", "real prompt"))}\n{"broken":\n`,
		);
		await expectParity(noisy);
	});

	it("matches on an empty and a missing file", async () => {
		const empty = join(root, "empty.jsonl");
		await writeFile(empty, "");
		await expectParity(empty);
		expect(await buildTranscriptMessages(join(root, "missing.jsonl"), 5)).toEqual([]);
		expect(await legacyGetSessionMessages(join(root, "missing.jsonl"), 5)).toEqual([]);
	});

	it("matches on a transcript past the tail-size threshold at every limit", async () => {
		const path = join(root, "large.jsonl");
		await writeSessionTranscript(path, {
			sessionId: "large",
			cwd: "/tmp/work",
			turns: 6,
			targetBytes: 10 * 1024 * 1024,
		});
		expect((await stat(path)).size).toBeGreaterThan(TRANSCRIPT_TAIL_MIN_BYTES);
		await expectParity(path);
	});
});
