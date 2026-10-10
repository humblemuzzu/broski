import { getTailscaleBinaryPath } from "../platform";

export type InterfaceAddress = {
	family: string | number;
	internal?: boolean;
	address: string;
};

export type InterfaceMap = Record<string, InterfaceAddress[] | undefined>;

export type TailscaleStatus = {
	ipv4: string | null;
	magicDnsName: string | null;
	tailnetName: string | null;
	connected: boolean;
};

const CLI_TIMEOUT_MS = 5000;
const STATUS_TTL_MS = 30_000;

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
export function isCgnatAddress(address: string): boolean {
	const parts = address.split(".");
	if (parts.length !== 4) return false;
	if (parts[0] !== "100") return false;
	const octet = Number(parts[1]);
	return Number.isInteger(octet) && octet >= 64 && octet <= 127;
}

export function findTailscaleIpv4(interfaces: InterfaceMap): string | null {
	const matches = (name: string): string | null => {
		for (const address of interfaces[name] ?? []) {
			if (address.internal) continue;
			if (address.family !== "IPv4" && address.family !== 4) continue;
			if (isCgnatAddress(address.address)) return address.address;
		}
		return null;
	};

	for (const name of Object.keys(interfaces)) {
		if (!name.startsWith("utun") && !name.startsWith("tailscale")) continue;
		const address = matches(name);
		if (address) return address;
	}

	for (const name of Object.keys(interfaces)) {
		const address = matches(name);
		if (address) return address;
	}

	return null;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseTailscaleStatus(raw: string): TailscaleStatus | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;

	const status = parsed as { Self?: unknown; MagicDNSSuffix?: unknown; BackendState?: unknown };
	const self = (typeof status.Self === "object" && status.Self !== null ? status.Self : {}) as {
		DNSName?: unknown;
		TailscaleIPs?: unknown;
	};

	const dnsName = readString(self.DNSName);
	const suffix = readString(status.MagicDNSSuffix);
	const selfIps: unknown[] = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
	const ipv4 = selfIps.find((ip) => typeof ip === "string" && isCgnatAddress(ip));

	return {
		ipv4: readString(ipv4),
		magicDnsName: dnsName ? dnsName.replace(/\.$/, "") : null,
		tailnetName: suffix ? suffix.replace(/\.ts\.net\.?$/, "") : null,
		connected: status.BackendState === "Running",
	};
}

export async function readTailscaleStatus(options?: { timeoutMs?: number }): Promise<TailscaleStatus | null> {
	const timeoutMs = options?.timeoutMs ?? CLI_TIMEOUT_MS;
	const cli = getTailscaleBinaryPath();

	try {
		const proc = Bun.spawn([cli, "status", "--json"], { stdout: "pipe", stderr: "ignore" });
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// Already exited.
			}
		}, timeoutMs);

		try {
			const text = await new Response(proc.stdout).text();
			return parseTailscaleStatus(text.trim());
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return null;
	}
}

export type TailscaleStatusCache = {
	get: (force?: boolean) => Promise<TailscaleStatus | null>;
	last: () => TailscaleStatus | null;
};

export function createTailscaleStatusCache(options?: {
	ttlMs?: number;
	loader?: () => Promise<TailscaleStatus | null>;
	now?: () => number;
}): TailscaleStatusCache {
	const ttlMs = options?.ttlMs ?? STATUS_TTL_MS;
	const loader = options?.loader ?? readTailscaleStatus;
	const now = options?.now ?? Date.now;

	let cached: TailscaleStatus | null = null;
	let fetchedAt = 0;
	let inFlight: Promise<TailscaleStatus | null> | null = null;

	const get = async (force = false): Promise<TailscaleStatus | null> => {
		if (!force && cached !== null && now() - fetchedAt < ttlMs) return cached;
		if (inFlight) return inFlight;

		inFlight = (async () => {
			try {
				const status = await loader();
				if (status) {
					cached = status;
					fetchedAt = now();
					return status;
				}
				return cached;
			} finally {
				inFlight = null;
			}
		})();

		return inFlight;
	};

	return { get, last: () => cached };
}

const sharedCache = createTailscaleStatusCache();

export function getTailscaleStatus(force = false): Promise<TailscaleStatus | null> {
	return sharedCache.get(force);
}
