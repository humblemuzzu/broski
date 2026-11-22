import { basename, dirname } from "node:path";
import { normalizeModelName, parseMs, safeNum, type TurnEvent } from "../types";

export interface GrokLineContext {
	readonly sourcePath: string;
	readonly hasDedup: (key: string) => boolean;
	readonly setDedup: (key: string) => void;
	readonly emitTurn: (turn: TurnEvent) => void;
}

export function grokLineMatches(buf: Buffer): boolean {
	return buf.includes("turn_completed");
}

export function parseGrokLine(buf: Buffer, ctx: GrokLineContext): void {
	if (!grokLineMatches(buf)) return;
	let entry: Record<string, unknown>;
	try {
		const raw = JSON.parse(buf.toString("utf8")) as unknown;
		if (!raw || typeof raw !== "object") return;
		entry = raw as Record<string, unknown>;
	} catch {
		return;
	}

	const params = entry.params as Record<string, unknown> | undefined;
	const update = params?.update as Record<string, unknown> | undefined;
	if (update?.sessionUpdate !== "turn_completed") return;

	const meta = params?._meta as Record<string, unknown> | undefined;
	const ms = parseMs(meta?.agentTimestampMs ?? entry.timestamp);
	if (!Number.isFinite(ms)) return;

	const sessionId = (typeof params?.sessionId === "string" && params.sessionId) || basename(dirname(ctx.sourcePath));
	const promptId = typeof update.promptId === "string" ? update.promptId : "";
	const usage = update.usage as Record<string, unknown> | undefined;
	if (!usage) return;

	const modelUsage = usage.modelUsage as Record<string, Record<string, unknown>> | undefined;
	if (modelUsage && typeof modelUsage === "object" && Object.keys(modelUsage).length > 0) {
		for (const [rawModel, u] of Object.entries(modelUsage)) {
			emitGrokRecord(sessionId, promptId, ms, rawModel, u, ctx);
		}
		return;
	}

	const rawModel = typeof update.model === "string" ? update.model : "grok-4";
	emitGrokRecord(sessionId, promptId, ms, rawModel, usage, ctx);
}

function emitGrokRecord(
	sessionId: string,
	promptId: string,
	ms: number,
	rawModel: string,
	u: Record<string, unknown>,
	ctx: GrokLineContext,
): void {
	const { provider, model } = normalizeModelName("xai", rawModel);
	const dedupKey = `${sessionId}:${promptId}:${ms}:${model}`;
	if (ctx.hasDedup(dedupKey)) return;
	ctx.setDedup(dedupKey);

	const rawIn = safeNum(u.inputTokens);
	const cachedIn = Math.min(rawIn, safeNum(u.cachedReadTokens));
	const cacheCreation = Math.min(rawIn - cachedIn, safeNum(u.cacheCreationTokens));
	const uncachedInput = Math.max(0, rawIn - cachedIn - cacheCreation);
	const output = safeNum(u.outputTokens);
	const reasoning = Math.min(output, safeNum(u.reasoningTokens));
	if (uncachedInput + cachedIn + cacheCreation + output === 0) return;

	const ticks = safeNum(u.costUsdTicks);
	const reportedCostUsd = ticks > 0 ? ticks / 1e10 : undefined;

	ctx.emitTurn({
		harness: "grok",
		sessionKey: `grok:${sessionId}`,
		sessionId,
		cwd: "",
		ms,
		model,
		provider,
		thinking: "unknown",
		speedTier: "standard",
		tokens: {
			uncachedInput,
			cachedInput: cachedIn,
			cacheCreation,
			cacheCreation1h: 0,
			output,
			reasoning,
		},
		reportedCostUsd,
		durationMs: 0,
		error: false,
		extra: false,
		afterCompaction: false,
		isSubagent: false,
	});
}
