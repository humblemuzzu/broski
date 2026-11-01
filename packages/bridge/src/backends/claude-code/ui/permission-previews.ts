/** What a tool permission shows besides its input: the command, the paths, the host, the file changes (bounded). */

import {
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	MAX_TEXT_CHARS,
	type PermissionPreview,
} from "../../../contract";
import { boundList, clip } from "../bounds";
import { fileChangesOf } from "../mapping/file-changes";
import { plain } from "./text";

const SHELLS = new Set(["Bash", "PowerShell"]);
const PATH_KEYS = ["file_path", "notebook_path", "path"] as const;

export function permissionPreviews(
	toolName: string,
	input: Readonly<Record<string, unknown>>,
	blockedPath: string | undefined,
): PermissionPreview[] {
	const previews: PermissionPreview[] = [];
	const command = text(input.command);
	if (SHELLS.has(toolName) && command !== undefined) {
		previews.push({ kind: "command", command: clip(command, MAX_TEXT_CHARS) });
	}
	const changes = boundList(fileChangesOf(toolName, input, undefined)).items;
	if (changes.length > 0) previews.push({ kind: "file_changes", changes });
	const paths = pathsOf(input, blockedPath);
	if (paths.length > 0 && changes.length === 0) previews.push({ kind: "paths", paths });
	const network = networkOf(toolName, input);
	if (network) previews.push(network);
	return previews;
}

function pathsOf(input: Readonly<Record<string, unknown>>, blockedPath: string | undefined): string[] {
	const found = [...PATH_KEYS.map((key) => text(input[key])), blockedPath].flatMap((path) =>
		path === undefined || path === "" ? [] : [clip(path, MAX_PATH_CHARS)],
	);
	return boundList([...new Set(found)], MAX_LIST_ITEMS).items;
}

function networkOf(toolName: string, input: Readonly<Record<string, unknown>>): PermissionPreview | undefined {
	const url = toolName === "WebFetch" ? text(input.url) : undefined;
	if (url === undefined || !URL.canParse(url)) return undefined;
	const parsed = new URL(url);
	const host = plain(parsed.host, MAX_NAME_CHARS);
	if (host === "") return undefined;
	return { kind: "network", host, protocol: plain(parsed.protocol.replace(/:$/, ""), MAX_NAME_CHARS) };
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
