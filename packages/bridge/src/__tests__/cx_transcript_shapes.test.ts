/**
 * Codex rollout transcript shaping.
 *
 * The synthetic blocks pin the three rollout layouts found on disk — `response_item` (current),
 * `event_msg/user_message` (older) and the flat records the oldest CLI wrote — to the same message
 * boundaries: a new message per turn, injected context excluded, tool outputs paired by `call_id`.
 *
 * The real-data block is read-only and skips itself without ~/.codex data. Set
 * CODEX_TRANSCRIPT_REAL=1 to include the multi-hundred-megabyte rollouts.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readCxTranscript, readCxTranscriptPage } from "../connectors/codex/cx-transcript";
import type { CodexTranscriptMessage } from "../types";

const REAL_ENABLED = process.env.CODEX_TRANSCRIPT_REAL === "1";
const SMALL_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const REAL_FILE_LIMIT_BYTES = 512 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const SAMPLE_SIZE = 20;
const PAGE_LIMITS = [1, 2, 3, 7, 40];

let root = "";

async function tempRoot(name: string): Promise<string> {
	root = await mkdtemp(join(tmpdir(), `broski-${name}-`));
	return root;
}

async function writeRollout(name: string, lines: unknown[]): Promise<string> {
	const path = join(root, name);
	await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return path;
}

type Shape = { role: string; text: string; thinking: string | null; tools: unknown[]; diffs: unknown[] };

function shape(messages: CodexTranscriptMessage[]): Shape[] {
	return messages.map((message) => ({
		role: message.role,
		text: message.text,
		thinking: message.thinking ?? null,
		tools: message.toolCalls ?? [],
		diffs: message.diffs ?? [],
	}));
}

const meta = { type: "session_meta", payload: { id: "t1", cwd: "/tmp/work" } };
const userBlock = (text: string) => ({ type: "input_text", text });

const responseItem = (payload: Record<string, unknown>) => ({ type: "response_item", payload });

describe("codex rollout transcript shapes", () => {
	it("starts a message on each turn of the current response_item layout", async () => {
		await tempRoot("cx-shapes-current");
		const path = await writeRollout("current.jsonl", [
			meta,
			{ type: "turn_context", payload: { turn_id: "turn-1" } },
			{ type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
			responseItem({ type: "message", role: "developer", content: [userBlock("<permissions instructions>")] }),
			responseItem({ type: "message", role: "user", content: [userBlock("<environment_context>\n  <cwd>/tmp</cwd>")] }),
			responseItem({
				type: "message",
				role: "user",
				content: [userBlock("# Context from my IDE setup:\n\n## My request for Codex:\nfix the parser")],
			}),
			responseItem({ type: "reasoning", summary: [{ text: "thinking one" }] }),
			responseItem({ type: "function_call", name: "shell_command", call_id: "c1", arguments: '{"command":"ls"}' }),
			responseItem({ type: "function_call_output", call_id: "c1", output: "file-a\nfile-b" }),
			responseItem({
				type: "custom_tool_call",
				name: "apply_patch",
				call_id: "p1",
				status: "completed",
				input: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
			}),
			responseItem({ type: "custom_tool_call_output", call_id: "p1", output: "Success. Updated the following files" }),
			responseItem({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "done with round one" }],
			}),
			{ type: "turn_context", payload: { turn_id: "turn-2" } },
			responseItem({
				type: "message",
				role: "user",
				content: [userBlock("<goal_context>\nContinue working toward the goal")],
			}),
			responseItem({ type: "reasoning", summary: [{ text: "thinking two" }] }),
			responseItem({ type: "message", role: "assistant", content: [{ type: "output_text", text: "round two" }] }),
			{ type: "event_msg", payload: { type: "task_started", turn_id: "turn-3" } },
			{ type: "turn_context", payload: { turn_id: "turn-3" } },
			responseItem({ type: "message", role: "user", content: [userBlock("and now the second prompt")] }),
			responseItem({ type: "message", role: "assistant", content: [{ type: "output_text", text: "second answer" }] }),
		]);

		const messages = await readCxTranscript(path, { limit: 100_000 });
		expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant", "user", "assistant"]);
		expect(messages[0]?.text).toBe("fix the parser");
		expect(messages[3]?.text).toBe("and now the second prompt");

		const firstTurn = messages[1];
		expect(firstTurn?.thinking).toBe("thinking one");
		expect(firstTurn?.text).toBe("done with round one");
		expect(firstTurn?.toolCalls?.map((call) => [call.itemId, call.name, call.status, call.output])).toEqual([
			["c1", "Bash", "completed", "file-a\nfile-b"],
			["p1", "ApplyPatch", "completed", "Success. Updated the following files"],
		]);
		expect(firstTurn?.diffs).toEqual([
			{
				file: "src/a.ts",
				diff: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
				additions: 1,
				deletions: 1,
				itemId: "p1",
			},
		]);

		const rendered = JSON.stringify(messages);
		expect(rendered).not.toContain("environment_context");
		expect(rendered).not.toContain("goal_context");
		expect(rendered).not.toContain("permissions instructions");
		expect(rendered).not.toContain("## My request for Codex:");
	});

	it("starts a message on each event_msg/user_message turn of the older layout", async () => {
		await tempRoot("cx-shapes-legacy-events");
		const path = await writeRollout("events.jsonl", [
			meta,
			{ type: "event_msg", payload: { type: "user_message", message: "prompt one" } },
			{ type: "event_msg", payload: { type: "agent_reasoning", text: "thinking one" } },
			responseItem({ type: "message", role: "assistant", content: [{ type: "output_text", text: "reply one" }] }),
			responseItem({ type: "function_call", name: "shell_command", call_id: "c1", arguments: '{"command":"ls"}' }),
			responseItem({ type: "function_call_output", call_id: "c1", output: "listing" }),
			{ type: "event_msg", payload: { type: "task_started" } },
			{ type: "event_msg", payload: { type: "user_message", message: "prompt two" } },
			responseItem({ type: "message", role: "assistant", content: [{ type: "output_text", text: "reply two" }] }),
		]);

		const messages = await readCxTranscript(path, { limit: 100_000 });
		expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
		expect(messages.map((message) => message.text)).toEqual(["prompt one", "reply one", "prompt two", "reply two"]);
		expect(messages[1]?.thinking).toBe("thinking one");
		expect(messages[1]?.toolCalls?.[0]?.output).toBe("listing");
	});

	it("reads the flat records the oldest CLI wrote", async () => {
		await tempRoot("cx-shapes-flat");
		const path = await writeRollout("flat.jsonl", [
			{ id: "5bd9", timestamp: "2025-09-08T00:08:54.002Z", instructions: "# Repository Guidelines", git: {} },
			{ record_type: "state" },
			{ type: "message", id: null, role: "user", content: [userBlock("<environment_context>\n  <cwd>/tmp</cwd>")] },
			{
				type: "message",
				id: null,
				role: "user",
				content: [userBlock("<user_instructions>\n\n# Repository Guidelines")],
			},
			{ type: "message", id: null, role: "user", content: [userBlock("flat prompt")] },
			{ type: "reasoning", id: "r1", summary: [{ text: "flat thinking" }], content: null },
			{ type: "function_call", id: "f1", name: "shell_command", arguments: '{"command":"ls"}', call_id: "c0" },
			{ type: "function_call_output", call_id: "c0", output: "flat out" },
			{ type: "message", id: null, role: "assistant", content: [{ type: "output_text", text: "flat reply" }] },
		]);

		const messages = await readCxTranscript(path, { limit: 100_000 });
		expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(messages[0]?.text).toBe("flat prompt");
		expect(messages[1]?.thinking).toBe("flat thinking");
		expect(messages[1]?.text).toBe("flat reply");
		expect(messages[1]?.toolCalls?.[0]?.name).toBe("Bash");
		expect(messages[1]?.toolCalls?.[0]?.output).toBe("flat out");
	});

	it("keeps a tool output with its call when a turn boundary follows", async () => {
		await tempRoot("cx-shapes-pairing");
		const path = await writeRollout("pairing.jsonl", [
			meta,
			{ type: "event_msg", payload: { type: "task_started" } },
			{ type: "event_msg", payload: { type: "user_message", message: "run it" } },
			responseItem({ type: "function_call", name: "shell_command", call_id: "c9", arguments: '{"command":"sleep 1"}' }),
			{ type: "event_msg", payload: { type: "task_started" } },
			responseItem({ type: "function_call_output", call_id: "c9", output: "slept" }),
		]);

		const messages = await readCxTranscript(path, { limit: 100_000 });
		expect(messages.length).toBe(2);
		expect(messages[1]?.toolCalls?.[0]?.itemId).toBe("c9");
		expect(messages[1]?.toolCalls?.[0]?.output).toBe("slept");
		expect(messages[1]?.toolCalls?.[0]?.status).toBe("completed");
	});
});

function currentLayoutRollout(turns: number): unknown[] {
	const lines: unknown[] = [meta];
	for (let turn = 0; turn < turns; turn++) {
		lines.push(
			{ type: "turn_context", payload: { turn_id: `turn-${turn}` } },
			{ type: "event_msg", payload: { type: "task_started", turn_id: `turn-${turn}` } },
			responseItem({ type: "message", role: "user", content: [userBlock(`prompt ${turn}`)] }),
			responseItem({ type: "reasoning", summary: [{ text: `thinking ${turn}` }] }),
			responseItem({
				type: "function_call",
				name: "shell_command",
				call_id: `c${turn}`,
				arguments: JSON.stringify({ command: `echo ${turn}` }),
			}),
			responseItem({ type: "function_call_output", call_id: `c${turn}`, output: `out ${turn}` }),
			responseItem({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: `reply ${turn}` }],
			}),
		);
	}
	return lines;
}

async function concatPages(fetch: (cursor?: number) => ReturnType<typeof readCxTranscriptPage>) {
	const collected: CodexTranscriptMessage[] = [];
	let cursor: number | undefined;
	for (let attempt = 0; attempt < 500; attempt++) {
		const page = await fetch(cursor);
		expect(page, "reader could not build a page").not.toBeNull();
		if (!page) break;
		collected.unshift(...page.messages);
		if (!page.hasMore) return collected;
		expect(page.nextCursor).toBeDefined();
		cursor = Number.parseInt(page.nextCursor as string, 10);
	}
	throw new Error("paging did not terminate");
}

describe("codex rollout paging over the current layout", () => {
	it("concatenates to the whole-file read", async () => {
		await tempRoot("cx-shapes-paging");
		for (const turns of [1, 5, 24]) {
			const path = await writeRollout(`paged-${turns}.jsonl`, currentLayoutRollout(turns));
			const expected = shape(await readCxTranscript(path, { limit: 100_000 }));
			expect(expected.length).toBe(2 * turns);
			for (const limit of PAGE_LIMITS) {
				const messages = await concatPages((end) => readCxTranscriptPage(path, { limit, end }));
				expect(shape(messages), `turns=${turns} limit=${limit}`).toEqual(expected);
			}
		}
	}, 60_000);
});

type RealFile = { path: string; size: number };

async function collectRollouts(dir: string, depth = 0): Promise<RealFile[]> {
	const found: RealFile[] = [];
	let names: string[] = [];
	try {
		names = await readdir(dir);
	} catch {
		return found;
	}
	for (const name of names) {
		const path = join(dir, name);
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(path);
		} catch {
			continue;
		}
		if (info.isDirectory()) {
			if (depth < 4) found.push(...(await collectRollouts(path, depth + 1)));
		} else if (name.endsWith(".jsonl")) {
			found.push({ path, size: info.size });
		}
	}
	return found;
}

describe("codex rollout transcript on real rollouts", () => {
	it(`keeps every message under ${MAX_MESSAGE_BYTES / 1024 / 1024} MB`, async () => {
		const files = await collectRollouts(join(homedir(), ".codex", "sessions"));
		if (files.length === 0) {
			console.warn("[cx-transcript] no ~/.codex/sessions on this machine — skipped");
			return;
		}
		const limit = REAL_ENABLED ? REAL_FILE_LIMIT_BYTES : SMALL_FILE_LIMIT_BYTES;
		const sample = files
			.filter((file) => file.size > 0 && file.size <= limit)
			.sort((a, b) => b.size - a.size)
			.slice(0, SAMPLE_SIZE);

		let worst = 0;
		for (const file of sample) {
			const messages = await readCxTranscript(file.path, { limit: 100_000 });
			const sizes = messages.map((message) => Buffer.byteLength(JSON.stringify(message), "utf8"));
			const max = sizes.length > 0 ? Math.max(...sizes) : 0;
			worst = Math.max(worst, max);
			console.log(
				`[cx-transcript] ${(file.size / 1e6).toFixed(1)} MB -> ${messages.length} message(s), largest ${(max / 1e6).toFixed(2)} MB`,
			);
			expect(max, file.path).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
			expect(messages.length, file.path).toBeGreaterThan(0);
		}
		console.log(`[cx-transcript] ${sample.length} rollout(s), largest message ${(worst / 1e6).toFixed(2)} MB`);
		expect(worst).toBeGreaterThan(0);
	}, 600_000);
});
