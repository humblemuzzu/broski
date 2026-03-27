/**
 * Subscription Usage Tracker
 *
 * Fetches subscription limits/credits for AI coding services:
 * - Claude (Anthropic) - via OAuth API or credentials file
 * - OpenAI/Codex - via OAuth API or auth.json
 *
 * Based on CodexBar's implementation for reliable fetching.
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

// ============================================================================
// TYPES
// ============================================================================

export type UsageWindow = {
	usedPercent: number; // 0-100
	resetsAt: number | null; // Unix timestamp (seconds)
	windowSeconds: number; // Window duration in seconds (e.g., 18000 for 5h)
};

export type ExtraUsage = {
	isEnabled: boolean;
	monthlyLimit: number | null; // In USD
	usedCredits: number | null; // Amount spent
	utilization: number | null; // 0-100 percent
	currency: string;
	resetsAt: number | null; // Unix timestamp
};

export type Credits = {
	hasCredits: boolean;
	unlimited: boolean;
	balance: number | null;
};

export type ProviderUsage = {
	providerId: "claude" | "openai";
	providerName: string;
	plan: string | null;
	// Plan usage limits (session/daily)
	sessionWindow: UsageWindow | null; // 5-hour window
	weeklyWindow: UsageWindow | null; // 7-day all models
	weeklyOpusWindow: UsageWindow | null; // 7-day Opus only
	weeklySonnetWindow: UsageWindow | null; // 7-day Sonnet only
	// Extra/credits
	extraUsage: ExtraUsage | null;
	credits: Credits | null;
	// Meta
	source: string; // 'oauth', 'file', 'api-key'
	fetchedAt: number; // Unix timestamp ms
	error: string | null;
};

export type SubscriptionUsage = {
	providers: ProviderUsage[];
	fetchedAt: number;
};

// ============================================================================
// CLAUDE OAUTH CREDENTIALS
// ============================================================================

type ClaudeOAuthCredentials = {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: Date | null;
	scopes: string[];
	rateLimitTier: string | null;
};

/**
 * Try to read Claude credentials from macOS Keychain.
 * Claude Code stores credentials in Keychain under service "Claude Code-credentials".
 */
function loadClaudeCredentialsFromKeychain(): ClaudeOAuthCredentials | null {
	// Only works on macOS
	if (process.platform !== "darwin") {
		return null;
	}

	try {
		// Get the current username for the account field
		const username = process.env.USER || basename(homedir()) || "";

		// Use security CLI to read from Keychain
		const result = execSync(
			`security find-generic-password -s "Claude Code-credentials" -a "${username}" -w 2>/dev/null`,
			{ encoding: "utf-8", timeout: 5000 },
		).trim();

		if (!result) {
			console.log("[Subscription] Claude Keychain entry is empty");
			return null;
		}

		const json = JSON.parse(result);
		const oauth = json.claudeAiOauth;

		if (!oauth) {
			console.log("[Subscription] Claude Keychain missing claudeAiOauth");
			return null;
		}

		const accessToken = oauth.accessToken?.trim();
		if (!accessToken) {
			console.log("[Subscription] Claude Keychain missing access token");
			return null;
		}

		const expiresAt = oauth.expiresAt ? new Date(oauth.expiresAt) : null;

		console.log("[Subscription] Claude credentials loaded from macOS Keychain");

		return {
			accessToken,
			refreshToken: oauth.refreshToken ?? null,
			expiresAt,
			scopes: oauth.scopes ?? [],
			rateLimitTier: oauth.rateLimitTier ?? null,
		};
	} catch (error) {
		// Keychain access failed - this is normal if not on macOS or not logged in
		console.log("[Subscription] Claude Keychain access failed:", (error as Error).message);
		return null;
	}
}

/**
 * Try to read Claude credentials from file (fallback for non-macOS or older versions).
 */
async function loadClaudeCredentialsFromFile(): Promise<ClaudeOAuthCredentials | null> {
	const credentialsPath = resolve(homedir(), ".claude", ".credentials.json");

	try {
		const content = await readFile(credentialsPath, "utf-8");
		const json = JSON.parse(content);

		const oauth = json.claudeAiOauth;
		if (!oauth) {
			console.log("[Subscription] Claude credentials file missing claudeAiOauth");
			return null;
		}

		const accessToken = oauth.accessToken?.trim();
		if (!accessToken) {
			console.log("[Subscription] Claude credentials file missing access token");
			return null;
		}

		const expiresAt = oauth.expiresAt ? new Date(oauth.expiresAt) : null;

		console.log("[Subscription] Claude credentials loaded from file");

		return {
			accessToken,
			refreshToken: oauth.refreshToken ?? null,
			expiresAt,
			scopes: oauth.scopes ?? [],
			rateLimitTier: oauth.rateLimitTier ?? null,
		};
	} catch (_error) {
		// File not found is normal
		return null;
	}
}

async function loadClaudeCredentials(): Promise<ClaudeOAuthCredentials | null> {
	// Try macOS Keychain first (primary storage for Claude Code)
	const keychainCreds = loadClaudeCredentialsFromKeychain();
	if (keychainCreds) {
		return keychainCreds;
	}

	// Fall back to file-based credentials
	const fileCreds = await loadClaudeCredentialsFromFile();
	if (fileCreds) {
		return fileCreds;
	}

	console.log("[Subscription] Claude credentials not found in Keychain or file");
	return null;
}

// ============================================================================
// CLAUDE USAGE API
// ============================================================================

type ClaudeOAuthUsageResponse = {
	five_hour?: { utilization?: number; resets_at?: string };
	seven_day?: { utilization?: number; resets_at?: string };
	seven_day_oauth_apps?: { utilization?: number; resets_at?: string };
	seven_day_opus?: { utilization?: number; resets_at?: string };
	seven_day_sonnet?: { utilization?: number; resets_at?: string };
	iguana_necktie?: { utilization?: number; resets_at?: string };
	extra_usage?: {
		is_enabled?: boolean;
		monthly_limit?: number;
		used_credits?: number;
		utilization?: number;
		currency?: string;
	};
};

async function fetchClaudeUsage(accessToken: string): Promise<ClaudeOAuthUsageResponse> {
	const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
			"Content-Type": "application/json",
			"anthropic-beta": "oauth-2025-04-20",
			"User-Agent": "Broski",
		},
		signal: AbortSignal.timeout(30000),
	});

	if (response.status === 401 || response.status === 403) {
		throw new Error("Claude OAuth token expired. Run `claude login` to re-authenticate.");
	}

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Claude API error ${response.status}: ${body}`);
	}

	return await response.json();
}

function parseISO8601(str: string | undefined): number | null {
	if (!str) return null;
	const date = new Date(str);
	return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function mapClaudeUsage(response: ClaudeOAuthUsageResponse, creds: ClaudeOAuthCredentials): ProviderUsage {
	// Session window (5-hour)
	// Note: Claude API returns utilization as 0-100 directly (not 0-1)
	const sessionWindow: UsageWindow | null = response.five_hour
		? {
				usedPercent: response.five_hour.utilization ?? 0,
				resetsAt: parseISO8601(response.five_hour.resets_at),
				windowSeconds: 5 * 60 * 60, // 5 hours
			}
		: null;

	// Weekly window (all models)
	const weeklyWindow: UsageWindow | null = response.seven_day
		? {
				usedPercent: response.seven_day.utilization ?? 0,
				resetsAt: parseISO8601(response.seven_day.resets_at),
				windowSeconds: 7 * 24 * 60 * 60, // 7 days
			}
		: null;

	// Weekly Opus window
	const weeklyOpusWindow: UsageWindow | null = response.seven_day_opus
		? {
				usedPercent: response.seven_day_opus.utilization ?? 0,
				resetsAt: parseISO8601(response.seven_day_opus.resets_at),
				windowSeconds: 7 * 24 * 60 * 60,
			}
		: null;

	// Weekly Sonnet window
	const weeklySonnetWindow: UsageWindow | null = response.seven_day_sonnet
		? {
				usedPercent: response.seven_day_sonnet.utilization ?? 0,
				resetsAt: parseISO8601(response.seven_day_sonnet.resets_at),
				windowSeconds: 7 * 24 * 60 * 60,
			}
		: null;

	// Extra usage (overage credits)
	const extraUsage: ExtraUsage | null = response.extra_usage
		? {
				isEnabled: response.extra_usage.is_enabled ?? false,
				monthlyLimit: response.extra_usage.monthly_limit ?? null,
				usedCredits: response.extra_usage.used_credits ?? null,
				utilization: response.extra_usage.utilization ?? null, // Already 0-100
				currency: response.extra_usage.currency ?? "USD",
				resetsAt: null, // Claude doesn't provide this directly
			}
		: null;

	// Infer plan from rate_limit_tier
	let plan: string | null = null;
	if (creds.rateLimitTier) {
		const tier = creds.rateLimitTier.toLowerCase();
		if (tier.includes("max")) plan = "Max";
		else if (tier.includes("pro")) plan = "Pro";
		else if (tier.includes("team")) plan = "Team";
		else if (tier.includes("enterprise")) plan = "Enterprise";
		else plan = creds.rateLimitTier;
	}

	return {
		providerId: "claude",
		providerName: "Claude",
		plan,
		sessionWindow,
		weeklyWindow,
		weeklyOpusWindow,
		weeklySonnetWindow,
		extraUsage,
		credits: null, // Claude uses extra_usage instead of credits
		source: "oauth",
		fetchedAt: Date.now(),
		error: null,
	};
}

async function getClaudeUsage(): Promise<ProviderUsage> {
	try {
		const creds = await loadClaudeCredentials();
		if (!creds) {
			return {
				providerId: "claude",
				providerName: "Claude",
				plan: null,
				sessionWindow: null,
				weeklyWindow: null,
				weeklyOpusWindow: null,
				weeklySonnetWindow: null,
				extraUsage: null,
				credits: null,
				source: "none",
				fetchedAt: Date.now(),
				error: "Not configured. Run `claude login` to authenticate.",
			};
		}

		// Check if token is expired
		if (creds.expiresAt && creds.expiresAt < new Date()) {
			return {
				providerId: "claude",
				providerName: "Claude",
				plan: null,
				sessionWindow: null,
				weeklyWindow: null,
				weeklyOpusWindow: null,
				weeklySonnetWindow: null,
				extraUsage: null,
				credits: null,
				source: "oauth",
				fetchedAt: Date.now(),
				error: "OAuth token expired. Run `claude login` to re-authenticate.",
			};
		}

		const response = await fetchClaudeUsage(creds.accessToken);
		return mapClaudeUsage(response, creds);
	} catch (error) {
		return {
			providerId: "claude",
			providerName: "Claude",
			plan: null,
			sessionWindow: null,
			weeklyWindow: null,
			weeklyOpusWindow: null,
			weeklySonnetWindow: null,
			extraUsage: null,
			credits: null,
			source: "oauth",
			fetchedAt: Date.now(),
			error: (error as Error).message,
		};
	}
}

// ============================================================================
// OPENAI/CODEX OAUTH CREDENTIALS
// ============================================================================

type CodexOAuthCredentials = {
	accessToken: string;
	refreshToken: string;
	accountId: string | null;
	lastRefresh: Date | null;
	isApiKey: boolean;
};

async function loadCodexCredentials(): Promise<CodexOAuthCredentials | null> {
	const codexHome = process.env.CODEX_HOME?.trim();
	const authPath = codexHome ? resolve(codexHome, "auth.json") : resolve(homedir(), ".codex", "auth.json");

	try {
		const content = await readFile(authPath, "utf-8");
		const json = JSON.parse(content);

		// Check for API key auth
		const apiKey = json.OPENAI_API_KEY?.trim();
		if (apiKey) {
			return {
				accessToken: apiKey,
				refreshToken: "",
				accountId: null,
				lastRefresh: null,
				isApiKey: true,
			};
		}

		// OAuth tokens
		const tokens = json.tokens;
		if (!tokens) {
			console.log("[Subscription] Codex auth.json missing tokens");
			return null;
		}

		const accessToken = tokens.access_token?.trim();
		const refreshToken = tokens.refresh_token?.trim();

		if (!accessToken) {
			console.log("[Subscription] Codex tokens missing access_token");
			return null;
		}

		let lastRefresh: Date | null = null;
		if (json.last_refresh) {
			lastRefresh = new Date(json.last_refresh);
			if (Number.isNaN(lastRefresh.getTime())) lastRefresh = null;
		}

		return {
			accessToken,
			refreshToken: refreshToken ?? "",
			accountId: tokens.account_id ?? null,
			lastRefresh,
			isApiKey: false,
		};
	} catch (error) {
		console.log("[Subscription] Codex credentials not found:", (error as Error).message);
		return null;
	}
}

// ============================================================================
// OPENAI/CODEX USAGE API
// ============================================================================

type CodexUsageResponse = {
	plan_type?: string;
	rate_limit?: {
		primary_window?: {
			used_percent: number;
			reset_at: number;
			limit_window_seconds: number;
		};
		secondary_window?: {
			used_percent: number;
			reset_at: number;
			limit_window_seconds: number;
		};
	};
	credits?: {
		has_credits: boolean;
		unlimited: boolean;
		balance?: number | string;
	};
};

async function fetchCodexUsage(accessToken: string, accountId: string | null): Promise<CodexUsageResponse> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/json",
		"User-Agent": "Broski",
	};

	if (accountId) {
		headers["ChatGPT-Account-Id"] = accountId;
	}

	const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
		method: "GET",
		headers,
		signal: AbortSignal.timeout(30000),
	});

	if (response.status === 401 || response.status === 403) {
		throw new Error("Codex OAuth token expired. Run `codex` to re-authenticate.");
	}

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Codex API error ${response.status}: ${body}`);
	}

	return await response.json();
}

function mapCodexUsage(response: CodexUsageResponse, isApiKey: boolean): ProviderUsage {
	// Session window (primary - typically 5 hours)
	const sessionWindow: UsageWindow | null = response.rate_limit?.primary_window
		? {
				usedPercent: response.rate_limit.primary_window.used_percent,
				resetsAt: response.rate_limit.primary_window.reset_at,
				windowSeconds: response.rate_limit.primary_window.limit_window_seconds,
			}
		: null;

	// Weekly window (secondary - typically 7 days)
	const weeklyWindow: UsageWindow | null = response.rate_limit?.secondary_window
		? {
				usedPercent: response.rate_limit.secondary_window.used_percent,
				resetsAt: response.rate_limit.secondary_window.reset_at,
				windowSeconds: response.rate_limit.secondary_window.limit_window_seconds,
			}
		: null;

	// Credits
	const credits: Credits | null = response.credits
		? {
				hasCredits: response.credits.has_credits,
				unlimited: response.credits.unlimited,
				balance:
					typeof response.credits.balance === "number"
						? response.credits.balance
						: typeof response.credits.balance === "string"
							? parseFloat(response.credits.balance)
							: null,
			}
		: null;

	// Plan type mapping
	let plan: string | null = null;
	if (response.plan_type) {
		const planType = response.plan_type.toLowerCase();
		if (planType === "pro") plan = "Pro";
		else if (planType === "plus") plan = "Plus";
		else if (planType === "team") plan = "Team";
		else if (planType === "enterprise") plan = "Enterprise";
		else if (planType === "free") plan = "Free";
		else plan = response.plan_type;
	}

	return {
		providerId: "openai",
		providerName: "OpenAI / Codex",
		plan,
		sessionWindow,
		weeklyWindow,
		weeklyOpusWindow: null,
		weeklySonnetWindow: null,
		extraUsage: null,
		credits,
		source: isApiKey ? "api-key" : "oauth",
		fetchedAt: Date.now(),
		error: null,
	};
}

async function getCodexUsage(): Promise<ProviderUsage> {
	try {
		const creds = await loadCodexCredentials();
		if (!creds) {
			return {
				providerId: "openai",
				providerName: "OpenAI / Codex",
				plan: null,
				sessionWindow: null,
				weeklyWindow: null,
				weeklyOpusWindow: null,
				weeklySonnetWindow: null,
				extraUsage: null,
				credits: null,
				source: "none",
				fetchedAt: Date.now(),
				error: "Not configured. Run `codex` to authenticate or set OPENAI_API_KEY.",
			};
		}

		// Check if token needs refresh (8+ days old)
		if (creds.lastRefresh && !creds.isApiKey) {
			const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
			if (creds.lastRefresh < eightDaysAgo) {
				console.log("[Subscription] Codex token may need refresh (>8 days old)");
				// Note: We don't automatically refresh - let the CLI handle that
			}
		}

		// For API key auth, we can't fetch usage via OAuth endpoint
		if (creds.isApiKey) {
			return {
				providerId: "openai",
				providerName: "OpenAI / Codex",
				plan: null,
				sessionWindow: null,
				weeklyWindow: null,
				weeklyOpusWindow: null,
				weeklySonnetWindow: null,
				extraUsage: null,
				credits: null,
				source: "api-key",
				fetchedAt: Date.now(),
				error: "Using API key auth. OAuth required for usage tracking.",
			};
		}

		const response = await fetchCodexUsage(creds.accessToken, creds.accountId);
		return mapCodexUsage(response, creds.isApiKey);
	} catch (error) {
		return {
			providerId: "openai",
			providerName: "OpenAI / Codex",
			plan: null,
			sessionWindow: null,
			weeklyWindow: null,
			weeklyOpusWindow: null,
			weeklySonnetWindow: null,
			extraUsage: null,
			credits: null,
			source: "oauth",
			fetchedAt: Date.now(),
			error: (error as Error).message,
		};
	}
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Fetch usage for all configured providers.
 * This is designed to be called on-demand (not polled).
 */
export async function getSubscriptionUsage(): Promise<SubscriptionUsage> {
	console.log("[Subscription] Fetching usage for all providers...");

	// Fetch all providers in parallel
	const [claudeUsage, codexUsage] = await Promise.all([getClaudeUsage(), getCodexUsage()]);

	const providers = [claudeUsage, codexUsage];

	console.log(`[Subscription] Fetched ${providers.length} providers`);

	return {
		providers,
		fetchedAt: Date.now(),
	};
}

/**
 * Fetch usage for a specific provider.
 */
export async function getProviderUsage(providerId: "claude" | "openai"): Promise<ProviderUsage> {
	switch (providerId) {
		case "claude":
			return getClaudeUsage();
		case "openai":
			return getCodexUsage();
		default:
			throw new Error(`Unknown provider: ${providerId}`);
	}
}
