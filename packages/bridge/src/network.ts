import { networkInterfaces } from "os";
import { findTailscaleIpv4, type InterfaceMap, readTailscaleStatus } from "./network/tailscale";
import { getHotspotInterfacePatterns, getPreferredInterfaceNames } from "./platform";

export type LocalEndpoints = {
	localIP: string | null;
	tailscaleIP: string | null;
	hotspotIP: string | null;
};

export function getLocalIP(interfaces: InterfaceMap = networkInterfaces()): string | null {
	for (const name of Object.keys(interfaces)) {
		for (const iface of interfaces[name] || []) {
			if (iface.internal || iface.family !== "IPv4") continue;
			const preferred = getPreferredInterfaceNames();
			// Check if this interface matches any preferred name (case-insensitive, prefix match for Linux patterns like enp*)
			if (
				preferred.some((p) => name.toLowerCase() === p.toLowerCase() || name.toLowerCase().startsWith(p.toLowerCase()))
			)
				return iface.address;
		}
	}

	for (const name of Object.keys(interfaces)) {
		for (const iface of interfaces[name] || []) {
			if (!iface.internal && iface.family === "IPv4") {
				return iface.address;
			}
		}
	}

	return null;
}

export async function getTailscaleIP(): Promise<string | null> {
	const fromInterfaces = findTailscaleIpv4(networkInterfaces());
	if (fromInterfaces) return fromInterfaces;
	return await getTailscaleIPViaCli();
}

export async function getTailscaleIPViaCli(): Promise<string | null> {
	const status = await readTailscaleStatus();
	return status?.ipv4 ?? null;
}

export async function isTailscaleConnected(): Promise<boolean> {
	const status = await readTailscaleStatus();
	return status?.connected === true;
}

export async function getTailscaleMagicDNS(): Promise<string | null> {
	const status = await readTailscaleStatus();
	return status?.magicDnsName ?? null;
}

export async function getTailnetName(): Promise<string | null> {
	const status = await readTailscaleStatus();
	return status?.tailnetName ?? null;
}

/** One interface read for all endpoint kinds — no subprocesses. */
export function readLocalEndpoints(interfaces: InterfaceMap = networkInterfaces()): LocalEndpoints {
	return {
		localIP: getLocalIP(interfaces),
		tailscaleIP: findTailscaleIpv4(interfaces),
		hotspotIP: getHotspotIP(interfaces),
	};
}

export function interfaceFingerprint(interfaces: InterfaceMap = networkInterfaces()): string {
	const parts: string[] = [];
	for (const name of Object.keys(interfaces).sort()) {
		for (const iface of interfaces[name] || []) {
			parts.push(`${name}:${String(iface.family)}:${iface.address}`);
		}
	}
	return parts.join("|");
}

// Hotspot detection for mobile tethering scenarios
// iPhone hotspot: typically uses 172.20.10.x range
// Android hotspot: typically uses 192.168.43.x or 192.168.44.x range
export function getHotspotIP(interfaces: InterfaceMap = networkInterfaces()): string | null {
	// First, look for IPs in known hotspot ranges
	for (const name of Object.keys(interfaces)) {
		for (const iface of interfaces[name] || []) {
			if (iface.internal || iface.family !== "IPv4") continue;

			// iPhone hotspot range
			if (iface.address.startsWith("172.20.10.")) {
				return iface.address;
			}

			// Android hotspot ranges
			if (iface.address.startsWith("192.168.43.") || iface.address.startsWith("192.168.44.")) {
				return iface.address;
			}
		}
	}

	// Second, look for hotspot interface names
	const hotspotInterfacePatterns = getHotspotInterfacePatterns();
	for (const name of Object.keys(interfaces)) {
		const ifaceName = name.toLowerCase();
		if (hotspotInterfacePatterns.some((pattern) => ifaceName.includes(pattern))) {
			for (const iface of interfaces[name] || []) {
				if (!iface.internal && iface.family === "IPv4") {
					return iface.address;
				}
			}
		}
	}

	return null;
}
