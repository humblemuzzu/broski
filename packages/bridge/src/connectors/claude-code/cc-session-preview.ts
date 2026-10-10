/**
 * Session preview reader.
 *
 * Reads only the first `maxBytes` of a transcript through `readJsonlHead` — a preview needs the
 * first record carrying cwd / branch / slug / model plus the first real user message, never the
 * whole file. Results are cached by file fingerprint so a refresh costs one `stat` per session.
 */

import { FileFingerprintCache } from "../../utils/file-fingerprint-cache";
import { readJsonlHead } from "../../utils/jsonl-lines";
import {
	type ClaudeTranscriptLine,
	extractFirstTextContent,
	isLikelyCommandEcho,
	safeParseJsonLine,
	type TranscriptContentBlock,
} from "./cc-transcript-parse";

export type SessionPreview = {
	cwd?: string;
	model?: string;
	title?: string;
	slug?: string;
	isBackground?: boolean;
	hasSubagentActivity?: boolean;
	subagentName?: string;
	gitBranch?: string;
};

export const SESSION_PREVIEW_MAX_BYTES = 200_000;

const PREVIEW_CACHE_BYTE_BUDGET = 8 * 1024 * 1024;

function estimatePreviewBytes(preview: SessionPreview): number {
	let bytes = 64;
	for (const value of Object.values(preview)) {
		if (typeof value === "string") bytes += value.length;
	}
	return bytes;
}

type PreviewState = {
	cwd?: string;
	model?: string;
	title?: string;
	slug?: string;
	isBackground: boolean;
	hasSubagentActivity: boolean;
	subagentName?: string;
	gitBranch?: string;
};

function applyPreviewLine(state: PreviewState, parsed: ClaudeTranscriptLine): void {
	if (!state.cwd && typeof parsed.cwd === "string") state.cwd = parsed.cwd;
	if (!state.gitBranch && typeof parsed.gitBranch === "string") state.gitBranch = parsed.gitBranch;
	if (!state.slug && typeof parsed.slug === "string") state.slug = parsed.slug;
	if (!state.model && typeof parsed.message?.model === "string") state.model = parsed.message.model;

	const parentToolUseId = parsed.parent_tool_use_id;
	if (parentToolUseId && parentToolUseId.length > 0) state.isBackground = true;

	const content = parsed.message?.content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const b = block as TranscriptContentBlock;
			if (b.type !== "tool_use" || b.name !== "Task") continue;
			const toolInput = b.input as Record<string, unknown> | undefined;
			const rawSubagent = toolInput?.subagent_type;
			const taskSubagent = typeof rawSubagent === "string" ? rawSubagent.trim() : "";
			if (taskSubagent.length === 0) continue;
			state.hasSubagentActivity = true;
			if (!state.subagentName) state.subagentName = taskSubagent;
		}
	}

	if (state.title || parsed.type !== "user" || parsed.message?.role !== "user" || parsed.isMeta === true) return;
	const maybeText = extractFirstTextContent(parsed.message?.content);
	if (!maybeText || isLikelyCommandEcho(maybeText)) return;
	state.title = maybeText
		.trim()
		.split("\n")
		.find((l) => l.trim().length > 0)
		?.trim();
}

function finalizePreview(state: PreviewState): SessionPreview {
	if (state.title && state.title.length > 80) state.title = `${state.title.slice(0, 77)}…`;

	const titleHint = (state.title || "").toLowerCase();
	if (!state.isBackground) {
		state.isBackground =
			titleHint.includes("subagent") || titleHint.includes("@agent") || titleHint.includes("background");
	}
	return { ...state };
}

export async function readSessionPreview(
	filePath: string,
	maxBytes: number = SESSION_PREVIEW_MAX_BYTES,
): Promise<SessionPreview> {
	try {
		const lines = await readJsonlHead(filePath, { maxBytes });
		const state: PreviewState = {
			cwd: undefined,
			model: undefined,
			title: undefined,
			slug: undefined,
			isBackground: false,
			hasSubagentActivity: false,
			subagentName: undefined,
			gitBranch: undefined,
		};
		for (const line of lines) {
			const parsed = safeParseJsonLine(line);
			if (!parsed) continue;
			applyPreviewLine(state, parsed);
		}
		return finalizePreview(state);
	} catch {
		return {};
	}
}

const previewCache = new FileFingerprintCache<SessionPreview>({
	byteBudget: PREVIEW_CACHE_BYTE_BUDGET,
	estimateBytes: estimatePreviewBytes,
	shedOnPressure: true,
});

export function readSessionPreviewCached(filePath: string): Promise<SessionPreview> {
	return previewCache.get(filePath, () => readSessionPreview(filePath));
}

export function clearCCPreviewCache(): void {
	previewCache.clear();
}
