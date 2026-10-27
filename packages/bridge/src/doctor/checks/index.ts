import type { DoctorContext } from "../context";
import type { CheckResult, DoctorProfile } from "../types";
import { runAgentChecks } from "./agents";
import { runConnectivityChecks } from "./connectivity";
import { runDaemonChecks } from "./daemon";
import { runDependencyChecks } from "./dependencies";
import { runLinkServiceChecks } from "./link-service";
import { runLinkStatusChecks } from "./link-status";
import { runNetworkChecks } from "./network";
import { runSecurityChecks } from "./security";
import { runShellEnvChecks } from "./shell-env";
import { runSystemChecks } from "./system";

const PROFILE_CATEGORIES: Record<DoctorProfile, Set<CheckResult["category"]>> = {
	all: new Set(["system", "dependencies", "network", "security", "daemon", "agents", "connectivity"]),
	network: new Set(["network", "connectivity"]),
	pairing: new Set(["network", "security", "connectivity"]),
	agents: new Set(["dependencies", "agents"]),
	daemon: new Set(["daemon", "connectivity", "network"]),
	security: new Set(["security"]),
};

export async function runAllChecks(
	ctx: DoctorContext,
	opts: { deep?: boolean; profile?: DoctorProfile } = {},
): Promise<CheckResult[]> {
	const results: CheckResult[] = [
		...(await runSystemChecks(ctx)),
		...(await runDependencyChecks()),
		...(await runNetworkChecks(ctx)),
		...(await runSecurityChecks(ctx)),
		...(await runDaemonChecks(ctx, { deep: opts.deep })),
		...(await runAgentChecks()),
		...(await runShellEnvChecks()),
		...(await runConnectivityChecks(ctx, { deep: opts.deep })),
		...(await runLinkServiceChecks(ctx)),
		...(await runLinkStatusChecks(ctx)),
	];

	const profile = opts.profile ?? "all";
	const allowed = PROFILE_CATEGORIES[profile];
	return results.filter((result) => allowed.has(result.category));
}
