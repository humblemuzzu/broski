import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StatsPricingStatus } from "../contract";
import { type ModelRateCard, SEED_RATES, VENDOR_CACHE_DEFAULTS } from "./pricing-seed";
import {
	type ContextTier,
	canonicalProvider,
	fnv1a,
	isUnpriceableModel,
	type PricedTurn,
	type RawTokenCounts,
	type SpeedTier,
} from "./types";

const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MODELS_DEV_URL = "https://models.dev/api.json";
const REFRESH_TTL_MS = 24 * 3_600_000;
const RETRY_FLOOR_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const FIRST_PARTY = [
	"anthropic",
	"openai",
	"google",
	"xai",
	"deepseek",
	"moonshotai",
	"zai",
	"minimax",
	"mistral",
	"qwen",
];

interface CachedCatalog {
	readonly version: 1;
	readonly fetchedAt: number;
	readonly etag?: string;
	readonly rates: Record<string, ModelRateCard>;
}

interface ResolvedRate {
	readonly provider: string;
	readonly card: ModelRateCard;
	readonly sig: string;
}

export interface PriceBookOptions {
	readonly cachePath?: string;
	readonly disableRemote?: boolean;
}

export class PriceBook {
	private readonly byProvider = new Map<string, ModelRateCard>();
	private readonly byModel = new Map<string, Array<readonly [string, ModelRateCard]>>();
	private readonly memo = new Map<string, ResolvedRate | null>();
	private readonly earlyTried = new Set<string>();
	private readonly cachePath: string | undefined;
	private readonly disableRemote: boolean;
	private status: StatsPricingStatus = "bundled";
	private fetchedAt: number | undefined;
	private etag: string | undefined;
	private lastAttemptMs = 0;
	private refreshInflight: Promise<boolean> | undefined;

	constructor(options?: string | PriceBookOptions) {
		this.cachePath = typeof options === "string" ? options : options?.cachePath;
		this.disableRemote = typeof options === "object" ? Boolean(options.disableRemote) : false;
		this.loadSeed();
		this.loadDiskCache();
	}

	setOverride(provider: string, model: string, card: ModelRateCard): void {
		this.register(provider, model, card);
		this.memo.clear();
	}

	info(): { status: StatsPricingStatus; fetchedAt?: number; knownModels: number } {
		return {
			status: this.status,
			...(this.fetchedAt !== undefined && { fetchedAt: this.fetchedAt }),
			knownModels: this.byProvider.size,
		};
	}

	needsRefresh(now: number): boolean {
		if (this.disableRemote) return false;
		if (now - this.lastAttemptMs < RETRY_FLOOR_MS) return false;
		if (this.fetchedAt === undefined) return true;
		return now - this.fetchedAt >= REFRESH_TTL_MS;
	}

	async refresh(now = Date.now(), force = false): Promise<boolean> {
		if (this.disableRemote) return false;
		if (!force && !this.needsRefresh(now)) return false;
		if (this.refreshInflight) return this.refreshInflight;
		this.lastAttemptMs = now;
		this.refreshInflight = this.fetchAndMerge(now).finally(() => {
			this.refreshInflight = undefined;
		});
		return this.refreshInflight;
	}

	maybeRefreshForUnknown(model: string, now = Date.now()): void {
		if (this.disableRemote || isUnpriceableModel(model) || this.earlyTried.has(model)) return;
		if (now - this.lastAttemptMs < RETRY_FLOOR_MS) return;
		this.earlyTried.add(model);
		void this.refresh(now, true);
	}

	lookup(provider: string, model: string): ResolvedRate | undefined {
		if (isUnpriceableModel(model)) return undefined;
		const key = `${provider}/${model}`;
		if (this.memo.has(key)) return this.memo.get(key) ?? undefined;
		const resolved = this.resolve(provider, model);
		this.memo.set(key, resolved ?? null);
		return resolved;
	}

	priceTurn(
		provider: string,
		model: string,
		tokens: RawTokenCounts,
		speedTier: SpeedTier,
		reportedCostUsd: number | undefined,
		forcedContextTier?: ContextTier,
	): PricedTurn {
		const totalTokens = tokens.uncachedInput + tokens.cachedInput + tokens.cacheCreation + tokens.output;
		const resolved = this.lookup(provider, model);
		const contextTier = forcedContextTier ?? selectContextTier(resolved?.card, tokens);
		if (!resolved) {
			if (reportedCostUsd !== undefined && reportedCostUsd > 0) {
				return {
					inputUsd: 0,
					outputUsd: 0,
					cacheReadUsd: 0,
					cacheWriteUsd: 0,
					totalUsd: reportedCostUsd,
					speedPremiumUsd: 0,
					cacheSavingsUsd: 0,
					costSource: "provider_reported",
					contextTier,
					priceSig: "none",
					unpriced: false,
				};
			}
			return {
				inputUsd: 0,
				outputUsd: 0,
				cacheReadUsd: 0,
				cacheWriteUsd: 0,
				totalUsd: 0,
				speedPremiumUsd: 0,
				cacheSavingsUsd: 0,
				costSource: "unpriced",
				contextTier,
				priceSig: "none",
				unpriced: totalTokens > 0,
			};
		}
		const base = computeBaseParts(resolved.provider, resolved.card, tokens, contextTier);
		const mult = speedMultiplier(resolved.card, speedTier);
		const listInput = base.inputUsd * mult;
		const listOutput = base.outputUsd * mult;
		const listRead = base.cacheReadUsd * mult;
		const listWrite = base.cacheWriteUsd * mult;
		const listTotal = listInput + listOutput + listRead + listWrite;
		const speedPremiumUsd = mult > 1 ? Math.max(0, listTotal - base.totalUsd) : 0;
		const cacheSavingsUsd = Math.max(0, base.cacheSavingsUsd * mult);

		if (reportedCostUsd !== undefined && reportedCostUsd > 0) {
			const scale = listTotal > 0 ? reportedCostUsd / listTotal : 0;
			return {
				inputUsd: scale > 0 ? listInput * scale : 0,
				outputUsd: scale > 0 ? listOutput * scale : 0,
				cacheReadUsd: scale > 0 ? listRead * scale : 0,
				cacheWriteUsd: scale > 0 ? listWrite * scale : 0,
				totalUsd: reportedCostUsd,
				speedPremiumUsd: scale > 0 ? speedPremiumUsd * scale : 0,
				cacheSavingsUsd,
				costSource: "provider_reported",
				contextTier,
				priceSig: resolved.sig,
				unpriced: false,
			};
		}
		return {
			inputUsd: listInput,
			outputUsd: listOutput,
			cacheReadUsd: listRead,
			cacheWriteUsd: listWrite,
			totalUsd: listTotal,
			speedPremiumUsd,
			cacheSavingsUsd,
			costSource: "api_estimate",
			contextTier,
			priceSig: resolved.sig,
			unpriced: false,
		};
	}

	private loadSeed(): void {
		for (const [key, card] of Object.entries(SEED_RATES)) {
			const slash = key.indexOf("/");
			if (slash === -1) continue;
			this.register(key.slice(0, slash), key.slice(slash + 1), card);
		}
	}

	private loadDiskCache(): void {
		if (!this.cachePath) return;
		try {
			const raw = JSON.parse(readFileSync(this.cachePath, "utf8")) as Partial<CachedCatalog>;
			if (raw.version !== 1 || !raw.rates || typeof raw.rates !== "object") return;
			let count = 0;
			for (const [key, card] of Object.entries(raw.rates)) {
				const slash = key.indexOf("/");
				if (slash === -1 || !validCard(card)) continue;
				this.register(key.slice(0, slash), key.slice(slash + 1), card);
				count++;
			}
			if (count > 0) {
				this.fetchedAt = typeof raw.fetchedAt === "number" ? raw.fetchedAt : undefined;
				this.etag = typeof raw.etag === "string" ? raw.etag : undefined;
				this.status = "cached";
				this.memo.clear();
			}
		} catch {
			// Missing or unreadable cache falls back cleanly to bundled seed rates.
		}
	}

	private async fetchAndMerge(now: number): Promise<boolean> {
		const merged: Record<string, ModelRateCard> = {};
		let etag = this.etag;
		const [litellm, modelsDev] = await Promise.all([fetchLitellm(this.etag), fetchModelsDev()]);
		if (modelsDev) {
			for (const [k, card] of Object.entries(modelsDev)) merged[k] = card;
		}
		if (litellm?.notModified) {
			this.fetchedAt = now;
			this.status = "fresh";
			this.touchDiskCacheTimestamp(now);
			return false;
		}
		if (litellm?.rates) {
			etag = litellm.etag ?? etag;
			for (const [k, card] of Object.entries(litellm.rates)) merged[k] = card;
		}
		if (Object.keys(merged).length === 0) return false;
		for (const [key, card] of Object.entries(merged)) {
			const slash = key.indexOf("/");
			if (slash !== -1 && validCard(card)) {
				this.register(key.slice(0, slash), key.slice(slash + 1), card);
			}
		}
		this.fetchedAt = now;
		this.etag = etag;
		this.status = "fresh";
		this.memo.clear();
		this.saveDiskCache(now, etag, merged);
		return true;
	}

	private touchDiskCacheTimestamp(fetchedAt: number): void {
		if (!this.cachePath) return;
		try {
			const raw = JSON.parse(readFileSync(this.cachePath, "utf8")) as Partial<CachedCatalog>;
			if (raw.version === 1 && raw.rates) this.saveDiskCache(fetchedAt, raw.etag, raw.rates);
		} catch {
			// Ignore if cache disappeared.
		}
	}

	private saveDiskCache(fetchedAt: number, etag: string | undefined, rates: Record<string, ModelRateCard>): void {
		if (!this.cachePath) return;
		try {
			mkdirSync(dirname(this.cachePath), { recursive: true, mode: 0o700 });
			const tmp = `${this.cachePath}.${process.pid}.tmp`;
			const payload: CachedCatalog = { version: 1, fetchedAt, ...(etag ? { etag } : {}), rates };
			writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
			renameSync(tmp, this.cachePath);
		} catch {
			// Best-effort cache write; in-memory rates remain active.
		}
	}

	private register(provider: string, model: string, card: ModelRateCard): void {
		const p = canonicalProvider(provider);
		const m = model.trim();
		if (!p || !m) return;
		this.byProvider.set(`${p}/${m}`, card);
		const list = this.byModel.get(m) ?? [];
		const idx = list.findIndex(([prov]) => prov === p);
		if (idx >= 0) list[idx] = [p, card];
		else list.push([p, card]);
		this.byModel.set(m, list);
	}

	private resolve(provider: string, model: string): ResolvedRate | undefined {
		const p = canonicalProvider(provider);
		const candidates = modelCandidates(model);
		for (const c of candidates) {
			const direct = this.byProvider.get(`${p}/${c}`);
			if (direct && !isZeroCard(direct)) return { provider: p, card: direct, sig: rateSignature(direct) };
		}
		if (isFreeOrLocalModel(p, model)) {
			const free: ModelRateCard = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
			return { provider: p, card: free, sig: rateSignature(free) };
		}
		for (const c of candidates) {
			const rows = (this.byModel.get(c) ?? []).filter(([, card]) => !isZeroCard(card));
			for (const first of FIRST_PARTY) {
				const hit = rows.find(([prov]) => prov === first);
				if (hit) return { provider: hit[0], card: hit[1], sig: rateSignature(hit[1]) };
			}
			const firstAny = rows[0];
			if (firstAny) return { provider: firstAny[0], card: firstAny[1], sig: rateSignature(firstAny[1]) };
		}
		return undefined;
	}
}

export function rateSignature(card: ModelRateCard): string {
	return fnv1a(JSON.stringify(card));
}

function selectContextTier(card: ModelRateCard | undefined, tokens: RawTokenCounts): ContextTier {
	if (!card) return "base";
	const prompt = tokens.uncachedInput + tokens.cachedInput + tokens.cacheCreation;
	if (card.above272k && prompt > 272_000) return "long272k";
	if (card.above200k && prompt > 200_000) return "long200k";
	return "base";
}

function computeBaseParts(provider: string, card: ModelRateCard, tokens: RawTokenCounts, tier: ContextTier) {
	const defaults = VENDOR_CACHE_DEFAULTS[provider] ?? { write5m: 1.0, write1h: 1.0, read: 1.0 };
	const active =
		tier === "long272k" && card.above272k
			? card.above272k
			: tier === "long200k" && card.above200k
				? card.above200k
				: card;
	const inputRate = active.input;
	const outputRate = active.output;
	const cacheReadRate = active.cacheRead ?? inputRate * defaults.read;
	const cacheWrite5mRate = active.cacheWrite ?? inputRate * defaults.write5m;
	const explicit1h =
		"cacheWrite1h" in active && typeof active.cacheWrite1h === "number" ? active.cacheWrite1h : undefined;
	const cacheWrite1hRate = explicit1h ?? inputRate * defaults.write1h;

	const write1h = Math.min(tokens.cacheCreation1h, tokens.cacheCreation);
	const write5m = Math.max(0, tokens.cacheCreation - write1h);

	const inputUsd = (tokens.uncachedInput * inputRate) / 1e6;
	const outputUsd = (tokens.output * outputRate) / 1e6;
	const cacheReadUsd = (tokens.cachedInput * cacheReadRate) / 1e6;
	const cacheWriteUsd = (write5m * cacheWrite5mRate + write1h * cacheWrite1hRate) / 1e6;
	const totalUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd;
	const readSaved = (tokens.cachedInput * Math.max(0, inputRate - cacheReadRate)) / 1e6;
	const writePremium = Math.max(0, cacheWriteUsd - (tokens.cacheCreation * inputRate) / 1e6);
	return {
		inputUsd,
		outputUsd,
		cacheReadUsd,
		cacheWriteUsd,
		totalUsd,
		cacheSavingsUsd: Math.max(0, readSaved - writePremium),
	};
}

function speedMultiplier(card: ModelRateCard, tier: SpeedTier): number {
	if (tier === "fast") return card.fastMultiplier ?? 2;
	if (tier === "ultrafast") return card.ultrafastMultiplier ?? 6;
	if (tier === "flex") return card.flexMultiplier ?? 0.5;
	return 1;
}

function isFreeOrLocalModel(provider: string, model: string): boolean {
	if (/-free$|-local$/i.test(model)) return true;
	if (model === "big-pickle") return true;
	return (
		provider === "local" ||
		provider === "ollama" ||
		provider === "local-llama" ||
		provider === "llama-local" ||
		provider === "lmstudio"
	);
}

function modelCandidates(model: string): string[] {
	const stripped = model.replace(/-\d{8}$/, "").replace(/:thinking$|:free$/, "");
	const withoutEffort = stripped.replace(
		/-(?:minimal|extra-low|low|medium|high|xhigh|max|tiered|control|thinking|build|0)$/,
		"",
	);
	const variants = [model, stripped, withoutEffort];
	const out: string[] = [];
	for (const v of variants) {
		if (!v) continue;
		out.push(v);
		out.push(v.replace(/^claude-(\w+)-(\d+)-(\d+)$/, "claude-$1-$2.$3"));
		out.push(v.replace(/^claude-(\w+)-(\d+)\.(\d+)$/, "claude-$1-$2-$3"));
	}
	if (withoutEffort === "gemini-3-pro") out.push("gemini-3-pro-preview");
	if (withoutEffort === "gemini-3-flash") out.push("gemini-3-flash-preview");
	return [...new Set(out)];
}

function isZeroCard(card: ModelRateCard): boolean {
	return card.input === 0 && card.output === 0 && !card.above200k && !card.above272k;
}

function validCard(card: unknown): card is ModelRateCard {
	if (!card || typeof card !== "object") return false;
	const c = card as Record<string, unknown>;
	return (
		typeof c.input === "number" &&
		Number.isFinite(c.input) &&
		c.input >= 0 &&
		typeof c.output === "number" &&
		Number.isFinite(c.output) &&
		c.output >= 0
	);
}

async function fetchLitellm(
	etag: string | undefined,
): Promise<{ notModified?: boolean; etag?: string; rates?: Record<string, ModelRateCard> } | undefined> {
	try {
		const res = await fetch(LITELLM_URL, {
			headers: etag ? { "if-none-match": etag } : undefined,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (res.status === 304) return { notModified: true };
		if (!res.ok) return undefined;
		const body = (await res.json()) as Record<string, Record<string, unknown>>;
		const rates: Record<string, ModelRateCard> = {};
		for (const [rawKey, entry] of Object.entries(body)) {
			if (!entry || typeof entry !== "object" || rawKey === "sample_spec") continue;
			const parsed = parseLitellmEntry(rawKey, entry);
			if (parsed) rates[parsed[0]] = parsed[1];
		}
		return { etag: res.headers.get("etag") ?? undefined, rates };
	} catch {
		return undefined;
	}
}

function parseLitellmEntry(rawKey: string, e: Record<string, unknown>): readonly [string, ModelRateCard] | undefined {
	const inputPerTok = numOrUndef(e.input_cost_per_token);
	const outputPerTok = numOrUndef(e.output_cost_per_token);
	if (inputPerTok === undefined || outputPerTok === undefined) return undefined;
	const slash = rawKey.indexOf("/");
	const rawProv =
		typeof e.litellm_provider === "string" ? e.litellm_provider : slash !== -1 ? rawKey.slice(0, slash) : "";
	const provider = canonicalProvider(rawProv);
	if (!provider || provider === "github_copilot") return undefined;
	const model = (slash !== -1 ? rawKey.slice(slash + 1) : rawKey).replace(/^us\.|^eu\.|^global\./, "");
	const input = inputPerTok * 1e6;
	const output = outputPerTok * 1e6;
	const cacheRead = scalePerM(e.cache_read_input_token_cost);
	const cacheWrite = scalePerM(e.cache_creation_input_token_cost);
	const cacheWrite1h = scalePerM(e.cache_creation_input_token_cost_above_1hr);
	const above200k = parseTier(e, "_above_200k_tokens", input, output, cacheWrite);
	const above272k = parseTier(e, "_above_272k_tokens", input, output, cacheWrite);
	const priorityIn = scalePerM(e.input_cost_per_token_priority);
	const fastMultiplier = priorityIn !== undefined && input > 0 && priorityIn > input ? priorityIn / input : undefined;
	return [
		`${provider}/${model}`,
		{
			input,
			output,
			...(cacheRead !== undefined && { cacheRead }),
			...(cacheWrite !== undefined && { cacheWrite }),
			...(cacheWrite1h !== undefined && { cacheWrite1h }),
			...(above200k !== undefined && { above200k }),
			...(above272k !== undefined && { above272k }),
			...(fastMultiplier !== undefined && { fastMultiplier }),
		},
	];
}

function parseTier(
	e: Record<string, unknown>,
	suffix: string,
	baseInput: number,
	baseOutput: number,
	baseCacheWrite: number | undefined,
): ModelRateCard["above200k"] | undefined {
	const input = scalePerM(e[`input_cost_per_token${suffix}`]);
	const output = scalePerM(e[`output_cost_per_token${suffix}`]);
	if (input === undefined || output === undefined || input < baseInput || output < baseOutput) return undefined;
	const cacheRead = scalePerM(e[`cache_read_input_token_cost${suffix}`]);
	const rawCacheWrite = scalePerM(e[`cache_creation_input_token_cost${suffix}`]);
	const cacheWrite =
		rawCacheWrite !== undefined && (baseCacheWrite === undefined || rawCacheWrite >= baseCacheWrite)
			? rawCacheWrite
			: undefined;
	const cacheWrite1h = scalePerM(e[`cache_creation_input_token_cost_above_1hr${suffix}`]);
	return {
		input,
		output,
		...(cacheRead !== undefined && { cacheRead }),
		...(cacheWrite !== undefined && { cacheWrite }),
		...(cacheWrite1h !== undefined && { cacheWrite1h }),
	};
}

async function fetchModelsDev(): Promise<Record<string, ModelRateCard> | undefined> {
	try {
		const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) return undefined;
		const body = (await res.json()) as Record<string, { models?: Record<string, { cost?: Record<string, unknown> }> }>;
		const rates: Record<string, ModelRateCard> = {};
		for (const [provKey, prov] of Object.entries(body)) {
			const provider = canonicalProvider(provKey);
			if (!provider || !prov?.models) continue;
			for (const [modelId, model] of Object.entries(prov.models)) {
				const cost = model?.cost;
				const input = numOrUndef(cost?.input);
				const output = numOrUndef(cost?.output);
				if (input === undefined || output === undefined) continue;
				const cacheRead = numOrUndef(cost?.cache_read);
				const cacheWrite = numOrUndef(cost?.cache_write);
				rates[`${provider}/${modelId}`] = {
					input,
					output,
					...(cacheRead !== undefined && { cacheRead }),
					...(cacheWrite !== undefined && { cacheWrite }),
				};
			}
		}
		return rates;
	} catch {
		return undefined;
	}
}

function numOrUndef(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function scalePerM(v: unknown): number | undefined {
	const n = numOrUndef(v);
	return n !== undefined ? n * 1e6 : undefined;
}
