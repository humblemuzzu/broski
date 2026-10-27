import type { Connections } from "./connections";
import type { BridgeLimits } from "./limits";
import { type LinkIngress, startLinkIngress } from "./link-ingress";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

export type ConfiguredLinkIngressDeps = {
	/** Unset when this bridge serves no link socket at all. */
	linkSocket: string | undefined;
	linkKeyFile: string | undefined;
	state: BridgeState;
	connections: Connections;
	limits: BridgeLimits;
	log: LeveledLogger;
};

/** The link ingress the bridge was configured with, or null when it was configured with none. */
export function startConfiguredLinkIngress(deps: ConfiguredLinkIngressDeps): Promise<LinkIngress | null> {
	if (!deps.linkSocket) return Promise.resolve(null);
	return startLinkIngress({
		socketPath: deps.linkSocket,
		linkKeyFile: deps.linkKeyFile,
		state: deps.state,
		connections: deps.connections,
		limits: deps.limits,
		log: deps.log,
	});
}
