import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { type CommandSources, PiCommandLister } from "../../backends/pi/commands";
import { builtinExtensions } from "../../backends/pi/ui/extensions";
import { type CommandSummary, CommandsListed, CommandsListResult } from "../../contract";
import { createWorld, trustProject, type World, writeAgentFile, writeFile, writeSettings } from "./catalogue_support";

let world: World;
let inline: InlineExtension[];

beforeEach(async () => {
	world = await createWorld();
	inline = [];
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

const sources = (): CommandSources => ({ agentDir: world.env.agentDir, extensions: () => inline });

async function commands(cwd?: string): Promise<CommandSummary[]> {
	const listed = await new PiCommandLister(sources()).list({ cwd });
	expect(CommandsListResult.safeParse(listed).success).toBe(true);
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	expect(CommandsListed.safeParse(listed).success).toBe(true);
	expect(new Set(listed.commands.map((command) => command.id)).size).toBe(listed.commands.length);
	return listed.commands;
}

const extensionFile = (commandNames: string[], description = "A command") =>
	`export default function (pi) {\n${commandNames
		.map(
			(name) =>
				`\tpi.registerCommand(${JSON.stringify(name)}, { description: ${JSON.stringify(description)}, handler: async () => {} });`,
		)
		.join("\n")}\n}\n`;

const template = (description: string, hint?: string) =>
	`---\ndescription: ${description}\n${hint ? `argument-hint: "${hint}"\n` : ""}---\nBody of the template.\n`;

const skill = (name: string, description: string) =>
	`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

function writeUserResources(): void {
	writeAgentFile(world.env, "prompts/review.md", template("Review the diff", "[path]"));
	writeAgentFile(world.env, "prompts/ghost.md", template("Hidden by an extension command"));
	writeAgentFile(world.env, "skills/tidy/SKILL.md", skill("tidy", "Tidy the workspace"));
	writeAgentFile(world.env, "extensions/hello.ts", extensionFile(["hello", "ghost"], "Say hello"));
}

describe("listing commands from a resource loader", () => {
	test("lists prompt templates, skills and extension commands in that order, each by name", async () => {
		writeUserResources();
		writeAgentFile(world.env, "prompts/aaa.md", template("First"));
		expect(await commands(world.env.cwd)).toEqual([
			{ id: "prompt:aaa", name: "aaa", kind: "prompt", description: "First" },
			{ id: "prompt:review", name: "review", kind: "prompt", description: "Review the diff", argumentHint: "[path]" },
			{ id: "skill:tidy", name: "tidy", kind: "skill", description: "Tidy the workspace" },
			{ id: "ext:ghost", name: "ghost", kind: "command", description: "Say hello" },
			{ id: "ext:hello", name: "hello", kind: "command", description: "Say hello" },
		]);
	});

	test("an extension command hides the template and the skill it shadows", async () => {
		writeUserResources();
		writeAgentFile(world.env, "extensions/shadow.ts", extensionFile(["skill:tidy"]));
		const found = await commands(world.env.cwd);
		expect(found.filter((command) => command.name === "ghost").map((command) => command.kind)).toEqual(["command"]);
		expect(found.filter((command) => command.name === "tidy")).toEqual([]);
		expect(found.find((command) => command.name === "skill:tidy")?.kind).toBe("command");
	});

	test("skills are left out when the user turned skill commands off", async () => {
		writeUserResources();
		writeSettings(world.env, { enableSkillCommands: false });
		const found = await commands(world.env.cwd);
		expect(found.some((command) => command.kind === "skill")).toBe(false);
		expect(found.some((command) => command.kind === "prompt")).toBe(true);
	});

	test("includes the extensions the adapter loads itself", async () => {
		inline = [{ name: "inline", factory: (pi) => pi.registerCommand("inline-cmd", { handler: async () => {} }) }];
		expect(await commands(world.env.cwd)).toEqual([{ id: "ext:inline-cmd", name: "inline-cmd", kind: "command" }]);
	});

	test("lists the commands of the built-in extensions the adapter loads", async () => {
		const lister = new PiCommandLister({ agentDir: world.env.agentDir, extensions: builtinExtensions });
		const listed = await lister.list({ cwd: world.env.cwd });
		expect(listed.status === "accepted" && listed.commands.map((command) => command.id)).toContain("ext:mcp");
	});

	test("without a directory it lists the global resources only, even where a trusted project would add more", async () => {
		writeUserResources();
		writeFile(join(world.env.cwd, ".pi", "prompts", "project.md"), template("Only in the project"));
		writeFile(join(world.env.root, ".agents", "skills", "outer", "SKILL.md"), skill("outer", "From an ancestor"));
		trustProject(world.env, world.env.root);
		expect((await commands()).map((command) => command.id)).toEqual([
			"prompt:review",
			"skill:tidy",
			"ext:ghost",
			"ext:hello",
		]);
		expect((await commands(world.env.cwd)).map((command) => command.id)).toEqual([
			"prompt:project",
			"prompt:review",
			"skill:outer",
			"skill:tidy",
			"ext:ghost",
			"ext:hello",
		]);
	});

	test("a project's resources and extension code are used only once the project is trusted", async () => {
		const { cwd } = world.env;
		const marker = join(world.env.root, "project-extension-ran");
		writeFile(join(cwd, ".pi", "prompts", "project.md"), template("Only in the project"));
		writeFile(
			join(cwd, ".pi", "extensions", "project.ts"),
			`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n${extensionFile(["from-project"])}`,
		);
		writeFile(join(world.env.root, ".agents", "skills", "outer", "SKILL.md"), skill("outer", "From an ancestor"));

		expect(await commands(cwd)).toEqual([]);
		expect(existsSync(marker)).toBe(false);

		trustProject(world.env, cwd);
		expect((await commands(cwd)).map((command) => command.id).sort()).toEqual([
			"ext:from-project",
			"prompt:project",
			"skill:outer",
		]);
		expect(existsSync(marker)).toBe(true);
	});

	test("a project the user marked untrusted stays closed, whatever the default says", async () => {
		const { cwd } = world.env;
		writeFile(join(cwd, ".pi", "prompts", "project.md"), template("Only in the project"));
		writeSettings(world.env, { defaultProjectTrust: "always" });
		expect((await commands(cwd)).map((command) => command.id)).toEqual(["prompt:project"]);
		writeAgentFile(world.env, "trust.json", JSON.stringify({ [cwd]: false }));
		expect(await commands(cwd)).toEqual([]);
	});

	test("an unreadable trust store distrusts the project", async () => {
		const { cwd } = world.env;
		writeFile(join(cwd, ".pi", "prompts", "project.md"), template("Only in the project"));
		writeSettings(world.env, { defaultProjectTrust: "always" });
		writeAgentFile(world.env, "trust.json", "{ not json");
		expect(await commands(cwd)).toEqual([]);
	});

	test("leaves out a name Pi could not parse back from a prompt, and bounds the text it keeps", async () => {
		writeAgentFile(world.env, "prompts/two words.md", template("Spaced"));
		writeAgentFile(world.env, "prompts/styled.md", template("\u001b[31mred\u001b[0m"));
		writeAgentFile(world.env, "extensions/long.ts", extensionFile(["long"], "d".repeat(5_000)));
		const found = await commands(world.env.cwd);
		expect(found.map((command) => command.name)).toEqual(["styled", "long"]);
		expect(found[0]?.description).toBe("red");
		expect(found[1]?.description).toHaveLength(1_024);
	});

	test("is a backend error, not a throw, when the loader fails", async () => {
		const failing: CommandSources = {
			agentDir: world.env.agentDir,
			extensions: () => {
				throw new Error("no extensions today");
			},
		};
		const listed = await new PiCommandLister(failing).list({ cwd: world.env.cwd });
		expect(listed).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(listed.status === "rejected" && listed.rejection.message).toContain("no extensions today");
	});
});

describe("a lister asked again", () => {
	test("runs no extension factory again while nothing commands come from changed, and does once something did", async () => {
		let runs = 0;
		inline = [
			(pi) => {
				runs += 1;
				pi.registerCommand("counted", { description: "Counts its loads", handler: async () => {} });
			},
		];
		const lister = new PiCommandLister(sources());
		const ids = async () => {
			const listed = await lister.list({ cwd: world.env.cwd });
			return listed.status === "accepted" ? listed.commands.map((command) => command.id) : [];
		};

		expect(await ids()).toContain("ext:counted");
		expect(await ids()).toContain("ext:counted");
		expect(runs).toBe(1);

		writeAgentFile(world.env, "prompts/new.md", template("A new template"));
		expect(await ids()).toContain("prompt:new");
		expect(runs).toBe(2);
		writeSettings(world.env, { enableSkillCommands: false });
		await ids();
		expect(runs).toBe(3);
	});
});
