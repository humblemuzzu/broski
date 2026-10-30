/**
 * The Broski link extension in the user's Pi agent directory. Pi loads every `*.ts` or `*.js` file and every
 * `<dir>/index.ts` under `<agentDir>/extensions/` (pi-coding-agent `src/core/package-manager.ts:599-651`,
 * `addAutoDiscoveredResources`, `:2537-2544`), unless that folder is itself one extension (an `index.ts`/`index.js`
 * or a `package.json` with `pi.extensions` at its top), when Pi loads only that. The bridge owns the folder
 * `extensions/broski-link/`: it writes the files of `./extension/` there, and rewrites them when they differ. A folder
 * of that name whose `index.ts` does not begin with `MARKER` is somebody else's, and is left alone.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorText } from "../error-text";
import { EXTENSION_FILES } from "./extension-sources";

/** The first line of the extension's `index.ts` up to its version: what says the files are the bridge's. */
export const MARKER = "// broski-link-extension ";

export const EXTENSION_NAME = "broski-link";

export type InstallResult =
	| { readonly kind: "installed" | "updated" | "current" | "removed" | "absent" }
	| { readonly kind: "problem"; readonly reason: string };

export function extensionDirectory(agentDir: string): string {
	return join(agentDir, "extensions", EXTENSION_NAME);
}

/** The entry point of the installed extension: how Pi names the extension it loaded from there. */
export function extensionEntry(agentDir: string): string {
	return join(extensionDirectory(agentDir), "index.ts");
}

function installed(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/** Whether `path` is an extension the bridge wrote: its entry point opens with the marker. */
function isOurs(entry: string): boolean {
	return installed(entry)?.startsWith(MARKER) === true;
}

function replaceFile(path: string, content: string): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content);
	renameSync(temporary, path);
}

/** Whether Pi would take `<agentDir>/extensions` for one extension and so never look at `broski-link/` beside its files. */
function folderIsAnExtension(folder: string): boolean {
	if (existsSync(join(folder, "index.ts")) || existsSync(join(folder, "index.js"))) return true;
	const manifest = installed(join(folder, "package.json"));
	if (manifest === undefined) return false;
	try {
		const declared: unknown = JSON.parse(manifest)?.pi?.extensions;
		return (
			Array.isArray(declared) && declared.some((path) => typeof path === "string" && existsSync(resolve(folder, path)))
		);
	} catch {
		return false;
	}
}

export function installExtension(agentDir: string): InstallResult {
	const folder = join(agentDir, "extensions");
	const directory = extensionDirectory(agentDir);
	try {
		mkdirSync(folder, { recursive: true });
		if (folderIsAnExtension(folder)) {
			return { kind: "problem", reason: `${folder} is itself one extension, so Pi does not look in it for others.` };
		}
		if (existsSync(directory) && !isOurs(extensionEntry(agentDir))) {
			return { kind: "problem", reason: `${directory} holds an extension Broski did not write; it was left alone.` };
		}
		const fresh = !existsSync(directory);
		mkdirSync(directory, { recursive: true });
		let changed = false;
		for (const { name, content } of EXTENSION_FILES) {
			const path = join(directory, name);
			if (installed(path) === content) continue;
			replaceFile(path, content);
			changed = true;
		}
		return { kind: fresh ? "installed" : changed ? "updated" : "current" };
	} catch (error) {
		return { kind: "problem", reason: `The Broski link could not be installed in ${directory}: ${errorText(error)}` };
	}
}

/** Removes the bridge's files and the folder when nothing else is in it. */
export function uninstallExtension(agentDir: string): InstallResult {
	const directory = extensionDirectory(agentDir);
	if (!existsSync(directory)) return { kind: "absent" };
	try {
		if (!isOurs(extensionEntry(agentDir))) {
			return { kind: "problem", reason: `${directory} holds an extension Broski did not write; it was left alone.` };
		}
		for (const { name } of [...EXTENSION_FILES].reverse()) {
			try {
				unlinkSync(join(directory, name));
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			}
		}
		try {
			rmdirSync(directory);
		} catch {
			// Something else is in the folder: it stays.
		}
		return { kind: "removed" };
	} catch (error) {
		return { kind: "problem", reason: `The Broski link could not be removed from ${directory}: ${errorText(error)}` };
	}
}

/** Whether `entry`, the path Pi names a loaded extension by, is the Broski link's entry point under `agentDir`. */
export function isBroskiLink(agentDir: string, entry: string): boolean {
	return resolve(entry) === resolve(extensionEntry(agentDir));
}
