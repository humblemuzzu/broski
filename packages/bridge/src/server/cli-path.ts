/**
 * Where the user's own agent executable is. The bridge carries no agent of its own: it runs the one the user
 * installed, so the phone gets exactly the version, settings and extensions the terminal gets. In order:
 * 1. the bridge config key `<configKey>`, when it names an existing file;
 * 2. `<name>` on `PATH`, which by the time this runs is the user's login-shell `PATH` (`platform/shell-env.ts`).
 */

import { statSync } from "node:fs";
import { findBinary } from "../platform";

export type CliLookup =
	| { readonly found: true; readonly path: string }
	| { readonly found: false; readonly reason: string };

export interface CliSpec {
	readonly name: string;
	readonly configKey: string;
	/** Why there is none, and how to fix it. */
	readonly notFound: string;
}

export function resolveCli(
	spec: CliSpec,
	configured: string | undefined,
	which: (name: string) => string | null = findBinary,
): CliLookup {
	const path = configured?.trim();
	if (path && isFile(path)) return { found: true, path };
	const found = which(spec.name);
	if (found) return { found: true, path: found };
	const ignored = path ? `${spec.configKey} ${path} is not a file. ` : "";
	return { found: false, reason: `${ignored}${spec.notFound}` };
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
