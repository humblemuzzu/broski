/** Where the CLI reads each config file for a cwd (research 05 §3, §8, §9, §11), and the ids the phone addresses them by. */

import { dirname, join } from "node:path";

export type PlaceKind =
	| "settings"
	| "mcp"
	| "memory"
	| "auto-memory"
	| "agents"
	| "commands"
	| "skills"
	| "output-styles";
export type PlaceScope = "user" | "project" | "local" | "managed";

export interface ConfigPlace {
	/** `<kind>:<scope>`, plus `/<path below the directory>` for a file inside a directory kind. */
	readonly id: string;
	readonly kind: PlaceKind;
	readonly label: string;
	readonly group: string;
	readonly scope: PlaceScope;
	readonly path: string;
	/** Every real path this place reads or writes stays inside it. */
	readonly base: string;
	readonly format: "json" | "markdown" | "text";
	readonly editable: boolean;
	/** A directory a new named file goes into (a command, an agent). */
	readonly template: boolean;
}

export interface PlaceRoots {
	/** `ClaudeSdk.configRoot()`: where the CLI keeps user-level files. */
	readonly configRoot: string;
	readonly cwd: string;
	/** Where managed policy files live on this machine; undefined when the platform has none. */
	readonly managedDir: string | undefined;
	/** This project's auto memory directory, when it can be named. */
	readonly autoMemoryDir: string | undefined;
	/** Where `resolveSettings` found each settings file that exists, which is where the CLI reads it. */
	readonly settingsPaths?: Partial<Record<"project" | "local", string>>;
	/** Every settings file `resolveSettings` loaded something from, as reported and as resolved; a file not here is skipped. */
	readonly loadedSettings?: ReadonlySet<string>;
}

export type Resolved = ConfigPlace | { readonly problem: string } | undefined;

const GROUPS: Record<PlaceKind, string> = {
	settings: "Settings",
	mcp: "MCP",
	memory: "Memory",
	"auto-memory": "Memory",
	agents: "Agents",
	commands: "Commands",
	skills: "Skills",
	"output-styles": "Output styles",
};

const DIRECTORY_NAMES: Partial<Record<PlaceKind, string>> = {
	agents: "agents",
	commands: "commands",
	skills: "skills",
	"output-styles": "output-styles",
};

const DIRECTORY_KINDS: readonly PlaceKind[] = ["agents", "commands", "skills", "output-styles", "auto-memory"];
const NOUNS: Partial<Record<PlaceKind, string>> = {
	agents: "agent",
	commands: "command",
	skills: "skill",
	"output-styles": "output style",
	"auto-memory": "memory note",
};
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const MAX_DEPTH = 4;

export function managedDirFor(platform: NodeJS.Platform): string | undefined {
	if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
	if (platform === "linux") return "/etc/claude-code";
	return undefined;
}

interface Made {
	readonly label: string;
	readonly path: string;
	readonly format?: ConfigPlace["format"];
	readonly suffix?: string;
	readonly template?: boolean;
}

function reportedSettings(roots: PlaceRoots, scope: PlaceScope): string | undefined {
	return scope === "project" || scope === "local" ? roots.settingsPaths?.[scope] : undefined;
}

function baseOf(roots: PlaceRoots, kind: PlaceKind, scope: PlaceScope): string {
	if (kind === "auto-memory") return roots.autoMemoryDir ?? roots.configRoot;
	if (scope === "managed") return roots.managedDir ?? "/";
	const reported = kind === "settings" ? reportedSettings(roots, scope) : undefined;
	if (reported !== undefined && scope !== "user") return dirname(dirname(reported));
	return scope === "user" ? roots.configRoot : roots.cwd;
}

function place(roots: PlaceRoots, kind: PlaceKind, scope: PlaceScope, made: Made): ConfigPlace {
	return {
		id: `${kind}:${scope}${made.suffix ?? ""}`,
		kind,
		label: made.label,
		group: GROUPS[kind],
		scope,
		path: made.path,
		base: baseOf(roots, kind, scope),
		format: made.format ?? "markdown",
		editable: scope !== "managed",
		template: made.template ?? false,
	};
}

const SETTINGS_LABELS: Record<PlaceScope, string> = {
	user: "User settings",
	project: "Project settings (shared)",
	local: "Local settings (this machine)",
	managed: "Managed settings (policy)",
};

function settingsPath(roots: PlaceRoots, scope: PlaceScope): string {
	const reported = reportedSettings(roots, scope);
	if (reported !== undefined) return reported;
	if (scope === "user") return join(roots.configRoot, "settings.json");
	if (scope === "managed") return join(roots.managedDir ?? "/", "managed-settings.json");
	return join(roots.cwd, ".claude", scope === "local" ? "settings.local.json" : "settings.json");
}

/** The files that are always the same few paths. */
export function fixedPlaces(roots: PlaceRoots): ConfigPlace[] {
	const scopes: PlaceScope[] =
		roots.managedDir === undefined ? ["user", "project", "local"] : ["user", "project", "local", "managed"];
	const places = scopes.map((scope) =>
		place(roots, "settings", scope, {
			label: SETTINGS_LABELS[scope],
			path: settingsPath(roots, scope),
			format: "json",
		}),
	);
	places.push(
		place(roots, "mcp", "project", {
			label: ".mcp.json (project MCP servers)",
			path: join(roots.cwd, ".mcp.json"),
			format: "json",
		}),
		place(roots, "memory", "user", { label: "CLAUDE.md (all projects)", path: join(roots.configRoot, "CLAUDE.md") }),
		place(roots, "memory", "project", { label: "CLAUDE.md (project)", path: join(roots.cwd, "CLAUDE.md") }),
		place(roots, "memory", "project", {
			label: ".claude/CLAUDE.md (project)",
			path: join(roots.cwd, ".claude", "CLAUDE.md"),
			suffix: "-claude-dir",
		}),
		place(roots, "memory", "local", {
			label: "CLAUDE.local.md (this machine)",
			path: join(roots.cwd, "CLAUDE.local.md"),
		}),
	);
	if (roots.managedDir !== undefined) {
		const path = join(roots.managedDir, "CLAUDE.md");
		places.push(place(roots, "memory", "managed", { label: "Managed CLAUDE.md (policy)", path }));
	}
	return places;
}

function directoryOf(roots: PlaceRoots, kind: PlaceKind, scope: "user" | "project"): string | undefined {
	if (kind === "auto-memory") return scope === "project" ? roots.autoMemoryDir : undefined;
	const name = DIRECTORY_NAMES[kind];
	if (name === undefined) return undefined;
	return scope === "user" ? join(roots.configRoot, name) : join(roots.cwd, ".claude", name);
}

/** The directories a new named file goes into. */
export function templatePlaces(roots: PlaceRoots): ConfigPlace[] {
	const places: ConfigPlace[] = [];
	for (const kind of DIRECTORY_KINDS) {
		for (const scope of ["user", "project"] as const) {
			const path = directoryOf(roots, kind, scope);
			if (path === undefined) continue;
			const where = kind === "auto-memory" ? "this project" : scope;
			places.push(place(roots, kind, scope, { label: `New ${NOUNS[kind]} (${where})`, path, template: true }));
		}
	}
	return places;
}

function validSegment(segment: string): boolean {
	return segment !== "" && !segment.startsWith(".") && !/[\\\0]/.test(segment) && segment.length <= 255;
}

function validRelative(kind: PlaceKind, rel: string): boolean {
	const segments = rel.split("/");
	if (segments.length > MAX_DEPTH || !segments.every(validSegment)) return false;
	const file = segments[segments.length - 1] ?? "";
	if (kind === "skills") return segments.length === 2 && file === "SKILL.md";
	return file.endsWith(".md");
}

function member(directory: ConfigPlace, rel: string): ConfigPlace {
	return {
		...directory,
		id: `${directory.id}/${rel}`,
		path: join(directory.path, ...rel.split("/")),
		template: false,
		label: rel,
	};
}

function namedMember(directory: ConfigPlace, name: string): Resolved {
	const bare = name.endsWith(".md") ? name.slice(0, -3) : name;
	if (!NAME_PATTERN.test(bare)) return { problem: `"${name}" is not a usable file name` };
	return member(directory, directory.kind === "skills" ? `${bare}/SKILL.md` : `${bare}.md`);
}

/**
 * The place an id names: a fixed file, a template directory (with `name`: the new file in it), or a file inside a
 * directory. `undefined`: the id names nothing this adapter listed; `problem`: the id is right and the request is not.
 */
export function resolvePlace(roots: PlaceRoots, id: string, name?: string): Resolved {
	const slash = id.indexOf("/");
	const head = slash < 0 ? id : id.slice(0, slash);
	const rel = slash < 0 ? undefined : id.slice(slash + 1);
	const known = [...fixedPlaces(roots), ...templatePlaces(roots)].find((candidate) => candidate.id === head);
	if (known === undefined) return undefined;
	if (rel !== undefined) {
		if (!known.template || !validRelative(known.kind, rel)) return undefined;
		return name === undefined ? member(known, rel) : { problem: "a name is only for a new file" };
	}
	if (name === undefined) return known;
	return known.template ? namedMember(known, name) : { problem: "this file takes no name" };
}

/** What a new file of a kind starts as, so the first save already is something the CLI reads. */
export function starterText(place: ConfigPlace): string {
	if (place.format === "json") return "{}\n";
	const parts = place.id.slice(place.id.indexOf("/") + 1).split("/");
	const name = (parts[0] === "" ? "" : (parts[0] ?? "")).replace(/\.md$/, "");
	switch (place.kind) {
		case "agents":
			return `---\nname: ${name}\ndescription: Describe when this agent should be used\n---\n\nYou are ${name}.\n`;
		case "commands":
			return "---\ndescription: Describe what this command does\n---\n\n$ARGUMENTS\n";
		case "skills":
			return `---\nname: ${name}\ndescription: Describe what this skill does and when to use it\n---\n\n`;
		case "output-styles":
			return `---\nname: ${name}\ndescription: Describe this output style\n---\n\n`;
		default:
			return "";
	}
}
