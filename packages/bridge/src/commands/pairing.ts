import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import packageMeta from "../../package.json";
import { getHotspotIP, getLocalIP, getTailscaleIP, getTailscaleMagicDNS } from "../network";
import { checkPortInUse } from "../platform";
import { displayQRCode } from "../qr";
import { getConfiguredPort } from "./config-port";

async function loadAuthToken(): Promise<{ authToken: string; expiresAt: number | null } | null> {
	try {
		const tokenJsonFile = resolve(homedir(), ".broski", "token.json");
		const raw = await readFile(tokenJsonFile, "utf-8");
		const parsed = JSON.parse(raw);
		const authToken = parsed.token?.trim() ?? "";
		if (!authToken || authToken.length < 16) {
			throw new Error("Invalid token in token.json");
		}
		return { authToken, expiresAt: parsed.expiresAt ?? null };
	} catch {
		try {
			const tokenFile = resolve(homedir(), ".broski", "token");
			const existing = await readFile(tokenFile, "utf-8");
			const authToken = existing.trim();
			if (authToken.length < 16) {
				throw new Error("Invalid token");
			}
			return { authToken, expiresAt: null };
		} catch {
			return null;
		}
	}
}

export async function runQR(detectHotspot: boolean): Promise<void> {
	console.log("Generating QR code for phone pairing...\n");

	const stored = await loadAuthToken();
	if (!stored) {
		console.log("⚠️  No auth token found. Run `broski` or `broski install` first to start the bridge.");
		return;
	}
	const authToken = stored.authToken;

	let tlsEnabled = false;
	let certSha256: string | null = null;

	try {
		const { ensureTlsMaterial, isTlsEnabledByEnv } = await import("../tls");
		tlsEnabled = isTlsEnabledByEnv();
		if (tlsEnabled) {
			const tlsMaterial = await ensureTlsMaterial();
			certSha256 = tlsMaterial.certSha256;
		}
	} catch {
		// TLS not available, continue without it
	}

	const port = await getConfiguredPort();
	const bridgeRunning = await checkPortInUse(port);

	if (!bridgeRunning) {
		console.log(`⚠️  Bridge is not running on port ${port}.`);
		console.log("   Start it with `broski` or `broski install` first.");
		console.log("");
	}

	const localIP = getLocalIP();
	const tailscaleIP = await getTailscaleIP();
	const magicDNS = await getTailscaleMagicDNS();
	const hotspotIP = detectHotspot ? getHotspotIP() : null;

	const version = packageMeta.version ?? "0.1.0";

	displayQRCode({
		localIP,
		tailscaleIP,
		magicDNS,
		funnelURL: null,
		hotspotIP,
		port,
		version,
		authToken,
		tlsEnabled,
		certSha256,
	});

	if (bridgeRunning) {
		console.log("✓ Bridge is running. Scan the QR code with the Broski app.");
	}
}

export async function runShowToken(): Promise<void> {
	console.log("Broski Auth Token\n");

	const stored = await loadAuthToken();
	if (!stored) {
		console.log("  No auth token found.");
		console.log("  Run `broski` or `broski install` first to start the bridge.");
		return;
	}

	console.log(`  Token: ${stored.authToken}`);
	console.log("");
	if (stored.expiresAt) {
		const expiresDate = new Date(stored.expiresAt);
		const now = new Date();
		const daysRemaining = Math.ceil((stored.expiresAt - now.getTime()) / (1000 * 60 * 60 * 24));
		console.log(`  Expires: ${expiresDate.toLocaleDateString()} (${daysRemaining} days)`);
	}
	console.log("");
	console.log("  Use this token in the Broski app manual connection dialog.");
	console.log("  Or run `broski qr` to generate a scannable QR code.");
}
