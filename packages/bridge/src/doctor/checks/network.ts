import { getHotspotIP, getLocalIP, getTailscaleIP, isTailscaleConnected } from "../../network";
import {
	checkPortInUse,
	getKillPortHint,
	getProcessOnPort,
	getTailscaleInstallHint,
	IS_LINUX,
	IS_MACOS,
	isTailscaleInstalled,
} from "../../platform";
import type { DoctorContext } from "../context";
import type { CheckResult } from "../types";

export async function runNetworkChecks(ctx: DoctorContext, opts: { deep?: boolean } = {}): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const localIP = getLocalIP();
	if (localIP) {
		results.push({ id: "local_ip", category: "network", status: "ok", message: `Local IP: ${localIP}` });
	} else {
		results.push({
			id: "local_ip",
			category: "network",
			status: "warning",
			message: "Could not detect local IP",
			fix: "Check Wi-Fi/network connectivity",
		});
	}

	const inUse = await checkPortInUse(ctx.port);
	if (!inUse) {
		results.push({
			id: "bridge_port_target",
			category: "network",
			status: "ok",
			message: `Port ${ctx.port} available`,
		});
	} else {
		const proc = await getProcessOnPort(ctx.port);
		const procLabel = proc ? ` (${proc.name}, PID ${proc.pid})` : "";
		const isBroski = proc?.name?.toLowerCase().includes("broski");
		results.push(
			isBroski
				? {
						id: "bridge_port_target",
						category: "network",
						status: "info",
						message: `Port ${ctx.port} in use by Broski${procLabel}`,
					}
				: {
						id: "bridge_port_target",
						category: "network",
						status: "warning",
						message: `Port ${ctx.port} in use by another process${procLabel}`,
						fix: getKillPortHint(ctx.port),
					},
		);
	}

	const tsInstalled = await isTailscaleInstalled();
	if (!tsInstalled) {
		results.push({
			id: "tailscale_installed",
			category: "network",
			status: "warning",
			message: "Tailscale not installed (optional for remote access)",
			fix: getTailscaleInstallHint(),
		});
		results.push({
			id: "tailscale_connected",
			category: "network",
			status: "info",
			message: "Tailscale not installed — skipping connection check",
		});
	} else {
		results.push({ id: "tailscale_installed", category: "network", status: "ok", message: "Tailscale installed" });
		const connected = await isTailscaleConnected();
		if (connected) {
			results.push({ id: "tailscale_connected", category: "network", status: "ok", message: "Tailscale connected" });
			const tsIp = await getTailscaleIP();
			if (tsIp) {
				results.push({ id: "tailscale_ip", category: "network", status: "info", message: `Tailscale IP: ${tsIp}` });
			}
		} else {
			const fix = IS_MACOS
				? "Click Tailscale menu bar icon and connect"
				: IS_LINUX
					? "Run: sudo tailscale up"
					: "Open Tailscale app and connect";
			results.push({
				id: "tailscale_connected",
				category: "network",
				status: "warning",
				message: "Tailscale installed but not connected",
				fix,
			});
			results.push({ id: "tailscale_ip", category: "network", status: "info", message: "No Tailscale IP" });
		}
	}

	if (opts.deep) {
		const hotspot = getHotspotIP();
		results.push({
			id: "hotspot_ip",
			category: "network",
			status: hotspot ? "info" : "warning",
			message: hotspot ? `Hotspot IP detected: ${hotspot}` : "No hotspot IP detected",
			fix: hotspot ? undefined : "Enable hotspot/tethering only if you need hotspot mode",
		});

		if (ctx.config.network.mode === "tailscale" && !tsInstalled) {
			results.push({
				id: "network_mode_tailscale_missing",
				category: "network",
				status: "error",
				message: "Config uses tailscale mode but Tailscale is not installed",
				fix: getTailscaleInstallHint(),
			});
		}
	}

	return results;
}
