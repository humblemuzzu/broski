export interface ModelRateCard {
	/** USD per 1M tokens. */
	readonly input: number;
	readonly output: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly cacheWrite1h?: number;
	readonly above200k?: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead?: number;
		readonly cacheWrite?: number;
		readonly cacheWrite1h?: number;
	};
	readonly above272k?: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead?: number;
		readonly cacheWrite?: number;
	};
	readonly fastMultiplier?: number;
	readonly ultrafastMultiplier?: number;
	readonly flexMultiplier?: number;
}

export interface VendorCacheDefaults {
	readonly write5m: number;
	readonly write1h: number;
	readonly read: number;
}

export const VENDOR_CACHE_DEFAULTS: Readonly<Record<string, VendorCacheDefaults>> = {
	anthropic: { write5m: 1.25, write1h: 2.0, read: 0.1 },
	openai: { write5m: 1.0, write1h: 1.0, read: 0.1 },
	google: { write5m: 1.0, write1h: 1.0, read: 0.1 },
	xai: { write5m: 1.0, write1h: 1.0, read: 0.25 },
	deepseek: { write5m: 1.0, write1h: 1.0, read: 0.25 },
	moonshotai: { write5m: 1.0, write1h: 1.0, read: 0.25 },
	zai: { write5m: 1.0, write1h: 1.0, read: 0.2 },
	minimax: { write5m: 1.25, write1h: 2.0, read: 0.1 },
	mistral: { write5m: 1.0, write1h: 1.0, read: 0.1 },
	qwen: { write5m: 1.0, write1h: 1.0, read: 0.1 },
};

const CLAUDE_LONG_OPUS = { input: 10, output: 37.5, cacheRead: 1.0, cacheWrite: 12.5, cacheWrite1h: 20 };
const CLAUDE_LONG_SONNET = { input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5, cacheWrite1h: 12 };

/**
 * Bundled baseline rates (USD per 1M tokens) so offline and cold startups price accurately
 * before any remote catalog refresh completes. Live LiteLLM / models.dev refreshes override
 * these automatically when fetched.
 */
export const SEED_RATES: Readonly<Record<string, ModelRateCard>> = {
	// Anthropic
	"anthropic/claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, cacheWrite1h: 30 },
	"anthropic/claude-opus-4-1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, cacheWrite1h: 30 },
	"anthropic/claude-opus-4-5": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
		cacheWrite1h: 10,
		above200k: CLAUDE_LONG_OPUS,
		fastMultiplier: 6,
	},
	"anthropic/claude-opus-4-6": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
		cacheWrite1h: 10,
		above200k: CLAUDE_LONG_OPUS,
		fastMultiplier: 6,
	},
	"anthropic/claude-opus-4-7": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
		cacheWrite1h: 10,
		above200k: CLAUDE_LONG_OPUS,
		fastMultiplier: 6,
	},
	"anthropic/claude-opus-4-8": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
		cacheWrite1h: 10,
		above200k: CLAUDE_LONG_OPUS,
		fastMultiplier: 6,
	},
	"anthropic/claude-opus-5": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
		cacheWrite1h: 10,
		above200k: CLAUDE_LONG_OPUS,
		fastMultiplier: 6,
	},
	"anthropic/claude-opus-5-5": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
		cacheWrite1h: 10,
		above200k: CLAUDE_LONG_OPUS,
		fastMultiplier: 6,
	},
	"anthropic/claude-fable-5": {
		input: 10,
		output: 50,
		cacheRead: 1.0,
		cacheWrite: 12.5,
		cacheWrite1h: 20,
		above200k: { input: 20, output: 75, cacheRead: 2.0, cacheWrite: 25, cacheWrite1h: 40 },
		fastMultiplier: 6,
	},
	"anthropic/claude-fable-5-1": {
		input: 10,
		output: 50,
		cacheRead: 1.0,
		cacheWrite: 12.5,
		cacheWrite1h: 20,
		above200k: { input: 20, output: 75, cacheRead: 2.0, cacheWrite: 25, cacheWrite1h: 40 },
		fastMultiplier: 6,
	},
	"anthropic/claude-fable-5-2": {
		input: 10,
		output: 50,
		cacheRead: 1.0,
		cacheWrite: 12.5,
		cacheWrite1h: 20,
		above200k: { input: 20, output: 75, cacheRead: 2.0, cacheWrite: 25, cacheWrite1h: 40 },
		fastMultiplier: 6,
	},
	"anthropic/claude-sonnet-4": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
		cacheWrite1h: 6,
		above200k: CLAUDE_LONG_SONNET,
	},
	"anthropic/claude-sonnet-4-5": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
		cacheWrite1h: 6,
		above200k: CLAUDE_LONG_SONNET,
	},
	"anthropic/claude-sonnet-4-6": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
		cacheWrite1h: 6,
		above200k: CLAUDE_LONG_SONNET,
	},
	"anthropic/claude-sonnet-5-5": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
		cacheWrite1h: 6,
		above200k: CLAUDE_LONG_SONNET,
	},
	"anthropic/claude-3-7-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
	"anthropic/claude-3-5-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
	"anthropic/claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
	"anthropic/claude-haiku-5-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
	"anthropic/claude-3-5-haiku": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1.0, cacheWrite1h: 1.6 },

	// OpenAI / Codex
	"openai/gpt-5": {
		input: 1.25,
		output: 10,
		cacheRead: 0.125,
		above272k: { input: 2.5, output: 20, cacheRead: 0.25 },
		fastMultiplier: 2,
		flexMultiplier: 0.5,
	},
	"openai/gpt-5-codex": {
		input: 1.25,
		output: 10,
		cacheRead: 0.125,
		above272k: { input: 2.5, output: 20, cacheRead: 0.25 },
		fastMultiplier: 2,
	},
	"openai/gpt-5.1": {
		input: 1.25,
		output: 10,
		cacheRead: 0.125,
		above272k: { input: 2.5, output: 20, cacheRead: 0.25 },
		fastMultiplier: 2,
	},
	"openai/gpt-5.2": {
		input: 1.75,
		output: 14,
		cacheRead: 0.175,
		above272k: { input: 3.5, output: 28, cacheRead: 0.35 },
		fastMultiplier: 2,
	},
	"openai/gpt-5.3-codex": {
		input: 1.75,
		output: 14,
		cacheRead: 0.175,
		above272k: { input: 3.5, output: 28, cacheRead: 0.35 },
		fastMultiplier: 2,
	},
	"openai/gpt-5.4": {
		input: 2.5,
		output: 15,
		cacheRead: 0.25,
		above272k: { input: 5, output: 22.5, cacheRead: 0.5 },
		fastMultiplier: 2,
	},
	"openai/gpt-5.5": {
		input: 2.5,
		output: 15,
		cacheRead: 0.25,
		above272k: { input: 5, output: 22.5, cacheRead: 0.5 },
		fastMultiplier: 2,
	},
	"openai/gpt-6-astra": {
		input: 2.5,
		output: 15,
		cacheRead: 0.25,
		above272k: { input: 5, output: 22.5, cacheRead: 0.5 },
		fastMultiplier: 2,
	},
	"openai/gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025, fastMultiplier: 2 },
	"openai/gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005 },
	"openai/codex-auto-review": { input: 1.75, output: 14, cacheRead: 0.175 },
	"openai/gpt-6.1": {
		input: 2.5,
		output: 15,
		cacheRead: 0.25,
		above272k: { input: 5, output: 22.5, cacheRead: 0.5 },
		fastMultiplier: 2,
	},
	"openai/gpt-6.1-sol": {
		input: 2.5,
		output: 15,
		cacheRead: 0.25,
		above272k: { input: 5, output: 22.5, cacheRead: 0.5 },
		fastMultiplier: 2,
	},
	"openai/gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
	"openai/gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
	"openai/gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
	"openai/o3": { input: 2, output: 8, cacheRead: 0.5 },
	"openai/o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },
	"openai/codex-mini-latest": { input: 1.5, output: 6, cacheRead: 0.375 },

	// Google / Gemini / Antigravity
	"google/gemini-2.5-pro": {
		input: 1.25,
		output: 10,
		cacheRead: 0.125,
		above200k: { input: 2.5, output: 15, cacheRead: 0.25 },
	},
	"google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03 },
	"google/gemini-3-pro-preview": {
		input: 2,
		output: 12,
		cacheRead: 0.2,
		above200k: { input: 4, output: 18, cacheRead: 0.4 },
	},
	"google/gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05 },
	"google/gemini-3.8-flash": { input: 0.5, output: 3, cacheRead: 0.05 },
	"google/gemini-4-neon": {
		input: 2,
		output: 12,
		cacheRead: 0.2,
		above200k: { input: 4, output: 18, cacheRead: 0.4 },
	},
	"google/gemini-4-carbon": {
		input: 1.25,
		output: 10,
		cacheRead: 0.125,
		above200k: { input: 2.5, output: 15, cacheRead: 0.25 },
	},
	"google/gemini-4-argon": { input: 0.5, output: 3, cacheRead: 0.05 },
	"google/gemini-4-hydrogen": {
		input: 2,
		output: 12,
		cacheRead: 0.2,
		above200k: { input: 4, output: 18, cacheRead: 0.4 },
	},

	// xAI / Grok
	"xai/grok-4": { input: 3, output: 15, cacheRead: 0.75 },
	"xai/grok-4-fast": { input: 0.2, output: 0.5, cacheRead: 0.05 },
	"xai/grok-4.5": { input: 3, output: 15, cacheRead: 0.75 },
	"xai/grok-4.6": { input: 3, output: 15, cacheRead: 0.75 },
	"xai/grok-4.6-build": { input: 3, output: 15, cacheRead: 0.75 },
	"xai/grok-code": { input: 0.2, output: 1.5, cacheRead: 0.02 },
	"xai/grok-code-fast-1": { input: 0.2, output: 1.5, cacheRead: 0.02 },

	// DeepSeek
	"deepseek/deepseek-chat": { input: 0.28, output: 0.42, cacheRead: 0.028 },
	"deepseek/deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14 },
	"deepseek/deepseek-flash": { input: 0.28, output: 0.42, cacheRead: 0.028 },
	"deepseek/deepseek-v4-pro": { input: 0.55, output: 2.19, cacheRead: 0.14 },

	// Others
	"moonshotai/kimi-k2": { input: 0.6, output: 2.5, cacheRead: 0.15 },
	"moonshotai/kimi-k2.5": { input: 0.6, output: 3.0, cacheRead: 0.1 },
	"moonshotai/k2p5": { input: 0.6, output: 3.0, cacheRead: 0.1 },
	"moonshotai/k2p6": { input: 0.6, output: 3.0, cacheRead: 0.1 },
	"moonshotai/kimi-for-coding": { input: 0.6, output: 3.0, cacheRead: 0.1 },
	"zai/glm-4.7": { input: 0.6, output: 2.2, cacheRead: 0.11 },
	"zai/glm-5.3-flash": { input: 0.2, output: 0.8, cacheRead: 0.04 },
	"minimax/minimax-m2.5": { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
};
