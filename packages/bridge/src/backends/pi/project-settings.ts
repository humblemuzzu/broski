import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, hasTrustRequiringProjectResources, SettingsManager } from "@earendil-works/pi-coding-agent";
import { savedTrust } from "./trust-file";

type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

/**
 * The terminal's decision without a dialog, as its RPC mode makes it (pi-coding-agent `src/core/project-trust.ts:47-96`,
 * `src/main.ts:743-779`): nothing needing trust, else the saved decision for `cwd` or its nearest ancestor, else
 * `defaultProjectTrust === "always"`; `ask` distrusts, as nobody can answer. An unreadable `trust.json`, on which Pi
 * throws (`src/core/trust-manager.ts:99-124`), distrusts. Extensions' `project_trust` handlers are not run (README).
 */
export function isProjectTrusted(cwd: string, agentDir: string): boolean {
	if (!hasTrustRequiringProjectResources(cwd)) return true;
	const saved = savedTrust(cwd, agentDir);
	if (saved !== null) return saved === true;
	return settingsOf(cwd, agentDir, false).getDefaultProjectTrust() === "always";
}

/**
 * Pi's settings for `cwd` as a read sees them (a listing, a status): the global and project files as they are on disk.
 * Pi's own file storage reads each under a lock it creates beside the file and waits for a busy one in a synchronous
 * spin (`src/core/settings-manager.ts:197-250`); a read must neither write into the user's directories nor stall
 * the bridge, so this storage reads the files plainly and drops whatever it is asked to write.
 * `SettingsManager.create` trusts every project unless told otherwise (`:335`), so the trust is the terminal's.
 */
export function settingsOf(
	cwd: string | undefined,
	agentDir: string,
	projectTrusted = cwd !== undefined && isProjectTrusted(cwd, agentDir),
): SettingsManager {
	return SettingsManager.fromStorage(readOnlyStorage(cwd ?? agentDir, agentDir), { projectTrusted });
}

/** The settings a hosted session runs with: Pi's own file storage, which the session may write as the terminal's does. */
export function sessionSettingsOf(cwd: string, agentDir: string): SettingsManager {
	return SettingsManager.create(cwd, agentDir, { projectTrusted: isProjectTrusted(cwd, agentDir) });
}

/** The paths `FileSettingsStorage` reads (`src/core/settings-manager.ts:190-195`). */
function readOnlyStorage(cwd: string, agentDir: string): SettingsStorage {
	const paths = {
		global: join(resolve(agentDir), "settings.json"),
		project: join(resolve(cwd), CONFIG_DIR_NAME, "settings.json"),
	};
	return {
		withLock: (scope, read) => {
			const path = paths[scope];
			read(existsSync(path) ? readFileSync(path, "utf-8") : undefined);
		},
	};
}
