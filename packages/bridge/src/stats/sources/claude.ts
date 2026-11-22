import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { normalizeModelName, parseMs, type SpeedTier, safeNum, type TurnEvent } from "../types";

export interface ClaudeParserState {
	sessionId?: string;
	cwd?: string;
	isSubagent?: boolean;
	subagentName?: string;
	subagentRunCounted?: boolean;
	subagentFailed?: boolean;
	afterCompaction?: boolean;
}

export interface ClaudeLineContext {
	readonly sourcePath: string;
	readonly getDedup: (key: string) => string | undefined;
	readonly setDedup: (key: string, state: string) => void;
	readonly emitTurn: (turn: TurnEvent) => void;
}

const NONE = [0, 0, 0, 0, 0, 0] as const;

export function initClaudeState(sourcePath: string): ClaudeParserState {
	const parentDir = basename(dirname(sourcePath));
	const isSubagent = parentDir === "subagents" || sourcePath.includes("/subagents/");
	const state: ClaudeParserState = { isSubagent };
	if (isSubagent) state.subagentName = readSubagentType(sourcePath);
	return state;
}

export function claudeLineMatches(buf: Buffer): boolean {
	return buf.includes('"assistant"') || buf.includes('"compact_boundary"') || buf.includes('"sessionId"');
}

export function parseClaudeLine(state: ClaudeParserState, buf: Buffer, ctx: ClaudeLineContext): void {
	if (!claudeLineMatches(buf)) return;
	let entry: Record<string, unknown>;
	try {
		const raw = JSON.parse(buf.toString("utf8")) as unknown;
		if (!raw || typeof raw !== "object") return;
		entry = raw as Record<string, unknown>;
	} catch {
		return;
	}

	if (!state.cwd && typeof entry.cwd === "string") state.cwd = entry.cwd;
	if (!state.sessionId && typeof entry.sessionId === "string") state.sessionId = entry.sessionId;

	if (entry.type === "system" && entry.subtype === "compact_boundary") {
		state.afterCompaction = true;
		return;
	}
	if (entry.type !== "assistant") return;

	const ms = parseMs(entry.timestamp);
	if (!Number.isFinite(ms)) return;
	const msg = entry.message as Record<string, unknown> | undefined;
	if (!msg || typeof msg !== "object") return;

	const rawModel = typeof msg.model === "string" ? msg.model : "";
	if (!rawModel || rawModel === "<synthetic>") return;

	const msgId = typeof msg.id === "string" ? msg.id : "";
	const reqId = typeof entry.requestId === "string" ? entry.requestId : "";
	const isSidechain = entry.isSidechain === true;

	// Drop /btw sidechain replays that copy a parent message id under a fresh requestId.
	if (isSidechain && msgId && ctx.getDedup(`main:${msgId}`) !== undefined) return;

	// Never require requestId: Anthropic-compatible gateways often omit it.
	const dedupKey = msgId ? (reqId ? `${msgId}:${reqId}` : `m:${msgId}`) : undefined;
	const usage = msg.usage as Record<string, unknown> | undefined;
	const now = extractClaudeUsage(usage);
	const priorRaw = dedupKey ? ctx.getDedup(dedupKey) : undefined;
	const before = priorRaw ? parseCsv6(priorRaw) : NONE;
	const delta = [
		Math.max(0, now[0] - before[0]),
		Math.max(0, now[1] - before[1]),
		Math.max(0, now[2] - before[2]),
		Math.max(0, now[3] - before[3]),
		Math.max(0, now[4] - before[4]),
		Math.max(0, now[5] - before[5]),
	] as const;

	const highWater = [
		Math.max(now[0], before[0]),
		Math.max(now[1], before[1]),
		Math.max(now[2], before[2]),
		Math.max(now[3], before[3]),
		Math.max(now[4], before[4]),
		Math.max(now[5], before[5]),
	];
	if (dedupKey) ctx.setDedup(dedupKey, highWater.join(","));
	if (!isSidechain && msgId) ctx.setDedup(`main:${msgId}`, "1");

	const sessionId =
		state.sessionId ||
		(state.isSubagent ? basename(dirname(dirname(ctx.sourcePath))) : basename(ctx.sourcePath, ".jsonl"));

	const hasNewTokens = delta.some((v) => v > 0);
	if (priorRaw === undefined || hasNewTokens) {
		const { provider, model } = normalizeModelName("anthropic", rawModel);
		const reportedCost = priorRaw === undefined ? positiveOrUndef(entry.costUSD) : undefined;
		const error = entry.isApiErrorMessage === true || msg.stop_reason === "error";
		const subagentRunStart = state.isSubagent && !state.subagentRunCounted;
		const subagentFailed = state.isSubagent && error && !state.subagentFailed;
		if (subagentRunStart) state.subagentRunCounted = true;
		if (subagentFailed) state.subagentFailed = true;

		ctx.emitTurn({
			harness: "claude",
			sessionKey: `claude:${sessionId}`,
			sessionId,
			cwd: state.cwd ?? "",
			ms,
			model,
			provider,
			thinking: typeof entry.effort === "string" ? entry.effort : "unknown",
			speedTier: claudeSpeedTier(usage),
			tokens: {
				uncachedInput: delta[0],
				output: delta[1],
				cachedInput: delta[2],
				cacheCreation: delta[3],
				cacheCreation1h: delta[4],
				reasoning: Math.min(delta[5], delta[1]),
			},
			reportedCostUsd: reportedCost,
			durationMs: 0,
			error,
			extra: priorRaw !== undefined,
			afterCompaction: Boolean(state.afterCompaction),
			isSubagent: Boolean(state.isSubagent),
			subagentName: state.subagentName,
			subagentRunStart,
			subagentFailed,
		});
		if (priorRaw === undefined) state.afterCompaction = false;
	}

	// Emit advisor_message iterations as separate per-model turns.
	if (Array.isArray(usage?.iterations)) {
		emitAdvisorIterations(state, sessionId, ms, msgId, reqId, usage.iterations, ctx);
	}
}

function emitAdvisorIterations(
	state: ClaudeParserState,
	sessionId: string,
	ms: number,
	msgId: string,
	reqId: string,
	iterations: unknown[],
	ctx: ClaudeLineContext,
): void {
	for (let i = 0; i < iterations.length; i++) {
		const raw = iterations[i];
		if (!raw || typeof raw !== "object") continue;
		const iter = raw as Record<string, unknown>;
		if (iter.type !== "advisor_message") continue;
		const rawModel = typeof iter.model === "string" ? iter.model : "";
		if (!rawModel || rawModel === "<synthetic>") continue;
		const iterKey = msgId ? `${msgId}:${reqId}:advisor:${i}` : undefined;
		if (iterKey && ctx.getDedup(iterKey) !== undefined) continue;
		if (iterKey) ctx.setDedup(iterKey, "1");
		const u = extractClaudeUsage(iter);
		if (u[0] + u[1] + u[2] + u[3] === 0) continue;
		const { provider, model } = normalizeModelName("anthropic", rawModel);
		ctx.emitTurn({
			harness: "claude",
			sessionKey: `claude:${sessionId}`,
			sessionId,
			cwd: state.cwd ?? "",
			ms,
			model,
			provider,
			thinking: "unknown",
			speedTier: claudeSpeedTier(iter),
			tokens: {
				uncachedInput: u[0],
				output: u[1],
				cachedInput: u[2],
				cacheCreation: u[3],
				cacheCreation1h: u[4],
				reasoning: Math.min(u[5], u[1]),
			},
			reportedCostUsd: undefined,
			durationMs: 0,
			error: false,
			extra: false,
			afterCompaction: false,
			isSubagent: true,
			subagentName: "advisor",
			subagentRunStart: true,
			subagentFailed: false,
		});
	}
}

export function parseClaudeStatsArchive(statsCachePath: string, firstTranscriptDay: string | undefined): TurnEvent[] {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(readFileSync(statsCachePath, "utf8")) as Record<string, unknown>;
	} catch {
		return [];
	}
	const daily = Array.isArray(raw.dailyModelTokens) ? raw.dailyModelTokens : [];
	const lifetime = (raw.modelUsage as Record<string, Record<string, unknown>> | undefined) ?? {};
	const totals = new Map<string, number>();
	for (const d of daily) {
		const byModel = (d as Record<string, unknown>)?.tokensByModel as Record<string, unknown> | undefined;
		if (!byModel) continue;
		for (const [m, v] of Object.entries(byModel)) {
			totals.set(m, (totals.get(m) ?? 0) + safeNum(v));
		}
	}
	const out: TurnEvent[] = [];
	for (const item of daily) {
		const d = item as Record<string, unknown>;
		if (typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
		if (firstTranscriptDay && d.date >= firstTranscriptDay) continue;
		const ms = Date.parse(`${d.date}T12:00:00Z`);
		if (!Number.isFinite(ms)) continue;
		const byModel = (d.tokensByModel as Record<string, unknown> | undefined) ?? {};
		for (const [rawModel, rawTok] of Object.entries(byModel)) {
			const u = lifetime[rawModel];
			const total = totals.get(rawModel) ?? 0;
			const tokens = safeNum(rawTok);
			if (!u || total <= 0 || tokens <= 0) continue;
			const share = tokens / total;
			const { provider, model } = normalizeModelName("anthropic", rawModel);
			out.push({
				harness: "claude",
				sessionKey: "",
				sessionId: "archive",
				cwd: "",
				ms,
				model,
				provider,
				thinking: "unknown",
				speedTier: "standard",
				tokens: {
					uncachedInput: Math.round(safeNum(u.inputTokens) * share),
					output: Math.round(safeNum(u.outputTokens) * share),
					cachedInput: Math.round(safeNum(u.cacheReadInputTokens) * share),
					cacheCreation: Math.round(safeNum(u.cacheCreationInputTokens) * share),
					cacheCreation1h: 0,
					reasoning: 0,
				},
				reportedCostUsd: undefined,
				durationMs: 0,
				error: false,
				extra: true,
				afterCompaction: false,
				isSubagent: false,
			});
		}
	}
	return out;
}

function extractClaudeUsage(
	u: Record<string, unknown> | undefined,
): readonly [number, number, number, number, number, number] {
	if (!u) return NONE;
	const cc = u.cache_creation as Record<string, unknown> | undefined;
	const outDetails = u.output_tokens_details as Record<string, unknown> | undefined;
	return [
		safeNum(u.input_tokens),
		safeNum(u.output_tokens),
		safeNum(u.cache_read_input_tokens),
		safeNum(u.cache_creation_input_tokens),
		safeNum(cc?.ephemeral_1h_input_tokens),
		safeNum(outDetails?.thinking_tokens),
	];
}

function parseCsv6(csv: string): readonly [number, number, number, number, number, number] {
	const p = csv.split(",").map(Number);
	return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] || 0, p[4] || 0, p[5] || 0];
}

function claudeSpeedTier(usage: Record<string, unknown> | undefined): SpeedTier {
	const speed = usage?.speed;
	if (speed === "fast") return "fast";
	if (speed === "ultrafast") return "ultrafast";
	return "standard";
}

function positiveOrUndef(v: unknown): number | undefined {
	const n = safeNum(v);
	return n > 0 ? n : undefined;
}

function readSubagentType(file: string): string {
	try {
		const meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")) as Record<string, unknown>;
		if (typeof meta.agentType === "string" && meta.agentType.trim()) {
			return meta.agentType.trim().slice(0, 48);
		}
	} catch {
		// Meta file is optional.
	}
	return "subagent";
}
