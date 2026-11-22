/**
 * On the real adapter and the real `pi`: the cache window of `usage_updated` is the latest request's own, read from the
 * assistant message Pi ends, and kept when a later request touches no cache. The scripted provider is OpenAI's
 * completions API, which publishes no lifetime, so no countdown is claimed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Usage } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

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
});
