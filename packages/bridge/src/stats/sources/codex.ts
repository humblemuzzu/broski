import { basename } from "node:path";
import { fnv1a, normalizeModelName, parseMs, type SpeedTier, safeNum, type TurnEvent } from "../types";

const HEAD_BYTES = 260;
const TYPE_RE = /"type":"([a-z_]+)"/g;
const TIMESTAMP_RE = /"timestamp":"([^"]+)"/;
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/;

export interface CodexParserState {
	headerSeen?: boolean;
	sessionId?: string;
	parentId?: string;
	cwd?: string;
	provider?: string;
	model?: string;
	thinking?: string;
	speedTier?: SpeedTier;
	isSubagent?: boolean;
	subagentName?: string;
	subagentRunCounted?: boolean;
	afterCompaction?: boolean;
	replayActive?: boolean;
	lastInfoHash?: string;
	totals?: [number, number, number, number];
}

export interface CodexLineContext {
	readonly sourcePath: string;
	readonly hasDedup: (key: string) => boolean;
	readonly setDedup: (key: string) => void;
	readonly emitTurn: (turn: TurnEvent) => void;
}

export function initCodexState(): CodexParserState {
	return { provider: "openai", speedTier: "standard", replayActive: true };
}

export function parseCodexLine(state: CodexParserState, buf: Buffer, ctx: CodexLineContext): void {
	const head = buf.subarray(0, Math.min(buf.length, HEAD_BYTES)).toString("latin1");
	TYPE_RE.lastIndex = 0;
	const outer = TYPE_RE.exec(head)?.[1];
	const inner = outer ? TYPE_RE.exec(head)?.[1] : undefined;
	if (!outer) return;
	if (
		outer !== "session_meta" &&
		outer !== "turn_context" &&
		outer !== "compacted" &&
		outer !== "token_usage_record" &&
		!(outer === "event_msg" && (inner === "token_count" || inner === "thread_settings_applied"))
	) {
		return;
	}

	const ms = parseMs(TIMESTAMP_RE.exec(head)?.[1]);
	if (!Number.isFinite(ms)) return;

	let parsed: Record<string, unknown>;
	try {
		const raw = JSON.parse(buf.toString("utf8")) as unknown;
		if (!raw || typeof raw !== "object") return;
		parsed = raw as Record<string, unknown>;
	} catch {
		return;
	}

	const payload = parsed.payload as Record<string, unknown> | undefined;
	switch (outer) {
		case "session_meta":
			onSessionMeta(state, payload);
			return;
		case "turn_context":
			if (typeof payload?.model === "string") state.model = payload.model;
			if (typeof payload?.effort === "string") state.thinking = payload.effort;
			if (!state.cwd && typeof payload?.cwd === "string") state.cwd = payload.cwd;
			return;
		case "compacted":
			state.afterCompaction = true;
			return;
		case "token_usage_record":
			onTokenUsageRecord(state, payload, ms, ctx);
			return;
		case "event_msg":
			if (inner === "token_count") {
				onTokenCount(state, payload?.info as Record<string, unknown> | undefined, ms, ctx);
			} else if (inner === "thread_settings_applied") {
				const ts = payload?.thread_settings as Record<string, unknown> | undefined;
				if (!state.model && typeof ts?.model === "string") state.model = ts.model;
				state.speedTier = parseServiceTier(ts?.service_tier);
			}
			return;
	}
}

function onSessionMeta(state: CodexParserState, p: Record<string, unknown> | undefined): void {
	if (state.headerSeen || !p) return;
	state.headerSeen = true;
	if (typeof p.cwd === "string") state.cwd = p.cwd;
	if (typeof p.model_provider === "string" && p.model_provider) state.provider = p.model_provider;
	if (typeof p.id === "string" && p.id) state.sessionId = p.id;
	if (typeof p.forked_from_id === "string" && p.forked_from_id) state.parentId = p.forked_from_id;

	const source = p.source as Record<string, unknown> | undefined;
	const sub = source?.subagent;
	if (sub) {
		const name =
			typeof sub === "string"
				? sub
				: typeof (sub as Record<string, unknown>).other === "string"
					? String((sub as Record<string, unknown>).other)
					: Object.keys(sub as Record<string, unknown>)[0];
		const spawn = (sub as Record<string, unknown>).thread_spawn as Record<string, unknown> | undefined;
		const parent =
			(typeof p.parent_thread_id === "string" && p.parent_thread_id) ||
			(typeof spawn?.parent_thread_id === "string" && spawn.parent_thread_id) ||
			(typeof p.session_id === "string" && p.session_id !== p.id ? p.session_id : undefined);
		if (parent) {
			state.isSubagent = true;
			state.subagentName = (name || "subagent").slice(0, 48);
			state.parentId = parent;
		}
	}
}

function onTokenUsageRecord(
	state: CodexParserState,
	payload: Record<string, unknown> | undefined,
	ms: number,
	ctx: CodexLineContext,
): void {
	const usage = payload?.usage as Record<string, unknown> | undefined;
	if (!usage) return;
	const sessionId = sessionIdOf(state, ctx.sourcePath);
	const responseId = typeof payload?.response_id === "string" ? payload.response_id : "";
	if (responseId) {
		const key = `resp:${sessionId}:${responseId}`;
		if (ctx.hasDedup(key)) return;
		ctx.setDedup(key);
	}
	emitCodexUsage(state, usage, ms, ctx);
}

function onTokenCount(
	state: CodexParserState,
	info: Record<string, unknown> | undefined,
	ms: number,
	ctx: CodexLineContext,
): void {
	if (!info) return;
	// Collapse byte-identical consecutive token_count emissions (~46% of events in real rollouts).
	const infoHash = fnv1a(JSON.stringify(info));
	if (state.lastInfoHash === infoHash) return;
	state.lastInfoHash = infoHash;

	const total = info.total_token_usage as Record<string, unknown> | undefined;
	const last = info.last_token_usage as Record<string, unknown> | undefined;
	if (!total && !last) return;

	const curTotals: [number, number, number, number] | undefined = total
		? [
				safeNum(total.input_tokens),
				safeNum(total.cached_input_tokens),
				safeNum(total.output_tokens),
				safeNum(total.reasoning_output_tokens),
			]
		: undefined;

	if (curTotals && state.totals && curTotals.every((v, i) => v === state.totals?.[i])) return;

	// Detect session restart/compaction vs minor correction when cumulative counters drop.
	let prev = state.totals ?? [0, 0, 0, 0];
	if (curTotals && state.totals) {
		const dropped = curTotals[0] < state.totals[0] || curTotals[2] < state.totals[2];
		if (dropped) {
			const isRestart = curTotals[0] <= state.totals[0] * 0.1 && curTotals[2] <= state.totals[2] * 0.1;
			if (!isRestart) return;
			prev = [0, 0, 0, 0];
		}
	}

	let inc: Record<string, unknown> | undefined = last;
	if (!inc && curTotals) {
		inc = {
			input_tokens: Math.max(0, curTotals[0] - prev[0]),
			cached_input_tokens: Math.max(0, curTotals[1] - prev[1]),
			output_tokens: Math.max(0, curTotals[2] - prev[2]),
			reasoning_output_tokens: Math.max(0, curTotals[3] - prev[3]),
		};
	}

	// Always advance cumulative baseline even on the last_token_usage path.
	if (curTotals) {
		state.totals = curTotals;
		const ns = state.parentId ?? sessionIdOf(state, ctx.sourcePath);
		const replayKey = `tot:${ns}:${curTotals.join(":")}:${safeNum(total?.total_tokens)}`;
		if (state.replayActive && ctx.hasDedup(replayKey)) return;
		state.replayActive = false;
		ctx.setDedup(replayKey);
	}

	if (inc) emitCodexUsage(state, inc, ms, ctx);
}

function emitCodexUsage(
	state: CodexParserState,
	inc: Record<string, unknown>,
	ms: number,
	ctx: CodexLineContext,
): void {
	// OpenAI input_tokens INCLUDES cached_input_tokens — subtract so cached bytes are never billed twice.
	const promptTokens = safeNum(inc.input_tokens);
	const cacheRead = Math.min(
		promptTokens,
		Math.max(safeNum(inc.cached_input_tokens), safeNum(inc.cache_read_input_tokens)),
	);
	const cacheWrite = Math.min(promptTokens - cacheRead, safeNum(inc.cache_write_input_tokens));
	const uncachedInput = Math.max(0, promptTokens - cacheRead - cacheWrite);
	const output = safeNum(inc.output_tokens);
	const reasoning = Math.min(output, safeNum(inc.reasoning_output_tokens));
	if (uncachedInput + output + cacheRead + cacheWrite === 0) return;

	const { provider, model } = normalizeModelName(state.provider ?? "openai", state.model ?? "unknown");
	const sessionId = state.parentId && state.isSubagent ? state.parentId : sessionIdOf(state, ctx.sourcePath);
	const subagentRunStart = Boolean(state.isSubagent && !state.subagentRunCounted);
	if (subagentRunStart) state.subagentRunCounted = true;

	ctx.emitTurn({
		harness: "codex",
		sessionKey: `codex:${sessionId}`,
		sessionId,
		cwd: state.cwd ?? "",
		ms,
		model,
		provider,
		thinking: state.thinking ?? "unknown",
		speedTier: state.speedTier ?? "standard",
		tokens: {
			uncachedInput,
			cachedInput: cacheRead,
			cacheCreation: cacheWrite,
			cacheCreation1h: 0,
			output,
			reasoning,
		},
		reportedCostUsd: undefined,
		durationMs: 0,
		error: false,
		extra: false,
		afterCompaction: Boolean(state.afterCompaction),
		isSubagent: Boolean(state.isSubagent),
		subagentName: state.subagentName,
		subagentRunStart,
		subagentFailed: false,
	});
	state.afterCompaction = false;
}

function sessionIdOf(state: CodexParserState, sourcePath: string): string {
	return state.sessionId || UUID_RE.exec(sourcePath)?.[1] || basename(sourcePath);
}

function parseServiceTier(value: unknown): SpeedTier {
	if (value === "priority" || value === "fast") return "fast";
	if (value === "ultrafast") return "ultrafast";
	if (value === "flex") return "flex";
	return "standard";
}
