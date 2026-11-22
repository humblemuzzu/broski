/**
 * Antigravity's plan usage, read as agy 1.5.11 reads it: `loadCodeAssist` names the account's project and tier,
 * then `retrieveUserQuotaSummary` answers groups of models, each with a weekly and a five-hour bucket.
 */

import { MAX_NAME_CHARS, MAX_USAGE_WINDOWS, type UsageSpan, type UsageWindow } from "../contract";
import { clip } from "../contract/clip";
import { AntigravityLogin } from "./antigravity-login";
import { epochMs, fetchJson, isRecord, percent } from "./fetch-json";
import type { PlanReading, PlanSource } from "./plan-source";
import type { UsageSystem } from "./system";

const BASE_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";
/** What agy asks for when `loadCodeAssist` names no project. */
const CONSUMER_PROJECT = "aicode-consumers";

interface Account {
	readonly project: string;
	readonly tier?: string;
}

export function antigravitySource(system: UsageSystem): PlanSource {
	const login = new AntigravityLogin(system);
	let account: Account | undefined;
	return {
		plan: "antigravity",
		displayName: "Antigravity",
		async read(): Promise<PlanReading | undefined> {
			const access = await login.accessToken();
			if (access === undefined) return undefined;
			if ("problem" in access) return { problem: access.problem, ...(account?.tier ? { tier: account.tier } : {}) };
			const headers = {
				authorization: `Bearer ${access.token}`,
				"content-type": "application/json",
				"user-agent": await login.userAgent(),
			};
			account ??= await loadAccount(system, headers);
			const tier = account?.tier ? { tier: account.tier } : {};
			const quota = await fetchJson(system, "Antigravity", `${BASE_URL}:retrieveUserQuotaSummary`, {
				method: "POST",
				headers,
				body: JSON.stringify({ project: account?.project ?? CONSUMER_PROJECT }),
			});
			if (quota.ok) return { windows: antigravityWindows(quota.body), ...tier };
			login.forget();
			return { problem: quota.problem, ...tier };
		},
	};
}

/** Undefined when the service did not say, so the next read asks again. */
async function loadAccount(system: UsageSystem, headers: Record<string, string>): Promise<Account | undefined> {
	const answer = await fetchJson(system, "Antigravity", `${BASE_URL}:loadCodeAssist`, {
		method: "POST",
		headers,
		body: "{}",
	});
	if (!answer.ok || !isRecord(answer.body)) return undefined;
	const { cloudaicompanionProject: project, paidTier, currentTier } = answer.body;
	const tier = [paidTier, currentTier]
		.map((value) => (isRecord(value) && typeof value.name === "string" ? value.name.trim() : ""))
		.find(Boolean);
	return {
		project: typeof project === "string" && project ? project : CONSUMER_PROJECT,
		...(tier ? { tier: clip(tier, MAX_NAME_CHARS) } : {}),
	};
}

export function antigravityWindows(body: unknown): UsageWindow[] {
	const groups = isRecord(body) && Array.isArray(body.groups) ? body.groups : [];
	return groups.flatMap(groupWindows).slice(0, MAX_USAGE_WINDOWS);
}

function groupWindows(group: unknown): UsageWindow[] {
	if (!isRecord(group) || !Array.isArray(group.buckets)) return [];
	const scope = groupName(group.displayName);
	return group.buckets.flatMap((bucket) => {
		if (!isRecord(bucket)) return [];
		const span = spanOf(bucket.window);
		if (!span) return [];
		const id = typeof bucket.bucketId === "string" && bucket.bucketId ? bucket.bucketId : `${scope ?? "plan"}-${span}`;
		// Protobuf's JSON leaves out a zero, so a bucket without `remainingFraction` has nothing left.
		const remaining = typeof bucket.remainingFraction === "number" ? bucket.remainingFraction : 0;
		const resetsAt = epochMs(bucket.resetTime);
		return [
			{
				id: clip(id, MAX_NAME_CHARS),
				span,
				...(scope !== undefined && { scope }),
				usedPercent: percent((1 - remaining) * 100),
				...(resetsAt !== undefined && { resetsAt }),
			},
		];
	});
}

function spanOf(window: unknown): UsageSpan | undefined {
	if (window === "5h") return "five_hour";
	if (window === "weekly") return "week";
	return undefined;
}

/** "Gemini Models" reads "Gemini": the window already says it covers models. */
function groupName(name: unknown): string | undefined {
	if (typeof name !== "string") return undefined;
	const short = name.trim().replace(/\s+models$/i, "");
	return short ? clip(short, MAX_NAME_CHARS) : undefined;
}
