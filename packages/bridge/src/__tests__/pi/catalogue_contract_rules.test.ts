/**
 * Conformance rules 1 to 3 (status, models, commands) run against the catalogue's own parts. The rest of the
 * backend is the contract's fake: these three rules read nothing else.
 */

import { afterEach, beforeEach, describe, mock, test } from "bun:test";
import { PiCommandLister } from "../../backends/pi/commands";
import { ModelCatalogue } from "../../backends/pi/models/catalogue";
import { piStatus } from "../../backends/pi/status";
import { PI_TRAITS } from "../../backends/pi/traits";
import type { AgentBackend } from "../../contract";
import { CatalogRecorder, Rig } from "../../contract/testing/conformance-harness";
import { fakeConformanceFactory } from "../../contract/testing/fake-conformance";
import {
	capabilitiesMatchTheBackend,
	commandsAreListed,
	modelsAreConsistent,
} from "../../contract/testing/rules-catalog";
import { createWorld, registerFauxProviders, type World, writeAgentFile } from "./catalogue_support";

let world: World;

beforeEach(async () => {
	world = await createWorld();
	await registerFauxProviders(world.services.models.runtime, [
		{
			provider: "faux",
			withoutOff: ["no-off"],
			models: [{ id: "thinker", reasoning: true }, { id: "plain" }, { id: "no-off", reasoning: true }],
		},
		{ provider: "router", models: [{ id: "anthropic/claude-x", reasoning: true }] },
	]);
	writeAgentFile(world.env, "prompts/review.md", "---\ndescription: Review\n---\nBody\n");
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

async function rig(): Promise<Rig> {
	const catalog = new CatalogRecorder(1_000);
	const { backend, driver } = await fakeConformanceFactory()({ catalog });
	const { call: _fakeOps, ...fake } = backend;
	const models = new ModelCatalogue(world.services.models, world.env.agentDir);
	const sources = { agentDir: world.env.agentDir, extensions: () => [] };
	const pi: AgentBackend = {
		...fake,
		id: "pi",
		traits: PI_TRAITS,
		status: () => piStatus(world.services.models, world.env.agentDir, { proxy: world.services.proxy }),
		listModels: (cwd) => models.list(cwd),
		listCommands: (scope) => new PiCommandLister(sources).list({ cwd: scope.cwd }),
	};
	return new Rig(pi, { ...driver, cwd: world.env.cwd, otherCwd: world.env.otherCwd }, catalog, 5_000);
}

describe("conformance rules over the catalogue's parts", () => {
	test("rule 1: the status is a valid BackendStatus", async () => {
		await capabilitiesMatchTheBackend(await rig());
	});

	test("rule 2: the models are listed, unique and consistent", async () => {
		await modelsAreConsistent(await rig());
	});

	test("rule 3: the commands are listed, with unique ids", async () => {
		await commandsAreListed(await rig());
	});
});
