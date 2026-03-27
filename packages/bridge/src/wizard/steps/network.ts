import { getHotspotIP, getLocalIP, getTailscaleIP, isTailscaleConnected } from "../../network";
import { checkPortInUse, getProcessOnPort, getTailscaleInstallHint, isTailscaleInstalled } from "../../platform";
import { bold, brand, muted, success, warning } from "../palette";
import type { WizardPrompter } from "../prompter";

export type NetworkResult = {
	port: number;
	mode: "local" | "tailscale" | "hotspot-iphone" | "hotspot-android";
	enableFunnel: boolean;
};

interface NetworkDetection {
	localIP: string | null;
	tailscaleIP: string | null;
	hotspotIP: string | null;
	tailscaleInstalled: boolean;
	tailscaleConnected: boolean;
}

async function detectNetwork(): Promise<NetworkDetection> {
	const localIP = getLocalIP();
	const tailscaleInstalled = await isTailscaleInstalled();
	const tailscaleConnected = tailscaleInstalled ? await isTailscaleConnected() : false;
	const tailscaleIP = tailscaleConnected ? await getTailscaleIP() : null;
	const hotspotIP = getHotspotIP();

	return { localIP, tailscaleIP, hotspotIP, tailscaleInstalled, tailscaleConnected };
}

export async function runNetworkStep(
	prompter: WizardPrompter,
	options: { isQuick: boolean; currentPort?: number },
): Promise<NetworkResult> {
	const net = await detectNetwork();

	if (options.isQuick) {
		// Auto-select best mode
		let mode: NetworkResult["mode"] = "local";
		let modeLabel = "Same Wi-Fi";
		let ip = net.localIP ?? "127.0.0.1";

		if (net.tailscaleConnected && net.tailscaleIP) {
			mode = "tailscale";
			modeLabel = "Tailscale";
			ip = net.tailscaleIP;
		}

		const port = options.currentPort ?? 18274;

		const lines: string[] = [
			`  ${bold("Mode:")}    ${brand(modeLabel)}`,
			`  ${bold("IP:")}      ${ip}`,
			`  ${bold("Port:")}    ${port}`,
		];
		if (net.tailscaleConnected) {
			lines.push(`  ${success("✓")} Tailscale connected`);
		}
		if (net.hotspotIP) {
			lines.push(`  ${muted(`Hotspot also available: ${net.hotspotIP}`)}`);
		}

		await prompter.note(lines.join("\n"), "Network Configuration");

		return { port, mode, enableFunnel: false };
	}

	// Advanced mode
	const modeOptions: { value: NetworkResult["mode"]; label: string; hint?: string }[] = [
		{
			value: "local",
			label: `Same Wi-Fi (local)`,
			hint: net.localIP ? `${net.localIP}` : "no IP detected",
		},
		{
			value: "tailscale",
			label: `Tailscale (remote access)`,
			hint: net.tailscaleConnected
				? `connected — ${net.tailscaleIP}`
				: net.tailscaleInstalled
					? "installed but not connected"
					: "not installed",
		},
		{
			value: "hotspot-iphone",
			label: "iPhone Hotspot",
			hint: net.hotspotIP ? `detected — ${net.hotspotIP}` : "share your phone's internet",
		},
		{
			value: "hotspot-android",
			label: "Android Hotspot",
			hint: "USB or Wi-Fi tethering",
		},
	];

	const mode = await prompter.select<NetworkResult["mode"]>({
		message: "How will your phone connect to this computer?",
		options: modeOptions,
		initialValue: net.tailscaleConnected ? "tailscale" : "local",
	});

	// Tailscale-specific follow-ups
	let enableFunnel = false;
	if (mode === "tailscale") {
		if (!net.tailscaleInstalled) {
			await prompter.note(
				`Tailscale is not installed.\n\n` +
					`${bold("Install instructions:")}\n` +
					`  ${getTailscaleInstallHint()}\n\n` +
					`${muted("You can continue setup and install Tailscale later.")}`,
				"Tailscale Required",
			);
		} else if (net.tailscaleConnected) {
			enableFunnel = await prompter.confirm({
				message: "Enable Tailscale Funnel? (public HTTPS, no VPN needed on phone)",
				initialValue: false,
			});
		}
	}

	// Port selection
	const portStr = await prompter.text({
		message: "Bridge port number:",
		defaultValue: String(options.currentPort ?? 18274),
		placeholder: "18274",
		validate: (v) => {
			const n = Number(v);
			if (!Number.isFinite(n) || n < 1 || n > 65535) {
				return "Port must be a number between 1 and 65535";
			}
			return undefined;
		},
	});

	const port = Number(portStr);

	const busy = await checkPortInUse(port);
	if (busy) {
		const proc = await getProcessOnPort(port);
		const procLabel = proc ? `${proc.name} (PID ${proc.pid})` : "another process";
		await prompter.note(
			`${warning("⚠")} Port ${bold(String(port))} is already in use by ${procLabel}.\n` +
				`${muted("You can continue, but bridge startup may fail until that process is stopped.")}`,
			"Port Check",
		);
	}

	return { port, mode, enableFunnel };
}
