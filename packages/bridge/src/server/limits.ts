/**
 * DoS guards and connection caps, all overridable by environment for operators that need a wider
 * or narrower bridge. Read once per server so a test can set the env before creating one.
 */

export type BridgeLimits = {
	maxWsMessageBytes: number;
	wsBackpressureLimitBytes: number;
	wsIdleTimeoutSeconds: number;
	rate: { perSecond: number; burst: number; blockMs: number };
	maxClients: number;
	/** Separate cap for the broski-link unix socket, so link clients never take a network slot. */
	linkMaxClients: number;
	allowedDeviceIds: Set<string>;
	maxBatchSize: number;
};

export function createLimits(): BridgeLimits {
	const maxWsMessageBytes = Math.max(
		1024 * 1024,
		Math.min(Number(process.env.BROSKI_MAX_WS_MESSAGE_MB ?? "15") * 1024 * 1024, 200 * 1024 * 1024),
	);

	const wsBackpressureLimitBytes = Math.max(
		128 * 1024,
		Math.min(Number(process.env.BROSKI_WS_BACKPRESSURE_MB ?? "4") * 1024 * 1024, 64 * 1024 * 1024),
	);

	const wsIdleTimeoutSeconds = Math.max(30, Math.min(Number(process.env.BROSKI_WS_IDLE_TIMEOUT_SECONDS ?? "120"), 600));

	const rate = {
		perSecond: Math.max(10, Math.min(Number(process.env.BROSKI_RATE_LIMIT_PER_SEC ?? "60"), 5000)),
		burst: Math.max(10, Math.min(Number(process.env.BROSKI_RATE_LIMIT_BURST ?? "150"), 20000)),
		blockMs: Math.max(1000, Math.min(Number(process.env.BROSKI_RATE_LIMIT_BLOCK_MS ?? "10000"), 60_000)),
	};

	const maxClients = Math.max(1, Math.min(Number(process.env.BROSKI_MAX_CLIENTS ?? "8"), 100));
	const linkMaxClients = Math.max(1, Math.min(Number(process.env.BROSKI_LINK_MAX_CLIENTS ?? "32"), 64));
	const allowedDeviceIdsRaw = (process.env.BROSKI_ALLOWED_DEVICE_IDS ?? "").trim();
	const allowedDeviceIds = new Set(
		allowedDeviceIdsRaw
			? allowedDeviceIdsRaw
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [],
	);

	return {
		maxWsMessageBytes,
		wsBackpressureLimitBytes,
		wsIdleTimeoutSeconds,
		rate,
		maxClients,
		linkMaxClients,
		allowedDeviceIds,
		maxBatchSize: 50,
	};
}
