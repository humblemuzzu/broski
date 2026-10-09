/**
 * Extracts subagent tool invocations from Pi session JSONL files.
 *
 * Pi subagents (Task, oracle, finder, code_review, look_at, librarian, and
 * any user-configured extension tool that spawns a child agent) run via
 * piSpawn() with --no-session — so their entire conversation is embedded as
 * a toolCall + toolResult pair inside the parent session's JSONL.
 *
 * Detection is dynamic, not hardcoded: we ask Pi's resource loader what
 * tools/skills/agents are loaded for the cwd. If we can't reach the loader
 * (cold read, no instance), we fall back to a "not a builtin" heuristic
 * so we still catch everything the user actually invoked.
 *
 * The extraction returns a preview-sized summary (prompt + short result
 * text) suitable for list rendering. For the full, untruncated tool call
 * and result blocks, use the `pi_get_subagent_invocation` handler which
 * re-reads the parent JSONL by toolCallId.
 */

import { readFile, stat } from "node:fs/promises";
import type { BroskiSessionSummary } from "../../types/runtime";
import { getSubagentNames, isLikelySubagentName } from "./pi-subagent-registry";

/**
 * Maximum parent session JSONL size we'll load into memory for extraction.
 * Pi sessions can grow very large for long-running agents. A 20MB cap keeps
 * the bridge responsive and prevents OOM on very long sessions. Sessions
 * larger than this return an empty list — users should use the per-invocation
 * `pi_get_subagent_invocation` endpoint for drill-down instead.
 */
const MAX_SESSION_JSONL_BYTES = 20 * 1024 * 1024;

export type PiSubagentInvocation = {
	toolCallId: string;
	toolName: string;
	prompt: string;
	result?: string;
	resultIsError?: boolean;
	startedAtMs: number;
	finishedAtMs?: number;
};

const KNOWN_PROMPT_FIELDS = [
	"description",
	"subject",
	"query",
	"prompt",
	"pattern",
	"task",
	"instructions",
	"goal",
	"diff_description",
	"question",
	"text",
	"input",
] as const;

/**
 * Extract subagent invocations from a Pi session JSONL file.
 *
 * @param sessionPath  Absolute path to the parent session JSONL.
 * @param cwd          Working directory — used to look up the dynamic
 *                     subagent registry. When omitted, falls back to
 *                     `isLikelySubagentName` heuristic (non-builtins only).
 */
export async function extractSubagentInvocations(sessionPath: string, cwd?: string): Promise<PiSubagentInvocation[]> {
	let raw: string;
	try {
		const info = await stat(sessionPath);
		if (info.size > MAX_SESSION_JSONL_BYTES) {
			console.warn(
				`[pi-subagent-extraction] skipping ${sessionPath} — ${info.size} bytes exceeds ${MAX_SESSION_JSONL_BYTES} byte cap`,
			);
			return [];
		}
		raw = await readFile(sessionPath, "utf-8");
	} catch {
		return [];
	}

	// Resolve the dynamic subagent name set. `allowCreate = false` so we
	// never spin up a fresh Pi instance just to list past invocations —
	// that would be wasteful and slow.
	let subagentNames: Set<string> = new Set<string>();
	if (cwd) {
		try {
			subagentNames = await getSubagentNames(cwd, /*allowCreate*/ false);
		} catch {
			// registry unavailable; use heuristic
		}
	}

	// Build a case-insensitive lowercase lookup alongside the exact set,
	// because Pi extensions can register tools with any casing (e.g. "Task"
	// vs "task") and the JSONL records the name exactly as the model emitted
	// it.
	const subagentNamesLower = new Set<string>();
	for (const n of subagentNames) subagentNamesLower.add(n.toLowerCase());

	const matches = (toolName: string): boolean => {
		if (!toolName) return false;
		// Exact match against the registry wins. Case-insensitive match is
		// a second chance. Heuristic ("not a builtin") is the final safety
		// net — it catches extension tools the registry missed (e.g. an
		// extension that failed to load fully but whose invocations still
		// landed in the JSONL).
		if (subagentNames.has(toolName)) return true;
		if (subagentNamesLower.has(toolName.toLowerCase())) return true;
		return isLikelySubagentName(toolName);
	};

	const invocations: PiSubagentInvocation[] = [];
	const toolCalls = new Map<string, { name: string; prompt: string; timestamp: number }>();

	const lines = raw.split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (parsed?.type !== "message") continue;

		const message = parsed.message;
		if (!message) continue;

		// Assistant messages contain toolCall entries
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block?.type !== "toolCall") continue;
				const toolName = typeof block.name === "string" ? block.name : "";
				if (!matches(toolName)) continue;
				const args = block.arguments ?? {};
				const prompt = extractPrompt(args);
				const tsRaw = message.timestamp ?? parsed.timestamp ?? Date.now();
				toolCalls.set(String(block.id), {
					name: toolName,
					prompt,
					timestamp: typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) || Date.now(),
				});
			}
		}

		// Tool results close out the invocation. We trust the `toolCalls`
		// map lookup — if the toolCallId matches a call we already accepted
		// via `matches()`, the result belongs to it. No need to re-run the
		// name filter here (result rows sometimes carry a different canonical
		// name than the call row, which would cause legitimate results to be
		// dropped).
		if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const call = toolCalls.get(message.toolCallId);
			if (call) {
				const result = extractShortResult(message.content);
				const tsRaw = message.timestamp ?? parsed.timestamp ?? Date.now();
				invocations.push({
					toolCallId: message.toolCallId,
					toolName: call.name,
					prompt: call.prompt,
					result,
					resultIsError: Boolean(message.isError),
					startedAtMs: call.timestamp,
					finishedAtMs: typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) || Date.now(),
				});
				toolCalls.delete(message.toolCallId);
			}
		}
	}

	// Any remaining unfinished tool calls (still running or interrupted)
	for (const entry of toolCalls.entries()) {
		const id = entry[0];
		const call = entry[1];
		invocations.push({
			toolCallId: id,
			toolName: call.name,
			prompt: call.prompt,
			startedAtMs: call.timestamp,
		});
	}

	return invocations;
}

/**
 * Walk known prompt-like field names, then fall back to the longest
 * string value in the arguments object (capped at 500 chars for preview).
 */
function extractPrompt(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;

	for (const field of KNOWN_PROMPT_FIELDS) {
		const value = record[field];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.length > 500 ? `${value.slice(0, 500)}…` : value;
		}
	}

	// Fallback: longest string field with at least 20 chars of content.
	let longest = "";
	for (const value of Object.values(record)) {
		if (typeof value === "string" && value.length > longest.length) {
			longest = value;
		}
	}
	if (longest.length >= 20) {
		return longest.length > 500 ? `${longest.slice(0, 500)}…` : longest;
	}

	// Final fallback: serialize as JSON snippet.
	try {
		const json = JSON.stringify(record);
		return json.length > 500 ? `${json.slice(0, 500)}…` : json;
	} catch {
		return "";
	}
}

/**
 * Pull a short preview string out of the tool result for list rendering.
 * Full content is available via `pi_get_subagent_invocation`.
 */
function extractShortResult(content: unknown): string | undefined {
	if (content === null || content === undefined) return undefined;
	if (typeof content === "string") {
		return content.length > 300 ? `${content.slice(0, 300)}…` : content;
	}
	if (!Array.isArray(content)) return undefined;
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b: Record<string, unknown> = block;
		if (b.type === "text" && typeof b.text === "string") {
			return b.text.length > 300 ? `${b.text.slice(0, 300)}…` : b.text;
		}
	}
	return undefined;
}

/**
 * Map Pi subagent invocations to BroskiSessionSummary format so they can
 * appear as pseudo-child sessions in the sessions list. The `id` is
 * synthetic — `${parentSessionId}::${toolCallId}` — and should NEVER be
 * passed to a session-loading API. Instead, the detail view uses
 * `pi_get_subagent_invocation(parentSessionPath, toolCallId)`.
 */
export function mapInvocationsToSummaries(
	invocations: PiSubagentInvocation[],
	parentSessionId: string,
	parentSessionPath: string,
	cwd: string,
): BroskiSessionSummary[] {
	return invocations.map((inv) => ({
		id: `${parentSessionId}::${inv.toolCallId}`,
		backend: "pi" as const,
		title: inv.prompt.slice(0, 80) || `${inv.toolName} invocation`,
		cwd,
		createdAtMs: inv.startedAtMs,
		updatedAtMs: inv.finishedAtMs ?? inv.startedAtMs,
		parentSessionId,
		sessionKind: "subagent" as const,
		subagentType: inv.toolName,
		backendData: {
			kind: "pi_tool_invocation",
			toolCallId: inv.toolCallId,
			toolName: inv.toolName,
			prompt: inv.prompt,
			resultPreview: inv.result,
			resultIsError: inv.resultIsError ?? false,
			parentSessionPath,
		},
	}));
}
