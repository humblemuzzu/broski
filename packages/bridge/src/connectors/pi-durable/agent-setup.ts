import { join } from "node:path";
import type { EnvTarget, Extension, HarnessOptions, PromptSection, Registry } from "@earendil-works/pi-durable";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import { loadPiDurable, loadPiDurableBackend, loadPiDurableNodeEnv, loadPiDurableTools } from "../../sdk/pi-durable";
import { createPiDurableSearchExtension } from "./tools";

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

async function projectSections(context: PiDurableProjectContext): Promise<PromptSection[]> {
	const { section } = await loadPiDurable();
	return [
		section("preamble", () => PI_DURABLE_PREAMBLE, { tag: false }),
		section("project-context", () => context.contextText || undefined, { tag: false }),
		section("skills", () => context.skillsText || undefined, { tag: false }),
	];
}

export async function loadPiDurableProjectContext(
	projectDir: string,
	agentDir: string,
): Promise<PiDurableProjectContext> {
	const { formatSkillsForPrompt, loadProjectContextFiles, loadSkills } = await loadPiCodingAgent();
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

export async function createPiDurableProjectExtension(context: PiDurableProjectContext): Promise<Extension> {
	const { defineExtension } = await loadPiDurable();
	return defineExtension({ name: PI_DURABLE_PROJECT_EXTENSION, sections: await projectSections(context) });
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

export async function createPiDurableAgentSetup(options: PiDurableAgentSetupOptions): Promise<PiDurableAgentSetup> {
	await loadPiDurableBackend();
	const { getAgentDir } = await loadPiCodingAgent();
	const { createRegistry } = await loadPiDurable();
	const { CodingTools } = await loadPiDurableTools();
	const agentDir = options.agentDir ?? getAgentDir();
	const project = await loadPiDurableProjectContext(options.cwd, agentDir);
	const registry = createRegistry();
	registry.install(CodingTools);
	registry.install(await createPiDurableSearchExtension(options.cwd));
	registry.install(await createPiDurableProjectExtension(project));
	for (const extension of options.extensions ?? []) registry.install(extension);
	return { registry, project };
}

export async function piDurableExecutionEnv(cwd: string): Promise<HarnessOptions["env"]> {
	const { NodeExecutionEnv } = await loadPiDurableNodeEnv();
	return (target: EnvTarget) => new NodeExecutionEnv({ cwd: target.cwd ?? cwd });
}
