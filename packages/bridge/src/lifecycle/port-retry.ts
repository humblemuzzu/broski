export type PortRetryInfo = {
	attempt: number;
	delayMs: number;
	elapsedMs: number;
	error: unknown;
};

export type PortRetryOptions = {
	mode?: "daemon" | "once";
	initialDelayMs?: number;
	maxDelayMs?: number;
	/** Backoff window. Past it the delay stays at maxDelayMs and only occasional lines are reported. */
	budgetMs?: number;
	/** Report attempt 1..N individually, then one line every N attempts. */
	reportEvery?: number;
	initialReportCount?: number;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	isRetryable?: (error: unknown) => boolean;
	onRetry?: (info: PortRetryInfo) => void;
};

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const BUDGET_MS = 5 * 60 * 1000;
const REPORT_EVERY = 20;
const INITIAL_REPORTS = 5;

export function isAddressInUse(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	return (error as { code?: unknown }).code === "EADDRINUSE";
}

export function isReportableAttempt(attempt: number, options?: PortRetryOptions): boolean {
	const every = options?.reportEvery ?? REPORT_EVERY;
	const initial = options?.initialReportCount ?? INITIAL_REPORTS;
	if (attempt <= initial) return true;
	return attempt % every === 0;
}

export async function bindWithRetry<T>(bind: () => Promise<T>, options?: PortRetryOptions): Promise<T> {
	const mode = options?.mode ?? "once";
	const initialDelayMs = options?.initialDelayMs ?? INITIAL_DELAY_MS;
	const maxDelayMs = options?.maxDelayMs ?? MAX_DELAY_MS;
	const budgetMs = options?.budgetMs ?? BUDGET_MS;
	const sleep = options?.sleep ?? ((ms: number) => Bun.sleep(ms));
	const now = options?.now ?? Date.now;
	const isRetryable = options?.isRetryable ?? isAddressInUse;

	const startedAt = now();
	let attempt = 0;

	for (;;) {
		attempt++;
		try {
			return await bind();
		} catch (error) {
			if (!isRetryable(error)) throw error;
			if (mode === "once") throw error;

			const elapsedMs = now() - startedAt;
			const withinBudget = elapsedMs < budgetMs;
			const delayMs = withinBudget ? Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs) : maxDelayMs;
			const info: PortRetryInfo = { attempt, delayMs, elapsedMs, error };

			if (isReportableAttempt(attempt, options)) options?.onRetry?.(info);
			await sleep(delayMs);
		}
	}
}
