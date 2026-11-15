import { describe, expect, test } from "bun:test";
import type { AgentBackend, BackendId, CatalogEvent } from "../contract";
import { createFakeBackend } from "../contract/testing/fake-backend";
import { BACKEND_START_WAIT_MS, BackendRegistry, type Reached } from "../core/backend-registry";
import { ManualClock, quiesce, RecordingLog } from "./helpers/core-rig";

function registry() {
	const news: Array<[BackendId, CatalogEvent]> = [];
	const arrivals: BackendId[] = [];
	const log = new RecordingLog();
	const clock = new ManualClock();
	const backends = new BackendRegistry({
		onCatalog: (backend, event) => news.push([backend, event]),
		onArrival: (backend) => arrivals.push(backend.id),
		clock,
		log,
	});
	return { news, arrivals, log, clock, registry: backends };
}

function backendOf(reached: Reached): AgentBackend | undefined {
	return "backend" in reached ? reached.backend : undefined;
}

function missingOf(reached: Reached): string | undefined {
	return "missing" in reached ? reached.missing : undefined;
}

describe("the backend registry", () => {
	test("starts a backend with a host whose catalog news carries the backend's id, and announces it", async () => {
		const { registry: backends, news, arrivals } = registry();
		let started: ReturnType<typeof createFakeBackend> | undefined;
		expect(
			await backends.add("claude-code", async (host) => (started = createFakeBackend(host, { id: "claude-code" }))),
		).toBe(true);
		started?.fake.seed({ cwd: "/p" });
		expect(news.map(([backend, event]) => [backend, event.type])).toEqual([["claude-code", "session_updated"]]);
		expect(backendOf(await backends.reach("claude-code"))).toBe(started);
		expect(backends.descriptors().map((descriptor) => descriptor.id)).toEqual(["claude-code"]);
		expect(arrivals).toEqual(["claude-code"]);
	});

	test("refuses a second backend under one id, and disposes one whose factory made another backend", async () => {
		const { registry: backends, log } = registry();
		await backends.add("pi", async (host) => createFakeBackend(host));
		expect(() => backends.add("pi", async (host) => createFakeBackend(host))).toThrow("registered twice");
		let disposed = 0;
		expect(
			await backends.add("claude-code", async (host) => ({
				...createFakeBackend(host, { id: "pi" }),
				dispose: async () => void disposed++,
			})),
		).toBe(false);
		expect(disposed).toBe(1);
		expect(missingOf(await backends.reach("claude-code"))).toBe(
			"the claude-code backend did not start: the factory made a pi backend",
		);
		expect(log.errors.some((line) => line.includes("made a pi backend"))).toBe(true);
	});

	test("goes on without a backend whose factory fails, and says why to whoever asks for it", async () => {
		const { registry: backends, log } = registry();
		expect(
			await backends.add("claude-code", async () => {
				throw new Error("not installed");
			}),
		).toBe(false);
		expect(backends.descriptors()).toEqual([]);
		expect(log.errors).toEqual(["[core] backend claude-code did not start: Error: not installed"]);
		expect(missingOf(await backends.reach("claude-code"))).toBe(
			"the claude-code backend did not start: Error: not installed",
		);
		expect(missingOf(await backends.reach("pi"))).toBe("no pi backend is registered");
		await backends.add("pi", async () => {
			throw new Error("y".repeat(10_000));
		});
		expect(missingOf(await backends.reach("pi"))?.length).toBeLessThan(4_200);
	});

	test("a request for a backend still starting waits for it, but no longer than the start may take", async () => {
		const { registry: backends, clock, arrivals } = registry();
		const factory = Promise.withResolvers<AgentBackend>();
		const adding = backends.add("pi", () => factory.promise);
		const early = backends.reach("pi");
		clock.advance(BACKEND_START_WAIT_MS - 1);
		await quiesce();
		const created = createFakeBackend({ catalog: { emit: () => {} } });
		factory.resolve(created);
		expect(await adding).toBe(true);
		expect(backendOf(await early)).toBe(created);
		expect(arrivals).toEqual(["pi"]);
		expect(clock.pending()).toBe(0);

		const slow = Promise.withResolvers<AgentBackend>();
		const slowAdding = backends.add("claude-code", () => slow.promise);
		const waiting = backends.reach("claude-code");
		clock.advance(BACKEND_START_WAIT_MS);
		expect(missingOf(await waiting)).toBe("the claude-code backend is still starting");
		expect(missingOf(await backends.reach("claude-code"))).toBe("the claude-code backend is still starting");
		slow.resolve(createFakeBackend({ catalog: { emit: () => {} } }, { id: "claude-code" }));
		expect(await slowAdding).toBe(true);
		expect(arrivals).toEqual(["pi", "claude-code"]);
	});

	test("an invalid status becomes an unusable one, and so does a status() that throws", async () => {
		const { registry: backends, log } = registry();
		const fake = createFakeBackend({ catalog: { emit: () => {} } });
		const invalid = await backends.status({
			...fake,
			status: async () => ({ ...(await fake.status()), issues: [{ severity: "error", message: "" }] }),
		});
		expect(invalid).toMatchObject({ usable: false, auth: "unknown", issues: [{ severity: "error" }] });
		const thrown = await backends.status({
			...fake,
			status: () => {
				throw new Error("x".repeat(10_000));
			},
		});
		expect(thrown.issues[0]?.message.length).toBe(4_096);
		const cut = await backends.status({
			...fake,
			status: () => {
				throw new Error(`${"x".repeat(4_047)}😀`);
			},
		});
		expect(cut.issues[0]?.message.isWellFormed()).toBe(true);
		expect(log.errors.some((line) => line.includes("status() threw"))).toBe(true);
	});

	test("dispose disposes every backend, even when one fails, and one that lands later as it lands", async () => {
		const { registry: backends, log, arrivals, clock } = registry();
		let disposed = 0;
		await backends.add("pi", async (host) => ({
			...createFakeBackend(host),
			dispose: async () => {
				disposed++;
				throw new Error("stuck");
			},
		}));
		const late = Promise.withResolvers<AgentBackend>();
		const lateAdding = backends.add("claude-code", () => late.promise);
		const waiting = backends.reach("claude-code");
		await backends.dispose();
		expect(clock.pending()).toBe(0);
		expect(disposed).toBe(1);
		expect(backends.descriptors()).toEqual([]);
		expect(log.errors.some((line) => line.includes("pi dispose failed"))).toBe(true);
		expect(missingOf(await waiting)).toBe("the claude-code backend is still starting");
		late.resolve({
			...createFakeBackend({ catalog: { emit: () => {} } }, { id: "claude-code" }),
			dispose: async () => void disposed++,
		});
		expect(await lateAdding).toBe(false);
		expect(disposed).toBe(2);
		expect(arrivals).toEqual(["pi"]);
	});
});
