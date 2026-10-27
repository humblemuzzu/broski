/**
 * Head-only rollout metadata reader.
 *
 * A Codex rollout starts with its `session_meta` record on line 0, so listing projects or threads
 * needs one small read per file rather than the whole 4.8 GiB tree. The preview (first real user
 * prompt) sits a few records further in, so it is read only when a caller asks for it.
 */

import { FileFingerprintCache } from "../../utils/file-fingerprint-cache";
import { readJsonlHead } from "../../utils/jsonl-lines";
import { sessionPreview } from "../../utils/session-preview";
import { isInjectedUserContent } from "./cx-injected-user-content";

export type RolloutHead = {
	id: string;
	cwd: string;
	cliVersion?: string;
	modelProvider?: string;
	gitBranch?: string;
	preview?: string;
};

const META_READ_BYTES = [8 * 1024, 64 * 1024, 1024 * 1024];
export const PREVIEW_HEAD_WINDOW_BYTES = 1024 * 1024;
const PREVIEW_MAX_LINES = 40;
const CACHE_BYTE_BUDGET = 8 * 1024 * 1024;
const ESTIMATED_ENTRY_BYTES = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(line: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function optStr(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Extract the actual user prompt from a Codex user message body. */
export function extractUserPrompt(message: string): string {
	const marker = "## My request for Codex:";
	const markerIndex = message.indexOf(marker);
	if (markerIndex !== -1) {
		return message.slice(markerIndex + marker.length).trim();
	}
	if (message.startsWith("# Context from my IDE setup:")) {
		const lines = message.split("\n");
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index]!.trim();
			if (line && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("##")) {
				return lines.slice(index).join("\n").trim();
			}
		}
	}
	return message.trim();
}

function parseSessionMeta(line: string | undefined): RolloutHead | null {
	if (!line) return null;
	const record = parseRecord(line);
	if (record?.type !== "session_meta") return null;
	const payload = isRecord(record.payload) ? record.payload : {};
	const git = isRecord(payload.git) ? payload.git : {};
	return {
		id: str(payload.id),
		cwd: str(payload.cwd),
		cliVersion: optStr(payload.cli_version),
		modelProvider: optStr(payload.model_provider),
		gitBranch: optStr(git.branch),
	};
}

function promptFromContent(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	for (const block of content) {
		if (!isRecord(block) || block.type !== "input_text") continue;
		const text = typeof block.text === "string" ? block.text : "";
		if (!text) continue;
		if (isInjectedUserContent(text)) continue;
		const prompt = extractUserPrompt(text);
		if (prompt) return sessionPreview(prompt);
	}
	return undefined;
}

function previewFromRecord(record: Record<string, unknown> | null): string | undefined {
	if (!record) return undefined;
	const payload = isRecord(record.payload) ? record.payload : {};
	if (record.type === "event_msg" && payload.type === "user_message" && typeof payload.message === "string") {
		if (isInjectedUserContent(payload.message)) return undefined;
		const prompt = extractUserPrompt(payload.message);
		return prompt ? sessionPreview(prompt) : undefined;
	}
	if (record.type === "response_item" && payload.role === "user") {
		return promptFromContent(payload.content);
	}
	return undefined;
}

/** Read `session_meta`: enough for `cwd`, thread id and timestamps. */
async function readHeadLine(path: string, maxBytes: number): Promise<string | undefined> {
	try {
		return (await readJsonlHead(path, { maxLines: 1, maxBytes }))[0];
	} catch {
		return undefined;
	}
}

/**
 * The metadata record is small in almost every rollout, so the first read is small too; a longer
 * read is only paid by the files that need it.
 */
export async function readRolloutHead(path: string): Promise<RolloutHead | null> {
	for (const maxBytes of META_READ_BYTES) {
		const head = parseSessionMeta(await readHeadLine(path, maxBytes));
		if (head) return head;
	}
	return null;
}

/** Read `session_meta` plus the first real user prompt, within a bounded head window. */
export async function readRolloutHeadWithPreview(path: string): Promise<RolloutHead | null> {
	let lines: string[] = [];
	try {
		lines = await readJsonlHead(path, { maxLines: PREVIEW_MAX_LINES, maxBytes: PREVIEW_HEAD_WINDOW_BYTES });
	} catch {
		return null;
	}
	const head = parseSessionMeta(lines[0]) ?? (await readRolloutHead(path));
	if (!head) return null;
	for (const line of lines) {
		if (!line.trim()) continue;
		const preview = previewFromRecord(parseRecord(line));
		if (preview) return { ...head, preview };
	}
	return head;
}

const metaCache = new FileFingerprintCache<RolloutHead | null>({
	byteBudget: CACHE_BYTE_BUDGET,
	estimateBytes: () => ESTIMATED_ENTRY_BYTES,
	shedOnPressure: true,
});

const previewCache = new FileFingerprintCache<RolloutHead | null>({
	byteBudget: CACHE_BYTE_BUDGET,
	estimateBytes: () => ESTIMATED_ENTRY_BYTES,
	shedOnPressure: true,
});

/** Head read reused across calls until the file's fingerprint changes. */
export function cachedRolloutHead(path: string): Promise<RolloutHead | null> {
	return metaCache.get(path, () => readRolloutHead(path));
}

export function cachedRolloutHeadWithPreview(path: string): Promise<RolloutHead | null> {
	return previewCache.get(path, () => readRolloutHeadWithPreview(path));
}
