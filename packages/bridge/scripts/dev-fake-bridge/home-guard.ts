import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

/**
 * Every place the bridge and the agents it hosts derive from the home directory. The fake bridge
 * registers only the contract's fake backend, but the server around it still reads these (config,
 * logs, the link key, the prompt journal), so each must point into the temp directory.
 */
export const HOME_DERIVED_ENV = [
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_CACHE_HOME",
	"PI_CODING_AGENT_DIR",
	"PI_DURABLE_ROOT",
	"CODEX_HOME",
	"CODEX_SQLITE_HOME",
	"CLAUDE_CONFIG_DIR",
	"BROSKI_DIR",
	"BROSKI_CONFIG_DIR",
	"BROSKI_CACHE_DIR",
	"BROSKI_LOG_DIR",
	"BROSKI_LINK_HOME",
] as const;

/**
 * Why the fake bridge must not start: the home directory, or a home-derived path set in `env`, lies
 * outside the temp directory. Null when nothing does, or when `BROSKI_DEV_REAL_HOME=1` says to use them.
 */
export function homeOutsideTemp(env: NodeJS.ProcessEnv = process.env): string | null {
	if (env.BROSKI_DEV_REAL_HOME === "1") return null;
	const temp = realPath(tmpdir());
	const places: [string, string][] = [["HOME", env.HOME || homedir()]];
	for (const name of HOME_DERIVED_ENV) {
		const value = env[name];
		if (value) places.push([name, value]);
	}
	const outside = places.filter(([, path]) => relative(temp, realPath(path)).startsWith(".."));
	if (outside.length === 0) return null;
	const named = outside.map(([name, path]) => `${name}=${path}`).join(", ");
	return `${named} outside ${temp}; set BROSKI_DEV_REAL_HOME=1 to use them anyway`;
}

/** The real path of `path`, or of its nearest existing ancestor joined with the rest. */
function realPath(path: string): string {
	const absolute = resolve(path);
	if (existsSync(absolute)) return realpathSync(absolute);
	const parent = dirname(absolute);
	return parent === absolute ? absolute : join(realPath(parent), basename(absolute));
}
