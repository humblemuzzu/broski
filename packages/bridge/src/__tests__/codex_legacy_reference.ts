/**
 * Pre-optimisation Codex readers, kept as the oracle the fast paths are compared against.
 *
 * These are verbatim copies of the whole-file implementations that lived in `connectors/codex-fs.ts`
 * and `connectors/codex/cx-session-stats.ts` before the rollout readers were made head-only and
 * streaming, so parity tests can compare old output with new output on the same bytes.
 */

import { createHash } from "node:crypto";
import type { SessionDiffSummary } from "../handlers/session-stats";
import { aggregateFileDiffs, countUnifiedDiffStats } from "../handlers/session-stats";
import type { CodexTranscriptMessage } from "../types";

export function legacyExtractUserPrompt(message: string): string {
	const marker = "## My request for Codex:";
	const idx = message.indexOf(marker);
	if (idx !== -1) return message.slice(idx + marker.length).trim();
	if (message.startsWith("# Context from my IDE setup:")) {
		const lines = message.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!.trim();
			if (line && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("##")) {
				return lines.slice(i).join("\n").trim();
			}
		}
	}
	return message.trim();
}

export type LegacySessionMeta = {
	id: string;
	cwd: string;
	cliVersion?: string;
	modelProvider?: string;
	gitBranch?: string;
	preview?: string;
} | null;

export function legacyReadSessionMeta(text: string): LegacySessionMeta {
	const lines = text.split("\n");
	const firstLine = lines[0];
	if (!firstLine) return null;

	const meta = JSON.parse(firstLine);
	if (meta?.type !== "session_meta") return null;
	const payload = meta.payload ?? {};

	let preview: string | undefined;
	for (const line of lines) {
		if (preview) break;
		if (!line.trim()) continue;
		try {
			const record = JSON.parse(line);
			if (
				record?.type === "event_msg" &&
				record?.payload?.type === "user_message" &&
				typeof record?.payload?.message === "string"
			) {
				const userPrompt = legacyExtractUserPrompt(record.payload.message);
				if (userPrompt) {
					preview = userPrompt.slice(0, 300);
					break;
				}
			}
			if (
				record?.type === "response_item" &&
				record?.payload?.role === "user" &&
				Array.isArray(record?.payload?.content)
			) {
				for (const block of record.payload.content) {
					if (block?.type === "input_text" && typeof block?.text === "string") {
						const blockText = block.text;
						if (
							blockText.startsWith("<user_instructions>") ||
							blockText.startsWith("<environment_context>") ||
							blockText.startsWith("# AGENTS.md") ||
							blockText.startsWith("# Repository Guidelines") ||
							blockText.startsWith("# Continuity Ledger")
						) {
							continue;
						}
						const userPrompt = legacyExtractUserPrompt(blockText);
						if (userPrompt) {
							preview = userPrompt.slice(0, 300);
							break;
						}
					}
				}
			}
		} catch {}
	}

	return {
		id: payload.id ?? "",
		cwd: payload.cwd ?? "",
		cliVersion: payload.cli_version,
		modelProvider: payload.model_provider,
		gitBranch: payload.git?.branch,
		preview,
	};
}

type LegacyFileDiff = { file: string; additions: number; deletions: number };

export function legacyScanCxFileDiffs(text: string): LegacyFileDiff[] {
	const lines = text.split("\n");
	const fileDiffs: LegacyFileDiff[] = [];

	for (const line of lines) {
		if (!line) continue;
		if (!line.includes("apply_patch") && !line.includes("fileChange") && !line.includes("file_change")) continue;

		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		const type = parsed?.type;
		const payload = parsed?.payload;

		if (type === "response_item" && payload?.type === "custom_tool_call" && payload?.name === "apply_patch") {
			const input = typeof payload.input === "string" ? payload.input : "";
			if (!input) continue;
			for (const match of input.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g)) {
				const file = match[1]?.trim();
				if (!file) continue;
				const stats = countUnifiedDiffStats(input);
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
			continue;
		}

		if (type === "response_item" && payload?.type === "function_call" && payload?.name === "apply_patch") {
			let args: any = {};
			try {
				args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : (payload.arguments ?? {});
			} catch {}
			const patch = typeof args.patch === "string" ? args.patch : "";
			if (!patch) continue;
			for (const match of patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g)) {
				const file = match[1]?.trim();
				if (!file) continue;
				const stats = countUnifiedDiffStats(patch);
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
			continue;
		}

		if (type === "event_msg" || type === "item") {
			const item = payload?.item ?? payload;
			if (item?.type !== "fileChange") continue;
			const changes = Array.isArray(item.changes) ? item.changes : [];
			for (const ch of changes) {
				const diff = typeof ch?.diff === "string" ? ch.diff : "";
				const file = typeof ch?.path === "string" ? ch.path : "";
				if (!file || !diff) continue;
				const stats = countUnifiedDiffStats(diff);
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
		}
	}

	return fileDiffs;
}

export function legacyCxThreadStats(text: string): SessionDiffSummary {
	return aggregateFileDiffs(legacyScanCxFileDiffs(text));
}

/** Canonical shape for comparing transcripts whose ids and timestamps are derived from a clock. */
export function normalizeTranscript(messages: CodexTranscriptMessage[]): unknown[] {
	return messages.map((message) => ({
		role: message.role,
		text: message.text,
		thinking: message.thinking ?? null,
		toolCalls: message.toolCalls ?? [],
		diffs: (message.diffs ?? []).map((diff) => ({
			file: diff.file,
			diff: diff.diff,
			additions: diff.additions,
			deletions: diff.deletions,
			itemId: diff.itemId,
		})),
	}));
}

/** Digest of one transcript, so two processes can compare without shipping the messages around. */
export function transcriptDigest(messages: CodexTranscriptMessage[]): string {
	const hash = createHash("sha256");
	for (const message of normalizeTranscript(messages)) hash.update(JSON.stringify(message));
	return hash.digest("hex");
}

function legacyCountDiffAddsDels(diff: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) adds++;
		else if (line.startsWith("-")) dels++;
	}
	return { adds, dels };
}

function legacyHeadTailTruncate(text: string, headLines: number, tailLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= headLines + tailLines + 5) return text;
	const head = lines.slice(0, headLines).join("\n");
	const tail = lines.slice(-tailLines).join("\n");
	const omitted = lines.length - headLines - tailLines;
	return `${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`;
}

export function legacyBuildTranscript(text: string): CodexTranscriptMessage[] {
	const safeStr = (v: unknown): string => (typeof v === "string" ? v : "");
	const lines = text.split("\n").filter((l) => l.trim());
	const out: CodexTranscriptMessage[] = [];
	let seq = 0;
	let currentAssistant: CodexTranscriptMessage | null = null;
	const baseTime = Math.floor(Date.now() / 1000) - lines.length;

	const pushUser = (userText: string) => {
		out.push({ id: `user_${baseTime}_${seq}`, role: "user", createdAt: baseTime + seq, text: userText });
		seq++;
		currentAssistant = null;
	};

	const startNewAssistant = (thinking?: string): CodexTranscriptMessage => {
		if (
			currentAssistant &&
			!currentAssistant.text &&
			!currentAssistant.thinking &&
			(!currentAssistant.toolCalls || currentAssistant.toolCalls.length === 0)
		) {
			if (thinking) currentAssistant.thinking = thinking;
			return currentAssistant;
		}
		const msg: CodexTranscriptMessage = {
			id: `assistant_${baseTime}_${seq}`,
			role: "assistant",
			createdAt: baseTime + seq,
			text: "",
			thinking: thinking || undefined,
			toolCalls: [],
			diffs: [],
		};
		out.push(msg);
		seq++;
		currentAssistant = msg;
		return msg;
	};

	const getOrCreateAssistant = (): CodexTranscriptMessage => currentAssistant ?? startNewAssistant();

	for (const line of lines) {
		try {
			const record = JSON.parse(line);
			const type = safeStr(record?.type);
			const payload = record?.payload ?? {};

			if (type === "session_meta" || type === "turn_context") continue;
			if (type === "event_msg" && payload?.type === "token_count") continue;

			if (type === "event_msg" && payload?.type === "user_message") {
				const userText = legacyExtractUserPrompt(safeStr(payload?.message));
				if (userText) pushUser(userText);
				continue;
			}

			if (type === "response_item" && payload?.type === "message" && payload?.role === "user") continue;

			if (type === "event_msg" && payload?.type === "agent_reasoning") {
				const thinking = safeStr(payload?.text);
				if (thinking) startNewAssistant(thinking);
				continue;
			}

			if (type === "response_item" && payload?.type === "reasoning") {
				const summary = Array.isArray(payload?.summary)
					? payload.summary.map((s: any) => safeStr(s?.text)).join("\n")
					: "";
				if (summary) {
					const a = getOrCreateAssistant();
					a.thinking = `${a.thinking ?? ""}\n${summary}`.trim();
				}
				continue;
			}

			if (type === "response_item" && payload?.type === "message" && payload?.role === "assistant") {
				const content = Array.isArray(payload?.content) ? payload.content : [];
				const textParts: string[] = [];
				for (const c of content) {
					if (safeStr(c?.type) === "output_text") textParts.push(safeStr(c?.text));
				}
				const finalText = textParts.filter(Boolean).join("\n\n").trim();
				if (finalText) getOrCreateAssistant().text = finalText;
				continue;
			}

			if (type === "response_item" && payload?.type === "function_call") {
				const a = getOrCreateAssistant();
				a.toolCalls = a.toolCalls ?? [];
				const name = safeStr(payload?.name);
				const callId = safeStr(payload?.call_id);
				let args: Record<string, unknown> = {};
				try {
					args = typeof payload?.arguments === "string" ? JSON.parse(payload.arguments) : (payload?.arguments ?? {});
				} catch {}
				if (name === "shell_command" || name === "shell") {
					a.toolCalls.push({ itemId: callId, type: "commandExecution", name: "Bash", status: "running", input: args });
				} else if (name === "apply_patch") {
					a.toolCalls.push({ itemId: callId, type: "fileChange", name: "ApplyPatch", status: "running", input: args });
				} else {
					a.toolCalls.push({ itemId: callId, type: "mcpToolCall", name: name, status: "running", input: args });
				}
				continue;
			}

			if (type === "response_item" && payload?.type === "function_call_output") {
				const callId = safeStr(payload?.call_id);
				const output = safeStr(payload?.output);
				const toolCalls = (currentAssistant as CodexTranscriptMessage | null)?.toolCalls;
				if (Array.isArray(toolCalls)) {
					for (const tc of toolCalls) {
						if (tc.itemId === callId) {
							tc.status = "completed";
							tc.output = legacyHeadTailTruncate(output, 50, 30);
							break;
						}
					}
				}
				continue;
			}

			if (type === "response_item" && payload?.type === "custom_tool_call") {
				const a = getOrCreateAssistant();
				a.toolCalls = a.toolCalls ?? [];
				a.diffs = a.diffs ?? [];
				const name = safeStr(payload?.name);
				const status = safeStr(payload?.status);
				const callId = safeStr(payload?.call_id);
				const input = safeStr(payload?.input);
				if (name === "apply_patch") {
					const patchMatch = input.match(/\*\*\* Update File: ([^\n]+)/);
					const file = patchMatch?.[1] ?? "unknown";
					a.toolCalls.push({
						itemId: callId,
						type: "fileChange",
						name: "ApplyPatch",
						status: status === "completed" ? "completed" : "running",
						input: { patch: input },
						output: input,
					});
					const { adds, dels } = legacyCountDiffAddsDels(input);
					a.diffs.push({ file, diff: input, additions: adds, deletions: dels, itemId: callId });
				}
			}
		} catch {}
	}

	return out;
}
