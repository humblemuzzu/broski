import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { normalizeModelName, parseMs, safeNum, type TurnEvent } from "../types";

export interface GeminiFileContext {
	readonly sourcePath: string;
	readonly hasDedup: (key: string) => boolean;
	readonly setDedup: (key: string) => void;
	readonly emitTurn: (turn: TurnEvent) => void;
}

export function parseGeminiSessionFile(ctx: GeminiFileContext): void {
	let raw: Record<string, unknown>;
	try {
		const parsed = JSON.parse(readFileSync(ctx.sourcePath, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") return;
		raw = parsed as Record<string, unknown>;
	} catch {
		return;
	}

	const sessionId = (typeof raw.sessionId === "string" && raw.sessionId) || basename(ctx.sourcePath, ".json");
	const cwd = typeof raw.projectRoot === "string" ? raw.projectRoot : "";
	const messages = Array.isArray(raw.messages) ? raw.messages : [];

	for (let i = 0; i < messages.length; i++) {
		const item = messages[i];
		if (!item || typeof item !== "object") continue;
		const msg = item as Record<string, unknown>;
		if (msg.type !== "gemini" && msg.role !== "model" && msg.role !== "assistant") continue;
		const tokens = msg.tokens as Record<string, unknown> | undefined;
		if (!tokens) continue;

		const ms = parseMs(msg.timestamp ?? raw.startTime ?? raw.lastUpdated);
		if (!Number.isFinite(ms)) continue;
		const msgId = typeof msg.id === "string" && msg.id ? msg.id : String(i);
		const dedupKey = `${sessionId}:${msgId}`;
		if (ctx.hasDedup(dedupKey)) continue;
		ctx.setDedup(dedupKey);

		const rawInput = safeNum(tokens.input);
		const cached = Math.min(rawInput, safeNum(tokens.cached));
		const uncachedInput = Math.max(0, rawInput - cached);
		const thoughts = safeNum(tokens.thoughts);
		const rawOut = safeNum(tokens.output);
		const output = rawOut + (rawOut > 0 && thoughts > rawOut ? thoughts : 0);
		if (uncachedInput + cached + output === 0) continue;

		const rawModel = typeof msg.model === "string" ? msg.model : "gemini-2.5-pro";
		const { provider, model } = normalizeModelName("google", rawModel);

		ctx.emitTurn({
			harness: "gemini",
			sessionKey: `gemini:${sessionId}`,
			sessionId,
			cwd,
			ms,
			model,
			provider,
			thinking: "unknown",
			speedTier: "standard",
			tokens: {
				uncachedInput,
				cachedInput: cached,
				cacheCreation: 0,
				cacheCreation1h: 0,
				output,
				reasoning: Math.min(output, thoughts),
			},
			reportedCostUsd: undefined,
			durationMs: 0,
			error: false,
			extra: false,
			afterCompaction: false,
			isSubagent: false,
		});
	}
}
