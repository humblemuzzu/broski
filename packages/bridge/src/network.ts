import { spawnSync } from "node:child_process";
import { networkInterfaces } from "os";
import { getHotspotInterfacePatterns, getPreferredInterfaceNames, getTailscaleBinaryPath } from "./platform";

const TAILSCALE_CLI = getTailscaleBinaryPath();

// Timeout for shell commands (5 seconds)
const COMMAND_TIMEOUT_MS = 5000;

// Run a command with timeout, returns stdout or null on failure
function runWithTimeout(cmd: string, args: string[]): string | null {
	try {
		const result = spawnSync(cmd, args, {
			encoding: "utf-8",
			timeout: COMMAND_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (result.status === 0 && result.stdout) {
			return result.stdout.trim();
		}
		return null;
	} catch {
		return null;
	}
}

export function getLocalIP(): string | null {
	const interfaces = networkInterfaces();

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
	const output = runWithTimeout(TAILSCALE_CLI, ["ip", "-4"]);
	if (output?.startsWith("100.")) return output;
	return null;
}

/** Non-blocking variant for use in periodic polling (won't stall the event loop). */
export async function getTailscaleIPAsync(): Promise<string | null> {
	try {
		const proc = Bun.spawn([TAILSCALE_CLI, "ip", "-4"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const text = await new Response(proc.stdout).text();
		const trimmed = text.trim();
		return trimmed.startsWith("100.") ? trimmed : null;
	} catch {
		return null;
	}
}

export async function isTailscaleConnected(): Promise<boolean> {
	const output = runWithTimeout(TAILSCALE_CLI, ["status"]);
	if (!output) return false;
	return !output.includes("Tailscale is stopped");
}

export async function getTailscaleMagicDNS(): Promise<string | null> {
	const output = runWithTimeout(TAILSCALE_CLI, ["status", "--json"]);
	if (!output) return null;

	try {
		const status = JSON.parse(output);
		// The current device's MagicDNS name
		const self = status.Self;
		if (self?.DNSName) {
			// DNSName includes trailing dot, remove it
			return self.DNSName.replace(/\.$/, "");
		}
		return null;
	} catch {
		return null;
	}
}

export async function getTailnetName(): Promise<string | null> {
	const output = runWithTimeout(TAILSCALE_CLI, ["status", "--json"]);
	if (!output) return null;

	try {
		const status = JSON.parse(output);
		// Get tailnet name from MagicDNSSuffix
		// e.g., "tailnet-name.ts.net" → "tailnet-name"
		const suffix = status.MagicDNSSuffix;
		if (suffix) {
			return suffix.replace(/\.ts\.net\.?$/, "");
		}
		return null;
	} catch {
		return null;
	}
}

// Hotspot detection for mobile tethering scenarios
// iPhone hotspot: typically uses 172.20.10.x range
// Android hotspot: typically uses 192.168.43.x or 192.168.44.x range
export function getHotspotIP(): string | null {
	const interfaces = networkInterfaces();

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
