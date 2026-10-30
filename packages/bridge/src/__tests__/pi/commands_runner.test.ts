import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	DefaultResourceLoader,
	ExtensionRunner,
	type InlineExtension,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type CommandSources, invocationNames, PiCommandLister } from "../../backends/pi/commands";
import { createWorld, registerFauxProviders, type World, writeAgentFile, writeSettings } from "./catalogue_support";
import { hostSpikeSession, spikeRuntimeFactory } from "./helpers/pi-spike";

let world: World;

beforeEach(async () => {
	world = await createWorld();
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

const registering = (name: string, ...commands: string[]): InlineExtension => ({
	name,
	factory: (pi) => {
		for (const command of commands) pi.registerCommand(command, { handler: async () => {} });
	},
});

describe("invocationNames", () => {
	const arrangements: Record<string, InlineExtension[]> = {
		"one extension": [registering("a", "x", "y")],
		"a name two extensions share": [registering("a", "x", "y"), registering("b", "x")],
		"three extensions share a name": [registering("a", "x"), registering("b", "x"), registering("c", "x")],
		"a literal suffix already taken": [registering("a", "x:2"), registering("b", "x"), registering("c", "x")],
		"a literal suffix registered later": [registering("a", "x"), registering("b", "x"), registering("c", "x:2")],
	};

	for (const [label, extensions] of Object.entries(arrangements)) {
		test(`names commands as the extension runner does: ${label}`, async () => {
			const { cwd, agentDir } = world.env;
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				extensionFactories: extensions,
				noThemes: true,
				noContextFiles: true,
			});
			await loader.reload();
			const loaded = loader.getExtensions();
			const runner = new ExtensionRunner(
				loaded.extensions,
				loaded.runtime,
				cwd,
				SessionManager.inMemory(cwd),
				new ModelRegistry(world.services.models.runtime),
			);
			const expected = runner.getRegisteredCommands().map((command) => command.invocationName);
			expect(invocationNames(loaded.extensions).map((command) => command.name)).toEqual(expected);
			expect(new Set(expected).size).toBe(expected.length);
		});
	}
});

describe("listing commands from a live session", () => {
	test("lists what the session holds, the same as a loader of its directory does", async () => {
		const [faux] = await registerFauxProviders(world.services.models.runtime, [
			{ provider: "faux", models: [{ id: "a" }] },
		]);
		const model = faux?.getModel("a");
		if (!model) throw new Error("no faux model");
		writeAgentFile(world.env, "prompts/review.md", "---\ndescription: Review\n---\nBody\n");
		writeAgentFile(world.env, "skills/tidy/SKILL.md", "---\nname: tidy\ndescription: Tidy\n---\n# tidy\n");
		const inline = [registering("a", "hello")];
		const sources: CommandSources = { agentDir: world.env.agentDir, extensions: () => inline };

		const runtime = await hostSpikeSession(
			world.env,
			spikeRuntimeFactory(world.services.models.runtime, model, inline),
		);
		try {
			const live = await new PiCommandLister(sources).list({ session: runtime.session });
			expect(live).toEqual(await new PiCommandLister(sources).list({ cwd: world.env.cwd }));
			expect(live.status === "accepted" && live.commands.map((command) => command.id)).toEqual([
				"prompt:review",
				"skill:tidy",
				"ext:hello",
			]);

			writeSettings(world.env, { enableSkillCommands: false });
			await runtime.session.settingsManager.reload();
			const without = await new PiCommandLister(sources).list({ session: runtime.session });
			expect(without.status === "accepted" && without.commands.map((command) => command.kind)).toEqual([
				"prompt",
				"command",
			]);
		} finally {
			await runtime.dispose();
		}
	});
});
