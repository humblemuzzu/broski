/**
 * `listCommands` (D12): prompt templates, skills and extension commands, named by `command-ids.ts`.
 * Pi's own TUI commands are the contract's `compact`, `setModel` and `session.create` instead.
 */

import {
	type AgentSession,
	DefaultResourceLoader,
	type Extension,
	type InlineExtension,
	type PromptTemplate,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import { type CommandSummary, type CommandsListResult, MAX_CATALOG_ITEMS } from "../../contract";
import { CommandCache } from "./command-cache";
import { commandId, commandKind, type PiCommandSource } from "./command-ids";
import { errorText } from "./error-text";
import { withoutPackageInstalls } from "./no-package-installs";
import { rowText } from "./phone-text";
import { settingsOf } from "./project-settings";
import { rejected } from "./rejections";

export interface CommandSources {
	readonly agentDir: string;
	/** The extensions a session of the cwd loads, without the session's own gate. */
	readonly extensions: () => InlineExtension[];
}

interface Commands {
	readonly extensions: readonly { readonly name: string; readonly description?: string | undefined }[];
	readonly templates: readonly PromptTemplate[];
	readonly skills: readonly Skill[];
	readonly skillCommands: boolean;
}

interface Entry {
	readonly source: PiCommandSource;
	readonly name: string;
	readonly description?: string | undefined;
	readonly argumentHint?: string | undefined;
}

function byName(a: Entry, b: Entry): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * The names the extension runner gives its commands: a name two extensions both register becomes `name:1`,
 * `name:2`, and a name already taken moves on to the next free suffix (pi-coding-agent
 * `ExtensionRunner.resolveRegisteredCommands`, `src/core/extensions/runner.ts:814-848`).
 */
export function invocationNames(extensions: readonly Extension[]): { name: string; description?: string }[] {
	const registered = extensions.flatMap((extension) => [...extension.commands.values()]);
	const counts = new Map<string, number>();
	for (const command of registered) counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
	const seen = new Map<string, number>();
	const taken = new Set<string>();
	return registered.map((command) => {
		const occurrence = (seen.get(command.name) ?? 0) + 1;
		seen.set(command.name, occurrence);
		let name = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;
		let suffix = occurrence;
		while (taken.has(name)) name = `${command.name}:${++suffix}`;
		taken.add(name);
		return command.description === undefined ? { name } : { name, description: command.description };
	});
}

/**
 * A template or skill an extension command of the same name hides: `prompt()` tries extension commands
 * before it expands either (pi-coding-agent `src/core/agent-session.ts:2101-2133`).
 */
function entriesOf(found: Commands): Entry[] {
	const hidden = new Set(found.extensions.map((command) => command.name));
	const templates = found.templates
		.filter((template) => !hidden.has(template.name))
		.map(
			(template): Entry => ({
				source: "template",
				name: template.name,
				description: template.description,
				argumentHint: template.argumentHint,
			}),
		);
	const skills = found.skillCommands
		? found.skills
				.filter((skill) => !hidden.has(`skill:${skill.name}`))
				.map((skill): Entry => ({ source: "skill", name: skill.name, description: skill.description }))
		: [];
	const extensions = found.extensions.map((command): Entry => ({ source: "extension", ...command }));
	return [...templates.sort(byName), ...skills.sort(byName), ...extensions.sort(byName)];
}

function summariesOf(entries: readonly Entry[]): CommandSummary[] {
	return entries
		.flatMap((entry) => {
			const id = commandId(entry);
			if (id === undefined) return [];
			const description = rowText(entry.description);
			const argumentHint = rowText(entry.argumentHint);
			return {
				id,
				name: entry.name,
				kind: commandKind(entry.source),
				...(description !== "" && { description }),
				...(argumentHint !== "" && { argumentHint }),
			};
		})
		.slice(0, MAX_CATALOG_ITEMS);
}

function fromSession(session: AgentSession): Commands {
	return {
		extensions: session.extensionRunner.getRegisteredCommands().map(({ invocationName, description }) => ({
			name: invocationName,
			description,
		})),
		templates: session.promptTemplates,
		skills: session.resourceLoader.getSkills().skills,
		skillCommands: session.settingsManager.getEnableSkillCommands(),
	};
}

/** Runs every extension factory again; a module's code is imported once per directory and process (`extensions/loader.ts:132-154, 555-591`), so an edited extension file shows only after another directory loads. */
async function fromLoader(sources: CommandSources, cwd: string | undefined): Promise<Commands> {
	const settings = settingsOf(cwd, sources.agentDir);
	const loader = new DefaultResourceLoader({
		cwd: cwd ?? sources.agentDir,
		agentDir: sources.agentDir,
		settingsManager: settings,
		extensionFactories: sources.extensions(),
		noThemes: true,
		noContextFiles: true,
	});
	await withoutPackageInstalls(
		{ cwd: cwd ?? sources.agentDir, agentDir: sources.agentDir, settingsManager: settings },
		() => loader.reload(),
	);
	return {
		extensions: invocationNames(loader.getExtensions().extensions),
		templates: loader.getPrompts().prompts,
		skills: loader.getSkills().skills,
		skillCommands: settings.getEnableSkillCommands(),
	};
}

/**
 * From the live session when one is hosted, else from a resource loader of `cwd` (global resources only without one),
 * kept by `CommandCache` while what it read is unchanged.
 */
export class PiCommandLister {
	private readonly cache: CommandCache<Commands>;

	constructor(private readonly sources: CommandSources) {
		this.cache = new CommandCache(sources.agentDir);
	}

	async list(scope: {
		readonly cwd?: string | undefined;
		readonly session?: AgentSession;
	}): Promise<CommandsListResult> {
		try {
			const found = scope.session
				? fromSession(scope.session)
				: await this.cache.get(scope.cwd, () => fromLoader(this.sources, scope.cwd));
			return { status: "accepted", commands: summariesOf(entriesOf(found)) };
		} catch (error) {
			return rejected("backend_error", `Pi could not list its commands: ${errorText(error)}`);
		}
	}
}
