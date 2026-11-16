/** The options of a tool permission: plain allow/deny once, then one per kind of grant the CLI suggested (D15). */

import type { PermissionUpdate, PermissionUpdateDestination } from "@anthropic-ai/claude-agent-sdk";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS, type PermissionOption } from "../../../contract";
import { clip } from "../bounds";
import { phoneText } from "../phone-text";

export const ALLOW_ONCE = "allow_once";
export const DENY_ONCE = "deny_once";
export const DENY_STOP = "deny_stop";

/** What choosing an option does beyond its labels: the updates it sends back, whether it ends the run. */
export interface OptionEffect {
	readonly effect: PermissionOption["effect"];
	readonly stopsRun: boolean;
	readonly updates: readonly PermissionUpdate[];
	readonly persistent: boolean;
}

export interface PermissionChoices {
	readonly options: PermissionOption[];
	readonly effects: ReadonlyMap<string, OptionEffect>;
}

const SUGGESTIONS_KEPT = 64;
const RULE_IN_LABEL = 80;

const PERSISTENT_PLACES: readonly { destination: PermissionUpdateDestination; id: string; where: string }[] = [
	{ destination: "userSettings", id: "allow_always_user", where: "all your projects" },
	{ destination: "projectSettings", id: "allow_always_project", where: "this project, shared" },
	{ destination: "localSettings", id: "allow_always_local", where: "this project, only for you" },
];

/** `hidePersistent` is the CLI's `suppressAlwaysAllowRule`: no option that writes a rule to a settings file. */
export function permissionChoices(
	suggestions: readonly PermissionUpdate[],
	hidePersistent: boolean,
): PermissionChoices {
	const grants = grantChoices(suggestions, hidePersistent);
	const options: PermissionOption[] = [
		{ id: ALLOW_ONCE, label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
		...grants.options,
	];
	const effects = new Map<string, OptionEffect>([[ALLOW_ONCE, effectOf("allow", false, [])], ...grants.effects]);
	options.push(
		{ id: DENY_ONCE, label: "Deny", effect: "deny", scope: "once", stopsRun: false, message: "optional" },
		{ id: DENY_STOP, label: "Deny and stop", effect: "deny", scope: "once", stopsRun: true, message: "none" },
	);
	effects.set(DENY_ONCE, effectOf("deny", false, []));
	effects.set(DENY_STOP, effectOf("deny", true, []));
	return { options: options.slice(0, MAX_LIST_ITEMS), effects };
}

/** One option per kind of grant the CLI suggested: this session, then each settings file it would write. */
export function grantChoices(suggestions: readonly PermissionUpdate[], hidePersistent: boolean): PermissionChoices {
	const options: PermissionOption[] = [];
	const effects = new Map<string, OptionEffect>();
	const kept = suggestions.slice(0, SUGGESTIONS_KEPT);
	addSession(kept, options, effects);
	if (!hidePersistent) addPersistent(kept, options, effects);
	return { options, effects };
}

function effectOf(
	effect: OptionEffect["effect"],
	stopsRun: boolean,
	updates: readonly PermissionUpdate[],
): OptionEffect {
	return { effect, stopsRun, updates, persistent: false };
}

function addSession(
	suggestions: readonly PermissionUpdate[],
	options: PermissionOption[],
	effects: Map<string, OptionEffect>,
): void {
	const updates = suggestions.filter((update) => update.destination === "session" || update.destination === "cliArg");
	if (updates.length === 0) return;
	options.push({
		id: "allow_session",
		label: sessionLabel(updates),
		effect: "allow",
		scope: "session",
		stopsRun: false,
		message: "none",
	});
	effects.set("allow_session", effectOf("allow", false, updates));
}

function addPersistent(
	suggestions: readonly PermissionUpdate[],
	options: PermissionOption[],
	effects: Map<string, OptionEffect>,
): void {
	for (const place of PERSISTENT_PLACES) {
		const updates = suggestions.filter((update) => update.destination === place.destination);
		if (updates.length === 0) continue;
		const rule = ruleText(updates);
		options.push({
			id: place.id,
			label: clip(`Always allow ${clip(rule, RULE_IN_LABEL)} (${place.where})`, MAX_NAME_CHARS),
			effect: "allow",
			scope: "always",
			stopsRun: false,
			message: "none",
			rule,
		});
		effects.set(place.id, { effect: "allow", stopsRun: false, updates, persistent: true });
	}
}

function sessionLabel(updates: readonly PermissionUpdate[]): string {
	const [only] = updates;
	if (updates.length === 1 && only?.type === "setMode" && only.mode === "acceptEdits") {
		return "Allow all edits this session";
	}
	return "Allow for this session";
}

/** The suggested updates as the CLI words its rules: `Bash(npm test:*)`, `mode acceptEdits`. */
function ruleText(updates: readonly PermissionUpdate[]): string {
	return clip(updates.map(updateText).join("; "), MAX_TEXT_CHARS);
}

function updateText(update: PermissionUpdate): string {
	switch (update.type) {
		case "addRules":
			return update.behavior === "allow"
				? update.rules.map(ruleOf).join(", ")
				: `${update.behavior} ${update.rules.map(ruleOf).join(", ")}`;
		case "replaceRules":
		case "removeRules":
			return `${update.type} ${update.behavior}: ${update.rules.map(ruleOf).join(", ")}`;
		case "setMode":
			return `mode ${update.mode}`;
		case "addDirectories":
		case "removeDirectories":
			return `${update.type}: ${update.directories.map((dir) => phoneText(dir, MAX_NAME_CHARS)).join(", ")}`;
	}
}

function ruleOf(rule: { toolName: string; ruleContent?: string }): string {
	const name = phoneText(rule.toolName, MAX_NAME_CHARS);
	if (rule.ruleContent === undefined || rule.ruleContent === "") return name;
	return `${name}(${phoneText(rule.ruleContent, MAX_NAME_CHARS)})`;
}
