/**
 * DoS guards and connection caps, all overridable by environment for operators that need a wider
 * or narrower bridge. Read once per server so a test can set the env before creating one.
 */

export type BridgeLimits = {
	maxWsMessageBytes: number;
	wsBackpressureLimitBytes: number;
	/** Backlog a broski-link socket may build before it is closed with 4013; its peer is the daemon. */
	linkBackpressureLimitBytes: number;
	/** Largest single frame a broski-link socket may be sent; the daemon refuses anything above 8 MiB. */
	linkMessageLimitBytes: number;
	wsIdleTimeoutSeconds: number;
	rate: { perSecond: number; burst: number; blockMs: number };
	maxClients: number;
	/** Separate cap for the broski-link unix socket, so link clients never take a network slot. */
	linkMaxClients: number;
};

const MB = 1024 * 1024;

/**
 * The daemon's own per-message bound (`LINK_MAX_MESSAGE_BYTES` in
 * `packages/link/daemon/src/limits.rs`, half the link's unacked window). A frame past it drops the
 * daemon's bridge socket and redials, so this side never offers one.
 */
const LINK_MAX_MESSAGE_BYTES = 8 * MB;

/** An env knob in megabytes, clamped to a band the bridge can actually work in. */
function megabytesFromEnv(name: string, fallbackMb: string, minBytes: number, maxBytes: number): number {
	return Math.max(minBytes, Math.min(Number(process.env[name] ?? fallbackMb) * MB, maxBytes));
}

/** An env knob that is already a count, clamped to its band. */
function countFromEnv(name: string, fallback: string, min: number, max: number): number {
	return Math.max(min, Math.min(Number(process.env[name] ?? fallback), max));
}

export function createLimits(): BridgeLimits {
	const rate = {
		perSecond: countFromEnv("BROSKI_RATE_LIMIT_PER_SEC", "60", 10, 5000),
		burst: countFromEnv("BROSKI_RATE_LIMIT_BURST", "150", 10, 20_000),
		blockMs: countFromEnv("BROSKI_RATE_LIMIT_BLOCK_MS", "10000", 1000, 60_000),
	};

	return {
		maxWsMessageBytes: megabytesFromEnv("BROSKI_MAX_WS_MESSAGE_MB", "15", MB, 200 * MB),
		wsBackpressureLimitBytes: megabytesFromEnv("BROSKI_WS_BACKPRESSURE_MB", "4", 128 * 1024, 64 * MB),
		linkBackpressureLimitBytes: megabytesFromEnv("BROSKI_LINK_BACKPRESSURE_MB", "32", 8 * MB, 256 * MB),
		linkMessageLimitBytes: megabytesFromEnv("BROSKI_LINK_MESSAGE_MB", "8", MB, LINK_MAX_MESSAGE_BYTES),
		wsIdleTimeoutSeconds: countFromEnv("BROSKI_WS_IDLE_TIMEOUT_SECONDS", "120", 30, 600),
		rate,
		maxClients: countFromEnv("BROSKI_MAX_CLIENTS", "8", 1, 100),
		linkMaxClients: countFromEnv("BROSKI_LINK_MAX_CLIENTS", "32", 1, 64),
	};
}
