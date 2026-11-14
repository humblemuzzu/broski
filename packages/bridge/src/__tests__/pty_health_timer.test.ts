import { describe, expect, test } from "bun:test";
import { GatedInterval } from "../workspace/pty/health-timer";
import { PtyManager } from "../workspace/pty/manager";
import type { NativePtyConnection } from "../workspace/pty/native-pty";
import { PtyRuntime } from "../workspace/pty/runtime";
import type { PtyEvent, PtySession } from "../workspace/pty/types";

function fakeInterval(): { start: (fn: () => void) => () => void; tick: () => void; starts: number; stops: number } {
	let current: (() => void) | null = null;
	const state = {
		starts: 0,
		stops: 0,
		start: (fn: () => void) => {
			state.starts++;
			current = fn;
			return () => {
				state.stops++;
				current = null;
			};
		},
		tick: () => current?.(),
	};
	return state;
}

class FakeNativeConnection implements NativePtyConnection {
	constructor(private onOutput: (data: string) => void) {}

	onData(callback: (data: string) => void): void {
		this.onOutput = callback;
	}

	onExit(_callback: (code?: number) => void): void {}

	write(data: string): void {
		this.onOutput(`echo:${data}`);
	}

	resize(): void {}

	disconnect(): void {}
}

class FakePtyManager extends PtyManager {
	constructor(private readonly connection: NativePtyConnection) {
		super();
	}

	override get available(): boolean {
		return true;
	}

	override async listPty(): Promise<PtySession[]> {
		return [];
	}

	override async createPty(): Promise<PtySession | null> {
		return null;
	}

	override async getPty(): Promise<PtySession | null> {
		return null;
	}

	override async updatePty(): Promise<PtySession | null> {
		return null;
	}

	override async deletePty(): Promise<boolean> {
		return true;
	}

	override resize(): void {}

	override connectNative(_id: string): NativePtyConnection | null {
		return this.connection;
	}

	override async stop(): Promise<void> {}
}

describe("GatedInterval", () => {
	test("starts on demand and only once", () => {
		const timers = fakeInterval();
		const gated = new GatedInterval({ intervalMs: 10, onTick: () => true, interval: { start: timers.start } });

		expect(gated.running).toBe(false);
		gated.ensureRunning();
		gated.ensureRunning();
		expect(timers.starts).toBe(1);
		expect(gated.running).toBe(true);
	});

	test("stops itself once the callback reports no work left", () => {
		const timers = fakeInterval();
		let work = true;
		const gated = new GatedInterval({ intervalMs: 10, onTick: () => work, interval: { start: timers.start } });

		gated.ensureRunning();
		gated.runTick();
		expect(gated.running).toBe(true);

		work = false;
		gated.runTick();
		expect(gated.running).toBe(false);
		expect(timers.stops).toBe(1);

		work = true;
		gated.ensureRunning();
		expect(timers.starts).toBe(2);
	});

	test("stop is idempotent", () => {
		const timers = fakeInterval();
		const gated = new GatedInterval({ intervalMs: 10, onTick: () => true, interval: { start: timers.start } });
		gated.ensureRunning();
		gated.stop();
		gated.stop();
		expect(timers.stops).toBe(1);
	});
});

describe("PtyRuntime health snapshot gating", () => {
	function makeRuntime(timers: ReturnType<typeof fakeInterval>): { runtime: PtyRuntime; manager: FakePtyManager } {
		const manager = new FakePtyManager(new FakeNativeConnection(() => {}));
		const runtime = new PtyRuntime({
			ptyManager: manager,
			log: () => {},
			resolveSecurePath: async (path) => path,
			healthInterval: { start: timers.start },
		});
		return { runtime, manager };
	}

	test("no health timer until a client listens to a PTY", async () => {
		const timers = fakeInterval();
		const { runtime, manager } = makeRuntime(timers);
		const events: PtyEvent[] = [];
		const listener = (event: PtyEvent) => events.push(event);

		expect(timers.starts).toBe(0);

		runtime.connect("n1", listener);
		expect(timers.starts).toBe(1);
		expect(manager.available).toBe(true);

		timers.tick();
		expect(events.filter((event) => event.type === "health").length).toBeGreaterThan(0);

		runtime.disconnect("n1", listener);
		timers.tick();
		expect(timers.stops).toBe(1);

		await runtime.stop();
	});

	test("stops the timer when the PTY is deleted", async () => {
		const timers = fakeInterval();
		const { runtime } = makeRuntime(timers);

		runtime.connect("n2", () => {});
		expect(timers.starts).toBe(1);

		await runtime.delete("n2");
		timers.tick();
		expect(timers.stops).toBe(1);

		await runtime.stop();
	});

	test("stop() clears the timer", async () => {
		const timers = fakeInterval();
		const { runtime } = makeRuntime(timers);

		runtime.connect("n3", () => {});
		expect(timers.starts).toBe(1);

		await runtime.stop();
		expect(timers.stops).toBe(1);
	});
});
