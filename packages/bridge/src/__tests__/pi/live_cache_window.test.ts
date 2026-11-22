/**
 * On the real adapter and the real `pi`: the cache window of `usage_updated` is the latest request's own, read from the
 * assistant message Pi ends, and kept when a later request touches no cache. The scripted provider is OpenAI's
 * completions API, which publishes no lifetime, so no countdown is claimed unless the model's `promptCache` gives one;
 * Pi's own idle cache warming then keeps the window alive and adds its cost to the totals.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { MODELS, wireIdOf } from "./helpers/pi-world";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

/**
 * Gives the plain model a 12 s cache lifetime, which Pi warms every 2 s (pi-ai 1.5.2 `dist/cache-warming.js:18-21`),
 * and a price at which a warm always pays (`:62-79`).
 */
function warmedPlainModel(agentDir: string): void {
	const path = join(agentDir, "models.json");
	const config = JSON.parse(readFileSync(path, "utf8"));
	for (const provider of Object.values<{ models: { id: string }[] }>(config.providers)) {
		provider.models = provider.models.map((model) =>
			model.id === MODELS.plain
				? { ...model, promptCache: { short: 12 }, cost: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }
				: model,
		);
	}
	writeFileSync(path, JSON.stringify(config));
}

function lastUsage(live: LiveSession): Usage | undefined {
	return live
		.events()
		.flatMap((event) => (event.type === "usage_updated" ? [event.usage] : []))
		.at(-1);
}

describe("the cache window of a hosted pi", () => {
	test("is the latest request's hit, from when it was sent, with no lifetime the provider never gave", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [
			{ text: ["first"] },
			{ text: ["second"], cachedTokens: 30 },
			{ text: ["third"] },
		]);

		await live.run("one");
		expect(lastUsage(live)?.cache).toBeUndefined();

		const sent = Date.now();
		await live.run("two");
		const cache = lastUsage(live)?.cache;
		expect(cache).toMatchObject({ cachedTokens: 30 });
		expect(cache?.promptTokens).toBeGreaterThan(30);
		expect(cache?.lastTouchAt).toBeGreaterThanOrEqual(sent);
		expect(cache?.lastTouchAt).toBeLessThanOrEqual(Date.now());
		expect(cache).not.toHaveProperty("ttlMs");
		expect(cache).not.toHaveProperty("confidence");

		await live.run("three");
		expect(lastUsage(live)?.cache).toEqual(cache);
		expect(live.reduced().usage?.cache).toEqual(cache);
	});

	test("Pi's idle cache warming keeps the window alive with the lifetime the model gives, and its cost is counted", async () => {
		t = await LiveRig.create();
		warmedPlainModel(t.world.env.agentDir);
		const live = await t.rig.openNew({ modelId: wireIdOf(MODELS.plain) });
		t.router.script(live.ref.sessionId, [
			{ text: ["first"], cachedTokens: 30 },
			{ text: ["."], cachedTokens: 40 },
		]);

		await live.run("one");
		const ran = lastUsage(live);
		expect(ran?.cache).toMatchObject({ ttlMs: 12_000, confidence: "estimated", cachedTokens: 30 });
		const touched = ran?.cache?.lastTouchAt ?? 0;

		const warmed = await live.waitFor("usage_updated", (event) => (event.usage.cache?.lastTouchAt ?? 0) > touched);
		expect(warmed.usage.cache).toEqual({ ...ran?.cache, lastTouchAt: warmed.usage.cache?.lastTouchAt ?? 0 });
		expect(warmed.usage.costUsd ?? 0).toBeGreaterThan(ran?.costUsd ?? 0);
		expect(t.router.requests(live.ref.sessionId).length).toBeGreaterThanOrEqual(2);
	});
});
