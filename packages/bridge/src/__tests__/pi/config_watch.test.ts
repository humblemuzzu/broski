/**
 * A `/login` or a `models.json` edit made in a terminal reaches the phones: Pi's configuration files are watched, and
 * a change is `catalog_invalidated` with a fresh `status_changed` (contract README §5, catalog sink).
 */

import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogScope } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const ANNOUNCE_MS = 1_000;
const ATTEMPTS = 4;
const TEST_MS = ANNOUNCE_MS * ATTEMPTS + 5_000;

/**
 * `fs.watch` on macOS starts asynchronously and misses what is written in the first moments after it was created, so
 * a file written right after the backend started is not announced at all. The file is written again until the watcher
 * reports it; each attempt waits longer than the watcher's debounce and the status read that follow a change.
 */
async function writeUntilAnnounced(path: string, text: string, announced: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		writeFileSync(path, text);
		const until = Date.now() + ANNOUNCE_MS;
		while (Date.now() < until) {
			if (announced()) return;
			await Bun.sleep(20);
		}
	}
	throw new Error(`the watcher never reported a change to ${path}`);
}

function invalidated(rig: LiveRig, scope: CatalogScope): boolean {
	return rig.catalog.items.some((event) => event.type === "catalog_invalidated" && event.scope === scope);
}

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

test(
	"a models.json written in a terminal invalidates the model list and sends the status again",
	async () => {
		t = await LiveRig.create();
		const rig = t;
		await writeUntilAnnounced(join(rig.world.env.agentDir, "models.json"), LOCAL_MODELS, () =>
			invalidated(rig, "models"),
		);
		const changed = await t.catalog.waitFor(
			(events) => events.find((event) => event.type === "status_changed"),
			"the status sent again",
		);
		expect(changed.type === "status_changed" && changed.status.usable).toBe(true);
		const listed = await t.backend.listModels(undefined);
		expect(listed.status === "accepted" && listed.models.map((model) => model.id)).toContain(
			"local/added-in-a-terminal",
		);
	},
	TEST_MS,
);

test(
	"settings name commands too: their change invalidates both lists; a file Pi does not read, neither",
	async () => {
		t = await LiveRig.create();
		const rig = t;
		writeFileSync(join(rig.world.env.agentDir, "notes.txt"), "not Pi's");
		await writeUntilAnnounced(
			join(rig.world.env.agentDir, "settings.json"),
			JSON.stringify({ enableSkillCommands: false }),
			() => invalidated(rig, "commands"),
		);
		const scopes = rig.catalog.items.flatMap((event) => (event.type === "catalog_invalidated" ? [event.scope] : []));
		expect([...new Set(scopes)].sort()).toEqual(["commands", "models"]);
	},
	TEST_MS,
);

test("nothing is announced after the backend is disposed", async () => {
	t = await LiveRig.create();
	await t.backend.dispose();
	writeFileSync(join(t.world.env.agentDir, "models.json"), LOCAL_MODELS);
	await Bun.sleep(600);
	expect(t.catalog.items.filter((event) => event.type === "catalog_invalidated")).toEqual([]);
});
