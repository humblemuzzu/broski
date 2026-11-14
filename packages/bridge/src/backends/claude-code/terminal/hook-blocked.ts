/**
 * Our terminal ask hook is installed, but an `allowedHttpHookUrls` list the user did not let us change (project, local,
 * managed) leaves its URL out, so the CLI never calls it and terminal prompts stay on the terminal (D29). The lists
 * merge across sources (`Settings.allowedHttpHookUrls`), so the merged list decides; the sources that keep one are named. Nothing
 * here edits a file: a project's or an organisation's settings are theirs.
 */

import type { ResolvedSettings } from "@anthropic-ai/claude-agent-sdk";
import type { StatusIssue } from "../../../contract";
import { isRecord } from "../json";
import { urlAllowedBy } from "./allowed-urls";
import { isOwnUrl } from "./hook-settings";

export interface BlockedHook {
	readonly url: string;
	readonly sources: readonly string[];
}

function ownHookUrl(hooks: unknown): string | undefined {
	const groups = isRecord(hooks) ? hooks.PermissionRequest : undefined;
	if (!Array.isArray(groups)) return undefined;
	for (const group of groups) {
		const entries = isRecord(group) ? group.hooks : undefined;
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) if (isRecord(entry) && isOwnUrl(entry.url)) return entry.url;
	}
	return undefined;
}

export function blockedHook(resolved: ResolvedSettings): BlockedHook | undefined {
	const url = ownHookUrl(resolved.effective.hooks);
	const allowed: unknown = resolved.effective.allowedHttpHookUrls;
	if (url === undefined || !Array.isArray(allowed)) return undefined;
	if (allowed.some((pattern) => typeof pattern === "string" && urlAllowedBy(url, pattern))) return undefined;
	const sources = resolved.sources.filter(({ settings }) => Array.isArray(settings.allowedHttpHookUrls));
	return { url, sources: [...new Set(sources.map(({ source }) => source))] };
}

function blockedHookText(blocked: BlockedHook): string {
	const where = blocked.sources.length > 0 ? `${blocked.sources.join(" and ")} settings` : "the settings";
	return `Terminal permission prompts cannot reach the phone: allowedHttpHookUrls in ${where} does not list ${blocked.url}, so Claude Code does not call Broski's hook. Add that URL there; Broski does not change project or managed settings.`;
}

/** The status warning, read from the user's and the managed settings, which hold for every project. */
export function blockedHookIssue(resolved: ResolvedSettings): StatusIssue | undefined {
	const blocked = blockedHook(resolved);
	return blocked === undefined ? undefined : { severity: "warning", message: blockedHookText(blocked) };
}
