/**
 * What the live tests let agy do on the user's Mac. The prompts ask only for `touch`, `echo` and `ls` and for files in
 * the test's own temp folders, but a real model may do otherwise, so no permission is allowed unless what it would run
 * or write is that: one of those commands with no shell syntax (no `;`, pipe, redirect, substitution, `..`), every
 * absolute path in it, its working folder and every file it changes inside a test folder. Anything else is a
 * permission the tests refuse. Of agy's commands, which run as prompt text, only `/compact` is sent: what another
 * command does to the account is not known here.
 */

import { isAbsolute, resolve, sep } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import type { PermissionPreview, ToolPermissionRequest } from "../../../contract";

const HARMLESS = new Set(["touch", "echo", "ls"]);
export const HARMLESS_COMMANDS: ReadonlySet<string> = new Set(["compact"]);
const SHELL_SYNTAX = /[;&|`$<>(){}\\\n\r*?!~]/;

/** Why `request` may not be allowed, or undefined when it is harmless and stays in `roots`. */
export function unsafeReason(request: ToolPermissionRequest, roots: readonly string[]): string | undefined {
	if (request.previews.length === 0) return "it shows nothing it would run or change";
	const cwd = isRecord(request.input) ? request.input.Cwd : undefined;
	if (typeof cwd === "string" && cwd !== "" && !inside(cwd, roots)) return `it runs in ${cwd}`;
	for (const preview of request.previews) {
		const reason = previewProblem(preview, roots);
		if (reason !== undefined) return reason;
	}
	return undefined;
}

function previewProblem(preview: PermissionPreview, roots: readonly string[]): string | undefined {
	switch (preview.kind) {
		case "command":
			return commandProblem(preview.command, roots);
		case "file_changes": {
			const outside = preview.changes.find((change) => !inside(change.path, roots));
			return outside === undefined ? undefined : `it changes ${outside.path}`;
		}
		case "paths": {
			const outside = preview.paths.find((path) => !inside(path, roots));
			return outside === undefined ? undefined : `it reaches ${outside}`;
		}
		case "network":
			return "it reaches the network";
	}
}

function commandProblem(command: string, roots: readonly string[]): string | undefined {
	if (SHELL_SYNTAX.test(command)) return `\`${command}\` has shell syntax`;
	const [name, ...words] = command.trim().replaceAll(/["']/g, "").split(/\s+/);
	if (name === undefined || !HARMLESS.has(name)) return `\`${command}\` is not touch, echo or ls`;
	const escaping = words.find((word) => word.split("/").includes("..") || (isAbsolute(word) && !inside(word, roots)));
	return escaping === undefined ? undefined : `\`${command}\` reaches ${escaping}`;
}

/**
 * A relative path is the tool's, in its working folder, which is checked on its own. macOS names a temp folder both
 * through `/private` and without it, so either spelling of a root counts.
 */
function inside(path: string, roots: readonly string[]): boolean {
	if (!isAbsolute(path)) return !path.split("/").includes("..");
	const full = resolve(path);
	const spellings = roots.flatMap((root) =>
		root.startsWith("/private/") ? [root, root.slice("/private".length)] : [root],
	);
	return spellings.some((root) => full === root || full.startsWith(`${root}${sep}`));
}
