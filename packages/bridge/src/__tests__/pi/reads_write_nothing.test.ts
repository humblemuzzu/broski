import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PiCommandLister } from "../../backends/pi/commands";
import { ModelCatalogue } from "../../backends/pi/models/catalogue";
import { piStatus } from "../../backends/pi/status";
import {
	createWorld,
	modelsJson,
	registerFauxProviders,
	trustProject,
	type World,
	writeAgentFile,
	writeFile,
	writeSettings,
} from "./catalogue_support";

let world: World;

beforeEach(async () => {
	world = await createWorld();
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

/** Every path under `root`: a file with its size and modification time, a directory by name only (a lock taken inside it changes its time). */
function tree(path: string, found: Record<string, string> = {}): Record<string, string> {
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const full = join(path, entry.name);
		const stats = statSync(full);
		found[full] = entry.isDirectory() ? "directory" : `${stats.size}:${stats.mtimeMs}`;
		if (entry.isDirectory()) tree(full, found);
	}
	return found;
}

describe("reading Pi's catalogue writes nothing", () => {
	test("models, status and commands leave the agent directory and the project as they found them", async () => {
		const { env, services } = world;
		await registerFauxProviders(services.models.runtime, [{ provider: "faux", models: [{ id: "a" }] }]);
		writeAgentFile(env, "models.json", modelsJson([{ id: "custom" }]));
		writeSettings(env, { defaultProvider: "faux", defaultModel: "a", enabledModels: ["faux/a"] });
		writeAgentFile(env, "prompts/review.md", "---\ndescription: Review\n---\nBody\n");
		writeAgentFile(env, "skills/tidy/SKILL.md", "---\nname: tidy\ndescription: Tidy\n---\n# tidy\n");
		writeAgentFile(
			env,
			"extensions/hello.ts",
			"export default (pi) => pi.registerCommand('hello', { handler: async () => {} });\n",
		);
		writeFile(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ defaultModel: "a" }));
		writeFile(join(env.cwd, ".pi", "prompts", "project.md"), "Project prompt\n");
		trustProject(env, env.cwd);
		const catalogue = new ModelCatalogue(services.models, env.agentDir);
		const sources = { agentDir: env.agentDir, extensions: () => [] };

		const read = async () => {
			await catalogue.list(env.cwd);
			await catalogue.list(undefined);
			await catalogue.find("faux/a");
			await piStatus(services.models, env.agentDir, { proxy: services.proxy });
			await new PiCommandLister(sources).list({ cwd: env.cwd });
			await new PiCommandLister(sources).list({ cwd: undefined });
		};
		await read();
		const before = { agent: tree(env.agentDir), project: tree(env.cwd) };
		await read();
		expect({ agent: tree(env.agentDir), project: tree(env.cwd) }).toEqual(before);
	});
});
