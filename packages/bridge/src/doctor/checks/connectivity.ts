import { checkPortInUse } from "../../platform";
import type { DoctorContext } from "../context";
import type { CheckResult } from "../types";

export async function runConnectivityChecks(ctx: DoctorContext, opts: { deep?: boolean } = {}): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	try {
		const res = await fetch("https://github.com", {
			method: "HEAD",
			signal: AbortSignal.timeout(5000),
			headers: { "User-Agent": "broski-doctor" },
		});
		if (res.status < 500) {
			results.push({
				id: "internet",
				category: "connectivity",
				status: "ok",
				message: "Internet reachable (github.com)",
			});
		} else {
			results.push({
				id: "internet",
				category: "connectivity",
				status: "warning",
				message: `Internet probe returned HTTP ${res.status}`,
			});
		}
	} catch {
		results.push({
			id: "internet",
			category: "connectivity",
			status: "warning",
			message: "Cannot reach github.com",
			fix: "Check internet connection",
		});
	}

	const listening = await checkPortInUse(ctx.port);
	if (listening) {
		results.push({
			id: "bridge_port_listening",
			category: "connectivity",
			status: "ok",
			message: `Bridge listening on port ${ctx.port}`,
		});
	} else {
		results.push({
			id: "bridge_port_listening",
			category: "connectivity",
			status: "warning",
			message: `Bridge not listening on configured port ${ctx.port}`,
			fix: "Run `broski restart` or start manually with `broski`",
		});
	}

	if (opts.deep && listening) {
		try {
			const scheme = ctx.config.security.tls ? "https" : "http";
			const res = await fetch(`${scheme}://127.0.0.1:${ctx.port}/health`, {
				signal: AbortSignal.timeout(2000),
			});
			results.push({
				id: "health_endpoint",
				category: "connectivity",
				status: res.ok ? "ok" : "info",
				message: `Bridge /health probe: HTTP ${res.status}`,
			});
		} catch {
			results.push({
				id: "health_endpoint",
				category: "connectivity",
				status: "info",
				message: "Bridge /health probe unavailable (normal for some modes)",
			});
		}
	}

	return results;
}
