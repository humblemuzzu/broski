/**
 * The catalogue's share of the conformance suite: rules 1 to 4 whole, through the real conformance world, and what
 * rule 20 reads of the listing (`echo_model` names the first two listed models by the wire model of their requests).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { isRejected } from "../../../adapter-kit/rejections";
import { CONFORMANCE_RULES, checkRule } from "../../../contract/testing/conformance";
import { claudeCodeConformanceKit } from "../conformance/driver";
import { ModelEcho } from "../conformance/model-echo";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type RealWorld, startRealWorld } from "./real-world";

expectNoOrphans();

const RULE_MS = 15_000;
const kit = claudeCodeConformanceKit(RULE_MS);
const worlds: RealWorld[] = [];

afterEach(async () => {
	for (const world of worlds.splice(0)) await world.stop();
	await kit.dispose();
});

describe("conformance rules 1 to 4 on the Claude Code adapter", () => {
	for (const rule of CONFORMANCE_RULES.slice(0, 4)) {
		test(rule.name, () => checkRule(kit.factory, rule, RULE_MS), CLI_TEST_MS);
	}
});

describe("what rule 20 reads of the model listing", () => {
	test(
		"each of the first two listed models is echoed back as itself from the wire model of its request",
		async () => {
			const world = startRealWorld();
			worlds.push(world);
			const cwd = world.home.projectDir;
			const init = await world.catalogue.initialize(cwd);
			if (isRejected(init)) throw new Error(init.rejection.message);
			const listed = await world.catalogue.models(cwd);
			if (listed.status !== "accepted") throw new Error("models not listed");
			const echo = new ModelEcho(world.cliPath, cwd, { ...world.env });
			await echo.load();
			for (const model of listed.models.slice(0, 2)) {
				const wire = init.models.find((row) => row.value === model.id)?.resolvedModel;
				const request = { method: "POST", path: "/v1/messages", search: "", headers: {}, body: { model: wire } };
				expect(echo.echo(request)).toBe(model.id);
			}
		},
		CLI_TEST_MS,
	);
});
