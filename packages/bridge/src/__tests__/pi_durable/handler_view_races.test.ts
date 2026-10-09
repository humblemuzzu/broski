import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PI_DURABLE_LOCK_FILE } from "../../connectors/pi-durable/storage-lock";
import { broadcastPiDurablePermission } from "../../handlers/pi_durable/transport";
import { attachPiDurableView, detachPiDurableView, piDurableViewOf } from "../../handlers/pi_durable/view";
import { Collector, createHarness, createSession, type Harness, waitFor } from "./handler_harness";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function lockFile(harness: Harness, sessionId: string): string {
	return join(harness.root, sessionId, PI_DURABLE_LOCK_FILE);
}

describe("pi-durable attach races", () => {
	test("drops an attach whose socket detached while the host was still opening", async () => {
		const harness = createHarness({ idleTimeoutMs: 100 });
		try {
			const sessionId = await createSession(harness);
			const socket = new Collector();
			const gate = deferred();
			const deps = {
				...harness.deps,
				host: async () => {
					await gate.promise;
					return harness.host;
				},
			};

			const attaching = attachPiDurableView(socket, sessionId, deps);
			detachPiDurableView(socket);
			gate.resolve();
			await attaching;

			expect(piDurableViewOf(socket)).toBeUndefined();
			expect(harness.host.isOpen(sessionId)).toBe(false);
			expect(existsSync(lockFile(harness, sessionId))).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("idle-closes a session whose attach detached while it was opening", async () => {
		const harness = createHarness({ idleTimeoutMs: 100 });
		try {
			const sessionId = await createSession(harness);
			const socket = new Collector();
			const realOpen = harness.host.open.bind(harness.host);
			const started = deferred();
			const gate = deferred();
			harness.host.open = async (id) => {
				if (id === sessionId) {
					started.resolve();
					await gate.promise;
				}
				return realOpen(id);
			};

			const attaching = attachPiDurableView(socket, sessionId, harness.deps);
			await started.promise;
			detachPiDurableView(socket);
			gate.resolve();
			await attaching;

			expect(piDurableViewOf(socket)).toBeUndefined();
			await waitFor(() => !harness.host.isOpen(sessionId), "the idle close after the race", 5_000);
			expect(existsSync(lockFile(harness, sessionId))).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("keeps only the last session of two rapidly switched attaches", async () => {
		const harness = createHarness();
		const socket = new Collector();
		try {
			const sessionA = await createSession(harness, { requestId: "create-a" });
			const sessionB = await createSession(harness, { requestId: "create-b" });
			const realOpen = harness.host.open.bind(harness.host);
			const started = deferred();
			const gate = deferred();
			harness.host.open = async (id) => {
				if (id === sessionA) {
					started.resolve();
					await gate.promise;
				}
				return realOpen(id);
			};

			const attachingA = attachPiDurableView(socket, sessionA, harness.deps);
			await started.promise;
			const attachingB = attachPiDurableView(socket, sessionB, harness.deps);
			await attachingB;
			gate.resolve();
			await attachingA;

			expect(piDurableViewOf(socket)).toBe(sessionB);
		} finally {
			detachPiDurableView(socket);
			await harness.host.closeAll();
		}
	});

	test("unregisters the transport watcher when the harness watch fails", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			const socket = new Collector();
			harness.host.watch = async () => {
				throw new Error("watch failed");
			};

			await expect(attachPiDurableView(socket, sessionId, harness.deps)).rejects.toThrow("watch failed");
			expect(piDurableViewOf(socket)).toBeUndefined();

			broadcastPiDurablePermission({ requestId: "r-1", sessionId, toolName: "bash", input: {}, title: "Run" });
			expect(socket.messages.filter((message) => message.type === "runtime_event")).toEqual([]);
		} finally {
			await harness.host.closeAll();
		}
	});
});
