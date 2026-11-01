/**
 * What protocol 1.3 added, as the core sends it: the ops that move and read a session's files, refresh models, read
 * and edit the tree and run a shell command, and the models a backend knows but cannot use now. A client of an older minor is not told the ops exist and is never
 * handed the unavailable models, even when its request asks for them.
 */

import { describe, expect, test } from "bun:test";
import {
	type AgentBackend,
	type ModelListOptions,
	type ModelSummary,
	type ModelsListResult,
	READ_OP_KINDS,
	SHELL_OP_KINDS,
	TRANSFER_OP_KINDS,
	TREE_OP_KINDS,
} from "../contract";
import { quiesce, startCoreRig } from "./helpers/core-rig";

const MINOR_TWO = { major: 1, minor: 2 } as const;

const THREE_OPS = [...TRANSFER_OP_KINDS, ...READ_OP_KINDS, ...TREE_OP_KINDS, ...SHELL_OP_KINDS] as const;

const UNUSABLE: ModelSummary = {
	id: "missing/key-model",
	displayName: "Needs a key",
	thinking: { options: [] },
	isDefault: false,
	unavailableReason: "Not signed in to Missing.",
};

/** The fake, offering every op of 1.3 and, when asked, one model it cannot run. */
function withMinorThree(asked: ModelListOptions[]): (backend: AgentBackend) => AgentBackend {
	return (backend) => ({
		...backend,
		traits: { ...backend.traits, backendOps: [...backend.traits.backendOps, "take_over", ...THREE_OPS] },
		listModels: async (cwd, options): Promise<ModelsListResult> => {
			asked.push(options ?? {});
			const listed = await backend.listModels(cwd, options);
			return listed.status === "accepted" && options?.includeUnavailable
				? { ...listed, models: [...listed.models, UNUSABLE] }
				: listed;
		},
	});
}

describe("the ops protocol 1.3 added", () => {
	test("are listed only to a client that speaks that minor", async () => {
		const rig = await startCoreRig({ adapt: withMinorThree([]) });
		const listed = async (protocol?: typeof MINOR_TWO) =>
			(await (await rig.client("app", protocol)).ok("backends.list", {})).backends.flatMap(
				(backend) => backend.capabilities.backendOps,
			);
		expect(await listed()).toEqual(expect.arrayContaining([...THREE_OPS]));
		const older = await listed(MINOR_TWO);
		for (const op of THREE_OPS) expect(older).not.toContain(op);
		expect(older).toContain("take_over");
		expect(older).toContain("navigate_tree");
	});
});

describe("models a backend cannot use now", () => {
	test("reach a client of this minor that asks for them, with their reason", async () => {
		const asked: ModelListOptions[] = [];
		const rig = await startCoreRig({ adapt: withMinorThree(asked) });
		const phone = await rig.client("phone");
		const all = await phone.ok("models.list", { backend: "pi", includeUnavailable: true });
		const models = all.result.status === "accepted" ? all.result.models : [];
		expect(models.at(-1)).toEqual(UNUSABLE);
		expect(asked).toEqual([{ includeUnavailable: true }]);
	});

	test("are left out of a list that does not ask for them", async () => {
		const asked: ModelListOptions[] = [];
		const rig = await startCoreRig({ adapt: withMinorThree(asked) });
		const phone = await rig.client("phone");
		const usable = await phone.ok("models.list", { backend: "pi" });
		const models = usable.result.status === "accepted" ? usable.result.models : [];
		expect(models.some((model) => model.unavailableReason !== undefined)).toBe(false);
		expect(asked).toEqual([{ includeUnavailable: false }]);
	});

	test("are never given to a client of an older minor, whatever it asks", async () => {
		const asked: ModelListOptions[] = [];
		const rig = await startCoreRig({ adapt: withMinorThree(asked) });
		const older = await rig.client("older", MINOR_TWO);
		const answer = await older.ok("models.list", { backend: "pi", includeUnavailable: true });
		const models = answer.result.status === "accepted" ? answer.result.models : [];
		expect(models.some((model) => model.unavailableReason !== undefined)).toBe(false);
		expect(asked).toEqual([{ includeUnavailable: false }]);
		await quiesce();
		expect([...older.violations, ...rig.log.errors]).toEqual([]);
	});
});
