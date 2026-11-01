/**
 * A probe that reads `~/.claude` or `~/.broski` through `os.homedir()` runs only with `HOME` (and `CLAUDE_CONFIG_DIR`,
 * when set) inside a temp dir, so it can never read or write the developer's real config.
 */

import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { sep } from "node:path";

function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function isInsideTemp(path: string): boolean {
	const target = real(path);
	return [real(tmpdir()), real("/tmp")].some((temp) => target.startsWith(`${temp}${sep}`));
}

/** Exits with code 2 unless the home and config dir this process reads are temp dirs. */
export function refuseRealHome(probe: string, env: Record<string, string | undefined> = process.env): void {
	const config = env.CLAUDE_CONFIG_DIR;
	const homes = [homedir(), ...(config === undefined ? [] : [config])];
	const outside = homes.filter((path) => !isInsideTemp(path));
	if (outside.length === 0) return;
	console.error(`${probe}: refusing to run, ${outside.join(" and ")} is not a temp dir; set HOME to one first`);
	process.exit(2);
}
