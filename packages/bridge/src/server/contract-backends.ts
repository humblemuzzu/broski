import { piBackendFactory } from "../backends/pi/factory";
import { defaultLinkDirectory } from "../backends/pi/terminal/link";
import { readConfig } from "../config";
import type { BackendFactory, BackendId } from "../contract";
import type { ClaudeCodeWiring } from "./claude-code-wiring";
import type { ContractOptions } from "./contract-seam";

/** Pi with the link to terminal `pi` processes, unless the bridge's config turns it off (`pi.terminalLink: false`). */
const piWithLink: ReturnType<typeof piBackendFactory> = async (host) => {
	const config = await readConfig();
	return piBackendFactory({ link: { enabled: config.pi.terminalLink !== false, directory: defaultLinkDirectory() } })(
		host,
	);
};

/** The backends the bridge core serves: Pi, and Claude Code once `claudeCode.contract` is on (PLAN D28). */
export function contractOptions(claudeCode?: ClaudeCodeWiring): ContractOptions {
	const backends: [BackendId, BackendFactory][] = [["pi", piWithLink]];
	if (claudeCode?.backend) backends.push(["claude-code", claudeCode.backend]);
	return { backends };
}
