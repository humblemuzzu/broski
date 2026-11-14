/**
 * What the Pi adapter shares across all its sessions for the life of the process (D1): the agent dir
 * and the one `ModelRuntime` over its `auth.json`, `models.json` and `models-store.json`.
 */

import { join } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModelRuntimeHost } from "./models/model-runtime";
import { ProxySetting } from "./network/proxy-setting";
import { withProxy } from "./network/scoped-runtime";

export interface PiServices {
	readonly agentDir: string;
	readonly models: ModelRuntimeHost;
	/** Pi's `httpProxy` setting, for `status()`. */
	readonly proxy: ProxySetting;
	/** `models.runtime` as hosted sessions use it: Pi's `httpProxy` applies to their requests and to nothing else. */
	readonly sessionRuntime: ModelRuntime;
}

export interface PiServicesOptions {
	/** Defaults to Pi's own: `$PI_CODING_AGENT_DIR`, else `~/.pi/agent` (pi-coding-agent `src/config.ts:605-611`). */
	readonly agentDir?: string;
}

/**
 * `ModelRuntime.create` records an unreadable `models.json` as `getError()` instead of throwing
 * (pi-coding-agent `src/core/model-config.ts:168-190`), which `status()` reports.
 */
export async function createPiServices(options: PiServicesOptions = {}): Promise<PiServices> {
	const agentDir = options.agentDir ?? getAgentDir();
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
	});
	const proxy = new ProxySetting(agentDir);
	const sessionRuntime = withProxy(runtime, () => {
		const outcome = proxy.outcome();
		return outcome.kind === "scoped" ? outcome.plan : undefined;
	});
	return { agentDir, models: new ModelRuntimeHost(runtime, agentDir), proxy, sessionRuntime };
}
