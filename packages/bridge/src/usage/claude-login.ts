/**
 * The Claude sign-ins on this machine: Claude Code's own (macOS keeps it in the login keychain as
 * `Claude Code-credentials`, elsewhere `~/.claude/.credentials.json`) and Pi's (`anthropic` in Pi's `auth.json`).
 * They are read only; the agent that owns a sign-in renews it, so nothing here ever writes one back.
 */

import { join } from "node:path";
import { isRecord } from "./fetch-json";
import { keychainSecret, readJson, type UsageSystem } from "./system";

export interface ClaudeLogin {
	readonly token: string;
	/** Epoch milliseconds; undefined when the store does not say. */
	readonly expiresAt: number | undefined;
	readonly tier?: string;
}

const KEYCHAIN_SERVICE = "Claude Code-credentials";
/** The usage endpoint answers only a token with this scope (Claude Code 2.1.325 checks it before asking). */
const PROFILE_SCOPE = "user:profile";

export async function claudeLogins(system: UsageSystem): Promise<ClaudeLogin[]> {
	const [claudeCode, pi] = await Promise.all([claudeCodeLogin(system), piLogin(system)]);
	return [claudeCode, pi].filter((login): login is ClaudeLogin => login !== undefined);
}

async function claudeCodeLogin(system: UsageSystem): Promise<ClaudeLogin | undefined> {
	const stored = await keychainSecret(system, KEYCHAIN_SERVICE);
	const value = stored === undefined ? await readJson(system, credentialsFile(system)) : parsed(stored);
	const oauth = isRecord(value) ? value.claudeAiOauth : undefined;
	if (!isRecord(oauth) || typeof oauth.accessToken !== "string" || !oauth.accessToken) return undefined;
	if (Array.isArray(oauth.scopes) && !oauth.scopes.includes(PROFILE_SCOPE)) return undefined;
	const tier = tierName(oauth.subscriptionType, oauth.rateLimitTier);
	return {
		token: oauth.accessToken,
		expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
		...(tier !== undefined && { tier }),
	};
}

async function piLogin(system: UsageSystem): Promise<ClaudeLogin | undefined> {
	const auth = await readJson(system, join(system.piAgentDir, "auth.json"));
	const entry = isRecord(auth) ? auth.anthropic : undefined;
	if (!isRecord(entry) || entry.type !== "oauth" || typeof entry.access !== "string" || !entry.access) return undefined;
	return { token: entry.access, expiresAt: typeof entry.expires === "number" ? entry.expires : undefined };
}

function credentialsFile(system: UsageSystem): string {
	return join(system.claudeDir, ".credentials.json");
}

function parsed(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** "Max 5x" from Claude Code's `rateLimitTier` (`default_claude_max_5x`), else its `subscriptionType` ("Pro"). */
export function tierName(subscription: unknown, rateLimitTier: unknown): string | undefined {
	const multiple = typeof rateLimitTier === "string" ? /max_(\d+)x/.exec(rateLimitTier)?.[1] : undefined;
	if (multiple) return `Max ${multiple}x`;
	if (typeof subscription !== "string" || !subscription) return undefined;
	return subscription.charAt(0).toUpperCase() + subscription.slice(1);
}
