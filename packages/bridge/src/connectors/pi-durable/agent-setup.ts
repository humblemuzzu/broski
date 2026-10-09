import { join } from "node:path";
import {
	formatSkillsForPrompt,
	getAgentDir,
	loadProjectContextFiles,
	loadSkills,
} from "@earendil-works/pi-coding-agent";
import type { EnvTarget, Extension, HarnessOptions, PromptSection, Registry } from "@earendil-works/pi-durable";
import { createRegistry, defineExtension, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

export const PI_DURABLE_PROJECT_EXTENSION = "broski-project";

const PI_DURABLE_PREAMBLE = [
	"You are a coding agent running on the user's own machine, controlled from their phone.",
	"Use the tools to read, search, edit, and run code in the project directory.",
	"Prefer doing the work over asking about it: make the change, then report what you did in one or two sentences.",
].join(" ");

export type PiDurableProjectContext = {
	contextText: string;
	skillsText: string;
	contextFiles: { path: string; content: string }[];
	skillNames: string[];
	diagnostics: string[];
};

function projectSections(context: PiDurableProjectContext): PromptSection[] {
	return [
		section("preamble", () => PI_DURABLE_PREAMBLE, { tag: false }),
		section("project-context", () => context.contextText || undefined, { tag: false }),
		section("skills", () => context.skillsText || undefined, { tag: false }),
	];
}

export function loadPiDurableProjectContext(projectDir: string, agentDir: string): PiDurableProjectContext {
	const files = loadProjectContextFiles({ cwd: projectDir, agentDir });
	const loaded = loadSkills({
		cwd: projectDir,
		agentDir,
		skillPaths: [join(projectDir, ".pi/skills")],
		includeDefaults: false,
	});
	return {
		contextText: files.map((file) => `## ${file.path}\n\n${file.content}`).join("\n\n"),
		skillsText: formatSkillsForPrompt(loaded.skills),
		contextFiles: files,
		skillNames: loaded.skills.map((skill) => skill.name),
		diagnostics: loaded.diagnostics.map((diagnostic) => diagnostic.message),
	};
}

export function createPiDurableProjectExtension(context: PiDurableProjectContext): Extension {
	return defineExtension({ name: PI_DURABLE_PROJECT_EXTENSION, sections: projectSections(context) });
}

export type PiDurableAgentSetupOptions = {
	cwd: string;
	agentDir?: string;
	extensions?: readonly Extension[];
};

export type PiDurableAgentSetup = {
	registry: Registry;
	project: PiDurableProjectContext;
};

export function createPiDurableAgentSetup(options: PiDurableAgentSetupOptions): PiDurableAgentSetup {
	const agentDir = options.agentDir ?? getAgentDir();
	const project = loadPiDurableProjectContext(options.cwd, agentDir);
	const registry = createRegistry();
	registry.install(CodingTools);
	registry.install(createPiDurableProjectExtension(project));
	for (const extension of options.extensions ?? []) registry.install(extension);
	return { registry, project };
}

export function piDurableExecutionEnv(cwd: string): HarnessOptions["env"] {
	return (target: EnvTarget) => new NodeExecutionEnv({ cwd: target.cwd ?? cwd });
}
