/**
 * Claude's plan usage, read as Claude Code 2.1.325 reads it for `/usage`: `GET /api/oauth/usage` with the OAuth
 * beta header. Its `limits` rows are classified by `kind` (`session`, `weekly_all`, `weekly_scoped`), never by
 * label; the older `five_hour` / `seven_day*` fields fill in only a window the rows leave out.
 */

import { MAX_NAME_CHARS, MAX_USAGE_WINDOWS, type UsageSpan, type UsageWindow } from "../contract";
import { clip } from "../contract/clip";
import { type ClaudeLogin, claudeLogins } from "./claude-login";
import { epochMs, fetchJson, isRecord, percent } from "./fetch-json";
import { EXPIRY_MARGIN_MS, type PlanReading, type PlanSource } from "./plan-source";
import type { UsageSystem } from "./system";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage?skip_spend=1";
const OAUTH_BETA = "oauth-2025-04-20";
export const CLAUDE_EXPIRED =
	"Claude's sign-in on this Mac has expired. Run claude (or pi) there once and it renews itself.";

export function claudeSource(system: UsageSystem): PlanSource {
	return {
		plan: "claude",
		async read(): Promise<PlanReading | undefined> {
			const logins = await claudeLogins(system);
			if (logins.length === 0) return undefined;
			const tier = logins.find((login) => login.tier !== undefined)?.tier;
			const withTier = (reading: PlanReading): PlanReading => (tier === undefined ? reading : { ...reading, tier });
			const usable = usableLogins(logins, system.now());
			if (usable.length === 0) return withTier({ problem: CLAUDE_EXPIRED });
			let problem = CLAUDE_EXPIRED;
			for (const login of usable) {
				const answer = await fetchJson(system, "Claude", USAGE_URL, {
					headers: { authorization: `Bearer ${login.token}`, "anthropic-beta": OAUTH_BETA },
				});
				if (answer.ok) return withTier({ windows: claudeWindows(answer.body) });
				problem = answer.problem;
			}
			return withTier({ problem });
		},
	};
}

/** The sign-ins with time left, the one that lasts longest first; one that does not say when it ends goes last. */
function usableLogins(logins: readonly ClaudeLogin[], now: number): ClaudeLogin[] {
	return logins
		.filter((login) => login.expiresAt === undefined || login.expiresAt > now + EXPIRY_MARGIN_MS)
		.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0));
}

export function claudeWindows(body: unknown): UsageWindow[] {
	if (!isRecord(body)) return [];
	const rows = Array.isArray(body.limits) ? body.limits.flatMap(rowWindow) : [];
	const older = LEGACY_FIELDS.flatMap(([field, span, scope]) => legacyWindow(body[field], field, span, scope)).filter(
		(window) => !rows.some((row) => row.span === window.span && row.scope === window.scope),
	);
	return [...rows, ...older].slice(0, MAX_USAGE_WINDOWS);
}

function rowWindow(row: unknown): UsageWindow[] {
	if (!isRecord(row) || typeof row.percent !== "number") return [];
	const resetsAt = epochMs(row.resets_at);
	const base = { usedPercent: percent(row.percent), ...(resetsAt !== undefined && { resetsAt }) };
	switch (row.kind) {
		case "session":
			return [{ id: "session", span: "five_hour", ...base }];
		case "weekly_all":
			return [{ id: "weekly_all", span: "week", ...base }];
		case "weekly_scoped": {
			const scope = scopeName(row.scope);
			return scope ? [{ id: clip(`weekly_scoped:${scope}`, MAX_NAME_CHARS), span: "week", scope, ...base }] : [];
		}
		default:
			return [];
	}
}

/** What a scoped row covers, as the server labels it: a model ("Fable"), or a surface. */
function scopeName(scope: unknown): string | undefined {
	if (!isRecord(scope)) return undefined;
	for (const part of [scope.model, scope.surface]) {
		if (isRecord(part) && typeof part.display_name === "string" && part.display_name.trim()) {
			return clip(part.display_name.trim(), MAX_NAME_CHARS);
		}
	}
	return undefined;
}

const LEGACY_FIELDS: ReadonlyArray<readonly [string, UsageSpan, string | undefined]> = [
	["five_hour", "five_hour", undefined],
	["seven_day", "week", undefined],
	["seven_day_opus", "week", "Opus"],
	["seven_day_sonnet", "week", "Sonnet"],
];

function legacyWindow(value: unknown, id: string, span: UsageSpan, scope: string | undefined): UsageWindow[] {
	if (!isRecord(value) || typeof value.utilization !== "number") return [];
	const resetsAt = epochMs(value.resets_at);
	return [
		{
			id,
			span,
			...(scope !== undefined && { scope }),
			usedPercent: percent(value.utilization),
			...(resetsAt !== undefined && { resetsAt }),
		},
	];
}
