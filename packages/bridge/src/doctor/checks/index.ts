import type { DoctorContext } from "../context";
import type { CheckResult, DoctorCategory, DoctorProfile } from "../types";
import { runAgentChecks } from "./agents";
import { runAntigravityChecks } from "./antigravity";
import { runConnectivityChecks } from "./connectivity";
import { runDaemonChecks } from "./daemon";
import { runDependencyChecks } from "./dependencies";
import { runLinkServiceChecks } from "./link-service";
import { runLinkStatusChecks } from "./link-status";
import { runMacosHygieneChecks } from "./macos-hygiene";
import { runNetworkChecks } from "./network";
import { runSecurityChecks } from "./security";
import { runShellEnvChecks } from "./shell-env";
import { runSystemChecks } from "./system";

const PROFILE_CATEGORIES: Record<DoctorProfile, Set<DoctorCategory>> = {
	all: new Set(["system", "dependencies", "network", "security", "daemon", "agents", "connectivity"]),
	network: new Set(["network", "connectivity"]),
	pairing: new Set(["network", "security", "connectivity"]),
	agents: new Set(["dependencies", "agents"]),
	daemon: new Set(["daemon", "connectivity", "network"]),
	security: new Set(["security"]),
};

/** A group of checks and the categories of what it finds; a profile runs only the groups it shows something of. */
interface CheckGroup {
	readonly categories: readonly DoctorCategory[];
	readonly run: (ctx: DoctorContext, deep: boolean | undefined) => Promise<CheckResult[]>;
}

const CHECK_GROUPS: readonly CheckGroup[] = [
	{ categories: ["system"], run: (ctx) => runSystemChecks(ctx) },
	{ categories: ["dependencies"], run: (ctx) => runDependencyChecks(ctx.config) },
	{ categories: ["dependencies"], run: (ctx) => runAntigravityChecks(ctx.config) },
	{ categories: ["network"], run: (ctx) => runNetworkChecks(ctx) },
	{ categories: ["security"], run: (ctx) => runSecurityChecks(ctx) },
	{ categories: ["daemon"], run: (ctx, deep) => runDaemonChecks(ctx, { deep }) },
	{ categories: ["agents"], run: (ctx) => runAgentChecks(ctx.config) },
	{ categories: ["agents"], run: () => runShellEnvChecks() },
	{ categories: ["connectivity"], run: (ctx, deep) => runConnectivityChecks(ctx, { deep }) },
	{ categories: ["daemon"], run: (ctx) => runLinkServiceChecks(ctx) },
	{ categories: ["connectivity"], run: (ctx) => runLinkStatusChecks(ctx) },
	{ categories: ["system", "security", "connectivity"], run: () => runMacosHygieneChecks() },
];

export async function runAllChecks(
	ctx: DoctorContext,
	opts: { deep?: boolean; profile?: DoctorProfile } = {},
): Promise<CheckResult[]> {
	const allowed = PROFILE_CATEGORIES[opts.profile ?? "all"];
	const results: CheckResult[] = [];
	for (const group of CHECK_GROUPS) {
		if (group.categories.some((category) => allowed.has(category))) results.push(...(await group.run(ctx, opts.deep)));
	}
	return results.filter((result) => allowed.has(result.category));
}
