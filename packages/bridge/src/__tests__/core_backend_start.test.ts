import { describe, expect, test } from "bun:test";
import type { AgentBackend } from "../contract";
import { createFakeBackend, type FakeBackend } from "../contract/testing/fake-backend";
import { BACKEND_START_WAIT_MS } from "../core/backend-registry";
import { BridgeCore } from "../core/core";
import { ManualClock, quiesce, RecordingLog, RIG_CWD, TestClient } from "./helpers/core-rig";

/** A core whose one backend starts only when the test lets it. */
async function startingCore() {
	const clock = new ManualClock();
	const core = new BridgeCore({
		bridgeVersion: "0.0.0-test",
		maxFrameBytes: 8 * 1024 * 1024,
		log: new RecordingLog(),
		clock,
		directories: async (path) => path,
	});
	const factory = Promise.withResolvers<void>();
	let fake: FakeBackend | undefined;
	const added = core.addBackend("pi", async (host): Promise<AgentBackend> => {
		await factory.promise;
		fake = createFakeBackend(host);
		return fake;
	});
	const client = new TestClient(core, "a");
	await client.hello();
	return {
		clock,
		client,
		added,
		land: async (): Promise<FakeBackend> => {
			factory.resolve();
			await added;
			if (!fake) throw new Error("the fake did not start");
			return fake;
		},
	};
}

describe("a backend that starts after the bridge listens", () => {
	test("requests that name it wait for it, the list does not, and every client hears when it lands", async () => {
		const starting = await startingCore();
		const { client } = starting;
		expect((await client.ok("backends.list", {})).backends).toEqual([]);
		const waiting = client.request("sessions.list", { backend: "pi", query: {}, page: { limit: 5 } });
		await quiesce();
		const fake = await starting.land();
		expect(await waiting).toMatchObject({ type: "sessions.list.result", result: { status: "accepted" } });
		await quiesce();
		expect(client.catalog().map((message) => [message.backend, message.event.type])).toEqual([
			["pi", "status_changed"],
		]);
		fake.fake.seed({ cwd: RIG_CWD });
		expect((await client.ok("backends.list", {})).backends.map((backend) => backend.id)).toEqual(["pi"]);
	});

	test("past the wait a request is unknown_backend, saying the backend is still starting; it is served once it lands", async () => {
		const starting = await startingCore();
		const { client, clock } = starting;
		const waiting = client.request("backend.status", { backend: "pi" });
		await quiesce();
		clock.advance(BACKEND_START_WAIT_MS);
		expect(await waiting).toMatchObject({
			error: { code: "unknown_backend", message: "the pi backend is still starting" },
		});
		expect(await client.request("models.list", { backend: "pi" })).toMatchObject({
			error: { code: "unknown_backend" },
		});
		await starting.land();
		await quiesce();
		expect((await client.ok("backend.status", { backend: "pi" })).status.usable).toBe(true);
		expect(client.catalog()).toHaveLength(1);
	});
});
