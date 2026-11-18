import type { UsageSystem } from "./system";

export const REQUEST_TIMEOUT_MS = 15_000;

export type JsonAnswer =
	| { readonly ok: true; readonly body: unknown }
	| { readonly ok: false; readonly problem: string };

/** One HTTP exchange whose answer is JSON; a failure is a short sentence naming `service`, never a throw. */
export async function fetchJson(
	system: UsageSystem,
	service: string,
	url: string,
	init: RequestInit,
): Promise<JsonAnswer> {
	let response: Response;
	let text: string;
	try {
		response = await system.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		text = await response.text();
	} catch (error) {
		const reason =
			error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
		return { ok: false, problem: `${service} ${reason}.` };
	}
	if (!response.ok)
		return { ok: false, problem: `${service} answered ${response.status}${statusHint(response.status)}.` };
	try {
		return { ok: true, body: text ? (JSON.parse(text) as unknown) : {} };
	} catch {
		return { ok: false, problem: `${service} answered something that is not JSON.` };
	}
}

function statusHint(status: number): string {
	if (status === 401 || status === 403) return ": the sign-in on this Mac was refused";
	if (status === 429) return ": asked too often, try again in a minute";
	return "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An ISO 8601 time as epoch milliseconds; undefined for anything else. */
export function epochMs(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const at = Date.parse(value);
	return Number.isNaN(at) ? undefined : at;
}

export function percent(value: number): number {
	return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
