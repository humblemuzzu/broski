/** Rules 20 and 21 on the real CLI: the model, the thinking and the mode reach the CLI and show as events (D11, D12). */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";
import { standInCatalogue } from "./helpers/stand-ins";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const bodyOf = (request: { body: unknown } | undefined) => request?.body as Record<string, unknown>;

describe("settings on the real CLI", () => {
	test(
		"a model, a thinking level and a mode reach the next request and show as events",
		async () => {
			const rig = realRig([{ text: ["a"], echoModel: true }], {
				catalogue: standInCatalogue({ "claude-sonnet-5-5": "sonnet", "claude-opus-5-5": "default" }),
			});
			try {
				const live = await rig.openNew(rig.home.projectDir);
				expect((await live.control.setModel("sonnet")).status).toBe("accepted");
				expect((await live.control.setThinking("high")).status).toBe("accepted");
				expect((await live.control.setMode("permissions", "plan")).status).toBe("accepted");
				await live.run("hello");
				const body = bodyOf(rig.server.mainRequests()[0]);
				expect(body.model).toBe("claude-sonnet-5-5");
				expect(body.output_config).toEqual({ effort: "high" });
				expect(JSON.stringify(body)).toContain("Plan mode is active");
				const changes = live
					.events()
					.filter((event) => event.type === "model_changed" || event.type === "mode_changed");
				expect(changes).toEqual([
					{ type: "model_changed", modelId: "sonnet" },
					{ type: "model_changed", modelId: "sonnet", thinking: "high" },
					{ type: "mode_changed", axis: "permissions", value: "plan" },
				]);
				live.assertSettled();
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a session opens in the mode and the model asked for, and the CLI's own report adds no event",
		async () => {
			const rig = realRig([{ text: ["a"], echoModel: true }], {
				catalogue: standInCatalogue({ "claude-sonnet-5-5": "sonnet" }),
			});
			try {
				const live = await rig.openNew(rig.home.projectDir, {
					modelId: "sonnet",
					thinking: "low",
					modes: [{ axis: "permissions", value: "acceptEdits" }],
				});
				expect(live.initial).toMatchObject({
					modelId: "sonnet",
					thinking: "low",
					modes: [{ axis: "permissions", value: "acceptEdits" }],
				});
				await live.run("hello");
				const body = bodyOf(rig.server.mainRequests()[0]);
				expect(body.model).toBe("claude-sonnet-5-5");
				expect(body.output_config).toEqual({ effort: "low" });
				expect(
					live.events().filter((event) => event.type === "model_changed" || event.type === "mode_changed"),
				).toEqual([]);
				const started = rig.live.row(live.ref.sessionId);
				expect(started).toMatchObject({ status: "idle", modelId: "sonnet" });
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"an unlisted model is not_found, a thinking value or mode it does not offer is invalid_input, and nothing is emitted",
		async () => {
			const rig = realRig([]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const control = live.control;
				expect(await control.setModel("not-a-model")).toMatchObject({
					status: "rejected",
					rejection: { code: "not_found" },
				});
				expect(await control.setThinking("not-a-level")).toMatchObject({
					status: "rejected",
					rejection: { code: "invalid_input" },
				});
				expect(await control.setMode("permissions", "nope")).toMatchObject({
					status: "rejected",
					rejection: { code: "invalid_input" },
				});
				expect(await control.setMode("not-an-axis", "default")).toMatchObject({
					status: "rejected",
					rejection: { code: "invalid_input" },
				});
				expect(live.events()).toEqual([]);
				const refused = await rig.live.open(
					{ kind: "new", options: { cwd: rig.home.projectDir, modelId: "not-a-model" } },
					{ emit: () => undefined },
				);
				expect(refused).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"every listed mode can be chosen in turn, bypassPermissions included",
		async () => {
			const rig = realRig([]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const modes = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
				for (const value of modes) {
					const mark = live.recorder.items.length;
					expect((await live.control.setMode("permissions", value)).status).toBe("accepted");
					await live.waitFor("mode_changed", (event) => event.value === value, mark);
				}
				expect(live.reduced().modes).toEqual([{ axis: "permissions", value: "bypassPermissions" }]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a model chosen while a run is under way reaches the run's next request (next_request)",
		async () => {
			let release: () => void = () => undefined;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const rig = realRig([
				{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }], text: ["first"], echoModel: true },
				{ text: ["second"], echoModel: true, gate: held },
			]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				await live.prompt("go");
				await rig.mapping.waitForFrame("assistant");
				expect((await live.control.setModel("sonnet")).status).toBe("accepted");
				release();
				await live.waitFor("run_finished");
				const models = rig.server.mainRequests().map((request) => bodyOf(request).model);
				expect(models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
