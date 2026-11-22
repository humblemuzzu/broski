import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { StatsHarness } from "../../contract";
import { normalizeModelName, parseMs, safeNum, type TurnEvent } from "../types";

const IMPORTED_RE = /^\[(opencode|claude|codex)\] /;
const PREFILTER_MARKERS = [
	'"type":"session"',
	'"type":"model_change"',
	'"type":"thinking_level_change"',
	'"type":"session_info"',
	'"type":"compaction"',
	'"type":"custom"',
	'"type":"custom_message"',
	'"role":"assistant"',
	'"role":"toolResult"',
	'"type": "session"',
	'"type": "model_change"',
	'"type": "thinking_level_change"',
	'"type": "session_info"',
	'"type": "compaction"',
	'"type": "custom"',
	'"type": "custom_message"',
	'"role": "assistant"',
	'"role": "toolResult"',
];

export interface PiParserState {
	headerSeen?: boolean;
	sessionId?: string;
	cwd?: string;
	model?: string;
	provider?: string;
	thinking?: string;
	skipBeforeMs?: number;
	afterCompaction?: boolean;
	importOf?: StatsHarness;
}

export interface PiLineContext {
	readonly sourcePath: string;
	readonly parentExists: (path: string) => boolean;
	readonly hasDedup: (harness: StatsHarness, key: string) => boolean;
	readonly emitTurn: (turn: TurnEvent, dedupKey?: string) => void;
}

export function piLineMatches(buf: Buffer): boolean {
	const head = buf.subarray(0, Math.min(buf.length, 512)).toString("latin1");
	for (const marker of PREFILTER_MARKERS) {
		if (head.includes(marker)) return true;
	}
	return false;
}

export function parsePiLine(state: PiParserState, buf: Buffer, ctx: PiLineContext): void {
	if (!piLineMatches(buf)) return;
	let entry: Record<string, unknown>;
	try {
		const raw = JSON.parse(buf.toString("utf8")) as unknown;
		if (!raw || typeof raw !== "object") return;
		entry = raw as Record<string, unknown>;
	} catch {
		return;
	}

	if (entry.type === "session") {
		if (state.headerSeen) return;
		state.headerSeen = true;
		state.sessionId = typeof entry.id === "string" && entry.id ? entry.id : basename(ctx.sourcePath, ".jsonl");
		state.cwd = typeof entry.cwd === "string" ? entry.cwd : "";
		const startMs = parseMs(entry.timestamp);
		if (typeof entry.parentSession === "string" && Number.isFinite(startMs) && ctx.parentExists(entry.parentSession)) {
			state.skipBeforeMs = startMs;
		}
		return;
	}

	const ms = parseMs(entry.timestamp);
	if (!Number.isFinite(ms)) return;
	const counted = state.skipBeforeMs === undefined || ms >= state.skipBeforeMs;

	switch (entry.type) {
		case "model_change":
			if (typeof entry.provider === "string") state.provider = entry.provider;
			if (typeof entry.modelId === "string") state.model = entry.modelId;
			return;
		case "thinking_level_change":
			if (typeof entry.thinkingLevel === "string") state.thinking = entry.thinkingLevel;
			return;
		case "session_info": {
			if (typeof entry.name === "string") {
				const from = IMPORTED_RE.exec(entry.name.trim())?.[1];
				if (from === "opencode" || from === "claude" || from === "codex") state.importOf = from;
			}
			return;
		}
		case "compaction":
			state.afterCompaction = true;
			return;
		case "custom": {
			const data = entry.data as Record<string, unknown> | undefined;
			if (entry.customType === "cache-ping" && data?.usage && counted) {
				emitPiMessage(state, data, ms, true, ctx);
			}
			return;
		}
		case "custom_message": {
			const details = entry.details as Record<string, unknown> | undefined;
			if (counted && entry.customType === "agent-result" && Array.isArray(details?.runs)) {
				emitRuns(state, ms, details.runs, ctx);
			}
			return;
		}
		case "message":
			break;
		default:
			return;
	}

	const msg = entry.message as Record<string, unknown> | undefined;
	if (!msg || typeof msg !== "object") return;
	if (msg.role === "assistant" && counted) {
		emitPiMessage(state, msg, ms, false, ctx);
	} else if (msg.role === "toolResult" && counted) {
		onToolResult(state, msg, ms, ctx);
	}
}

function emitPiMessage(
	state: PiParserState,
	msg: Record<string, unknown>,
	ms: number,
	extra: boolean,
	ctx: PiLineContext,
): void {
	const u = (msg.usage as Record<string, unknown> | undefined) ?? {};
	const input = safeNum(u.input);
	const output = safeNum(u.output);
	const cacheRead = safeNum(u.cacheRead);
	const cacheWrite = safeNum(u.cacheWrite);
	const cacheWrite1h = safeNum(u.cacheWrite1h);
	const reasoning = Math.min(output, safeNum(u.reasoning));
	const totalTokens = input + output + cacheRead + cacheWrite;
	if (totalTokens === 0 && !msg.stopReason) return;

	const rawProv = typeof msg.provider === "string" ? msg.provider : (state.provider ?? "unknown");
	const rawModel = typeof msg.model === "string" ? msg.model : (state.model ?? "unknown");
	const { provider, model } = normalizeModelName(rawProv, rawModel);
	const fp = `${ms}:${input}:${output}:${cacheRead}:${cacheWrite}`;
	if (state.importOf && ctx.hasDedup(state.importOf, fp)) return;

	const costObj = u.cost as Record<string, unknown> | number | undefined;
	const recordedTotal = typeof costObj === "object" && costObj ? safeNum(costObj.total) : safeNum(costObj);
	const sessionId = state.sessionId || basename(ctx.sourcePath, ".jsonl");

	ctx.emitTurn({
		harness: "pi",
		sessionKey: `pi:${sessionId}`,
		sessionId,
		cwd: state.cwd ?? "",
		ms,
		model,
		provider,
		thinking: typeof msg.thinkingLevel === "string" ? msg.thinkingLevel : (state.thinking ?? "unknown"),
		speedTier: "standard",
		tokens: {
			uncachedInput: input,
			cachedInput: cacheRead,
			cacheCreation: cacheWrite,
			cacheCreation1h: cacheWrite1h,
			output,
			reasoning,
		},
		reportedCostUsd: recordedTotal > 0 ? recordedTotal : undefined,
		durationMs: Math.round(safeNum(msg.durationMs)),
		error: msg.stopReason === "error",
		extra,
		afterCompaction: Boolean(state.afterCompaction),
		isSubagent: false,
	});
	if (!extra) state.afterCompaction = false;
}

function onToolResult(state: PiParserState, msg: Record<string, unknown>, ms: number, ctx: PiLineContext): void {
	const tool = typeof msg.toolName === "string" ? msg.toolName : "agent";
	const details = msg.details as Record<string, unknown> | undefined;
	if (!details || typeof details !== "object") return;
	if (hasAgentUsage(details)) {
		emitAgentRun(state, ms, tool, details, agentFailed(msg, details), ctx);
		if (Array.isArray(details.messages)) walkChild(state, ms, details.messages, 1, ctx);
	} else if (Array.isArray(details.runs)) {
		emitRuns(state, ms, details.runs, ctx);
	}
}

function emitRuns(state: PiParserState, ms: number, runs: unknown[], ctx: PiLineContext): void {
	for (const run of runs) {
		if (!run || typeof run !== "object") continue;
		const rec = run as Record<string, unknown>;
		if (!hasAgentUsage(rec)) continue;
		const agent = typeof rec.agent === "string" && rec.agent ? rec.agent : "agent";
		emitAgentRun(state, ms, agent, rec, rec.status !== "done", ctx);
		if (Array.isArray(rec.messages)) walkChild(state, ms, rec.messages, 1, ctx);
	}
}

function walkChild(state: PiParserState, ms: number, messages: unknown[], depth: number, ctx: PiLineContext): void {
	if (depth > 4) return;
	for (const raw of messages) {
		if (!raw || typeof raw !== "object") continue;
		const cm = raw as Record<string, unknown>;
		if (cm.role !== "toolResult" || typeof cm.toolName !== "string") continue;
		const details = cm.details as Record<string, unknown> | undefined;
		if (details && typeof details === "object" && hasAgentUsage(details)) {
			emitAgentRun(state, ms, cm.toolName, details, agentFailed(cm, details), ctx);
			if (Array.isArray(details.messages)) walkChild(state, ms, details.messages, depth + 1, ctx);
		}
	}
}

/**
 * Emits a sub-agent run as an aggregate `TurnEvent` so sub-agent tokens and spend are included
 * consistently in hero totals, harness totals, models, projects, and sub-agent leaderboards.
 */
function emitAgentRun(
	state: PiParserState,
	ms: number,
	agentName: string,
	details: Record<string, unknown>,
	failed: boolean,
	ctx: PiLineContext,
): void {
	const u = (details.usage as Record<string, unknown> | undefined) ?? {};
	const costField = u.cost as Record<string, unknown> | number | undefined;
	const costUsd =
		typeof costField === "object" && costField ? safeNum(costField.total) : safeNum(costField ?? details.cost);
	const input = safeNum(u.input);
	const output = safeNum(u.output);
	const cacheRead = safeNum(u.cacheRead);
	const cacheWrite = safeNum(u.cacheWrite);
	const turns = Math.max(1, Math.round(safeNum(u.turns)));
	if (input + output + cacheRead + cacheWrite === 0 && costUsd === 0) return;

	const rawModel = typeof details.model === "string" && details.model ? details.model : (state.model ?? "unknown");
	const { provider, model } = normalizeModelName("", rawModel);
	const sessionId = state.sessionId || basename(ctx.sourcePath, ".jsonl");

	ctx.emitTurn({
		harness: "pi",
		sessionKey: `pi:${sessionId}`,
		sessionId,
		cwd: state.cwd ?? "",
		ms,
		model,
		provider,
		thinking: "unknown",
		speedTier: "standard",
		tokens: {
			uncachedInput: input,
			cachedInput: cacheRead,
			cacheCreation: cacheWrite,
			cacheCreation1h: 0,
			output,
			reasoning: 0,
		},
		reportedCostUsd: costUsd > 0 ? costUsd : undefined,
		durationMs: Math.round(safeNum(details.durationMs)),
		error: failed,
		extra: false,
		turnCount: turns,
		aggregate: true,
		afterCompaction: false,
		isSubagent: true,
		subagentName: agentName.slice(0, 64),
		subagentRunStart: true,
		subagentFailed: failed,
	});
}

function hasAgentUsage(obj: Record<string, unknown>): boolean {
	return Boolean(obj.usage && ("agent" in obj || "exitCode" in obj));
}

function agentFailed(msg: Record<string, unknown>, details: Record<string, unknown>): boolean {
	return (
		Boolean(msg.isError) ||
		(typeof details.exitCode === "number" && details.exitCode !== 0) ||
		details.stopReason === "error" ||
		details.stopReason === "aborted"
	);
}

export function createParentExistsCache(): (path: string) => boolean {
	const cache = new Map<string, boolean>();
	return (p: string) => {
		const hit = cache.get(p);
		if (hit !== undefined) return hit;
		const ok = existsSync(p);
		cache.set(p, ok);
		return ok;
	};
}
