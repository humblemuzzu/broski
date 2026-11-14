import { piBackendFactory } from "../backends/pi/factory";
import { defaultLinkDirectory } from "../backends/pi/terminal/link";
import { readConfig } from "../config";
import type { ClaudeCodeWiring } from "./claude-code-wiring";
import type { ContractOptions } from "./contract-seam";

/** Pi with the link to terminal `pi` processes, unless the bridge's config turns it off (`pi.terminalLink: false`). */
const piWithLink: ReturnType<typeof piBackendFactory> = async (host) => {
	const config = await readConfig();
	return piBackendFactory({ link: { enabled: config.pi.terminalLink !== false, directory: defaultLinkDirectory() } })(
		host,
	);
};

/** The backends the bridge core serves: Pi and Claude Code. */
export function contractOptions(claudeCode: ClaudeCodeWiring): ContractOptions {
	return {
		backends: [
			["pi", piWithLink],
			["claude-code", claudeCode.backend],
		],
	};
}
