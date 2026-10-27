import { homedir } from "node:os";
import { resolve } from "node:path";

/** The daemon's own home, `~/.broski/link`, which `BROSKI_LINK_HOME` may move. */
export function linkHomeDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.BROSKI_LINK_HOME?.trim();
	return override ? resolve(override) : resolve(homedir(), ".broski", "link");
}

export type LinkPaths = {
	home: string;
	bridgeSocket: string;
	controlSocket: string;
	keyFile: string;
	configFile: string;
};

export function linkPaths(home: string = linkHomeDir()): LinkPaths {
	return {
		home,
		bridgeSocket: resolve(home, "bridge.sock"),
		controlSocket: resolve(home, "control.sock"),
		keyFile: resolve(home, "bridge.key"),
		configFile: resolve(home, "config.json"),
	};
}
