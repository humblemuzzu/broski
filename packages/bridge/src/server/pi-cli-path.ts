/**
 * Where the user's `pi` executable is. The bridge carries no Pi of its own: it runs the one the user installed, so the
 * phone gets exactly the version, settings and extensions the terminal gets. In order:
 * 1. the bridge config key `pi.cliPath`, when it names an existing file;
 * 2. `pi` on `PATH`, which by the time this runs is the user's login-shell `PATH` (`platform/shell-env.ts`).
 */

import { statSync } from "node:fs";
import { PI_INSTALL_FIX, type PiCli } from "../backends/pi/pi-install";
import { findBinary } from "../platform";

const NOT_FOUND = `Pi is not installed, or \`pi\` is not on your login shell's PATH. ${PI_INSTALL_FIX}`;

export function resolvePiCli(
	configured: string | undefined,
	which: (name: string) => string | null = findBinary,
): PiCli {
	const path = configured?.trim();
	if (path && isFile(path)) return { found: true, path };
	const found = which("pi");
	if (found) return { found: true, path: found };
	const ignored = path ? `pi.cliPath ${path} is not a file. ` : "";
	return { found: false, reason: `${ignored}${NOT_FOUND}` };
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
