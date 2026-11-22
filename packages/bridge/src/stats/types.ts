import type { StatsCostSource, StatsHarness, StatsScanState } from "../contract";

export const HARNESSES: readonly StatsHarness[] = [
	"pi",
	"claude",
	"codex",
	"opencode",
	"antigravity",
	"grok",
	"gemini",
];

export const HARNESS_DISPLAY_NAME: Readonly<Record<StatsHarness, string>> = {
	pi: "Pi",
	claude: "Claude Code",
	codex: "Codex",
	opencode: "OpenCode",
	antigravity: "Antigravity",
	grok: "Grok",
	gemini: "Gemini CLI",
};

export type SpeedTier = "standard" | "fast" | "ultrafast" | "flex";
export type ContextTier = "base" | "long200k" | "long272k";

export interface RawTokenCounts {
	readonly uncachedInput: number;
	readonly cachedInput: number;
	readonly cacheCreation: number;
	readonly cacheCreation1h: number;
	readonly output: number;
	readonly reasoning: number;
}

export interface PricedTurn {
	readonly inputUsd: number;
	readonly outputUsd: number;
	readonly cacheReadUsd: number;
	readonly cacheWriteUsd: number;
	readonly totalUsd: number;
	readonly speedPremiumUsd: number;
	readonly cacheSavingsUsd: number;
	readonly costSource: StatsCostSource;
	readonly contextTier: ContextTier;
	readonly priceSig: string;
	readonly unpriced: boolean;
}

export interface TurnEvent {
	readonly harness: StatsHarness;
	readonly sessionKey: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly ms: number;
	readonly model: string;
	readonly provider: string;
	readonly thinking: string;
	readonly speedTier: SpeedTier;
	readonly tokens: RawTokenCounts;
	readonly reportedCostUsd: number | undefined;
	readonly durationMs: number;
	readonly error: boolean;
	readonly extra: boolean;
	/** Explicit turn count for rolled-up subagent runs; defaults to `extra ? 0 : 1`. */
	readonly turnCount?: number;
	/** True for multi-turn aggregates so single-request >200k/>272k tiers are not applied. */
	readonly aggregate?: boolean;
	readonly afterCompaction: boolean;
	readonly isSubagent: boolean;
	readonly subagentName?: string;
	readonly subagentRunStart?: boolean;
	readonly subagentFailed?: boolean;
}

export interface SourceCursor {
	readonly path: string;
	readonly harness: StatsHarness;
	readonly dev: number;
	readonly ino: number;
	readonly mtimeMs: number;
	readonly size: number;
	readonly offset: number;
	readonly guardHash: string;
	readonly status: "live" | "retained";
	readonly parserState: string;
}

export interface SourceProgress {
	readonly harness: StatsHarness;
	state: StatsScanState;
	files: number;
	parsedFiles: number;
	bytesRead: number;
	totalBytes: number;
	problem?: string;
}

export interface StatsPaths {
	readonly dbPath: string;
	readonly pricingCachePath: string;
	readonly piSessionsDir: string;
	readonly claudeDirs: readonly string[];
	readonly claudeStatsCachePath: string;
	readonly codexHome: string;
	readonly opencodeHome: string;
	readonly antigravityDirs: readonly string[];
	readonly grokHome: string;
	readonly geminiHome: string;
}

export function fnv1a(input: string | Uint8Array): string {
	let hash = 2166136261;
	if (typeof input === "string") {
		for (let i = 0; i < input.length; i++) {
			hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
		}
	} else {
		for (let i = 0; i < input.length; i++) {
			hash = Math.imul(hash ^ (input[i] ?? 0), 16777619);
		}
	}
	return (hash >>> 0).toString(36);
}

/** Compact 64-bit dual-FNV key (14 chars max) to keep the SQLite dedup B-tree small. */
export function compactDedupKey(raw: string): string {
	if (raw.length <= 20) return raw;
	let h1 = 2166136261;
	let h2 = 0x811c9dc5 ^ 0x9e3779b9;
	for (let i = 0; i < raw.length; i++) {
		const c = raw.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 16777619);
		h2 = Math.imul(h2 ^ (c + i), 2246822519);
	}
	return `~${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function safeNum(value: unknown): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseMs(value: unknown): number {
	const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
	return Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : Number.NaN;
}

export function canonicalProvider(provider: string): string {
	const p = provider.trim().toLowerCase();
	if (p === "gemini" || p === "vertex_ai" || p === "vertex_ai-language-models" || p === "agy" || p === "antigravity") {
		return "google";
	}
	if (p === "bedrock" || p === "bedrock_converse" || p === "claude" || p === "claude-bridge" || p === "claude-agent") {
		return "anthropic";
	}
	if (p === "azure" || p === "chatgpt" || p === "codex" || p === "openai-codex") {
		return "openai";
	}
	if (p === "grok") return "xai";
	if (p === "kimi" || p === "kimi-coding" || p === "kimi-for-coding" || p === "kimi-code" || p === "moonshot") {
		return "moonshotai";
	}
	return p;
}

export function normalizeModelName(provider: string, rawModel: string): { provider: string; model: string } {
	let model = rawModel.trim();
	let prov = canonicalProvider(provider);
	const slash = model.indexOf("/");
	if (slash !== -1) {
		if (!prov || prov === "unknown") prov = canonicalProvider(model.slice(0, slash));
		model = model.slice(slash + 1);
	}
	model = model.replace(/\[[^\]]+\]$/, "").trim();
	if (/^claude-/.test(model)) {
		model = model.replace(/-\d{8}$/, "");
	}
	const inferred = inferProvider(model);
	if (!prov || prov === "unknown" || (prov === "opencode" && inferred !== "unknown")) {
		prov = inferred;
	}
	return { provider: prov || "unknown", model: model || "unknown" };
}

export function inferProvider(model: string): string {
	const m = model.toLowerCase();
	if (m.startsWith("claude-")) return "anthropic";
	if (/^(gpt-|o1|o3|o4|codex-|chatgpt-)/.test(m)) return "openai";
	if (m.startsWith("gemini-")) return "google";
	if (m.startsWith("grok-")) return "xai";
	if (m.startsWith("deepseek-")) return "deepseek";
	if (m.startsWith("kimi-") || m.startsWith("moonshot-") || /^k2p\d/.test(m)) return "moonshotai";
	if (m.startsWith("qwen")) return "qwen";
	if (m.startsWith("glm-")) return "zai";
	if (m.startsWith("minimax-")) return "minimax";
	if (m.startsWith("mistral-") || m.startsWith("codestral")) return "mistral";
	return "unknown";
}

export function isUnpriceableModel(model: string): boolean {
	const m = model.toLowerCase();
	return (
		!m ||
		m === "unknown" ||
		m === "<synthetic>" ||
		m === "synthetic" ||
		m === "opus" ||
		m === "sonnet" ||
		m === "haiku" ||
		m === "fable"
	);
}

export function localDayKey(ms: number, timeZone?: string): string {
	if (!timeZone) {
		const d = new Date(ms);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	}
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(ms));
	const y = parts.find((p) => p.type === "year")?.value ?? "1970";
	const m = parts.find((p) => p.type === "month")?.value ?? "01";
	const d = parts.find((p) => p.type === "day")?.value ?? "01";
	return `${y}-${m}-${d}`;
}

export function utcHourKey(ms: number): string {
	const d = new Date(Math.floor(ms / 3_600_000) * 3_600_000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
}
