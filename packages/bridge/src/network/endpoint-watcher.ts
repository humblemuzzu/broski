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
};

const DEFAULT_INTERVAL_MS = 10_000;

export class EndpointWatcher {
	private readonly deps: EndpointWatcherDeps;
	private readonly intervalMs: number;
	private readonly interval: ManagedInterval;
	private stopTimer: (() => void) | null = null;
	private current: EndpointSnapshot;
	private fingerprint: string;
	private lastCliFingerprint: string | null = null;
	private cliInFlight = false;

	constructor(deps: EndpointWatcherDeps) {
		this.deps = deps;
		this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.interval = deps.interval ?? nodeInterval;
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
		const needsCliFallback = next.tailscaleIP === null && (interfacesChanged || this.lastCliFingerprint === null);
		this.fingerprint = fingerprint;

		if (needsCliFallback) void this.resolveViaCli();
		this.publish(next);
	}

	private async resolveViaCli(): Promise<void> {
		const resolve = this.deps.resolveTailscaleViaCli;
		if (!resolve || this.cliInFlight) return;

		this.cliInFlight = true;
		this.lastCliFingerprint = this.fingerprint;
		try {
			const ip = await resolve();
			this.deps.onCliFallback?.(ip);
			this.publish({ ...this.current, tailscaleIP: ip });
		} catch {
			// CLI unavailable; the interface-derived view stays authoritative.
		} finally {
			this.cliInFlight = false;
		}
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
