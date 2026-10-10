/**
 * Codex writes injected context — the environment, AGENTS.md, the IDE context, and system blocks
 * such as `<recommended_plugins>` or `<turn_aborted>` — into the user's role. None of it may surface
 * as a user bubble or as a list preview.
 *
 * The real-data block is read-only and self-skips without ~/.codex data. It streams the 60 most
 * recent rollouts (set CODEX_USER_BUBBLES_REAL=1 to lift the 512 MB per-file cap) and reports
 * user-message counts with the old prefix list vs the injected-tag rule.
 */

import { describe, expect, it } from "bun:test";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isInjectedUserContent } from "../connectors/codex/cx-injected-user-content";
import { extractUserPrompt, readRolloutHeadWithPreview } from "../connectors/codex/cx-rollout-meta";
import { classifyRecord, userPromptFromContent } from "../connectors/codex/cx-transcript-records";

const REAL_ENABLED = process.env.CODEX_USER_BUBBLES_REAL === "1";
const REAL_FILE_LIMIT_BYTES = REAL_ENABLED ? Number.MAX_SAFE_INTEGER : 512 * 1024 * 1024;
const RECENT_ROLLOUTS = 60;
const CONTEXT_TAG = /^<[a-z_]+>/;

const inputText = (text: string) => ({ type: "input_text", text });
const userItem = (blocks: unknown[]) => ({
	type: "response_item",
	payload: { type: "message", role: "user", content: blocks },
});

describe("codex injected user content", () => {
	it("classifies XML-tagged context and harness prefixes as injected, prompts as not", () => {
		for (const tag of [
			"<recommended_plugins>",
			"<turn_aborted>",
			"<environment_context>",
			"<goal_context>",
			"<user_action>",
			"<image>",
			"<user_instructions>",
		]) {
			expect(isInjectedUserContent(`${tag} body`), tag).toBe(true);
		}
		for (const prefix of ["# AGENTS.md\n", "# Repository Guidelines\n", "# Continuity Ledger\n"]) {
			expect(isInjectedUserContent(prefix), prefix).toBe(true);
		}
		expect(isInjectedUserContent("  <turn_aborted> interrupted")).toBe(true);
		expect(isInjectedUserContent("fix the parser")).toBe(false);
		expect(isInjectedUserContent("# Context from my IDE setup:\n\n## My request for Codex:\nfix it")).toBe(false);
	});

	it("keeps the user's prompt from a message that also carries an injected block", () => {
		const content = [
			inputText("<recommended_plugins>\nHere is a list of plugins that are available but not installed."),
			inputText("# Context from my IDE setup:\n\n## My request for Codex:\nadd a retry"),
		];
		expect(userPromptFromContent(content)).toBe("add a retry");
	});

	it("returns no prompt when every block is injected", () => {
		expect(userPromptFromContent([inputText("<recommended_plugins>\n...")])).toBe("");
		expect(userPromptFromContent([inputText("<turn_aborted>\nThe user interrupted the previous turn")])).toBe("");
		expect(userPromptFromContent([inputText("<image>")])).toBe("");
	});

	it("emits no phantom user message for injected-only records", () => {
		expect(classifyRecord(userItem([inputText("<recommended_plugins>\n...")]))).toBeNull();
		expect(classifyRecord(userItem([inputText("<turn_aborted>\nThe user interrupted")]))).toBeNull();
		expect(
			classifyRecord({ type: "event_msg", payload: { type: "user_message", message: "<turn_aborted>\ninterrupted" } }),
		).toBeNull();
		expect(classifyRecord(userItem([inputText("and now the second prompt")]))).toEqual({
			kind: "user",
			text: "and now the second prompt",
		});
	});

	it("previews the first real prompt, not an injected block", async () => {
		const dir = await mkdtemp(join(tmpdir(), "broski-cx-preview-"));
		try {
			const meta = { type: "session_meta", payload: { id: "t1", cwd: "/tmp/work" } };
			const goal = join(dir, "goal.jsonl");
			await writeFile(
				goal,
				[
					meta,
					userItem([inputText("<goal_context>\nContinue working toward the active thread goal.")]),
					userItem([inputText("# Context from my IDE setup:\n\n## My request for Codex:\nfix the parser")]),
				]
					.map((line) => JSON.stringify(line))
					.join("\n"),
			);
			expect((await readRolloutHeadWithPreview(goal))?.preview).toBe("fix the parser");

			const recommended = join(dir, "recommended.jsonl");
			await writeFile(
				recommended,
				[
					meta,
					userItem([inputText("<recommended_plugins>\nHere is a list of plugins.")]),
					userItem([inputText("wire up the new endpoint")]),
				]
					.map((line) => JSON.stringify(line))
					.join("\n"),
			);
			expect((await readRolloutHeadWithPreview(recommended))?.preview).toBe("wire up the new endpoint");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

const LEGACY_PREFIXES = [
	"<user_instructions>",
	"<environment_context>",
	"<goal_context>",
	"# AGENTS.md",
	"# Repository Guidelines",
	"# Continuity Ledger",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The pre-fix rule: no XML-tag handling, only the six known prefixes. */
function legacyPromptFromContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		if (!isRecord(block) || block.type !== "input_text") continue;
		const text = typeof block.text === "string" ? block.text : "";
		if (!text) continue;
		if (LEGACY_PREFIXES.some((prefix) => text.startsWith(prefix))) continue;
		return extractUserPrompt(text);
	}
	return "";
}

type UserCounts = { before: number; after: number; tagBubbles: string[] };

async function countUserMessages(path: string): Promise<UserCounts> {
	const counts: UserCounts = { before: 0, after: 0, tagBubbles: [] };
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
	for await (const line of rl) {
		if (!line || line[0] !== "{") continue;
		if (line.includes('"user_message"')) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			const record = isRecord(parsed) ? parsed : {};
			const payload = isRecord(record.payload) ? record.payload : {};
			if (record.type === "event_msg" && payload.type === "user_message" && typeof payload.message === "string") {
				counts.before += legacyPromptFromContent([inputText(payload.message)]) ? 1 : 0;
				const text = isInjectedUserContent(payload.message) ? "" : extractUserPrompt(payload.message);
				counts.after += text ? 1 : 0;
				if (text && CONTEXT_TAG.test(text.trimStart())) counts.tagBubbles.push(text.slice(0, 80));
			}
			continue;
		}
		if (!line.includes('"role":"user"')) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		const record = isRecord(parsed) ? parsed : {};
		if (record.type !== "response_item") continue;
		const payload = isRecord(record.payload) ? record.payload : {};
		if (payload.role !== "user") continue;
		counts.before += legacyPromptFromContent(payload.content) ? 1 : 0;
		const text = userPromptFromContent(payload.content);
		counts.after += text ? 1 : 0;
		if (text && CONTEXT_TAG.test(text.trimStart())) counts.tagBubbles.push(text.slice(0, 80));
	}
	return counts;
}

type RealFile = { path: string; size: number; mtimeMs: number };

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
			found.push({ path, size: info.size, mtimeMs: info.mtimeMs });
		}
	}
	return found;
}

describe("codex user bubbles on real rollouts", () => {
	it("reports user-message counts before/after and shows no injected block", async () => {
		const all = await collectRollouts(join(homedir(), ".codex", "sessions"));
		if (all.length === 0) {
			console.warn("[cx-user] no ~/.codex/sessions on this machine — skipped");
			return;
		}
		const recent = all.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECENT_ROLLOUTS);
		const sample = recent.filter((file) => file.size > 0 && file.size <= REAL_FILE_LIMIT_BYTES);
		const skipped = recent.length - sample.length;
		const cap = REAL_ENABLED ? "no per-file cap" : `${REAL_FILE_LIMIT_BYTES / 1024 / 1024} MB cap`;

		let before = 0;
		let after = 0;
		const tagBubbles: string[] = [];
		for (const file of sample) {
			const counts = await countUserMessages(file.path);
			before += counts.before;
			after += counts.after;
			tagBubbles.push(...counts.tagBubbles);
		}
		console.log(
			`[cx-user] ${sample.length}/${recent.length} recent rollouts (${skipped} skipped, ${cap}): user messages before=${before} after=${after} removed=${before - after}`,
		);
		for (const bubble of tagBubbles.slice(0, 3)) console.log(`[cx-user]   leaked tag bubble: ${bubble}`);

		expect(sample.length).toBeGreaterThan(0);
		expect(tagBubbles).toEqual([]);
	}, 600_000);
});
