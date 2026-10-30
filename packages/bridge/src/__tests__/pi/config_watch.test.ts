/**
 * A `/login` or a `models.json` edit made in a terminal reaches the phones: Pi's configuration files are watched, and
 * a change is `catalog_invalidated` with a fresh `status_changed` (contract README §5, catalog sink).
 */

import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const LOCAL_MODELS = JSON.stringify({
	providers: {
		local: {
			baseUrl: "http://127.0.0.1:9/v1",
			api: "openai-completions",
			apiKey: "not-a-real-key",
			models: [{ id: "added-in-a-terminal" }],
		},
	},
});

test("a models.json written in a terminal invalidates the model list and sends the status again", async () => {
	t = await LiveRig.create();
	writeFileSync(join(t.world.env.agentDir, "models.json"), LOCAL_MODELS);

	await t.catalog.waitFor(
		(events) => events.find((event) => event.type === "catalog_invalidated" && event.scope === "models"),
		"the model list invalidated",
	);
	const changed = await t.catalog.waitFor(
		(events) => events.find((event) => event.type === "status_changed"),
		"the status sent again",
	);
	expect(changed.type === "status_changed" && changed.status.usable).toBe(true);
	const listed = await t.backend.listModels(undefined);
	expect(listed.status === "accepted" && listed.models.map((model) => model.id)).toContain("local/added-in-a-terminal");
});

test("settings name commands too: their change invalidates both lists; a file Pi does not read, neither", async () => {
	t = await LiveRig.create();
	writeFileSync(join(t.world.env.agentDir, "notes.txt"), "not Pi's");
	writeFileSync(join(t.world.env.agentDir, "settings.json"), JSON.stringify({ enableSkillCommands: false }));

	await t.catalog.waitFor(
		(events) => events.find((event) => event.type === "catalog_invalidated" && event.scope === "commands"),
		"the command list invalidated",
	);
	const scopes = t.catalog.items.flatMap((event) => (event.type === "catalog_invalidated" ? [event.scope] : []));
	expect(scopes.sort()).toEqual(["commands", "models"]);
});

test("nothing is announced after the backend is disposed", async () => {
	t = await LiveRig.create();
	await t.backend.dispose();
	writeFileSync(join(t.world.env.agentDir, "models.json"), LOCAL_MODELS);
	await Bun.sleep(600);
	expect(t.catalog.items.filter((event) => event.type === "catalog_invalidated")).toEqual([]);
});
