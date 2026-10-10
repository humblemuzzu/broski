import { checkPortInUse, getKillPortHint, getProcessOnPort } from "../../platform";
import type { DoctorContext } from "../context";
import type { CheckResult } from "../types";

export async function runNetworkChecks(ctx: DoctorContext): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

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

	return results;
}
