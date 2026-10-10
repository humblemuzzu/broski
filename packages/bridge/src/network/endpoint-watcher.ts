import { type ManagedInterval, nodeInterval } from "../timers";

export type EndpointSnapshot = {
	localIP: string | null;
	tailscaleIP: string | null;
	hotspotIP: string | null;
};

export type EndpointWatcherDeps = {
	/** Fork-free read of the current endpoints (os.networkInterfaces only). */
	readEndpoints: () => EndpointSnapshot;
	/** Changes only when the interface list changes; gates the CLI fallback. */
	interfacesFingerprint: () => string;
	/** Resolves the Tailscale IPv4 via its CLI. Only called when interfaces show no CGNAT address. */
	resolveTailscaleViaCli?: () => Promise<string | null>;
	onChange: (snapshot: EndpointSnapshot) => void;
	onCliFallback?: (ip: string | null) => void;
	intervalMs?: number;
	interval?: ManagedInterval;
	/** Injectable clock, for tests. */
	now?: () => number;
};

const DEFAULT_INTERVAL_MS = 10_000;
const CLI_RETRY_INITIAL_MS = 10_000;
const CLI_RETRY_MAX_MS = 10 * 60 * 1000;

export class EndpointWatcher {
	private readonly deps: EndpointWatcherDeps;
	private readonly intervalMs: number;
	private readonly interval: ManagedInterval;
	private readonly now: () => number;
	private stopTimer: (() => void) | null = null;
	private current: EndpointSnapshot;
	private fingerprint: string;
	private lastCliFingerprint: string | null = null;
	private cliInFlight = false;
	private cliBackoffMs = 0;
	private nextCliAttemptAt = 0;

	constructor(deps: EndpointWatcherDeps) {
		this.deps = deps;
		this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.interval = deps.interval ?? nodeInterval;
		this.now = deps.now ?? Date.now;
		this.current = deps.readEndpoints();
		this.fingerprint = deps.interfacesFingerprint();
	}

	snapshot(): EndpointSnapshot {
		return this.current;
	}

	start(): void {
		if (this.stopTimer) return;
		this.stopTimer = this.interval.start(() => this.tick(), this.intervalMs);
		if (this.current.tailscaleIP === null) void this.resolveViaCli();
	}

	stop(): void {
		const stop = this.stopTimer;
		this.stopTimer = null;
		stop?.();
	}

	tick(): void {
		const next = this.deps.readEndpoints();
		const fingerprint = this.deps.interfacesFingerprint();
		const interfacesChanged = fingerprint !== this.fingerprint;
		if (interfacesChanged) {
			this.cliBackoffMs = 0;
			this.nextCliAttemptAt = 0;
		}
		const needsCliFallback =
			next.tailscaleIP === null && (interfacesChanged || this.lastCliFingerprint !== fingerprint);
		this.fingerprint = fingerprint;

		if (needsCliFallback) void this.resolveViaCli();
		this.publish(next);
	}

	private async resolveViaCli(): Promise<void> {
		const resolve = this.deps.resolveTailscaleViaCli;
		if (!resolve || this.cliInFlight) return;
		if (this.now() < this.nextCliAttemptAt) return;

		this.cliInFlight = true;
		try {
			const ip = await resolve();
			this.deps.onCliFallback?.(ip);
			if (ip === null) {
				this.scheduleCliRetry();
				return;
			}
			this.lastCliFingerprint = this.fingerprint;
			this.cliBackoffMs = 0;
			this.nextCliAttemptAt = 0;
			this.publish({ ...this.current, tailscaleIP: ip });
		} catch {
			// CLI unavailable; the interface-derived view stays authoritative.
			this.scheduleCliRetry();
		} finally {
			this.cliInFlight = false;
		}
	}

	private scheduleCliRetry(): void {
		this.cliBackoffMs =
			this.cliBackoffMs === 0 ? CLI_RETRY_INITIAL_MS : Math.min(this.cliBackoffMs * 2, CLI_RETRY_MAX_MS);
		this.nextCliAttemptAt = this.now() + this.cliBackoffMs;
	}

	private publish(next: EndpointSnapshot): void {
		if (
			next.localIP === this.current.localIP &&
			next.tailscaleIP === this.current.tailscaleIP &&
			next.hotspotIP === this.current.hotspotIP
		) {
			return;
		}
		this.current = next;
		this.deps.onChange(next);
	}
}
