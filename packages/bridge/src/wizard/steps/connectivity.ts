import packageMeta from "../../../package.json";
import type { BroskiConfig } from "../../config/schema";
import { getHotspotIP, getLocalIP, getTailscaleIP, getTailscaleMagicDNS } from "../../network";
import { checkPortInUse } from "../../platform";
import { displayQRCode } from "../../qr";
import { loadOrCreateAuthState } from "../../server";
import { ensureTlsMaterial } from "../../tls";
import { bold, brand, muted, success, warning } from "../palette";
import type { WizardPrompter } from "../prompter";

type PairingData = {
	token: string;
	tlsEnabled: boolean;
	certSha256: string | null;
};

async function resolvePairingData(config: BroskiConfig): Promise<PairingData> {
	const auth = await loadOrCreateAuthState(false, config.security.tokenTtlDays);
	let certSha256: string | null = null;
	if (config.security.tls) {
		try {
			const tls = await ensureTlsMaterial();
			certSha256 = tls.certSha256;
		} catch {
			certSha256 = null;
		}
	}

	return {
		token: auth.token,
		tlsEnabled: config.security.tls,
		certSha256,
	};
}

export async function runConnectivityStep(prompter: WizardPrompter, config: BroskiConfig): Promise<void> {
	const port = config.network.port;
	const isRunning = await checkPortInUse(port);
	const pairing = await resolvePairingData(config);

	if (!isRunning) {
		await prompter.note(
			`${warning("⚠")} Bridge is not running on port ${bold(String(port))} yet.\n\n` +
				`Your pairing token is ready, but phone connection will work only after bridge starts.\n\n` +
				`Start bridge and scan:\n` +
				`  ${brand("broski")}          ${muted("— start bridge")}\n` +
				`  ${brand("broski qr")}       ${muted("— show QR code anytime")}`,
			"Pairing",
		);

		const showNow = await prompter.confirm({
			message: "Show QR code now anyway? (for quick scan after bridge starts)",
			initialValue: false,
		});
		if (!showNow) return;
	} else {
		await prompter.note(
			`${success("✓")} Bridge is running on port ${bold(String(port))}.\n\n` +
				`${muted("Scan the QR code below with the Broski app.")}`,
			"Pairing",
		);
	}

	const localIP = getLocalIP();
	const tailscaleIP = await getTailscaleIP();
	const hotspotIP = getHotspotIP();
	const magicDNS = await getTailscaleMagicDNS();

	displayQRCode({
		localIP,
		tailscaleIP,
		magicDNS,
		funnelURL: null,
		hotspotIP,
		port,
		version: packageMeta.version ?? "0.1.0",
		authToken: pairing.token,
		tlsEnabled: pairing.tlsEnabled,
		certSha256: pairing.certSha256,
	});

	const scanned = await prompter.confirm({
		message: "Have you scanned the QR code with the Broski app?",
		initialValue: true,
	});

	if (scanned) {
		await prompter.note(
			`${success("✓")} ${bold("Pairing step complete!")}\n\n` +
				`${muted('If app shows "Disconnected", run:')}\n` +
				`  ${brand("broski doctor --profile pairing")}\n` +
				`  ${brand("broski logs --export")}`,
			"Connection",
		);
	} else {
		await prompter.note(
			`${warning("⚠")} ${bold("QR scan skipped for now")}\n\n` +
				`${muted("You can pair later with:")}\n` +
				`  ${brand("broski qr")}\n` +
				`  ${brand("broski qr --new-token")} ${muted("if you want a fresh token")}\n\n` +
				`${muted("If pairing fails:")}\n` +
				`  ${brand("broski doctor --profile pairing")}\n` +
				`  ${brand("broski troubleshoot")}`,
			"Pairing Skipped",
		);
	}
}
