/** Pi's `httpProxy` setting as the bridge reads it: from the global `settings.json`, again whenever the file changes. */

import { statSync } from "node:fs";
import { join } from "node:path";
import { settingsOf } from "../project-settings";
import { type ProxyOutcome, proxyOutcome } from "./proxy-plan";

function stampOf(path: string): string {
	try {
		const stat = statSync(path);
		return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
	} catch {
		return "missing";
	}
}

export class ProxySetting {
	private stamp: string | undefined;
	private setting: string | undefined;

	constructor(
		private readonly agentDir: string,
		private readonly env: () => NodeJS.ProcessEnv = () => process.env,
	) {}

	/** What the setting comes to now; one `stat` while the file is unchanged. */
	outcome(): ProxyOutcome {
		const stamp = stampOf(join(this.agentDir, "settings.json"));
		if (stamp !== this.stamp) {
			const configured: unknown = settingsOf(undefined, this.agentDir).getGlobalSettings().httpProxy;
			this.setting = typeof configured === "string" && configured.trim() !== "" ? configured.trim() : undefined;
			this.stamp = stamp;
		}
		return proxyOutcome(this.setting, this.env());
	}
}
