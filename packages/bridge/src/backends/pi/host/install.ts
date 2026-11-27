/**
 * The bridge's own extension (`./extension/`) as files in a directory the bridge owns, whose entry point every `pi` the
 * bridge starts loads with `-e` (pi-coding-agent 1.5.2 `docs/cli.md`, `--extension`). It is never put where Pi looks
 * for extensions by itself, so a `pi` the user starts never loads it. Each file is written whole (a temporary file
 * renamed over it) and written again whenever it differs from what this bridge carries.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../../../adapter-kit/error-text";
import * as askSource from "./extension/ask.ts" with { type: "text" };
import * as extensionSource from "./extension/index.ts" with { type: "text" };

export const HOST_EXTENSION_FILE = "broski-host.ts";

/** The extension's flag carrying the note it adds to the system prompt (the same name in `./extension/index.ts`). */
export const PROMPT_NOTE_FLAG = "broski-prompt-note";

interface ExtensionFile {
	readonly name: string;
	readonly content: string;
}

/** Bun puts a text import into a compiled binary, where the file itself is not on disk; TypeScript types it as the module. */
function text(name: string, embedded: object): ExtensionFile {
	const content: unknown = Reflect.get(embedded, "default");
	if (typeof content !== "string") throw new Error(`the host extension's ${name} was not embedded as text`);
	return { name, content };
}

/** In the order they are written: the entry point last, so a `pi` starting meanwhile never loads it beside an old part. */
function files(): ExtensionFile[] {
	return [text("ask.ts", askSource), text(HOST_EXTENSION_FILE, extensionSource)];
}

/** `hash` names the extension's version, which a `pi` a holder kept from an earlier bridge may not run. */
export type HostExtension = { readonly path: string; readonly hash: string } | { readonly problem: string };

export function ensureHostExtension(directory: string): HostExtension {
	const path = join(directory, HOST_EXTENSION_FILE);
	try {
		const parts = files();
		const hash = createHash("sha256");
		for (const { name, content } of parts) hash.update(`${name}\0${content}\0`);
		for (const { name, content } of parts) writeIfChanged(directory, name, content);
		return { path, hash: hash.digest("hex").slice(0, 16) };
	} catch (error) {
		return { problem: `The bridge's Pi extension could not be written to ${path}: ${errorText(error)}` };
	}
}

function writeIfChanged(directory: string, name: string, content: string): void {
	const path = join(directory, name);
	if (readOrNothing(path) === content) return;
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content, { mode: 0o600 });
	renameSync(temporary, path);
}

function readOrNothing(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
