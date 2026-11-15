import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `~`, `~/…` and `file://` as Pi's `normalizePath` expands them (pi-coding-agent 1.5.2 `dist/utils/paths.js:100-122`).
 * A `file:` URL that names no local path (`file://host/x`) throws in Pi; here it names nothing.
 */
export function expandPath(path: string, home = homedir()): string | undefined {
	if (path === "~") return home;
	if (path.startsWith("~/")) return join(home, path.slice(2));
	if (!path.startsWith("file://")) return path;
	try {
		return fileURLToPath(path);
	} catch {
		return undefined;
	}
}
