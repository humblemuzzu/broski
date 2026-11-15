/**
 * The bridge's own extension (`./extension/index.ts`) as a file in a directory the bridge owns, which every `pi` the
 * bridge starts loads with `-e` (pi-coding-agent 1.5.2 `docs/cli.md`, `--extension`). It is never put where Pi looks
 * for extensions by itself, so a `pi` the user starts never loads it. The file is written whole (a temporary file
 * renamed over it) and written again whenever it differs from what this bridge carries.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../error-text";
import * as extensionSource from "./extension/index.ts" with { type: "text" };

export const HOST_EXTENSION_FILE = "broski-host.ts";

/** Bun puts a text import into a compiled binary, where the file itself is not on disk; TypeScript types it as the module. */
function source(): string {
	const text: unknown = Reflect.get(extensionSource, "default");
	if (typeof text !== "string") throw new Error("the host extension was not embedded as text");
	return text;
}

export type HostExtension = { readonly path: string } | { readonly problem: string };

export function ensureHostExtension(directory: string): HostExtension {
	const path = join(directory, HOST_EXTENSION_FILE);
	try {
		const content = source();
		if (readOrNothing(path) === content) return { path };
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, content, { mode: 0o600 });
		renameSync(temporary, path);
		return { path };
	} catch (error) {
		return { problem: `The bridge's Pi extension could not be written to ${path}: ${errorText(error)}` };
	}
}

function readOrNothing(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
