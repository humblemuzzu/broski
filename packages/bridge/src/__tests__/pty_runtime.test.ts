import { describe, expect, test } from "bun:test";
import type { PtyManager } from "../workspace/pty/manager";
import type { NativePtyConnection } from "../workspace/pty/native-pty";
import { PtyRuntime } from "../workspace/pty/runtime";
import type { PtyEvent, PtySession } from "../workspace/pty/types";

function makeSession(id: string): PtySession {
	return {
		id,
		title: `Terminal ${id}`,
		command: "/bin/zsh",
		args: [],
		cwd: "/repo",
		status: "running",
		pid: 500,
	};
}

/** Flushes and health snapshots are timer-driven; wait for the event instead of guessing how long it takes. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline) await Bun.sleep(10);
	return condition();
}

/** A manager over no native library: the runtime only calls these. */
function fakeManager(overrides: Partial<PtyManager> = {}): PtyManager {
	const manager = {
		available: true,
		connectNative: () => null,
		stop: async () => {},
		listPty: async () => [makeSession("n1")],
		createPty: async () => makeSession("n1"),
		getPty: async () => makeSession("n1"),
		updatePty: async (_id: string, title?: string) => ({ ...makeSession("n1"), title: title ?? "t" }),
		deletePty: async () => true,
		resize: () => {},
		...overrides,
	};
	return manager as unknown as PtyManager;
}

describe("PtyRuntime", () => {
	test("a connected terminal: output batched to its listener, input written, resize clamped, health, then exit", async () => {
		let onData: ((data: string) => void) | null = null;
		let onExit: ((code?: number) => void) | null = null;
		const writes: string[] = [];
		const connection: NativePtyConnection = {
			onData: (callback) => {
				onData = callback;
			},
			onExit: (callback) => {
				onExit = callback;
			},
			write: (data) => {
				writes.push(data);
			},
			resize: () => {},
			disconnect: () => {},
		};
		let resized: unknown[] | null = null;
		const runtime = new PtyRuntime({
			ptyManager: fakeManager({
				connectNative: () => connection,
				resize: (...args: unknown[]) => {
					resized = args;
				},
			}),
			log: () => {},
			resolveSecurePath: async (path) => path,
		});
		const events: PtyEvent[] = [];

		expect(runtime.connect("n1", (event) => events.push(event))).toEqual({ ok: true, value: null });

		onData!("foo");
		onData!("bar");
		expect(await waitFor(() => events.some((event) => event.type === "output"))).toBe(true);
		expect(events.find((event) => event.type === "output")).toEqual({ type: "output", ptyId: "n1", data: "foobar" });

		expect(runtime.input("n1", "pwd\n")).toEqual({ ok: true, value: null });
		expect(writes).toEqual(["pwd\n"]);
		expect(runtime.input("n1", "x".repeat(10_001))).toEqual({ ok: false, error: "Input too large (max 10KB)" });
		expect(runtime.input("nope", "ls\n")).toEqual({ ok: false, error: "PTY is not connected" });

		runtime.resize("n1", 45, 9000);
		expect(resized!).toEqual(["n1", 45, 500]);

		const counted = (event: PtyEvent) => event.type === "health" && event.bytesIn === 4 && event.bytesOut === 6;
		expect(await waitFor(() => events.some(counted))).toBe(true);

		onExit!(0);
		expect(events.at(-1)).toEqual({ type: "exit", ptyId: "n1", exitCode: 0 });

		await runtime.stop();
	});

	test("a listener that throws is dropped, and the terminal is disconnected once nobody listens", async () => {
		let onData: ((data: string) => void) | null = null;
		let disconnects = 0;
		const connection: NativePtyConnection = {
			onData: (callback) => {
				onData = callback;
			},
			onExit: () => {},
			write: () => {},
			resize: () => {},
			disconnect: () => {
				disconnects += 1;
			},
		};
		const runtime = new PtyRuntime({
			ptyManager: fakeManager({ connectNative: () => connection }),
			log: () => {},
			resolveSecurePath: async (path) => path,
		});
		const kept: PtyEvent[] = [];
		const keeper = (event: PtyEvent) => kept.push(event);
		runtime.connect("n1", () => {
			throw new Error("gone");
		});
		runtime.connect("n1", keeper);

		onData!("hello");
		expect(await waitFor(() => kept.some((event) => event.type === "output"))).toBe(true);
		expect(disconnects).toBe(0);

		runtime.forget(keeper);
		expect(disconnects).toBe(1);
		expect(runtime.input("n1", "ls\n")).toEqual({ ok: false, error: "PTY is not connected" });

		await runtime.stop();
	});

	test("create puts the directory through the policy; the rest answer values, and a missing terminal is an error", async () => {
		let secureCalls = 0;
		const runtime = new PtyRuntime({
			ptyManager: fakeManager({ getPty: async () => null }),
			log: () => {},
			resolveSecurePath: async (path) => {
				secureCalls += 1;
				return path === "/allowed" ? "/allowed" : null;
			},
		});

		expect(await runtime.create({ cwd: "/denied" })).toEqual({ ok: false, error: "Invalid terminal directory" });
		expect(await runtime.create({ cwd: "/allowed" })).toEqual({ ok: true, value: makeSession("n1") });
		expect(secureCalls).toBe(2);
		expect(await runtime.list()).toEqual({ ok: true, value: [makeSession("n1")] });
		expect(await runtime.get("n1")).toEqual({ ok: false, error: "PTY session not found" });
		expect(await runtime.update("n1", { title: "renamed" })).toMatchObject({ ok: true, value: { title: "renamed" } });
		expect(await runtime.delete("n1")).toBe(true);
		expect(runtime.connect("n1", () => {})).toEqual({ ok: false, error: "PTY session not found" });

		await runtime.stop();
	});

	test("without the native library every terminal operation says so", async () => {
		const runtime = new PtyRuntime({
			ptyManager: fakeManager({ available: false } as Partial<PtyManager>),
			log: () => {},
			resolveSecurePath: async (path) => path,
		});
		expect(await runtime.list()).toEqual({ ok: false, error: "Terminal not available on this machine" });
		expect(await runtime.create({})).toEqual({ ok: false, error: "Terminal not available on this machine" });
		await runtime.stop();
	});
});
